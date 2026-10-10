/** Keep independent dynamic UI plugin compilers alive inside one disposable development process. */

import { createHash } from 'node:crypto'
import { existsSync, globSync, readFileSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import type { UserConfig, UserConfigExport } from 'tsdown'
import { CLIENT_BUILD_RECORD_PATH, writeClientBuildRecord } from './client-build-environment.ts'
import { dobeeAdoptResidentBaseline, dobeePlanUiBuild } from './dobee-ui-build.ts'
import { dobeeVitePackage } from './dobee-vite-package.ts'
import type { DobeeViteBuildFiles } from './dobee-vite-cache.ts'

interface PluginInventory {
  readonly directory: string
  readonly name: string
  readonly files: DobeeViteBuildFiles
}

function fingerprint(files: ReadonlySet<string>): string {
  const hash = createHash('sha256')
  for (const path of [...files].sort()) {
    hash.update(path)
    hash.update(existsSync(path) ? readFileSync(path) : 'missing')
  }
  return hash.digest('hex')
}

function inside(root: string, path: string): string {
  const target = resolve(root, path)
  const local = relative(root, target)
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error('dobee-resident: path escapes the repository')
  }
  return target
}

/** One lazy Vite watcher, retaining its parsed module graph between source changes. */
class ResidentCompiler {
  private closeWatcher: (() => Promise<void>) | undefined
  private running = true
  private completedHash: string | undefined
  private startedHash: string | undefined
  private failure: unknown
  private readonly waiters = new Set<() => void>()

  constructor(private readonly inventory: PluginInventory) {}

  async open(root: string, config: UserConfig, interval: number): Promise<void> {
    await dobeeVitePackage(root, this.inventory.directory, { name: this.inventory.name }, config, this.inventory.files, {
      interval,
      opened: (close) => { this.closeWatcher = close },
      started: () => {
        this.running = true
        this.failure = undefined
        this.startedHash = fingerprint(this.inventory.files.inputs)
      },
      completed: () => {
        this.running = false
        this.completedHash = this.startedHash
        this.notify()
      },
      failed: (error) => { this.running = false; this.failure = error; this.notify() },
    })
  }

  async settled(): Promise<void> {
    const deadline = AbortSignal.timeout(30_000)
    while (this.running || this.completedHash !== fingerprint(this.inventory.files.inputs)) {
      if (this.failure !== undefined) throw new Error('dobee-resident: compiler failed', { cause: this.failure })
      await new Promise<void>((resolve, reject) => {
        const completed = (): void => {
          deadline.removeEventListener('abort', aborted)
          this.waiters.delete(completed)
          resolve()
        }
        const aborted = (): void => {
          this.waiters.delete(completed)
          reject(new Error(`dobee-resident: ${this.inventory.name} did not settle`))
        }
        this.waiters.add(completed)
        deadline.addEventListener('abort', aborted, { once: true })
        if (deadline.aborted) aborted()
      })
    }
    if (this.failure !== undefined) throw new Error('dobee-resident: compiler failed', { cause: this.failure })
    if ([...this.inventory.files.outputs].some(path => !existsSync(path))) throw new Error('dobee-resident: emitted output is missing')
  }

  async close(): Promise<void> {
    await this.closeWatcher?.()
    this.failure = new Error('dobee-resident: compiler closed')
    this.notify()
  }

  private notify(): void { for (const waiter of [...this.waiters]) waiter() }
}

/**
 * A lazily activated compiler set; structural/backend changes return to the checked subprocess build.
 * Compiler instances are bounded by the configured dynamic UI plugin roster.
 */
export class DobeeResidentUiBuild {
  private readonly inventories: readonly PluginInventory[]
  private readonly compilers = new Map<string, ResidentCompiler>()
  private closed = false

  /**
   * @param root - Repository with a successful full Desktop build and package input inventories.
   * @param environment - Fixed model-independent build environment; metadata is inherited from the complete build.
   * @param interval - Positive source polling interval.
   */
  constructor(private readonly root: string, private readonly environment: NodeJS.ProcessEnv, private readonly interval: number) {
    const inventories: PluginInventory[] = []
    for (const path of globSync('.dsh-build/dobee-vite/client/*.json', { cwd: root })) {
      const value: unknown = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
      if (typeof value !== 'object' || value === null || !('inputs' in value) || !Array.isArray(value.inputs)
        || !('outputs' in value) || !Array.isArray(value.outputs)) throw new Error('dobee-resident: invalid build inventory')
      const strings = (values: readonly unknown[]): Set<string> => new Set(values.map((value) => {
        if (typeof value !== 'string') throw new Error('dobee-resident: invalid inventory path')
        return inside(root, value)
      }))
      const outputs = strings(value.outputs)
      const entry = [...outputs].find(path => /\/packages\/client\/[^/]+\/lib\/client\.js$/.test(path.replaceAll('\\', '/')))
      if (entry === undefined) continue
      const directory = dirname(dirname(entry))
      const manifest: unknown = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
      if (typeof manifest !== 'object' || manifest === null || !('name' in manifest) || typeof manifest.name !== 'string') {
        throw new Error('dobee-resident: package inventory has no identity')
      }
      inventories.push({ directory, name: manifest.name, files: { inputs: strings(value.inputs), outputs } })
    }
    this.inventories = inventories
  }

  /**
   * Rebuild only dynamic plugins whose recorded input inventory includes an edited file.
   * @param paths - Repository-relative changes admitted by the serialized watch queue.
   * @returns True after selected compilers settle; false requests the existing guarded/full build path.
   */
  async build(paths: readonly string[]): Promise<boolean> {
    if (this.closed) throw new Error('dobee-resident: build process is closed')
    if (paths.length === 0) return false
    const started = performance.now()
    const plan = dobeePlanUiBuild(this.root, this.environment)
    const checkedBefore = performance.now()
    if (plan.kind !== 'ui' || plan.rendererReload) {
      console.log(`dobee-resident: ordinary build required (${plan.kind === 'full' ? plan.reason : 'static UI changed'})`)
      return false
    }
    const physical = paths.map(path => inside(this.root, path))
    const affected = this.inventories.filter(item => physical.some(path => item.files.inputs.has(path)))
    if (affected.length === 0 || physical.some(path => !affected.some(item => item.files.inputs.has(path)))) {
      console.log('dobee-resident: changed input has no complete dynamic-plugin inventory')
      return false
    }
    for (const item of affected) {
      let compiler = this.compilers.get(item.name)
      if (compiler === undefined) {
        const configPath = resolve(item.directory, 'tsdown.config.ts')
        if (/\b(?:readFile|readFileSync|readdir|readdirSync)\b/.test(readFileSync(configPath, 'utf8'))) return false
        const loaded = await import(pathToFileURL(configPath).href) as { default: UserConfigExport }
        const exported = await loaded.default
        const selected = typeof exported === 'function' ? await exported({ env: { DSH_BUILD_FACE: 'client' } }, { ci: false }) : exported
        const configs = Array.isArray(selected) ? selected : [selected]
        const config = configs.find(config => config.name === `${item.name}/client`)
        if (config === undefined || config.copy !== undefined || config.hooks !== undefined || config.onSuccess !== undefined) return false
        compiler = new ResidentCompiler(item)
        this.compilers.set(item.name, compiler)
        await compiler.open(this.root, config, this.interval)
      }
      await compiler.settled()
    }
    const after = dobeePlanUiBuild(this.root, this.environment)
    const checkedAfter = performance.now()
    if (after.kind !== 'ui' || after.rendererReload) return false
    const publicEnvironment: Record<string, string> = {}
    for (const [name, value] of Object.entries(this.environment)) {
      if (name.startsWith('DSH_CLIENT_') && value !== undefined) publicEnvironment[name] = value
    }
    writeClientBuildRecord(this.root, publicEnvironment)
    const recorded = performance.now()
    console.log(`dobee-resident: guard-before ${(checkedBefore - started).toFixed(1)}ms, `
      + `guard-after ${(checkedAfter - checkedBefore).toFixed(1)}ms including compilation, `
      + `record ${(recorded - checkedAfter).toFixed(1)}ms`)
    console.log(`dobee-resident: ${String(affected.length)} independent plugin compiler(s) settled`)
    return true
  }

  /** Close every compiler before ordinary builds or shutdown can write the same artifacts. */
  async close(): Promise<void> {
    this.closed = true
    const failures = await Promise.allSettled([...this.compilers.values()].map(compiler => compiler.close()))
    this.compilers.clear()
    const failed = failures.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw new Error('dobee-resident: compiler teardown failed', { cause: failed.reason })
  }
}

function main(): void {
  const root = resolve(import.meta.dirname, '..')
  const interval = Number(process.env.DOBEE_WATCH_INTERVAL ?? '500')
  if (!Number.isSafeInteger(interval) || interval < 1) throw new Error('dobee-resident: invalid polling interval')
  const environment = { ...process.env }
  const baselineAdopted = dobeeAdoptResidentBaseline(root, environment)
  const build = new DobeeResidentUiBuild(root, environment, interval)
  let pending = Promise.resolve()
  const stop = async (): Promise<void> => { await build.close(); if (process.connected) process.disconnect() }
  process.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'stop') { pending = pending.then(stop); return }
    if (message.type !== 'build' || !('id' in message) || !Number.isSafeInteger(message.id)
      || !('paths' in message) || !Array.isArray(message.paths)) {
      throw new Error('dobee-resident: invalid build request')
    }
    const paths: string[] = message.paths.map((path: unknown) => {
      if (typeof path !== 'string') throw new Error('dobee-resident: invalid edited path')
      return path
    })
    const id = message.id
    pending = pending.then(async () => {
      try {
        const reused = baselineAdopted && await build.build(paths)
        process.send?.({ type: 'result', id, reused })
      } catch (error) {
        rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
        process.send?.({ type: 'result', id, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })
  process.once('disconnect', () => {
    void build.close().catch((error: unknown) => { console.error('dobee-resident: disconnected compiler teardown failed', error); process.exitCode = 1 })
  })
  process.send?.({ type: 'ready' })
}

if (import.meta.main) main()
