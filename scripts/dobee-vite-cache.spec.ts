import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DobeeViteArtifactCache, type DobeeViteBuildFiles } from './dobee-vite-cache.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dobee-vite-artifacts-'))
  roots.push(root)
  const directory = join(root, 'packages/test/example')
  const source = join(directory, 'src/index.ts')
  const output = join(directory, 'lib/index.js')
  const dependency = join(root, 'dependency.js')
  mkdirSync(join(directory, 'src'), { recursive: true })
  mkdirSync(join(directory, 'lib'), { recursive: true })
  writeFileSync(source, 'export const value = 1\n')
  writeFileSync(dependency, 'export const other = 1\n')
  const build = vi.fn(async (files: DobeeViteBuildFiles) => {
    files.inputs.add(dependency)
    files.outputs.add(output)
    writeFileSync(output, `${readFileSync(source, 'utf8')}${readFileSync(dependency, 'utf8')}`)
  })
  return { root, directory, source, output, dependency, build,
    cache: (key = 'environment', face = 'host') => new DobeeViteArtifactCache(root, face, key) }
}

describe('verified Vite artifact reuse', () => {
  it('rejects an extra output when an exclusive Renderer directory supplies its file roster', async () => {
    const test = fixture()
    const cache = new DobeeViteArtifactCache(test.root, 'renderer', 'environment', () =>
      globSync('lib/*.js', { cwd: test.directory }).map(path => join(test.directory, path)))
    expect(await cache.run(test.directory, test.build)).toBe(false)
    expect(await cache.run(test.directory, test.build)).toBe(true)
    writeFileSync(join(test.directory, 'lib/unexpected.js'), 'unexpected output')
    expect(await cache.run(test.directory, test.build)).toBe(false)
    expect(test.build).toHaveBeenCalledTimes(2)
  })

  it('reuses complete matching output without rewriting its files', async () => {
    const test = fixture()
    expect(await test.cache().run(test.directory, test.build)).toBe(false)
    expect(await test.cache().run(test.directory, test.build)).toBe(true)
    expect(test.build).toHaveBeenCalledOnce()
  })

  it.each(['source', 'dependency'] as const)('rebuilds changed %s bytes even when timestamps are restored', async (field) => {
    const test = fixture()
    await test.cache().run(test.directory, test.build)
    const path = test[field]
    writeFileSync(path, 'export const changed = 2\n')
    utimesSync(path, new Date(0), new Date(0))
    expect(await test.cache().run(test.directory, test.build)).toBe(false)
    expect(test.build).toHaveBeenCalledTimes(2)
  })

  it.each(['missing', 'corrupt'] as const)('rebuilds %s output files', async (operation) => {
    const test = fixture()
    await test.cache().run(test.directory, test.build)
    if (operation === 'missing') rmSync(test.output)
    else writeFileSync(test.output, 'invalid bundle')
    expect(await test.cache().run(test.directory, test.build)).toBe(false)
  })

  it('invalidates on added package inputs and changed environment or compiler face', async () => {
    const test = fixture()
    await test.cache().run(test.directory, test.build)
    writeFileSync(join(test.directory, 'src/added.ts'), 'export const added = true')
    expect(await test.cache().run(test.directory, test.build)).toBe(false)
    expect(await test.cache('changed-environment').run(test.directory, test.build)).toBe(false)
    expect(await test.cache('changed-environment', 'client').run(test.directory, test.build)).toBe(false)
  })

  it('never publishes success after a failed build', async () => {
    const test = fixture()
    await test.cache().run(test.directory, test.build)
    writeFileSync(test.source, 'changed source')
    test.build.mockRejectedValueOnce(new Error('build failed'))
    await expect(test.cache().run(test.directory, test.build)).rejects.toThrow('build failed')
    expect(globSync('.dsh-build/dobee-vite/host/*.json', { cwd: test.root })).toEqual([])
    expect(await test.cache().run(test.directory, test.build)).toBe(false)
    expect(existsSync(test.output)).toBe(true)
  })
})
