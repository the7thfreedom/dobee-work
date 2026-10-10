/** Reuse Host Typert artifacts only while their source, dependencies, and emitted bytes match. */

import { createHash } from 'node:crypto'
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { typertPlugin } from '../packages/typert/generator/src/tsdown-plugin.ts'

const CACHE_PATH = '.dsh-build/dobee-typert-cache.json'
const INPUT_PATTERNS = [
  '*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json,yaml,yml}',
  '{apps,packages,scripts,vendor,native,python,examples,benchmarks,website}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json,yaml,yml}',
  'node_modules/.pnpm/**/*.{ts,tsx,mts,cts,json}',
  'node_modules/.pnpm/lock.yaml',
  'node_modules/.pnpm/typescript@*/node_modules/typescript/lib/*.js',
  'node_modules/.pnpm/@jridgewell*/**/*.{js,mjs,cjs}',
  'packages/typert/generator/lib/types/**/*.js',
]
const OUTPUT_PATTERNS = ['packages/*/*/lib/typert.*']
const GENERATED_DIRECTORY = /(?:^|\/)(?:node_modules|\.desktop-build|\.generated|\.cache|\.dist)(?:\/|$)/
const ARTIFACT_DIR = /^(?:packages\/[^/]+\/[^/]+|vendor\/[^/]+|apps\/[^/]+|native\/system(?:\/packages\/[^/]+)?)\/(?:lib|dist)(?:\/|$)/

interface CacheRecord {
  readonly version: 1
  readonly inputs: string
  readonly outputs: string
}

function digest(root: string, patterns: readonly string[], inputs: boolean): { hash: string; count: number } {
  const files = globSync([...patterns], {
    cwd: root,
    exclude: (path) => {
      const normalized = path.replaceAll('\\', '/')
      const generator = 'packages/typert/generator/lib'
      return inputs && normalized !== generator && !normalized.startsWith(`${generator}/`)
        && normalized !== 'node_modules' && !normalized.startsWith('node_modules/')
        && (GENERATED_DIRECTORY.test(normalized) || ARTIFACT_DIR.test(normalized))
    },
  }).filter(path => statSync(join(root, path)).isFile()).sort()
  const hash = createHash('sha256')
  if (inputs) hash.update(JSON.stringify([process.versions.node, process.platform, process.arch]))
  for (const path of files) {
    const content = readFileSync(join(root, path))
    hash.update(JSON.stringify([path.replaceAll('\\', '/'), content.byteLength]))
    hash.update(content)
  }
  return { hash: hash.digest('hex'), count: files.length }
}

function readRecord(path: string): CacheRecord | undefined {
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, 'utf8')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`dobee-typert-cache: cannot parse ${path}; run pnpm run clean before rebuilding`, { cause: error })
  }
  if (typeof value !== 'object' || value === null
    || !('version' in value) || value.version !== 1
    || !('inputs' in value) || typeof value.inputs !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputs)
    || !('outputs' in value) || typeof value.outputs !== 'string' || !/^[a-f0-9]{64}$/.test(value.outputs)) {
    throw new Error(`dobee-typert-cache: invalid record ${path}; run pnpm run clean before rebuilding`)
  }
  return { version: 1, inputs: value.inputs, outputs: value.outputs }
}

function writeRecord(root: string, record: CacheRecord): void {
  const directory = join(root, '.dsh-build')
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(join(directory, 'dobee-typert-'))
  try {
    const path = join(temporary, 'record.json')
    writeFileSync(path, `${JSON.stringify(record)}\n`)
    renameSync(path, join(root, CACHE_PATH))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/**
 * Cache verified workspace-wide Host artifacts while retaining upstream decorator transforms.
 * @param plugin - Upstream Typert plugin configured with workspace mode and the Host face.
 * @param root - Repository root containing source inputs and package outputs.
 * @param selection - Generation selection identity; distinct selections cannot reuse each other's record.
 * @returns A dobee-owned plugin that verifies content hashes before reusing generated artifacts.
 */
export function dobeeCachedHostTypert(
  plugin: ReturnType<typeof typertPlugin>,
  root: string,
  selection = 'all',
): ReturnType<typeof typertPlugin> {
  let completed = false
  return {
    ...plugin,
    name: 'dobee-typert-cache',
    writeBundle(options) {
      if (options.dir === undefined || completed) return
      const path = join(root, CACHE_PATH)
      const inputs = createHash('sha256').update(selection).update(digest(root, INPUT_PATTERNS, true).hash).digest('hex')
      const outputs = digest(root, OUTPUT_PATTERNS, false)
      const record = readRecord(path)
      if (outputs.count > 0 && record?.inputs === inputs && record.outputs === outputs.hash) {
        console.log(`dobee-typert-cache: reused ${String(outputs.count)} verified Host artifact(s)`)
      } else {
        rmSync(path, { force: true })
        plugin.writeBundle(options)
        const generated = digest(root, OUTPUT_PATTERNS, false)
        if (generated.count > 0) writeRecord(root, { version: 1, inputs, outputs: generated.hash })
      }
      completed = true
    },
  }
}
