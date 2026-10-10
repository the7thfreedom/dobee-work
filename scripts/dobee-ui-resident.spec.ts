import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { dobeeVitePackage } from './dobee-vite-package.ts'
import type { DobeeViteBuildFiles } from './dobee-vite-cache.ts'

const roots: string[] = []
const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('persistent independent Vite compiler', () => {
  it('rewrites only its owned plugin output after a real source edit and retains dependency tracking', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dobee-resident-')))
    roots.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"name":"dobee-fixture","type":"module"}\n')
    writeFileSync(join(root, 'tsconfig.base.json'), '{"compilerOptions":{"paths":{}},"files":[]}\n')
    const source = join(root, 'src/index.ts')
    writeFileSync(source, 'export const value: number = 1\n')
    const untouched = join(root, 'unrelated.js')
    writeFileSync(untouched, 'unrelated plugin output\n')
    let completion = Promise.withResolvers<undefined>()
    const failed = Promise.withResolvers<unknown>()
    const files: DobeeViteBuildFiles = { inputs: new Set(), outputs: new Set() }
    await dobeeVitePackage(root, root, { name: 'dobee-fixture' }, {
      entry: ['src/index.ts'], platform: 'node', format: 'cjs',
    }, files, {
      interval: 50,
      opened: (close) => { disposers.push(close) },
      started: () => {},
      completed: () => { completion.resolve(undefined) },
      failed: (error) => { failed.resolve(error); completion.reject(error) },
    })
    await completion.promise
    expect(files.inputs).toContain(source)
    expect(files.outputs).toContain(join(root, 'lib/index.cjs'))
    const read = (): number | undefined => {
      const exported: { value?: number } = {}
      runInNewContext(readFileSync(join(root, 'lib/index.cjs'), 'utf8'), { exports: exported })
      return exported.value
    }
    expect(read()).toBe(1)
    completion = Promise.withResolvers<undefined>()
    writeFileSync(source, 'export const value: number = 2\n')
    await completion.promise
    expect(read()).toBe(2)
    expect(files.inputs).toContain(source)
    expect(readFileSync(untouched, 'utf8')).toBe('unrelated plugin output\n')
    writeFileSync(source, 'export const value = ;\n')
    await expect(failed.promise).resolves.toBeDefined()
    completion = Promise.withResolvers<undefined>()
    writeFileSync(source, 'export const value: number = 3\n')
    await completion.promise
    expect(read()).toBe(3)
    const close = disposers.pop()
    if (close === undefined) throw new Error('compiler disposer unavailable')
    await close()
    writeFileSync(source, 'export const value: number = 4\n')
    expect(read()).toBe(3)
  })
})
