/** Reuse independent Vite artifacts only when their observed inputs and emitted bytes still match. */

import { createHash } from 'node:crypto'
import { existsSync, globSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Physical files Vite read or emitted during one package build. */
export interface DobeeViteBuildFiles {
  readonly inputs: Set<string>
  readonly outputs: Set<string>
}

interface CacheRecord {
  readonly version: 1
  readonly key: string
  readonly inputs: readonly string[]
  readonly inputHash: string
  readonly outputs: readonly string[]
  readonly outputHash: string
}

function hashFiles(paths: readonly string[]): string {
  const hash = createHash('sha256')
  for (const path of [...new Set(paths)].sort()) {
    hash.update(JSON.stringify(path))
    if (!existsSync(path)) { hash.update('missing'); continue }
    if (!statSync(path).isFile()) throw new Error(`dobee-vite-cache: input is not a file: ${path}`)
    const content = readFileSync(path)
    hash.update(JSON.stringify(content.length))
    hash.update(content)
  }
  return hash.digest('hex')
}

function sourceFiles(directory: string): string[] {
  return globSync('**/*', { cwd: directory, exclude: path =>
    /^(?:lib|dist|node_modules|\.dsh-build|\.desktop-build|tests|test|\.cache)(?:\/|$)/.test(path.replaceAll('\\', '/')) })
    .map(path => resolve(directory, path)).filter(path => statSync(path).isFile())
}

function record(value: unknown): value is CacheRecord {
  if (typeof value !== 'object' || value === null) return false
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')
  return 'version' in value && value.version === 1
    && 'key' in value && typeof value.key === 'string'
    && 'inputs' in value && strings(value.inputs) && 'inputHash' in value && typeof value.inputHash === 'string'
    && 'outputs' in value && strings(value.outputs) && 'outputHash' in value && typeof value.outputHash === 'string'
}

/**
 * Fingerprint build implementations, package declarations, dependency resolution, and the inherited environment.
 * @param root - Repository root.
 * @param environment - Environment inherited by this build process; only its digest is retained.
 * @returns A content-based key shared by the package caches in one build process.
 */
export function dobeeViteBuildKey(root: string, environment: NodeJS.ProcessEnv): string {
  const paths = globSync([
    '*.{json,yaml,yml}', 'scripts/dobee-*.ts', 'scripts/client-build-environment.ts',
    'scripts/browser-bundled-externals.ts', 'scripts/bundle-input-isolation.ts',
    'scripts/web-product-bundle-isolation.ts',
    '{packages/*/*,vendor/*,apps/*}/{package.json,tsdown.config.ts}',
    'packages/client/tsdown.client.ts', 'packages/tsdown.worker.ts',
    'node_modules/.pnpm/lock.yaml',
  ], { cwd: root }).filter(path => !path.endsWith('.spec.ts')).map(path => resolve(root, path))
  return createHash('sha256').update(hashFiles(paths))
    .update(JSON.stringify([process.version, process.platform, process.arch,
      Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))])).digest('hex')
}

/** Per-package, per-face cache; build hooks with unobserved nested outputs must bypass it. */
export class DobeeViteArtifactCache {
  constructor(
    private readonly root: string, private readonly face: string, private readonly buildKey: string,
    private readonly outputRoster?: () => readonly string[],
  ) {}

  /**
   * Reuse or rebuild one complete independent package output set.
   * @param directory - Package source directory.
   * @param build - Operation recording all physical input and output paths; failures never publish a cache record.
   * @returns True when verified artifacts were reused, false when the build ran.
   */
  async run(directory: string, build: (files: DobeeViteBuildFiles) => Promise<void>): Promise<boolean> {
    const id = createHash('sha256').update(directory).digest('hex')
    const path = join(this.root, '.dsh-build', 'dobee-vite', this.face, `${id}.json`)
    const ownSources = sourceFiles(directory)
    const key = createHash('sha256').update(this.buildKey).update(hashFiles(ownSources)).digest('hex')
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8')
      let value: unknown
      try { value = JSON.parse(text) } catch (error) {
        throw new Error(`dobee-vite-cache: cannot parse ${path}; run pnpm run clean`, { cause: error })
      }
      if (!record(value)) throw new Error(`dobee-vite-cache: invalid record ${path}; run pnpm run clean`)
      for (const input of [...value.inputs, ...value.outputs]) {
        const local = relative(this.root, input)
        if (!isAbsolute(input) || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
          throw new Error('dobee-vite-cache: record contains a path outside the repository; run pnpm run clean')
        }
      }
      const sameRoster = this.outputRoster === undefined
        || JSON.stringify([...this.outputRoster()].sort()) === JSON.stringify([...value.outputs].sort())
      if (sameRoster && value.key === key && value.outputs.length > 0 && value.outputs.every(output => existsSync(output))
        && hashFiles(value.inputs) === value.inputHash && hashFiles(value.outputs) === value.outputHash) return true
    }
    rmSync(path, { force: true })
    const files: DobeeViteBuildFiles = { inputs: new Set(ownSources), outputs: new Set() }
    await build(files)
    const inputs = [...files.inputs].sort()
    const outputs = [...files.outputs].sort()
    if (outputs.length === 0) return false
    for (const output of outputs) {
      if (!existsSync(output)) throw new Error(`dobee-vite-cache: build did not emit ${output}`)
    }
    const value: CacheRecord = {
      version: 1, key, inputs, inputHash: hashFiles(inputs), outputs, outputHash: hashFiles(outputs),
    }
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.${String(process.pid)}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx' })
      renameSync(temporary, path)
    } finally { rmSync(temporary, { force: true }) }
    return false
  }
}
