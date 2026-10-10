import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dobeeReadViteSelection } from './dobee-vite-build.ts'

const root = resolve(import.meta.dirname, '..')
const selection = {
  names: ['dobee-plugin'], directories: [resolve(root, 'packages/test/dobee-plugin')], totalPackages: 2,
}

describe('Desktop Vite child selection', () => {
  it('restores the coordinator selection without recomputing the runtime closure', () => {
    const parsed = dobeeReadViteSelection(root, selection)
    expect([...parsed.names]).toEqual(selection.names)
    expect([...parsed.directories]).toEqual(selection.directories)
    expect(parsed.totalPackages).toBe(2)
  })

  it.each([
    null, {}, { ...selection, names: [1] }, { ...selection, directories: [] },
    { ...selection, totalPackages: 0 }, { ...selection, totalPackages: 1.5 },
    { ...selection, names: ['dobee-plugin', 'dobee-plugin'], directories: [selection.directories[0], root] },
  ])('rejects incomplete or inconsistent input: %j', (value) => {
    expect(() => dobeeReadViteSelection(root, value)).toThrow('complete Desktop runtime selection')
  })

  it.each([root, resolve(root, '..'), 'packages/test/dobee-plugin'])('rejects a directory outside package scope: %s', (path) => {
    expect(() => dobeeReadViteSelection(root, { ...selection, directories: [path] })).toThrow('inside the repository')
  })
})
