import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dobeeDesktopPackageClosure, dobeeWorkspaceBuildPackages, type DobeeScopePackage } from './dobee-desktop-build-scope.ts'
import { dobeeDeclarationProjects, dobeeEmitDeclarations } from './dobee-declarations.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dobee-desktop-scope-'))
  roots.push(root)
  return root
}

function packageFixture(root: string, name: string, manifest: Record<string, unknown> = {}, source = 'export {}\n'): string {
  const directory = join(root, 'packages/test', name)
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: `@deepseek-ai/dsh-${name}`, ...manifest }))
  writeFileSync(join(directory, 'src/index.ts'), source)
  return directory
}

describe('Desktop build dependency selection', () => {
  it('retains cycles, runtime imports, configured conditional plugins, and client module requests', () => {
    const root = fixture()
    const application = packageFixture(root, 'application', {
      dependencies: { '@deepseek-ai/dsh-runtime': 'workspace:*' },
      devDependencies: { '@deepseek-ai/dsh-unused-test': 'workspace:*' },
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { external: ['@deepseek-ai/dsh-shared/client'] } },
    }, [
      'import { value } from "@deepseek-ai/dsh-inline"',
      'import type { Test } from "@deepseek-ai/dsh-unused-test"',
      'export const lazy = () => import("@deepseek-ai/dsh-lazy")',
      'export { value }',
    ].join('\n'))
    writeFileSync(join(application, 'cordis.patch.yml'),
      '- insert:\n    - name: "@deepseek-ai/dsh-configured/subpath"\n      disabled: !!js process.env.OPTIONAL\n')
    packageFixture(root, 'runtime', { peerDependencies: { '@deepseek-ai/dsh-application': 'workspace:*' } })
    for (const name of ['inline', 'lazy', 'shared', 'configured', 'unused-test']) packageFixture(root, name)
    const selected = dobeeDesktopPackageClosure(dobeeWorkspaceBuildPackages(root), ['@deepseek-ai/dsh-application'])
    expect([...selected]).toEqual([
      '@deepseek-ai/dsh-application', '@deepseek-ai/dsh-configured', '@deepseek-ai/dsh-inline',
      '@deepseek-ai/dsh-lazy', '@deepseek-ai/dsh-runtime', '@deepseek-ai/dsh-shared',
    ])
  })

  it('retains profile bundles and optional platform packages', () => {
    const root = fixture()
    packageFixture(root, 'application', {
      optionalDependencies: { '@deepseek-ai/dsh-platform': 'workspace:*' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-bundle'] } },
    })
    packageFixture(root, 'platform')
    packageFixture(root, 'bundle')
    expect([...dobeeDesktopPackageClosure(dobeeWorkspaceBuildPackages(root), ['@deepseek-ai/dsh-application'])])
      .toEqual(['@deepseek-ai/dsh-application', '@deepseek-ai/dsh-bundle', '@deepseek-ai/dsh-platform'])
  })

  it('rejects a missing runtime dependency instead of narrowing to an incomplete closure', () => {
    const root = fixture()
    packageFixture(root, 'application', { dependencies: { '@deepseek-ai/dsh-missing': 'workspace:*' } })
    expect(() => dobeeDesktopPackageClosure(dobeeWorkspaceBuildPackages(root), ['@deepseek-ai/dsh-application']))
      .toThrow('missing required workspace package @deepseek-ai/dsh-missing')
  })

  it('rejects a configured missing plugin and a missing patch', () => {
    const root = fixture()
    const directory = packageFixture(root, 'application', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
    expect(() => dobeeWorkspaceBuildPackages(root)).toThrow('missing bundle patch')
    writeFileSync(join(directory, 'cordis.patch.yml'), '- insert:\n    - name: "@deepseek-ai/dsh-missing"\n')
    expect(() => dobeeDesktopPackageClosure(dobeeWorkspaceBuildPackages(root), ['@deepseek-ai/dsh-application']))
      .toThrow('missing required workspace package')
  })

  it('rejects duplicate package identities', () => {
    const root = fixture()
    packageFixture(root, 'one')
    packageFixture(root, 'two', { name: '@deepseek-ai/dsh-one' })
    expect(() => dobeeWorkspaceBuildPackages(root)).toThrow('duplicate package')
  })

  it('rejects an unknown root', () => {
    expect(() => dobeeDesktopPackageClosure(new Map<string, DobeeScopePackage>(), ['@deepseek-ai/dsh-missing']))
      .toThrow('missing required workspace package')
  })
})

describe('Desktop declaration projects', () => {
  it('checks semantic errors even when fast declaration output already exists', () => {
    const root = fixture()
    const config = join(root, 'tsconfig.json')
    writeFileSync(join(root, 'index.ts'), 'export const value: number = "invalid"\n')
    writeFileSync(config, JSON.stringify({
      compilerOptions: { composite: true, declaration: true, outDir: './lib', types: [], skipLibCheck: true },
      files: ['index.ts'],
    }))
    const repository = join(import.meta.dirname, '..')
    expect(() => { dobeeEmitDeclarations(repository, config, true) }).not.toThrow()
    expect(() => { dobeeEmitDeclarations(repository, config, false) }).toThrow(/exited with [12]$/)
    writeFileSync(join(root, 'index.ts'), 'export const value: number = 1\n')
    expect(() => { dobeeEmitDeclarations(repository, config, false) }).not.toThrow()
  })

  it('selects matching face leaves without aggregate tests or opposite compiler faces', () => {
    const root = fixture()
    const selected = join(root, 'packages/test/selected')
    writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({
      include: ['tests/**/*.ts'],
      references: [{ path: './packages/test/selected/tsconfig.host.json' }, { path: './packages/test/unselected' }],
    }))
    expect(dobeeDeclarationProjects(root, 'host', new Set([selected])))
      .toEqual([join(selected, 'tsconfig.host.json')])
  })

  it('fails loud for an empty or malformed reference roster', () => {
    const root = fixture()
    writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({ references: [] }))
    expect(() => dobeeDeclarationProjects(root, 'host', new Set())).toThrow('no host projects selected')
    writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({ references: [{}] }))
    expect(() => dobeeDeclarationProjects(root, 'host', new Set())).toThrow('invalid project reference')
  })
})
