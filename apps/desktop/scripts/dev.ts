/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { developmentRuntimeDirectory, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareDevelopmentProject } from './development-project.ts'
import { prepareDevelopmentApp } from './development-app.ts'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'
import { DobeeDevelopmentProcess } from '../../../scripts/dobee-development-process.ts'
import { DobeeDesktopRebuildQueue, dobeeDesktopRestartRequired, dobeeWatchDesktopSources } from '../../../scripts/dobee-desktop-watch.ts'
import { dobeeReloadDesktopRenderer } from '../../../scripts/dobee-renderer-reload.ts'
import { dobeeBuildUpdate } from '../../../scripts/dobee-ui-build.ts'
import { DobeeResidentUiProcess } from '../../../scripts/dobee-ui-resident-process.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')

interface PackageManifest {
  readonly version?: string
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string, args: readonly string[] = []): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop')
  }
  await run(process.execPath, [packageManager, 'run', script, ...args], cwd)
}

interface ElectronInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: NodeJS.ProcessEnv
}

function electronInvocation(): ElectronInvocation {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229)
  const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222)
  const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230)
  const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = resolve(process.env.DSH_DESKTOP_USER_DATA_DIR ?? join(DEVELOPMENT_ROOT, 'electron-user-data'))
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_PRIMARY_RUNTIME_DIR: process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR ?? developmentRuntimeDirectory(),
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
  }
  console.log(`desktop development: DSH_HOME=${home}`)
  console.log(`desktop development: userData=${userData}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  if (process.platform === 'darwin') {
    const executable = prepareDevelopmentApp({ electron, appRoot: APP_ROOT, directory: DEVELOPMENT_ROOT, home, userData,
      mainPort, rendererPort, hostPort, openDevtools: environment.DSH_DESKTOP_OPEN_DEVTOOLS! })
    return { command: executable, args: [], environment }
  }
  return { command: electron, args: [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], environment }
}

async function watchDesktop(interval: number): Promise<void> {
  const shutdown = Promise.withResolvers<{ readonly error?: unknown }>()
  const fail = (error: unknown): void => { shutdown.resolve({ error }) }
  let application: DobeeDevelopmentProcess | undefined
  let restarting = false
  let closing = false
  let resident: DobeeResidentUiProcess | undefined
  const start = async (): Promise<void> => {
    const invocation = electronInvocation()
    application = new DobeeDevelopmentProcess(invocation.command, invocation.args, {
      cwd: APP_ROOT, env: invocation.environment, stdio: 'inherit',
    })
    const current = application
    void current.exited.then((result) => {
      if (restarting || closing) return
      if (result.code === 0) shutdown.resolve({})
      else fail(new Error(`desktop development: Electron exited ${String(result.code ?? result.signal)}`))
    }, fail)
    await new Promise<void>((resolve, reject) => {
      current.child.once('spawn', resolve)
      current.child.once('error', reject)
    })
  }
  const stop = async (): Promise<void> => { await application?.stop(); application = undefined }
  const queue = new DobeeDesktopRebuildQueue({
    async build(paths, signal) {
      if (!dobeeDesktopRestartRequired(paths)) {
        resident ??= new DobeeResidentUiProcess(REPOSITORY_ROOT, process.env, interval)
        if (await resident.build(paths, signal)) return 'hmr'
      }
      await resident?.close()
      resident = undefined
      const packageManager = process.env.npm_execpath
      if (packageManager === undefined) throw new Error('desktop development: watch requires pnpm run')
      const build = new DobeeDevelopmentProcess(process.execPath, [
        packageManager, 'run', 'build:desktop-runtime', '--record-ui-baseline',
        ...(!dobeeDesktopRestartRequired(paths) ? ['--ui'] : []),
      ], {
        cwd: REPOSITORY_ROOT, env: process.env, stdio: 'inherit',
      })
      const cancel = (): void => { void build.stop().catch(fail) }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const result = await build.exited
        if (result.code !== 0 && !signal.aborted) throw new Error(`desktop development: rebuild exited ${String(result.code ?? result.signal)}`)
      } finally {
        signal.removeEventListener('abort', cancel)
        if (signal.aborted) await build.stop()
      }
      return signal.aborted ? 'hmr' : dobeeBuildUpdate(REPOSITORY_ROOT)
    },
    async restart(signal) {
      restarting = true
      try {
        await stop()
        if (!signal.aborted) await start()
      } finally { restarting = false }
    },
    async reload(signal) {
      const pid = application?.child.pid
      if (pid === undefined) throw new Error('desktop development: no owned Electron process to reload')
      await dobeeReloadDesktopRenderer(debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222), pid, signal)
    },
    async failed(error) {
      console.error('desktop development: rebuild failed; stopping the application until the next successful edit', error)
      restarting = true
      try {
        try { await resident?.close(); resident = undefined } finally { await stop() }
      } finally { restarting = false }
    },
  })
  let changed = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const closeWatcher = await dobeeWatchDesktopSources(REPOSITORY_ROOT, (path) => {
    changed.add(path)
    clearTimeout(timer)
    timer = setTimeout(() => {
      const paths = [...changed]
      changed = new Set()
      void queue.enqueue(paths).catch(fail)
    }, 200)
  }, fail, interval)
  const terminate = (): void => { shutdown.resolve({}) }
  process.on('SIGINT', terminate)
  process.on('SIGTERM', terminate)
  try {
    await start()
    console.log('desktop development: watching sources; Host/Main/Preload edits restart the application and interrupt tasks')
    const result = await shutdown.promise
    if ('error' in result) throw result.error
  } finally {
    closing = true
    clearTimeout(timer)
    process.off('SIGINT', terminate)
    process.off('SIGTERM', terminate)
    try { await closeWatcher() } finally {
      try { await queue.close() } finally {
        try { await resident?.close() } finally { await stop() }
      }
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    'skip-build': { type: 'boolean', default: false },
    watch: { type: 'boolean', default: false },
    'watch-interval': { type: 'string', default: '500' },
  } })
  const interval = Number(values['watch-interval'])
  if (!Number.isSafeInteger(interval) || interval < 1) throw new Error('desktop development: --watch-interval must be a positive integer')
  if (!values['skip-build']) {
    await runPackageScript('build:desktop-runtime', REPOSITORY_ROOT, values.watch ? ['--record-ui-baseline'] : [])
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: execFileSync(createRequire(import.meta.url)('electron') as string, ['-p', 'process.versions.node'],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim(),
    pnpmVersion,
  }
  prepareDevelopmentProject({
    projectDir: join(DEVELOPMENT_ROOT, 'project'),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
    target: resolveDesktopBuildTarget(),
  })
  await preparePrimaryRuntime()
  if (values.watch) await watchDesktop(interval)
  else {
    const invocation = electronInvocation()
    await run(invocation.command, invocation.args, APP_ROOT, invocation.environment)
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
