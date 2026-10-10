import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DobeeScopePackage } from './dobee-desktop-build-scope.ts'

const mocked = vi.hoisted(() => ({
  packages: vi.fn<(root: string) => ReadonlyMap<string, DobeeScopePackage>>(),
  closure: vi.fn<() => ReadonlySet<string>>(),
  projects: vi.fn<() => string[]>(),
  emit: vi.fn<(root: string, config: string, fast: boolean) => void>(),
  spawn: vi.fn<(command: string, args: readonly string[], options: SpawnSyncOptions) => SpawnSyncReturns<Buffer>>(
    () => ({ pid: 1, status: 0, signal: null, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })),
}))
vi.mock('./dobee-desktop-build-scope.ts', () => ({
  dobeeWorkspaceBuildPackages: mocked.packages,
  dobeeDesktopPackageClosure: mocked.closure,
}))
vi.mock('./dobee-declarations.ts', () => ({
  dobeeDeclarationProjects: mocked.projects,
  dobeeEmitDeclarations: mocked.emit,
}))
vi.mock('node:child_process', () => ({ spawnSync: mocked.spawn }))

const { dobeeBuildDesktop } = await import('./dobee-desktop-build.ts')
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('shared Desktop build coordinator', () => {
  it('selects once and preserves checked Host, Typert, Desktop and Client stage ordering', () => {
    const root = mkdtempSync(join(tmpdir(), 'dobee-desktop-coordinator-'))
    roots.push(root)
    const directory = join(root, 'packages/test/plugin')
    mkdirSync(directory, { recursive: true })
    const config = join(directory, 'tsconfig.json')
    writeFileSync(config, '{}\n')
    mocked.packages.mockReturnValue(new Map([['dobee-plugin', {
      name: 'dobee-plugin', directory, dependencies: [], sourceDependencies: [], configurationDependencies: [],
    }]]))
    mocked.closure.mockReturnValue(new Set(['dobee-plugin']))
    mocked.projects.mockReturnValue([config])
    vi.stubEnv('DSH_BUILD_SCOPE', 'desktop')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    dobeeBuildDesktop(root)
    expect(mocked.packages).toHaveBeenCalledOnce()
    expect(mocked.closure).toHaveBeenCalledOnce()
    expect(mocked.emit.mock.calls.map(call => call[2])).toEqual([false, true])
    expect(mocked.spawn.mock.calls.map(call => call[1]?.[4])).toEqual(['host', 'desktop', 'client'])
    expect(mocked.spawn.mock.calls.map(call => call[1]?.includes('--checked'))).toEqual([true, true, false])
    const firstFace = mocked.spawn.mock.invocationCallOrder[0]
    const lastEmit = mocked.emit.mock.invocationCallOrder[1]
    if (firstFace === undefined || lastEmit === undefined) throw new Error('build stages were not invoked')
    expect(mocked.emit.mock.invocationCallOrder[0]).toBeLessThan(firstFace)
    expect(mocked.spawn.mock.invocationCallOrder[1]).toBeLessThan(lastEmit)
    expect(mocked.spawn.mock.calls[0]?.[2]?.input).toBe(mocked.spawn.mock.calls[2]?.[2]?.input)
    const generated = JSON.parse(readFileSync(join(root, '.dsh-build/dobee-desktop-host.json'), 'utf8')) as {
      files: string[]
      references: { path: string }[]
    }
    expect(generated).toEqual({ files: [], references: [{ path: config }] })
  })

  it('does not start Vite or Client emission after Host checking fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'dobee-desktop-coordinator-'))
    roots.push(root)
    mocked.packages.mockReturnValue(new Map([['dobee-plugin', {
      name: 'dobee-plugin', directory: root, dependencies: [], sourceDependencies: [], configurationDependencies: [],
    }]]))
    mocked.closure.mockReturnValue(new Set(['dobee-plugin']))
    mocked.projects.mockReturnValue([root])
    mocked.emit.mockImplementationOnce(() => { throw new Error('Host diagnostics failed') })
    vi.stubEnv('DSH_BUILD_SCOPE', 'desktop')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => { dobeeBuildDesktop(root) }).toThrow('Host diagnostics failed')
    expect(mocked.spawn).not.toHaveBeenCalled()
    expect(mocked.emit).toHaveBeenCalledOnce()
  })

  it('does not start Client compilation after the Host process fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'dobee-desktop-coordinator-'))
    roots.push(root)
    mocked.packages.mockReturnValue(new Map([['dobee-plugin', {
      name: 'dobee-plugin', directory: root, dependencies: [], sourceDependencies: [], configurationDependencies: [],
    }]]))
    mocked.closure.mockReturnValue(new Set(['dobee-plugin']))
    mocked.projects.mockReturnValue([root])
    mocked.spawn.mockReturnValueOnce({ pid: 1, status: 1, signal: null, output: [],
      stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
    vi.stubEnv('DSH_BUILD_SCOPE', 'desktop')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => { dobeeBuildDesktop(root) }).toThrow('host exited 1')
    expect(mocked.spawn).toHaveBeenCalledOnce()
    expect(mocked.emit).toHaveBeenCalledOnce()
  })
})
