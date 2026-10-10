import { existsSync, globSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import type { UserConfig } from 'tsdown'
import { dobeeExternalImport, dobeePublicTypeEntries, dobeeSourceEntry, dobeeVitePackage } from './dobee-vite-package.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dobee-vite-package-'))
  roots.push(root)
  mkdirSync(join(root, 'src/client'), { recursive: true })
  writeFileSync(join(root, 'tsconfig.base.json'), JSON.stringify({
    compilerOptions: { target: 'es2024', module: 'esnext', moduleResolution: 'bundler', paths: {} },
    files: [],
  }))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dobee-fixture', type: 'module' }))
  return root
}

describe('dobee Vite package build', () => {
  it('maps emitted and public type entries onto source without needing emitted JavaScript', () => {
    const root = fixture()
    writeFileSync(join(root, 'src/index.ts'), 'export const value = 1\n')
    expect(dobeeSourceEntry(root, 'lib/types/index.js')).toBe(join(root, 'src/index.ts'))
    expect(dobeeSourceEntry(root, './lib/types/index.js')).toBe(join(root, 'src/index.ts'))
    expect(dobeeSourceEntry(root, 'src/index.ts')).toBe(join(root, 'src/index.ts'))
    expect(() => dobeeSourceEntry(root, 'lib/types/missing.js')).toThrow('no source owns')
  })

  it('keeps production and peer identities external while honoring explicit inline rules', () => {
    const manifest = {
      name: 'dobee-fixture',
      dependencies: { '@example/shared': '*' },
      peerDependencies: { '@example/peer': '*' },
    }
    expect(dobeeExternalImport({ platform: 'node' }, manifest, 'node:fs')).toBe(true)
    expect(dobeeExternalImport({}, manifest, '@example/shared/subpath')).toBe(true)
    expect(dobeeExternalImport({}, manifest, '@example/peer')).toBe(true)
    expect(dobeeExternalImport({ deps: { alwaysBundle: ['@example/shared'] } }, manifest, '@example/shared/subpath')).toBe(false)
    expect(dobeeExternalImport({ deps: { neverBundle: /^virtual:/ } }, manifest, 'virtual:runtime')).toBe(true)
  })

  it('collects literal public JavaScript type entries without treating declarations as runtime files', () => {
    expect(dobeePublicTypeEntries({
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './types': { default: './lib/types/types.js' },
      './alias': { default: './lib/types/types.js' },
      './source/*': './src/*',
    })).toEqual(['./lib/types/types.js'])
  })

  it('builds separate ESM and sandboxed CJS artifacts from TypeScript', async () => {
    const root = fixture()
    writeFileSync(join(root, 'src/index.ts'), 'export const value: number = 7\n')
    writeFileSync(join(root, 'src/client/index.ts'), 'import { contextBridge } from "electron"; contextBridge.exposeInMainWorld("value", 7)\n')
    const manifest = { name: 'dobee-fixture', peerDependencies: { electron: '*' } }
    await dobeeVitePackage(root, root, manifest, { entry: ['lib/types/index.js'], platform: 'node', format: 'esm' })
    await dobeeVitePackage(root, root, manifest, {
      entry: { preload: 'lib/types/client/index.js' }, platform: 'node', format: 'cjs',
      deps: { neverBundle: ['electron'] },
    })
    expect(readFileSync(join(root, 'lib/index.js'), 'utf8')).toContain('value')
    let exposed: unknown
    runInNewContext(readFileSync(join(root, 'lib/preload.cjs'), 'utf8'), {
      require: (id: string) => {
        if (id !== 'electron') throw new Error(`unexpected sandbox import ${id}`)
        return { contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { exposed = value } } }
      },
      exports: {},
    })
    expect(exposed).toBe(7)
    expect(existsSync(join(root, 'lib/types/index.js'))).toBe(false)
  })

  it('does not publish a shared helper chunk for unused Node builtin imports', async () => {
    const root = fixture()
    for (const name of ['index', 'control']) {
      writeFileSync(join(root, `src/${name}.ts`), `import "node:module"; export const ${name} = true\n`)
    }
    await dobeeVitePackage(root, root, { name: 'dobee-fixture' }, {
      entry: { index: 'lib/types/index.js', control: 'lib/types/control.js' }, platform: 'node', format: 'esm',
    })
    expect(globSync('lib/*.js', { cwd: root }).sort()).toEqual(['lib/control.js', 'lib/index.js'])
    for (const name of ['index', 'control']) {
      expect(readFileSync(join(root, `lib/${name}.js`), 'utf8')).not.toContain('chunk-')
    }
  })

  it('honors declared ESM and CommonJS extensions rather than Vite SSR defaults', async () => {
    const root = fixture()
    writeFileSync(join(root, 'src/index.ts'), 'export const value = 1\n')
    await dobeeVitePackage(root, root, { name: 'dobee-fixture' }, {
      entry: ['src/index.ts'], platform: 'node', format: ['esm', 'cjs'],
      outExtensions: ({ format }) => ({ js: format === 'es' ? '.mjs' : '.cjs' }),
    })
    expect(globSync('lib/index.*', { cwd: root }).sort()).toEqual(['lib/index.cjs', 'lib/index.mjs'])
  })

  it('lowers explicit resource management while preserving disposal', async () => {
    const root = fixture()
    writeFileSync(join(root, 'src/index.ts'), [
      'export function run(): boolean {',
      '  let disposed = false',
      '  { using value = { [Symbol.dispose]() { disposed = true } }; void value }',
      '  return disposed',
      '}',
    ].join('\n'))
    await dobeeVitePackage(root, root, { name: 'dobee-fixture' }, {
      entry: ['src/index.ts'], platform: 'node', format: 'cjs',
    })
    const code = readFileSync(join(root, 'lib/index.cjs'), 'utf8')
    expect(code).not.toMatch(/\busing value/)
    const exported: { run?: () => boolean } = {}
    runInNewContext(code, { exports: exported, Symbol })
    expect(exported.run?.()).toBe(true)
  })

  it('preserves client registration, shared module identity, scoped CSS, and lazy chunk names', async () => {
    const root = fixture()
    writeFileSync(join(root, 'src/index.ts'), 'export const nodeHalf = true\n')
    writeFileSync(join(root, 'src/client/index.ts'), [
      'import { Context } from "@deepseek-ai/cordis"',
      'import styles from "./view.module.css"',
      'export const shared = Context',
      'export const className = styles.box',
      'export const load = () => import("./lazy.ts")',
    ].join('\n'))
    writeFileSync(join(root, 'src/client/lazy.ts'), 'export const answer = 42\n')
    writeFileSync(join(root, 'src/client/view.module.css'), '.box { color: red; }\n')
    // The browser preset must not join the Host test's TypeScript program.
    const preset = await import(pathToFileURL(join(import.meta.dirname, '../packages/client/tsdown.client.ts')).href) as {
      clientBundle(id: string, entries: readonly string[]): (options: { env: { DSH_BUILD_FACE: string } }) => UserConfig[]
    }
    const declaration = preset.clientBundle('@deepseek-ai/dsh-client-ui-theme', ['lib/types/index.js'])({ env: { DSH_BUILD_FACE: 'client' } })
    const config = declaration.find(config => config.name?.endsWith('/client'))
    if (config === undefined) throw new Error('missing client build declaration')
    await dobeeVitePackage(root, root, { name: '@deepseek-ai/dsh-client-ui-theme' }, config)
    const shared = Symbol('shared-context')
    interface ClientExports { shared?: symbol; className?: string; answer?: number; load?(): Promise<ClientExports> }
    interface Require {
      (id: string): { Context: symbol }
      async(id: string): Promise<ClientExports>
    }
    const factories = new Map<string, { id: string; factory(require: Require): ClientExports }>()
    const require: Require = Object.assign(
      (id: string) => {
        if (id !== '@deepseek-ai/cordis') throw new Error(`unexpected client import ${id}`)
        return { Context: shared }
      },
      {
        async: async (id: string) => {
          evaluate(id.replace(/^\.\//, ''))
          const factory = factories.get(id.replace(/^\.\//, ''))
          if (factory === undefined) throw new Error(`missing chunk factory ${id}`)
          return factory.factory(require)
        },
      },
    )
    const evaluate = (file: string): void => {
      runInNewContext(readFileSync(join(root, 'lib', file), 'utf8'), {
        window: { __ModuleLoader__: { load: (value: { id: string; chunk?: string; factory(require: Require): ClientExports }) => {
          factories.set(value.chunk ?? 'client.js', value)
        } } },
        document: { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild: () => {} } },
      })
    }
    evaluate('client.js')
    const factory = factories.get('client.js')
    if (factory === undefined) throw new Error('missing entry factory')
    expect(factory.id).toBe('@deepseek-ai/dsh-client-ui-theme')
    const result = factory.factory(require)
    expect(result.shared).toBe(shared)
    expect(result.className).toMatch(/_box$/)
    if (result.load === undefined) throw new Error('missing lazy loader')
    await expect(result.load()).resolves.toMatchObject({ answer: 42 })
    expect(existsSync(join(root, 'lib/client.lazy.js'))).toBe(true)
    const map = JSON.parse(readFileSync(join(root, 'lib/client.js.map'), 'utf8')) as { sourcesContent: string[] }
    expect(map.sourcesContent.some(source => source.includes('export const shared = Context'))).toBe(true)
  })
})
