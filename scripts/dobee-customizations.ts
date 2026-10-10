/** Reject unreviewed customization changes during upstream merges; see the synchronization cookbook. */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const excluded = ['vendor/', '.agents/notes/archived/']

function git(root: string, args: readonly string[], allowNoMatch = false): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status === 1 && allowNoMatch) return ''
  if (result.status !== 0) throw new Error(`dobee-customizations: git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

function paths(output: string): string[] {
  return output.split('\0').filter(path => path !== '')
}

function isAncestor(root: string, commit: string, ref: string): boolean {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, ref], { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(`dobee-customizations: cannot inspect ancestry: ${result.stderr.trim()}`)
}

/**
 * Compare customization files and their referring files with a pre-sync ancestor.
 * Discovery reads the ancestor, so removing a customization cannot narrow the check.
 * @param root - Git checkout to inspect.
 * @param base - pre-sync commit or ref, which must be an ancestor of HEAD.
 * @param reviewed - exact repository-relative changed paths explicitly reviewed for preserved behavior.
 * @param cached - inspect the index instead of the working tree.
 * @param upstream - incoming upstream commit; includes all local changes since the common ancestor when supplied.
 * @returns violations; removed files and unresolved conflicts cannot be acknowledged.
 */
export function verifyDobeeCustomizations(
  root: string, base: string, reviewed: readonly string[] = [], cached = false, upstream?: string,
): string[] {
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim()
  if (!isAncestor(root, commit, 'HEAD')) throw new Error('dobee-customizations: --base must be a pre-sync ancestor of HEAD')
  const eligible = (path: string): boolean => !excluded.some(prefix => path.startsWith(prefix))
  const owned = paths(git(root, ['ls-tree', '-r', '--name-only', '-z', commit]))
    .filter(path => eligible(path) && path.split('/').some(part => part.startsWith('dobee')))
  const referring = paths(git(root, [
    'grep', '-Ilz', '-e', 'dobee', '-e', 'Dobee', commit, '--', '.',
    ...excluded.map(prefix => `:(exclude)${prefix}**`),
  ], true)).map(path => path.slice(commit.length + 1))
  const protectedPaths = new Set([...owned, ...referring])
  if (owned.length === 0) throw new Error('dobee-customizations: --base contains no dobee-owned files; select the dobee-work pre-sync commit')
  if (upstream !== undefined) {
    const target = git(root, ['rev-parse', '--verify', '--end-of-options', `${upstream}^{commit}`]).trim()
    const ancestor = git(root, ['merge-base', commit, target]).trim()
    for (const path of paths(git(root, ['diff', '--no-renames', '--name-only', '-z', ancestor, commit, '--']))) {
      if (eligible(path)) protectedPaths.add(path)
    }
  }
  const diff = ['diff', '--no-renames', '--name-only', '-z', ...(cached ? ['--cached'] : [])]
  const changed = new Set(paths(git(root, [...diff, commit, '--'])).filter(path => protectedPaths.has(path)))
  const removed = new Set(paths(git(root, [...diff, '--diff-filter=D', commit, '--'])))
  const unresolved = new Set(paths(git(root, ['diff', '--name-only', '-z', '--diff-filter=U'])))
  const acknowledgements = new Set(reviewed)
  const failures: string[] = []
  for (const path of acknowledgements) {
    if (!changed.has(path)) failures.push(`${path}: --reviewed must name a changed protected file, without globs`)
  }
  for (const path of [...changed].sort()) {
    if (removed.has(path)) failures.push(`${path}: removed customization file; restore it before synchronizing`)
    else if (unresolved.has(path)) failures.push(`${path}: unresolved merge conflict`)
    else if (!acknowledgements.has(path)) failures.push(`${path}: customization changed; preserve it or review the adaptation and pass --reviewed ${path}`)
  }
  return failures
}

function upstreamMergeTarget(root: string): string | undefined {
  const heads = paths(git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], true).replaceAll('\n', '\0'))
  if (heads.length === 0) return undefined
  const upstreamRefs = git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/upstream/'])
    .trim().split('\n').filter(ref => ref !== '')
  for (const head of heads) {
    for (const ref of upstreamRefs) {
      if (isAncestor(root, head, ref)) return head
    }
  }
  return undefined
}

function main(): void {
  const { values } = parseArgs({ options: {
    base: { type: 'string' },
    upstream: { type: 'string' },
    cached: { type: 'boolean', default: false },
    merge: { type: 'boolean', default: false },
    reviewed: { type: 'string', multiple: true },
  }, allowPositionals: false })
  if (values.merge && (values.base !== undefined || values.upstream !== undefined)) {
    throw new Error('dobee-customizations: choose --merge or explicit --base/--upstream, not both')
  }
  const root = resolve(import.meta.dirname, '..')
  const upstream = values.merge ? upstreamMergeTarget(root) : values.upstream
  const base = values.merge && upstream !== undefined ? 'HEAD' : values.base
  if (base === undefined) {
    if (values.merge) return
    throw new Error('dobee-customizations: --base <pre-sync commit> is required')
  }
  const environmentReviewed: unknown = JSON.parse(process.env.DOBEE_SYNC_REVIEWED ?? '[]')
  if (!isStringArray(environmentReviewed)) {
    throw new Error('dobee-customizations: DOBEE_SYNC_REVIEWED must be a JSON array of exact reviewed paths')
  }
  const failures = verifyDobeeCustomizations(root, base, [...values.reviewed ?? [], ...environmentReviewed], values.cached, upstream)
  if (failures.length > 0) throw new Error(`dobee-customizations:\n${failures.join('\n')}`)
  console.log('dobee-customizations: preserved files and explicitly reviewed adaptations accepted')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((path: unknown) => typeof path === 'string')
}

if (import.meta.main) {
  try { main() } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
