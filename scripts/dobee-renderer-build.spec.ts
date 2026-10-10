import { createRequire } from 'node:module'
import { globSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dobeeBuildRenderer } from './dobee-renderer-build.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dobee-renderer-cache-')))
  roots.push(root)
  const directory = join(root, 'apps/web')
  const styles = join(root, 'packages/client/ui-theme/src/styles')
  mkdirSync(join(directory, 'node_modules'), { recursive: true })
  mkdirSync(styles, { recursive: true })
  const require = createRequire(resolve(import.meta.dirname, '../apps/web/package.json'))
  symlinkSync(dirname(require.resolve('vite/package.json')), join(directory, 'node_modules/vite'), 'junction')
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(directory, 'index.html'), '<script type="module" src="/main.js"></script>\n')
  writeFileSync(join(directory, 'main.js'), 'new Worker(new URL("./worker.js", import.meta.url));\n')
  writeFileSync(join(directory, 'worker.js'), 'import { value } from "../../worker-input.js"; postMessage(value);\n')
  writeFileSync(join(root, 'worker-input.js'), 'export const value = 1;\n')
  writeFileSync(join(styles, 'license.txt'), 'font license\n')
  writeFileSync(join(directory, 'vite.config.ts'), `
import { readFileSync } from 'node:fs'
export default {
  logLevel: 'silent',
  plugins: [{
    name: 'font-license',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'license.txt',
        source: readFileSync(new URL('../../packages/client/ui-theme/src/styles/license.txt', import.meta.url)) })
    },
  }],
}
`)
  vi.stubEnv('NODE_ENV', 'production')
  const environment = { ...process.env }
  const build = () => dobeeBuildRenderer(root, environment)
  const outputs = () => Object.fromEntries(globSync('dist/**/*', { cwd: directory })
    .filter(path => statSync(join(directory, path)).isFile())
    .map(path => [path, readFileSync(join(directory, path), 'utf8')]))
  return { root, directory, styles, build, outputs }
}

describe('package-owned Renderer Vite cache', () => {
  it.each(['worker', 'font'] as const)('invalidates changed external %s bytes and restores identical bundles', async (input) => {
    const test = fixture()
    expect(await test.build()).toBe(false)
    const before = test.outputs()
    expect(await test.build()).toBe(true)
    const path = input === 'worker' ? join(test.root, 'worker-input.js') : join(test.styles, 'license.txt')
    const original = readFileSync(path, 'utf8')
    writeFileSync(path, input === 'worker' ? 'export const value = 2;\n' : 'changed font license\n')
    utimesSync(path, new Date(0), new Date(0))
    expect(await test.build()).toBe(false)
    expect(test.outputs()).not.toEqual(before)
    writeFileSync(path, original)
    expect(await test.build()).toBe(false)
    expect(test.outputs()).toEqual(before)
  })

  it('cleans unexpected output and rebuilds corrupted or missing files', async () => {
    const test = fixture()
    await test.build()
    const before = test.outputs()
    writeFileSync(join(test.directory, 'dist/unexpected.js'), 'unexpected output')
    writeFileSync(join(test.directory, 'dist/index.html'), 'corrupt page')
    expect(await test.build()).toBe(false)
    expect(test.outputs()).toEqual(before)
    rmSync(join(test.directory, 'dist/index.html'))
    expect(await test.build()).toBe(false)
    expect(test.outputs()).toEqual(before)
  })
})
