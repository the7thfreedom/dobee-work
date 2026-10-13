import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findLegacyBrandLabels, verifyDobeeBranding } from './dobee-branding.ts'
import { gatesForMode } from './run-gates.ts'

const legacy = ['DeepSeek', 'Harness'].join(' ')

afterEach(() => { vi.unstubAllEnvs() })

function repositoryFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dobee-branding-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['init', '--quiet'], { cwd: root, env })
  writeFileSync(join(root, 'AGENTS.md'), 'DobeeWork\n')
  writeFileSync(join(root, 'package.json'), '{"name":"dobee-test"}\n')
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts/dobee-branding-exceptions.json'), '[]\n')
  return root
}

describe('DobeeWork brand consistency', () => {
  it('rejects old labels in sources, current docs and expected output', () => {
    for (const file of ['packages/client/example/src/locales.ts', 'README.md', 'apps/web/tests/expected/brand.txt']) {
      expect(findLegacyBrandLabels(file, `DobeeWork\n${legacy}\n`)).toEqual([{ file, line: 2 }])
    }
  })

  it('recognizes case, whitespace and encoded source references', () => {
    for (const text of [legacy.toLowerCase(), legacy.replace(' ', '  '), legacy.replace(' ', '\\u0020')]) {
      expect(findLegacyBrandLabels('apps/example.ts', text)).toHaveLength(1)
    }
  })

  it('preserves exact reviewed references without exempting other lines or files', () => {
    const exception = { file: 'README.md', text: `Derived from ${legacy}.`, reason: 'Accurate upstream attribution.' }
    expect(findLegacyBrandLabels(exception.file, exception.text, [exception])).toEqual([])
    expect(findLegacyBrandLabels(exception.file, `${exception.text}\nWelcome to ${legacy}.`, [exception]))
      .toEqual([{ file: exception.file, line: 2 }])
    expect(findLegacyBrandLabels('apps/example.ts', exception.text, [exception])).toHaveLength(1)
  })

  it('retains frozen inputs but still checks active notes and prompt sidecars', () => {
    for (const file of ['vendor/example.ts', '.agents/notes/archived/feature/note.md',
      'snapshots/session/example/session.v4.jsonl', 'snapshots/sdk/example/session.1.v3.jsonl.zstd']) {
      expect(findLegacyBrandLabels(file, legacy)).toEqual([])
    }
    for (const file of ['.agents/notes/proposed/feature/note.md', 'snapshots/session/example/system-prompt.expected.md',
      'snapshots/session/example/brand.expected.jsonl']) {
      expect(findLegacyBrandLabels(file, legacy)).toHaveLength(1)
    }
  })

  it('runs in the documented quick and CI static aggregates', () => {
    vi.stubEnv('npm_execpath', '/fixture/pnpm.cjs')
    for (const mode of ['doc-quick', 'doc-sync', 'ci-static'] as const) {
      expect(gatesForMode(mode).some(gate => gate.id === 'dobee-branding')).toBe(true)
    }
  })

  it('checks new untracked files through the executed repository scan', () => {
    const root = repositoryFixture()
    expect(verifyDobeeBranding(root)).toEqual([])
    writeFileSync(join(root, 'new-copy.txt'), `Welcome to ${legacy}.\n`)
    expect(verifyDobeeBranding(root)).toEqual([
      'new-copy.txt:1: replace the current product label with DobeeWork',
    ])
  })

  it('rejects stale and wildcard exceptions instead of silently narrowing the scan', () => {
    const root = repositoryFixture()
    const path = join(root, 'scripts/dobee-branding-exceptions.json')
    writeFileSync(path, JSON.stringify([{ file: 'README.md', text: legacy, reason: 'Upstream reference.' }]))
    expect(verifyDobeeBranding(root)).toEqual([
      'README.md: stale brand exception; remove or review the changed reference',
    ])
    writeFileSync(path, JSON.stringify([{ file: 'docs/*', text: legacy, reason: 'Upstream reference.' }]))
    expect(() => verifyDobeeBranding(root)).toThrow('exact relative file')
  })
})
