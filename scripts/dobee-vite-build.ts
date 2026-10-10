/** Run source-based Vite builds without merging independently loaded Cordis plugins. */

import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import type { UserConfig, UserConfigExport } from 'tsdown'
import { WorkspaceTypertGenerator } from '../packages/typert/generator/src/workspace.ts'
import { typertPlugin } from '../packages/typert/generator/src/tsdown-plugin.ts'
import { dobeeCachedHostTypert } from './dobee-typert-cache.ts'
import { dobeePublicTypeEntries, dobeeVitePackage, type DobeeBuildManifest } from './dobee-vite-package.ts'
import { dobeeDesktopPackageClosure, dobeeWorkspaceBuildPackages } from './dobee-desktop-build-scope.ts'
import { DobeeViteArtifactCache, dobeeViteBuildKey, type DobeeViteBuildFiles } from './dobee-vite-cache.ts'

const root = resolve(import.meta.dirname, '..')
const packageTimings: Array<{ name: string; milliseconds: number; builds: number }> = []
let artifactCache: DobeeViteArtifactCache | undefined
let reusedPackages = 0
let building = false

function manifest(directory: string): DobeeBuildManifest {
  const value: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new Error(`dobee-vite: ${directory}/package.json needs a package name`)
  }
  const section = (key: string): Record<string, string> | undefined => {
    const configured = value[key]
    if (configured === undefined) return undefined
    if (!isRecord(configured)) throw new Error(`dobee-vite: ${directory}/package.json ${key} must be an object`)
    const result: Record<string, string> = {}
    for (const [name, version] of Object.entries(configured)) {
      if (typeof version !== 'string') throw new Error(`dobee-vite: ${directory}/package.json ${key}.${name} must be a string`)
      result[name] = version
    }
    return result
  }
  const dependencies = section('dependencies')
  const peerDependencies = section('peerDependencies')
  const optionalDependencies = section('optionalDependencies')
  return {
    name: value.name, exports: value.exports,
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(peerDependencies === undefined ? {} : { peerDependencies }),
    ...(optionalDependencies === undefined ? {} : { optionalDependencies }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
async function configs(directory: string, face: 'host' | 'client' | 'desktop'): Promise<UserConfig[]> {
  const path = join(directory, 'tsdown.config.ts')
  if (existsSync(path)) {
    const loaded = await import(pathToFileURL(path).href) as { default: UserConfigExport }
    const value = await loaded.default
    const selected = typeof value === 'function' ? await value({ env: { DSH_BUILD_FACE: face } }, { ci: false }) : value
    return Array.isArray(selected) ? selected : [selected]
  }
  if (face === 'client') return []
  if (directory === join(root, 'native/system/packages/entry')) {
    return [{ entry: ['src/index.ts', 'src/flock.ts'], format: ['esm'], platform: 'node', target: 'es2024' }]
  }
  const entry = ['index', 'startup'].flatMap(name => existsSync(join(directory, `src/${name}.ts`)) ? [`src/${name}.ts`] : [])
  return entry.length === 0 ? [] : [{ entry, format: ['esm'], platform: 'node', target: 'es2024', clean: false, dts: false }]
}

async function packageBuild(directory: string, face: 'host' | 'client' | 'desktop'): Promise<void> {
  const started = performance.now()
  const declaration = manifest(directory)
  const selected = await configs(directory, face)
  if (!selected.some(config => config.entry)) return
  const publicEntries = dobeePublicTypeEntries(declaration.exports)
  const build = async (files?: DobeeViteBuildFiles): Promise<void> => {
    for (const config of selected) await dobeeVitePackage(root, directory, declaration, config, files)
    for (const entry of publicEntries) {
      await dobeeVitePackage(root, directory, declaration, {
        entry: { [entry.slice('./lib/types/'.length, -'.js'.length)]: entry },
        outDir: 'lib/types', format: ['esm'], platform: 'node', target: 'es2024',
        outputOptions: { codeSplitting: false }, dts: false, clean: false,
      }, files)
    }
  }
  // Nested build hooks do not expose their dependency/output inventories.
  const configPath = join(directory, 'tsdown.config.ts')
  const unobservedReads = existsSync(configPath)
    && /\b(?:readFile|readFileSync|readdir|readdirSync)\b/.test(readFileSync(configPath, 'utf8'))
  const cacheable = !unobservedReads && !selected.some(config => config.onSuccess !== undefined || config.hooks !== undefined)
  const reused = artifactCache !== undefined && cacheable ? await artifactCache.run(directory, build) : (await build(), false)
  if (reused) reusedPackages++
  packageTimings.push({
    name: declaration.name,
    milliseconds: performance.now() - started,
    builds: selected.filter(config => Boolean(config.entry)).length + publicEntries.length,
  })
}

function generateHost(checked: boolean, selection?: ReadonlySet<string>): void {
  const started = performance.now()
  const plugin = typertPlugin({ mode: 'workspace', faces: ['host'] })
  if (!checked || selection !== undefined) {
    plugin.writeBundle = () => {
      const generator = new WorkspaceTypertGenerator(root, { checkDiagnostics: !checked })
      const packages = generator.discover(['host']).filter((candidate) => {
        const exports = manifest(join(root, candidate.root)).exports
        return (selection === undefined || selection.has(candidate.package))
          && typeof exports === 'object' && exports !== null
          && ['./typert', './client/typert', './remote'].some(key => key in exports)
      }).map(candidate => candidate.package)
      for (const artifact of generator.generate(packages, ['host'])) {
        const directory = join(root, artifact.packageRoot, 'lib')
        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, `typert.${artifact.face}.js`), artifact.js)
        writeFileSync(join(directory, `typert.${artifact.face}.d.ts`), artifact.dts)
        if (artifact.remote !== undefined) {
          writeFileSync(join(directory, 'typert.remote-client.js'), artifact.remote.js)
          writeFileSync(join(directory, 'typert.remote-client.d.ts'), artifact.remote.dts)
          writeFileSync(join(directory, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
        } else {
          for (const file of ['typert.remote-client.js', 'typert.remote-client.d.ts', 'typert.remote-client.d.ts.map']) {
            rmSync(join(directory, file), { force: true })
          }
        }
      }
    }
  }
  dobeeCachedHostTypert(plugin, root, selection === undefined ? 'all' : JSON.stringify([...selection].sort()))
    .writeBundle({ dir: join(root, 'packages/core/agent/lib') })
  console.log(`dobee-build: Typert completed in ${((performance.now() - started) / 1000).toFixed(3)}s`)
}

/** Independent compiler faces and specialized artifact groups accepted by the Vite coordinator. */
export type DobeeViteFace = 'host' | 'client' | 'desktop' | 'native' | 'bench'

/** Precomputed runtime selection shared by serial build stages. */
export interface DobeeViteSelection {
  readonly names: ReadonlySet<string>
  readonly directories: ReadonlySet<string>
  readonly totalPackages: number
}

/**
 * Validate a Desktop coordinator's selection before a child reads package files.
 * @param root - Repository root containing every selected package directory.
 * @param value - JSON received through the child's stdin.
 * @returns Runtime selection reconstructed as read-only sets.
 */
export function dobeeReadViteSelection(root: string, value: unknown): DobeeViteSelection {
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')
  if (!isRecord(value) || !strings(value.names) || !strings(value.directories)
    || typeof value.totalPackages !== 'number' || !Number.isSafeInteger(value.totalPackages)
    || value.names.length === 0 || value.names.length !== value.directories.length
    || new Set(value.names).size !== value.names.length || new Set(value.directories).size !== value.directories.length
    || value.totalPackages < value.names.length) {
    throw new Error('dobee-vite: stdin requires a complete Desktop runtime selection')
  }
  for (const directory of value.directories) {
    const local = relative(root, directory)
    if (!isAbsolute(directory) || local === '' || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error('dobee-vite: selected package directory must be inside the repository')
    }
  }
  return { names: new Set(value.names), directories: new Set(value.directories), totalPackages: value.totalPackages }
}

/**
 * Build one independent Vite face, optionally borrowing a selection computed by the Desktop coordinator.
 * @param face - Artifact group to compile.
 * @param checked - Whether Host source projects passed semantic checking in this orchestration.
 * @param concurrency - Maximum simultaneous package builds.
 * @param selected - Immutable Desktop runtime package selection, shared only within this complete build.
 */
export async function dobeeBuildViteFace(
  face: DobeeViteFace, checked: boolean, concurrency: number, selected?: DobeeViteSelection,
): Promise<void> {
  if (building) throw new Error('dobee-vite: independent compiler faces must run serially in one process')
  building = true
  try { await buildFace(face, checked, concurrency, selected) } finally { building = false }
}

async function buildFace(
  face: DobeeViteFace, checked: boolean, concurrency: number, selected: DobeeViteSelection | undefined,
): Promise<void> {
  packageTimings.length = 0
  reusedPackages = 0
  artifactCache = undefined
  const scope = process.env.DSH_BUILD_SCOPE ?? 'all'
  if (scope !== 'all' && scope !== 'desktop') throw new Error('dobee-vite: DSH_BUILD_SCOPE must be all or desktop')
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('dobee-vite: --concurrency must be a positive integer')
  if (scope === 'desktop') artifactCache = new DobeeViteArtifactCache(root, face, dobeeViteBuildKey(root, process.env))
  if (face === 'desktop') {
    await packageBuild(join(root, 'apps/desktop'), face)
    return
  }
  if (face === 'native') {
    await packageBuild(join(root, 'native/system/packages/entry'), 'host')
    return
  }
  if (face === 'bench') {
    const directory = join(root, 'benchmarks')
    const loaded = await import(pathToFileURL(join(directory, 'tsdown.config.ts')).href) as { default: UserConfig[] }
    for (const config of loaded.default) await dobeeVitePackage(root, directory, manifest(directory), config)
    return
  }
  let directories = globSync(['vendor/*/package.json', 'packages/*/*/package.json', 'apps/cli/package.json',
    ...(face === 'host' ? ['apps/desktop-host/package.json', 'native/system/packages/entry/package.json'] : [])],
  { cwd: root }).sort().map(path => resolve(root, dirname(path)))
  let selection: ReadonlySet<string> | undefined
  if (scope === 'desktop') {
    let roster = selected
    if (roster === undefined) {
      const packages = dobeeWorkspaceBuildPackages(root)
      const names = dobeeDesktopPackageClosure(packages)
      const directories = new Set([...names].map((name) => {
        const item = packages.get(name)
        if (item === undefined) throw new Error(`dobee-vite: missing selected package ${name}`)
        return item.directory
      }))
      roster = { names, directories, totalPackages: packages.size }
    }
    selection = roster.names
    const selectedDirectories = roster.directories
    directories = directories.filter(directory => selectedDirectories.has(directory))
    console.log(`dobee-build: Desktop selects ${String(selection.size)}/${String(roster.totalPackages)} runtime packages`)
  }
  let next = 0
  const started = performance.now()
  await Promise.all(Array.from({ length: Math.min(concurrency, directories.length) }, async () => {
    while (next < directories.length) {
      const directory = directories[next++]
      if (directory !== undefined) await packageBuild(directory, face)
    }
  }))
  console.log(`dobee-build: ${face} Vite ${String(packageTimings.length)} packages, `
    + `${String(packageTimings.reduce((sum, item) => sum + item.builds, 0))} builds in `
    + `${((performance.now() - started) / 1000).toFixed(3)}s`)
  console.log(`dobee-build: ${face} reused ${String(reusedPackages)} verified package outputs`)
  for (const item of packageTimings.sort((left, right) => right.milliseconds - left.milliseconds).slice(0, 5)) {
    console.log(`dobee-build: ${item.name} ${(item.milliseconds / 1000).toFixed(3)}s (${String(item.builds)} builds)`)
  }
  if (face === 'host') generateHost(checked, selection)
  console.log(`dobee-vite: ${face} source build complete`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { face: { type: 'string' }, checked: { type: 'boolean', default: false }, concurrency: { type: 'string' },
      'selection-stdin': { type: 'boolean', default: false } },
  })
  const face = values.face
  if (face !== 'host' && face !== 'client' && face !== 'desktop' && face !== 'native' && face !== 'bench') {
    throw new Error('dobee-vite: --face must be host, client, desktop, native, or bench')
  }
  if (values['selection-stdin'] && process.env.DSH_BUILD_SCOPE !== 'desktop') {
    throw new Error('dobee-vite: --selection-stdin requires the Desktop build scope')
  }
  const selected = values['selection-stdin'] ? dobeeReadViteSelection(root, JSON.parse(readFileSync(0, 'utf8'))) : undefined
  const concurrency = values.concurrency === undefined ? availableParallelism() : Number(values.concurrency)
  await dobeeBuildViteFace(face, values.checked, concurrency, selected)
}

if (import.meta.main) await main()
