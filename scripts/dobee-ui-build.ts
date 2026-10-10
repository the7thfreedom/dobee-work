/** Admit UI-only rebuilds only while the successful Desktop build's Host inputs and artifacts remain unchanged. */

import { createHash } from 'node:crypto'
import { existsSync, globSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { repositoryConfigHost } from './ts-project.ts'
import { dobeeDeclarationProjects } from './dobee-declarations.ts'
import { dobeeDesktopPackageClosure, dobeeWorkspaceBuildPackages } from './dobee-desktop-build-scope.ts'
import { dobeeDesktopChangeKind } from './dobee-desktop-watch.ts'

const BASELINE = '.dsh-build/dobee-ui-baseline.json'
/** Successful build route consumed by the serialized Desktop watcher. */
export const DOBEE_BUILD_RESULT = '.dsh-build/dobee-build-result.json'
const GENERATED = /(?:^|\/)(?:node_modules|\.dsh-build|\.desktop-build|\.cache|\.generated)(?:\/|$)/
const ARTIFACTS = /^(?:packages\/[^/]+\/[^/]+|vendor\/[^/]+|apps\/[^/]+|native\/system(?:\/packages\/[^/]+)?)\/(?:lib|dist)(?:\/|$)/

interface Baseline {
  readonly version: 2
  readonly environment: string
  readonly hostInputs: readonly string[]
  readonly sources: string
  readonly uiRoster: string
  readonly staticUi: string
  readonly hostOutputs: readonly string[]
  readonly outputs: string
}

function hash(paths: readonly string[]): string {
  const result = createHash('sha256')
  for (const path of [...new Set(paths)].sort()) {
    result.update(JSON.stringify(path))
    let bytes: Buffer
    try {
      bytes = readFileSync(path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        result.update('missing')
        continue
      }
      throw new Error(`dobee-ui-build: cannot read input file ${path}`, { cause: error })
    }
    result.update(JSON.stringify(bytes.length)).update(bytes)
  }
  return result.digest('hex')
}

function environmentKey(environment: NodeJS.ProcessEnv): string {
  return createHash('sha256').update(JSON.stringify([process.version, process.platform, process.arch,
    Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))])).digest('hex')
}

/**
 * Enumerate the complete UI-guard source corpus without repeatedly expanding overlapping globs.
 * Repository source and installed dependency declarations are scanned afresh on every call.
 * @param root - Repository root.
 * @returns Absolute input paths; generated outputs, tests and dependency directory links are excluded.
 */
export function dobeeUiSourcePaths(root: string): string[] {
  const paths: string[] = []
  const ignoredFile = (path: string): boolean => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)
    || /(?:^|\/)(?:tests|test)(?:\/|$)/.test(path)
  const file = (path: string, dependency: boolean): boolean => dependency
    ? /\.(?:ts|mts|cts|json)$/.test(path) || path === 'node_modules/.pnpm/lock.yaml'
    : /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|yaml|yml|css|html|png|svg|woff|woff2|ttf)$/.test(path)
      || path.startsWith('native/') && /\.(?:c|h|cc|cpp|cxx|rs)$/.test(path)
  const visit = (directory: string, dependency: boolean): void => {
    const absolute = resolve(root, directory)
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = `${directory}/${entry.name}`
      if (ignoredFile(path)) continue
      if (!dependency && (GENERATED.test(path) || ARTIFACTS.test(path))) continue
      if (entry.isDirectory()) visit(path, dependency)
      else if (file(path, dependency) && (entry.isFile() || entry.isSymbolicLink() && statSync(resolve(root, path)).isFile())) {
        paths.push(resolve(root, path))
      }
    }
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith('.') && /\.(?:ts|js|mjs|cjs|json|yaml|yml)$/.test(entry.name) && !ignoredFile(entry.name)
      && (entry.isFile() || entry.isSymbolicLink() && statSync(resolve(root, entry.name)).isFile())) {
      paths.push(resolve(root, entry.name))
    }
  }
  for (const directory of ['apps', 'packages', 'vendor', 'native', 'scripts']) visit(directory, false)
  visit('node_modules/.pnpm', true)
  return paths.sort()
}

function sources(root: string, hostInputs: readonly string[]): { sources: string; uiRoster: string; staticUi: string } {
  const paths = dobeeUiSourcePaths(root)
  const reachable = new Set(hostInputs)
  const ui = paths.filter(path => !reachable.has(path) && dobeeDesktopChangeKind(relative(root, path)) !== 'restart')
  const uiSet = new Set(ui)
  const packageKinds = new Map<string, boolean>()
  const dynamic = (path: string): boolean => {
    const local = relative(root, path).replaceAll('\\', '/')
    if (!/^packages\/client\/[^/]+\/src\/client\//.test(local)) return false
    const packagePath = resolve(root, local.split('/').slice(0, 3).join('/'), 'package.json')
    const cached = packageKinds.get(packagePath)
    if (cached !== undefined) return cached
    const manifest: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))
    const kind = typeof manifest === 'object' && manifest !== null && 'dsh' in manifest
      && typeof manifest.dsh === 'object' && manifest.dsh !== null && 'client' in manifest.dsh
    packageKinds.set(packagePath, kind)
    return kind
  }
  const result = {
    sources: hash([...hostInputs, ...paths.filter(path => !uiSet.has(path))]),
    uiRoster: createHash('sha256').update(JSON.stringify(ui.sort())).digest('hex'),
    staticUi: hash(ui.filter(path => !dynamic(path))),
  }
  return result
}

/**
 * Resolve source-plane Host imports, including type-only imports into otherwise UI-classified files.
 * @param root - Repository root.
 * @returns Actual transitive source and declaration files referenced by the selected Host projects.
 */
export function dobeeHostSourceInputs(root: string): string[] {
  const packages = dobeeWorkspaceBuildPackages(root)
  const names = dobeeDesktopPackageClosure(packages)
  const directories = new Set([...names].map((name) => {
    const item = packages.get(name)
    if (item === undefined) throw new Error(`dobee-ui-build: missing selected package ${name}`)
    return item.directory
  }))
  const projects = dobeeDeclarationProjects(root, 'host', directories)
  const inputs = new Set<string>()
  const pending: string[] = []
  for (const project of projects) {
    const path = project.endsWith('.json') ? project : resolve(project, 'tsconfig.json')
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, repositoryConfigHost)
    if (parsed === undefined || parsed.errors.length > 0) throw new Error(`dobee-ui-build: cannot parse ${path}`)
    pending.push(...parsed.fileNames)
  }
  const firstSource = pending[0]
  if (firstSource === undefined) throw new Error('dobee-ui-build: no Host source files')
  const loaded = ts.readConfigFile(resolve(root, 'tsconfig.host.json'), path => ts.sys.readFile(path))
  const configuration: unknown = loaded.config
  if (loaded.error !== undefined || typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) {
    throw new Error('dobee-ui-build: Host aggregate configuration is unavailable')
  }
  const aggregate = ts.parseJsonConfigFileContent({
    ...configuration, files: [firstSource], include: [], references: [],
  }, ts.sys, root)
  if (aggregate.errors.length > 0) throw new Error('dobee-ui-build: invalid Host compiler options')
  const options = aggregate.options
  const cache = ts.createModuleResolutionCache(root, path => path, options)
  while (pending.length > 0) {
    const path = pending.pop()
    if (path === undefined || inputs.has(path) || !existsSync(path)) continue
    inputs.add(path)
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue
    const info = ts.preProcessFile(readFileSync(path, 'utf8'), true, path.endsWith('.js'))
    for (const dependency of info.importedFiles) {
      const module = ts.resolveModuleName(dependency.fileName, path, options, ts.sys, cache).resolvedModule
      if (module !== undefined) pending.push(module.resolvedFileName)
    }
    for (const dependency of info.referencedFiles) pending.push(resolve(dirname(path), dependency.fileName))
    for (const dependency of info.typeReferenceDirectives) {
      const type = ts.resolveTypeReferenceDirective(dependency.fileName, path, options, ts.sys).resolvedTypeReferenceDirective
      if (type?.resolvedFileName !== undefined) pending.push(type.resolvedFileName)
    }
  }
  for (const path of globSync('.dsh-build/dobee-vite/host/*.json', { cwd: root })) {
    const value: unknown = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
    if (typeof value !== 'object' || value === null || !('inputs' in value) || !Array.isArray(value.inputs)) {
      throw new Error('dobee-ui-build: invalid Host artifact input inventory')
    }
    const recorded: readonly unknown[] = value.inputs
    for (const item of recorded) {
      if (typeof item !== 'string') throw new Error('dobee-ui-build: invalid Host input path')
      inputs.add(item)
    }
  }
  for (const input of inputs) {
    const local = relative(root, input)
    if (!isAbsolute(input) || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error('dobee-ui-build: Host input escapes the repository')
    }
  }
  return [...inputs].sort()
}

function hostArtifacts(root: string): string[] {
  return globSync([
    'apps/desktop/lib/{main.js,preload*.cjs,command-manager-entry.js}',
    'apps/desktop-host/lib/**/*.js',
    'vendor/*/lib/**/*.{js,mjs,cjs}',
    'packages/*/*/lib/typert.*',
    'packages/*/*/lib/**/*.js',
    'packages/*/*/lib/**/*.cjs',
    'native/system/packages/*/prebuilds/**/*',
  ], { cwd: root }).filter(path => !/\/client(?:\.[^/]+)?\.js$/.test(path))
    .filter((path) => {
      if (!/^packages\/client\//.test(path) || path.includes('/typert.')) return true
      if (!/\/lib\/index\.js$/.test(path)) return false
      const value: unknown = JSON.parse(readFileSync(resolve(root, path.split('/').slice(0, 3).join('/'), 'package.json'), 'utf8'))
      return typeof value === 'object' && value !== null && 'dsh' in value
        && typeof value.dsh === 'object' && value.dsh !== null && 'client' in value.dsh
    })
    .map(path => resolve(root, path)).filter(path => statSync(path).isFile()).sort()
}

function parse(root: string): Baseline | undefined {
  const path = resolve(root, BASELINE)
  if (!existsSync(path)) return undefined
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof value === 'object' && value !== null && 'version' in value && value.version === 1) {
    console.log('dobee-ui-build: previous baseline format requires a complete Desktop build')
    return undefined
  }
  if (typeof value !== 'object' || value === null
    || !('version' in value) || value.version !== 2
    || !('environment' in value) || typeof value.environment !== 'string'
    || !('sources' in value) || typeof value.sources !== 'string'
    || !('uiRoster' in value) || typeof value.uiRoster !== 'string'
    || !('staticUi' in value) || typeof value.staticUi !== 'string'
    || !('outputs' in value) || typeof value.outputs !== 'string'
    || !('hostInputs' in value) || !Array.isArray(value.hostInputs)
    || !('hostOutputs' in value) || !Array.isArray(value.hostOutputs)) {
    throw new Error('dobee-ui-build: invalid baseline; run pnpm run clean and a complete Desktop build')
  }
  const paths = (items: readonly unknown[]): string[] => items.map((item) => {
    if (typeof item !== 'string' || !isAbsolute(item)) throw new Error('dobee-ui-build: invalid baseline path')
    const local = relative(root, item)
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error('dobee-ui-build: baseline path escapes repository')
    return item
  })
  return {
    version: 2, environment: value.environment, sources: value.sources,
    uiRoster: value.uiRoster, staticUi: value.staticUi, outputs: value.outputs,
    hostInputs: paths(value.hostInputs), hostOutputs: paths(value.hostOutputs),
  }
}

/**
 * Publish the baseline after a complete Desktop build succeeds.
 * @param root - Repository root.
 * @param environment - Build environment; only its digest is persisted.
 */
export function dobeeRecordUiBaseline(root: string, environment: NodeJS.ProcessEnv): void {
  const previous = parse(root)
  const unchanged = previous !== undefined && previous.environment === environmentKey(environment)
    ? sources(root, previous.hostInputs) : undefined
  const hostInputs = previous !== undefined && unchanged?.sources === previous.sources && unchanged.uiRoster === previous.uiRoster
    ? [...previous.hostInputs] : dobeeHostSourceInputs(root)
  const hostOutputs = hostArtifacts(root)
  for (const required of ['apps/desktop/lib/main.js', 'apps/desktop-host/lib/index.js']) {
    if (!hostOutputs.includes(resolve(root, required))) throw new Error(`dobee-ui-build: missing required artifact ${required}`)
  }
  const snapshot = sources(root, hostInputs)
  const value: Baseline = {
    version: 2, environment: environmentKey(environment), hostInputs, hostOutputs,
    ...snapshot, outputs: hash(hostOutputs),
  }
  mkdirSync(resolve(root, '.dsh-build'), { recursive: true })
  writeFileSync(resolve(root, BASELINE), `${JSON.stringify(value)}\n`)
}

/**
 * Verify that UI-only rebuilds may retain every running Node process and Host reflection artifact.
 * @param root - Repository root.
 * @param environment - Current build environment.
 * @returns A complete-build reason, or an admitted UI build with its required page-refresh action.
 */
export function dobeePlanUiBuild(
  root: string, environment: NodeJS.ProcessEnv,
): { kind: 'full'; reason: string } | { kind: 'ui'; rendererReload: boolean; staticUi: string } {
  const baseline = parse(root)
  if (baseline === undefined) return { kind: 'full', reason: 'no successful Desktop baseline' }
  if (baseline.environment !== environmentKey(environment)) return { kind: 'full', reason: 'build environment changed' }
  const snapshot = sources(root, baseline.hostInputs)
  if (snapshot.uiRoster !== baseline.uiRoster) return { kind: 'full', reason: 'UI source roster changed' }
  if (snapshot.sources !== baseline.sources) return { kind: 'full', reason: 'Host or shared inputs changed' }
  if (hash(baseline.hostOutputs) !== baseline.outputs) return { kind: 'full', reason: 'Host artifacts changed' }
  return { kind: 'ui', rendererReload: snapshot.staticUi !== baseline.staticUi, staticUi: snapshot.staticUi }
}

/**
 * Publish the static UI input digest captured before a successful UI rebuild.
 * @param root - Repository root.
 * @param staticUi - Pre-build digest; later edits remain detectable by the next build.
 */
export function dobeeRefreshStaticUiBaseline(root: string, staticUi: string): void {
  const baseline = parse(root)
  if (baseline === undefined) throw new Error('dobee-ui-build: successful UI rebuild lost its Host baseline')
  writeFileSync(resolve(root, BASELINE), `${JSON.stringify({ ...baseline, staticUi })}\n`)
}

/**
 * Bind a fresh resident compiler process to an already-verified Host baseline.
 * This never accepts changed Host inputs as a new successful build.
 * @param root - Repository with a prior successful Desktop build.
 * @param environment - Resident process environment carrying that build's public metadata.
 * @returns Whether the prior Host inputs and outputs still match.
 */
export function dobeeAdoptResidentBaseline(root: string, environment: NodeJS.ProcessEnv): boolean {
  const baseline = parse(root)
  if (baseline === undefined) return false
  const snapshot = sources(root, baseline.hostInputs)
  if (snapshot.sources !== baseline.sources || snapshot.uiRoster !== baseline.uiRoster
    || hash(baseline.hostOutputs) !== baseline.outputs) return false
  writeFileSync(resolve(root, BASELINE), `${JSON.stringify({ ...baseline, environment: environmentKey(environment) })}\n`)
  return true
}

/**
 * Read the route of the build that just completed.
 * @param root - Repository root containing the completion marker.
 * @returns Plugin HMR, page refresh, or Node-process restart according to the completed build.
 */
export function dobeeBuildUpdate(root: string): 'hmr' | 'reload' | 'restart' {
  const value: unknown = JSON.parse(readFileSync(resolve(root, DOBEE_BUILD_RESULT), 'utf8'))
  if (typeof value !== 'object' || value === null || !('nodeChanged' in value) || typeof value.nodeChanged !== 'boolean'
    || !('rendererReload' in value) || typeof value.rendererReload !== 'boolean') {
    throw new Error('dobee-ui-build: missing valid build completion marker')
  }
  return value.nodeChanged ? 'restart' : value.rendererReload ? 'reload' : 'hmr'
}
