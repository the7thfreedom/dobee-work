import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyDobeeCustomizations } from './dobee-customizations.ts'

const roots: string[] = []
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')
  && key !== 'DOBEE_SYNC_REVIEWED'))

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { root: string; base: string; git: (...args: string[]) => string; write: (path: string, text: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'dobee-customizations-'))
  roots.push(root)
  const git = (...args: string[]): string => execFileSync('git', [
    '-c', 'user.name=Dobee Test', '-c', 'user.email=dobee@example.invalid',
    '-c', 'commit.gpgSign=false', '-c', 'core.autocrlf=false', '-c', `core.hooksPath=${join(root, 'hooks')}`,
    ...args,
  ], { cwd: root, encoding: 'utf8', env: cleanEnvironment, stdio: 'pipe' }).trim()
  const write = (path: string, text: string): void => {
    const full = join(root, path)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, text)
  }
  git('init', '--quiet')
  write('scripts/dobee-build.ts', 'export const build = 1\n')
  write('packages/client/dobee-ui/src/index.ts', 'export const plugin = 1\n')
  write('package.json', '{"scripts":{"build":"node scripts/dobee-build.ts"}}\n')
  write('apps/desktop/src/client.ts', "import './dobee-welcome.ts'\n")
  write('ordinary.txt', 'upstream text\n')
  write('vendor/dobee-fixture.ts', 'vendor\n')
  write('.agents/notes/archived/dobee-fixture.md', 'archive\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'fixture baseline')
  return { root, base: git('rev-parse', 'HEAD'), git, write }
}

function cli(root: string, args: string[], reviewed?: string): ReturnType<typeof spawnSync> {
  mkdirSync(join(root, 'scripts'), { recursive: true })
  copyFileSync(resolve(import.meta.dirname, 'dobee-customizations.ts'), join(root, 'scripts/dobee-customizations.ts'))
  return spawnSync(process.execPath, [join(root, 'scripts/dobee-customizations.ts'), ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...cleanEnvironment, ...(reviewed === undefined ? {} : { DOBEE_SYNC_REVIEWED: reviewed }) },
  })
}

describe('dobee customization synchronization guard', () => {
  it('accepts untouched customizations while upstream and excluded files change', () => {
    const { root, base, write } = fixture()
    write('ordinary.txt', 'updated upstream text\n')
    write('vendor/dobee-fixture.ts', 'updated vendor\n')
    write('.agents/notes/archived/dobee-fixture.md', 'updated archive\n')
    expect(verifyDobeeCustomizations(root, base)).toEqual([])
  })

  it('discovers owned files by path even without a dobee reference in their contents', () => {
    const { root, base, write } = fixture()
    write('packages/client/dobee-ui/src/index.ts', 'export const plugin = 2\n')
    expect(verifyDobeeCustomizations(root, base)).toEqual([
      expect.stringContaining('packages/client/dobee-ui/src/index.ts: customization changed'),
    ])
  })

  it('detects overwritten shared commands and removed launcher references using the ancestor', () => {
    const { root, base, write } = fixture()
    write('package.json', '{"scripts":{"build":"tsdown"}}\n')
    write('apps/desktop/src/client.ts', '// upstream launcher\n')
    expect(verifyDobeeCustomizations(root, base)).toEqual([
      expect.stringContaining('apps/desktop/src/client.ts: customization changed'),
      expect.stringContaining('package.json: customization changed'),
    ])
    expect(verifyDobeeCustomizations(root, base, ['apps/desktop/src/client.ts', 'package.json'])).toEqual([])
  })

  it('does not permit an acknowledgement to hide deletion or rename', () => {
    const { root, base, git } = fixture()
    git('mv', 'scripts/dobee-build.ts', 'scripts/renamed.ts')
    expect(verifyDobeeCustomizations(root, base, ['scripts/dobee-build.ts'], true)).toEqual([
      expect.stringContaining('scripts/dobee-build.ts: removed customization file'),
    ])
  })

  it('rejects stale acknowledgement paths and wildcard exemptions', () => {
    const { root, base } = fixture()
    expect(verifyDobeeCustomizations(root, base, ['package.json', 'scripts/*'])).toEqual([
      expect.stringContaining('package.json: --reviewed must name a changed protected file'),
      expect.stringContaining('scripts/*: --reviewed must name a changed protected file'),
    ])
  })

  it('checks staged content independently from unstaged restoration', () => {
    const { root, base, git, write } = fixture()
    write('scripts/dobee-build.ts', 'overwritten\n')
    git('add', 'scripts/dobee-build.ts')
    write('scripts/dobee-build.ts', 'export const build = 1\n')
    expect(verifyDobeeCustomizations(root, base)).toEqual([])
    expect(verifyDobeeCustomizations(root, base, [], true)).toEqual([
      expect.stringContaining('scripts/dobee-build.ts: customization changed'),
    ])
  })

  it('rejects invalid, unrelated, or empty baselines', () => {
    const { root, base, git } = fixture()
    expect(() => verifyDobeeCustomizations(root, '--help')).toThrow('failed')
    git('checkout', '--orphan', 'unrelated')
    git('rm', '-rf', '.')
    writeFileSync(join(root, 'empty.txt'), 'empty baseline\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'empty baseline')
    const empty = git('rev-parse', 'HEAD')
    expect(() => verifyDobeeCustomizations(root, empty)).toThrow('contains no dobee-owned files')
    git('checkout', '--detach', base)
    expect(() => verifyDobeeCustomizations(root, empty)).toThrow('pre-sync ancestor')
  })

  it('reports a nonzero CLI status for overwrite and accepts exact reviewed paths', () => {
    const { root, base, write } = fixture()
    write('package.json', '{"scripts":{"build":"tsdown"}}\n')
    const failed = cli(root, ['--base', base])
    expect(failed.error).toBeUndefined()
    expect(failed.status).toBe(1)
    expect(String(failed.stderr)).toContain('package.json: customization changed')
    expect(cli(root, ['--base', base, '--reviewed', 'package.json']).status).toBe(0)
    expect(cli(root, ['--base', base], '["package.json"]').status).toBe(0)
    expect(cli(root, ['--base', base], '{"package.json":true}').status).toBe(1)
    expect(cli(root, []).status).toBe(1)
  })

  it('automatically checks a staged upstream merge and refuses unresolved conflicts', () => {
    const { root, base, git, write } = fixture()
    git('checkout', '-b', 'incoming')
    write('package.json', '{"scripts":{"build":"tsdown"}}\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'upstream change')
    const incoming = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/upstream/master', incoming)
    git('checkout', '-b', 'local', base)
    write('ordinary.txt', 'local change\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'local change')
    git('merge', '--no-ff', '--no-commit', 'incoming')
    const failed = cli(root, ['--merge', '--cached'])
    expect(failed.status).toBe(1)
    expect(String(failed.stderr)).toContain('package.json: customization changed')
    expect(cli(root, ['--merge', '--cached'], '["package.json"]').status).toBe(0)
    git('merge', '--abort')
    write('package.json', '{"scripts":{"build":"node scripts/dobee-build.ts --local"}}\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'local manifest')
    const conflict = spawnSync('git', ['-c', `core.hooksPath=${join(root, 'hooks')}`, 'merge', '--no-ff', '--no-commit', 'incoming'], {
      cwd: root, env: cleanEnvironment, encoding: 'utf8',
    })
    expect(conflict.status).toBe(1)
    expect(cli(root, ['--merge', '--cached'], '["package.json"]').status).toBe(1)
    expect(verifyDobeeCustomizations(root, 'HEAD', ['package.json'], true))
      .toContain('package.json: unresolved merge conflict')
  })

  it('does not apply the automatic hook to ordinary commits or non-upstream merges', () => {
    const { root, base, git, write } = fixture()
    expect(cli(root, ['--merge', '--cached']).status).toBe(0)
    git('checkout', '-b', 'feature')
    write('package.json', '{"scripts":{"build":"tsdown"}}\n')
    git('add', 'package.json')
    git('commit', '--quiet', '-m', 'feature')
    git('checkout', '-b', 'local', base)
    write('ordinary.txt', 'local change\n')
    git('add', 'ordinary.txt')
    git('commit', '--quiet', '-m', 'local')
    git('merge', '--no-ff', '--no-commit', 'feature')
    expect(cli(root, ['--merge', '--cached']).status).toBe(0)
    expect(cli(root, ['--base', base, '--cached']).status).toBe(1)
  })

  it('protects unmarked local customizations and cleanly merged overwrites using upstream ancestry', () => {
    const { root, base, git, write } = fixture()
    git('checkout', '-b', 'incoming')
    write('ordinary.txt', 'upstream update\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'upstream')
    const upstream = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/upstream/master', upstream)
    git('checkout', '-b', 'local', base)
    write('.github/workflows/ci.yml', 'enabled: false\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'local CI customization')
    const localBase = git('rev-parse', 'HEAD')
    git('merge', '--no-ff', '--no-commit', 'incoming')
    write('.github/workflows/ci.yml', 'enabled: true\n')
    git('add', '.')
    expect(verifyDobeeCustomizations(root, localBase, [], true)).toEqual([])
    expect(verifyDobeeCustomizations(root, localBase, [], true, upstream)).toEqual([
      expect.stringContaining('.github/workflows/ci.yml: customization changed'),
    ])
    expect(cli(root, ['--base', localBase, '--upstream', upstream, '--cached']).status).toBe(1)
    expect(cli(root, ['--merge', '--cached']).status).toBe(1)
    expect(cli(root, ['--merge', '--cached'], '[".github/workflows/ci.yml"]').status).toBe(0)
    expect(() => verifyDobeeCustomizations(root, localBase, [], true, '--help')).toThrow('failed')
  })
})

describe('local development Make entrypoints', () => {
  // Native Windows setup does not require Make.
  it.skipIf(process.platform === 'win32')('routes Desktop scope and watch options through package scripts', () => {
    const root = resolve(import.meta.dirname, '..')
    for (const [target, script, args] of [
      ['build-desktop', 'build:desktop-runtime', '--record-ui-baseline'],
      ['dev-desktop-watch', 'dev:desktop:watch', '--watch-interval 1000'],
    ] as const) {
      const result = spawnSync('make', ['--dry-run', target, `ARGS=${args}`], { cwd: root, encoding: 'utf8' })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`pnpm run ${script} ${args}`)
    }
  })
})
