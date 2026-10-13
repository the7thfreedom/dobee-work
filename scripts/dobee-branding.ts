/** Reject legacy product labels outside reviewed upstream and historical references. */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalReferenceText } from './verify-public-repository-links.ts'

/** One exact-file exception for an upstream reference or retained historical text. */
export interface BrandException {
  file: string
  text: string
  reason: string
}

/** One unapproved legacy product label. */
export interface BrandViolation {
  file: string
  line: number
}

const legacyBrand = ['deepseek', 'harness'].join(' ')
const policyFile = 'scripts/dobee-branding-exceptions.json'

function historicalInput(file: string): boolean {
  return file.startsWith('vendor/') || file.startsWith('.agents/notes/archived/')
    || /(?:^|\/)session(?:\.\d+)?(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(file)
}

/**
 * Find legacy labels without following symlinks or relabeling historical Session inputs.
 * @param file - Repository-relative path.
 * @param source - Text read from that file.
 * @param exceptions - Exact files and phrases approved as non-product references.
 * @returns unapproved matching lines.
 */
export function findLegacyBrandLabels(
  file: string, source: string, exceptions: readonly BrandException[] = [],
): BrandViolation[] {
  if (historicalInput(file) || file === policyFile) return []
  return source.split('\n').flatMap((line, index) => {
    const canonical = canonicalReferenceText(line).replace(/\s+/g, ' ')
    if (!canonical.includes(legacyBrand)) return []
    const allowed = exceptions.some(exception => exception.file === file && exception.text === line)
    return allowed ? [] : [{ file, line: index + 1 }]
  })
}

function readExceptions(root: string): BrandException[] {
  const input: unknown = JSON.parse(readFileSync(resolve(root, policyFile), 'utf8'))
  if (!Array.isArray(input)) throw new Error(`${policyFile}: expected an array of exact-file exceptions`)
  const entries: readonly unknown[] = input
  const exceptions: BrandException[] = []
  for (const item of entries) {
    if (typeof item !== 'object' || item === null
      || !('file' in item) || typeof item.file !== 'string' || item.file === ''
      || !('text' in item) || typeof item.text !== 'string' || item.text.includes('\n')
      || !('reason' in item) || typeof item.reason !== 'string' || item.reason.trim() === ''
      || /[*?[\]]/.test(item.file) || item.file.includes('..') || item.file.startsWith('/')) {
      throw new Error(`${policyFile}: every exception requires an exact relative file, source line, and reason`)
    }
    exceptions.push({ file: item.file, text: item.text, reason: item.reason })
  }
  return exceptions
}

/**
 * Scan tracked and non-ignored new files and reject stale exceptions.
 * @param root - Git worktree root.
 * @returns actionable legacy-label and exception diagnostics.
 */
export function verifyDobeeBranding(root: string): string[] {
  const exceptions = readExceptions(root)
  const files = [...new Set(execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z',
  ], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))]
  if (files.length === 0 || !files.includes('AGENTS.md') || !files.includes('package.json')) {
    throw new Error('dobee-branding: scan must include the repository instructions and root manifest')
  }
  const sources = new Map<string, string>()
  const failures: string[] = []
  for (const file of files) {
    if (historicalInput(file) || file === policyFile) continue
    const path = resolve(root, file)
    if (!existsSync(path) || !lstatSync(path).isFile()) continue
    const source = readFileSync(path, 'utf8')
    if (source.includes('\0')) continue
    sources.set(file, source)
    for (const match of findLegacyBrandLabels(file, source, exceptions)) {
      failures.push(`${match.file}:${match.line}: replace the current product label with DobeeWork`)
    }
  }
  for (const exception of exceptions) {
    if (!sources.get(exception.file)?.split('\n').includes(exception.text)) {
      failures.push(`${exception.file}: stale brand exception; remove or review the changed reference`)
    }
  }
  return failures
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  const failures = verifyDobeeBranding(resolve(import.meta.dirname, '..'))
  if (failures.length > 0) {
    console.error(`dobee-branding:\n${failures.join('\n')}`)
    process.exitCode = 1
  } else {
    console.log('dobee-branding: active product text uses DobeeWork; reviewed references are preserved.')
  }
}
