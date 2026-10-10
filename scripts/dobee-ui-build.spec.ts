import { globSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dobeeAdoptResidentBaseline, dobeeHostSourceInputs, dobeeRecordUiBaseline, dobeePlanUiBuild, dobeeRefreshStaticUiBaseline,
  dobeeUiSourcePaths,
} from './dobee-ui-build.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dobee-ui-build-'))
  roots.push(root)
  const packageFile = (directory: string, name: string, dependencies = {}): string => {
    const path = join(root, directory)
    mkdirSync(join(path, 'src'), { recursive: true })
    mkdirSync(join(path, 'lib'), { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name, dependencies }))
    writeFileSync(join(path, 'src/index.ts'), 'export const value = 1\n')
    writeFileSync(join(path, 'lib/index.js'), 'export const value = 1\n')
    writeFileSync(join(path, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', types: [] },
      include: ['src'],
    }))
    return path
  }
  packageFile('apps/cli', '@deepseek-ai/dsh', { '@deepseek-ai/dsh-test-host': 'workspace:*' })
  const desktop = packageFile('apps/desktop', '@deepseek-ai/dsh-desktop')
  writeFileSync(join(desktop, 'lib/main.js'), 'export const main = true\n')
  packageFile('apps/desktop-host', '@deepseek-ai/dsh-desktop-host')
  packageFile('apps/web', '@deepseek-ai/dsh-web-frontend', { '@deepseek-ai/dsh-client-test-ui': 'workspace:*' })
  const host = packageFile('packages/core/test-host', '@deepseek-ai/dsh-test-host')
  const ui = packageFile('packages/client/test-ui', '@deepseek-ai/dsh-client-test-ui')
  writeFileSync(join(ui, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-client-test-ui', dsh: { client: { platform: 'web' } },
  }))
  mkdirSync(join(ui, 'src/client'), { recursive: true })
  writeFileSync(join(ui, 'src/client/index.ts'), 'export const label = "one"\n')
  writeFileSync(join(ui, 'src/client/types.ts'), 'export interface State { value: string }\n')
  writeFileSync(join(host, 'src/index.ts'), [
    'import type { State } from "../../../client/test-ui/src/client/types.ts"',
    'export type { State }',
  ].join('\n'))
  writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({
    compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', types: [] },
    references: ['apps/cli', 'apps/desktop', 'apps/desktop-host', 'packages/core/test-host'].map(path => ({ path })),
  }))
  return { root, host, ui, environment: { DSH_CLIENT_VERSION: 'test' } }
}

describe('guarded UI-only rebuilds', () => {
  it('enumerates the same source and installed-declaration corpus as the original overlapping glob rules', () => {
    const test = fixture()
    for (const path of [
      'native/system/src/helper.c', 'scripts/helper.ts', 'apps/web/src/lib/view.ts',
      'packages/client/test-ui/src/client/view.tsx', 'packages/client/test-ui/lib/client.js',
      'packages/client/test-ui/tests/view.spec.ts', 'packages/client/test-ui/.hidden/settings.json',
      'node_modules/.pnpm/test@1/node_modules/test/lib/index.d.ts',
      'node_modules/.pnpm/test@1/node_modules/test/index.d.mts',
      'node_modules/.pnpm/test@1/node_modules/test/src/value.cts',
      'node_modules/.pnpm/test@1/node_modules/test/package.json',
      'node_modules/.pnpm/test@1/node_modules/test/index.js', 'node_modules/.pnpm/lock.yaml',
      '.hidden.json', 'root.json',
    ]) {
      mkdirSync(dirname(join(test.root, path)), { recursive: true })
      writeFileSync(join(test.root, path), '{}\n')
    }
    const previous = globSync([
      '*.{ts,js,mjs,cjs,json,yaml,yml}',
      '{apps,packages,vendor,native,scripts}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json,yaml,yml,css,html,png,svg,woff,woff2,ttf}',
      'native/**/*.{c,h,cc,cpp,cxx,rs}',
      'node_modules/.pnpm/**/*.{ts,mts,cts,json}', 'node_modules/.pnpm/lock.yaml',
    ], { cwd: test.root, exclude: path => !path.startsWith('node_modules') && (
      /(?:^|\/)(?:node_modules|\.dsh-build|\.desktop-build|\.cache|\.generated)(?:\/|$)/.test(path)
      || /^(?:packages\/[^/]+\/[^/]+|vendor\/[^/]+|apps\/[^/]+|native\/system(?:\/packages\/[^/]+)?)\/(?:lib|dist)(?:\/|$)/.test(path)
    ) }).filter(path => !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path))
      .filter(path => !/(?:^|\/)(?:tests|test)(?:\/|$)/.test(path))
      .map(path => join(test.root, path)).filter(path => statSync(path).isFile())
    expect(dobeeUiSourcePaths(test.root)).toEqual([...new Set(previous)].sort())
    const added = join(test.root, 'scripts/added.ts')
    writeFileSync(added, 'export {}\n')
    expect(dobeeUiSourcePaths(test.root)).toContain(added)
    rmSync(added)
    expect(dobeeUiSourcePaths(test.root)).not.toContain(added)
  })

  it('checks changed bytes with restored mtime rather than reusing a cached Host fingerprint', () => {
    const test = fixture()
    dobeeRecordUiBaseline(test.root, test.environment)
    const path = join(test.host, 'src/index.ts')
    const before = statSync(path)
    writeFileSync(path, 'export const changed = true\n')
    utimesSync(path, before.atime, before.mtime)
    expect(dobeePlanUiBuild(test.root, test.environment)).toEqual({ kind: 'full', reason: 'Host or shared inputs changed' })
  })

  it('does not turn a changed Host input into a successful build when a resident process starts', () => {
    const test = fixture()
    dobeeRecordUiBaseline(test.root, test.environment)
    const environment = { ...test.environment, RESIDENT_PROCESS: 'true' }
    expect(dobeeAdoptResidentBaseline(test.root, environment)).toBe(true)
    writeFileSync(join(test.ui, 'src/client/types.ts'), 'export interface State { changed: boolean }\n')
    expect(dobeeAdoptResidentBaseline(test.root, environment)).toBe(false)
    expect(dobeePlanUiBuild(test.root, environment)).toEqual({ kind: 'full', reason: 'Host or shared inputs changed' })
  })

  it('admits an existing isolated UI edit while retaining the complete Desktop baseline', () => {
    const test = fixture()
    dobeeRecordUiBaseline(test.root, test.environment)
    writeFileSync(join(test.ui, 'src/client/index.ts'), 'export const label = "two"\n')
    expect(dobeePlanUiBuild(test.root, test.environment)).toMatchObject({ kind: 'ui', rendererReload: false })
  })

  it('tracks type-only Host imports into UI directories and rejects their changes', () => {
    const test = fixture()
    const cache = join(test.root, '.dsh-build/dobee-vite/host')
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, 'inventory.json'), JSON.stringify({ inputs: [join(test.host, 'src/index.ts')] }))
    expect(dobeeHostSourceInputs(test.root)).toContain(join(test.ui, 'src/client/types.ts'))
    dobeeRecordUiBaseline(test.root, test.environment)
    writeFileSync(join(test.ui, 'src/client/types.ts'), 'export interface State { value: number }\n')
    expect(dobeePlanUiBuild(test.root, test.environment)).toEqual({ kind: 'full', reason: 'Host or shared inputs changed' })
  })

  it('rejects added UI files that could change module resolution', () => {
    const test = fixture()
    dobeeRecordUiBaseline(test.root, test.environment)
    writeFileSync(join(test.ui, 'src/client/added.ts'), 'export const value = 1\n')
    expect(dobeePlanUiBuild(test.root, test.environment)).toEqual({ kind: 'full', reason: 'UI source roster changed' })
  })

  it('rejects changed Host code, shared config, environment and damaged artifacts', () => {
    const test = fixture()
    dobeeRecordUiBaseline(test.root, test.environment)
    expect(dobeePlanUiBuild(test.root, { DSH_CLIENT_VERSION: 'changed' })).toEqual({ kind: 'full', reason: 'build environment changed' })
    writeFileSync(join(test.host, 'lib/index.js'), 'corrupted\n')
    expect(dobeePlanUiBuild(test.root, test.environment)).toEqual({ kind: 'full', reason: 'Host artifacts changed' })
    writeFileSync(join(test.host, 'lib/index.js'), 'export const value = 1\n')
    writeFileSync(join(test.root, 'package.json'), '{"name":"changed"}\n')
    expect(dobeePlanUiBuild(test.root, test.environment)).toEqual({ kind: 'full', reason: 'Host or shared inputs changed' })
  })

  it('rejects a deleted Host artifact and reports a directory replacing its file', () => {
    const test = fixture()
    dobeeRecordUiBaseline(test.root, test.environment)
    const path = join(test.host, 'lib/index.js')
    rmSync(path)
    expect(dobeePlanUiBuild(test.root, test.environment)).toEqual({ kind: 'full', reason: 'Host artifacts changed' })
    mkdirSync(path)
    expect(() => dobeePlanUiBuild(test.root, test.environment)).toThrow('cannot read input file')
  })

  it('does not use a fast path without a successful full-build baseline', () => {
    const test = fixture()
    expect(dobeePlanUiBuild(test.root, test.environment)).toEqual({ kind: 'full', reason: 'no successful Desktop baseline' })
  })

  it('rejects native Host source changes even when compiled binaries have not been rebuilt', () => {
    const test = fixture()
    const directory = join(test.root, 'native/system/src')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, 'helper.c')
    writeFileSync(path, 'int value = 1;\n')
    dobeeRecordUiBaseline(test.root, test.environment)
    writeFileSync(path, 'int value = 2;\n')
    expect(dobeePlanUiBuild(test.root, test.environment)).toEqual({ kind: 'full', reason: 'Host or shared inputs changed' })
  })

  it('rebuilds static UI only when its inputs change and retains later edits', () => {
    const test = fixture()
    dobeeRecordUiBaseline(test.root, test.environment)
    const path = join(test.root, 'apps/web/src/index.ts')
    writeFileSync(path, 'export const value = 2\n')
    const decision = dobeePlanUiBuild(test.root, test.environment)
    expect(decision).toMatchObject({ kind: 'ui', rendererReload: true })
    if (decision.kind !== 'ui') throw new Error('missing UI decision')
    dobeeRefreshStaticUiBaseline(test.root, decision.staticUi)
    expect(dobeePlanUiBuild(test.root, test.environment)).toMatchObject({ kind: 'ui', rendererReload: false })
    writeFileSync(path, 'export const value = 3\n')
    expect(dobeePlanUiBuild(test.root, test.environment)).toMatchObject({ kind: 'ui', rendererReload: true })
  })
})
