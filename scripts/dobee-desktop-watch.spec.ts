import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DobeeDesktopRebuildQueue, dobeeDesktopRestartRequired, dobeeWatchDesktopSources } from './dobee-desktop-watch.ts'
import { DobeeDevelopmentProcess } from './dobee-development-process.ts'

const disposers: Array<() => Promise<void>> = []
const roots: string[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function operations() {
  return {
    build: vi.fn<(paths: readonly string[], signal: AbortSignal) => Promise<'hmr' | 'reload' | 'restart'>>(async () => 'hmr'),
    restart: vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {}),
    reload: vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {}),
    failed: vi.fn<(error: unknown) => Promise<void>>(async () => {}),
  }
}

describe('Desktop incremental rebuild queue', () => {
  it('keeps client plugin edits on HMR and restarts for Host, Main and metadata', () => {
    expect(dobeeDesktopRestartRequired(['packages/client/example/src/client/index.ts'])).toBe(false)
    for (const path of ['packages/core/example/src/index.ts', 'apps/desktop/src/main.ts', 'apps/desktop/src/preload-app.ts',
      'packages/client/example/package.json']) {
      expect(dobeeDesktopRestartRequired([path])).toBe(true)
    }
  })

  it('serializes edits arriving during a build without losing the later restart', async () => {
    const ops = operations()
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ops.build.mockImplementationOnce(async () => { started.resolve(undefined); await release.promise; return 'hmr' })
    const queue = new DobeeDesktopRebuildQueue(ops)
    disposers.push(() => queue.close())
    const first = queue.enqueue(['packages/client/example/src/client/index.ts'])
    await started.promise
    const second = queue.enqueue(['apps/desktop/src/main.ts'])
    expect(ops.build).toHaveBeenCalledOnce()
    release.resolve(undefined)
    await Promise.all([first, second])
    expect(ops.build).toHaveBeenCalledTimes(2)
    expect(ops.restart).toHaveBeenCalledOnce()
  })

  it('refreshes Web and welcome UI without restarting Electron or Host', async () => {
    const ops = operations()
    const queue = new DobeeDesktopRebuildQueue(ops)
    disposers.push(() => queue.close())
    await queue.enqueue(['apps/web/src/main.tsx', 'apps/desktop/src/client/WelcomePage.tsx'])
    expect(ops.build).toHaveBeenCalledOnce()
    expect(ops.reload).toHaveBeenCalledOnce()
    expect(ops.restart).not.toHaveBeenCalled()
  })

  it('restarts when the UI build guard discovers a concurrent Host change', async () => {
    const ops = operations()
    ops.build.mockResolvedValueOnce('restart')
    const queue = new DobeeDesktopRebuildQueue(ops)
    disposers.push(() => queue.close())
    await queue.enqueue(['apps/web/src/main.tsx'])
    expect(ops.restart).toHaveBeenCalledOnce()
    expect(ops.reload).not.toHaveBeenCalled()
  })

  it('reports failure and restarts after the next successful client edit', async () => {
    const ops = operations()
    ops.build.mockRejectedValueOnce(new Error('invalid source'))
    const queue = new DobeeDesktopRebuildQueue(ops)
    disposers.push(() => queue.close())
    await queue.enqueue(['packages/client/example/src/client/index.ts'])
    expect(ops.failed).toHaveBeenCalledOnce()
    expect(ops.restart).not.toHaveBeenCalled()
    await queue.enqueue(['packages/client/example/src/client/index.ts'])
    expect(ops.restart).toHaveBeenCalledOnce()
  })

  it('cancels and settles an in-flight operation before closing', async () => {
    const ops = operations()
    const started = Promise.withResolvers<undefined>()
    const ended = Promise.withResolvers<undefined>()
    ops.build.mockImplementation(async (_paths, signal) => {
      started.resolve(undefined)
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { ended.resolve(undefined); resolve() }, { once: true })
      })
      return 'hmr'
    })
    const queue = new DobeeDesktopRebuildQueue(ops)
    const work = queue.enqueue(['apps/desktop/src/main.ts'])
    await started.promise
    await queue.close()
    await ended.promise
    await work
    await queue.enqueue(['apps/desktop/src/main.ts'])
    expect(ops.build).toHaveBeenCalledOnce()
    expect(ops.restart).not.toHaveBeenCalled()
  })

  it('does not hide a subprocess teardown failure during cancellation', async () => {
    const ops = operations()
    const started = Promise.withResolvers<undefined>()
    ops.build.mockImplementation(async (_paths, signal) => {
      started.resolve(undefined)
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('teardown failed')) }, { once: true })
      })
      return 'hmr'
    })
    const queue = new DobeeDesktopRebuildQueue(ops)
    const work = queue.enqueue(['apps/desktop/src/main.ts'])
    const failure = expect(work).rejects.toThrow('teardown failed')
    await started.promise
    await expect(queue.close()).rejects.toThrow('teardown failed')
    await failure
  })
})

describe('Desktop source watcher', () => {
  it('observes a real source edit and disposes without opening a network listener', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dobee-desktop-watch-'))
    roots.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    const path = join(root, 'src/index.ts')
    writeFileSync(path, 'export const value = 1\n')
    const changed = Promise.withResolvers<string>()
    const watching = Promise.withResolvers<string>()
    const close = await dobeeWatchDesktopSources(root, (relative) => {
      if (relative === 'probe.ts') watching.resolve(relative)
      if (relative === 'src/index.ts') changed.resolve(relative)
    }, (error) => { changed.reject(error); watching.reject(error) }, 50)
    disposers.push(close)
    writeFileSync(join(root, 'probe.ts'), 'export {}\n')
    await watching.promise
    writeFileSync(path, 'export const value = 2000\n')
    utimesSync(path, new Date(0), new Date(0))
    await expect(changed.promise).resolves.toBe('src/index.ts')
    await close()
    disposers.pop()
  })
})

describe.skipIf(process.platform === 'win32')('POSIX development process ownership', () => {
  it('waits for the owned child and its descendant process group to exit', async () => {
    const childSource = 'setInterval(() => {}, 1000); process.on("SIGTERM", () => process.exit(0))'
    const parentSource = `
      const { spawn } = await import('node:child_process')
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], { stdio: 'ignore' })
      child.once('spawn', () => process.send({ ready: true, descendant: child.pid }))
      process.on('SIGTERM', () => {})
      child.once('exit', () => process.exit(0))
    `
    const process = new DobeeDevelopmentProcess(globalThis.process.execPath, ['--input-type=module', '-e', parentSource], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    disposers.push(() => process.stop())
    const received: unknown = await once(process.child, 'message')
    if (!Array.isArray(received)) throw new Error('missing child message')
    const message: unknown = received[0]
    expect(message).toMatchObject({ ready: true })
    await process.stop()
    expect((await process.exited).code).toBe(0)
  })
})
