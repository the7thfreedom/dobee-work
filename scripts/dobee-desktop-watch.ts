/** Serialize incremental Desktop rebuilds and restart only for inputs that affect the running Node processes. */

import { relative } from 'node:path'
import { realpathSync } from 'node:fs'
import { once } from 'node:events'
import { watch } from 'chokidar'

/** Effects owned by the Desktop development launcher. */
export interface DobeeDesktopWatchOperations {
  /** Build the current Desktop scope; cancellation must settle owned subprocesses. */
  build(paths: readonly string[], signal: AbortSignal): Promise<'hmr' | 'reload' | 'restart'>
  /** Stop Electron and Host before starting the replacement. */
  restart(signal: AbortSignal): Promise<void>
  /** Refresh static Renderer assets without stopping Electron or Host. */
  reload(signal: AbortSignal): Promise<void>
  /** Show an explicit failure and stop the application using partial artifacts. */
  failed(error: unknown): Promise<void>
}

/**
 * Whether a changed input needs a Node-process restart rather than client plugin HMR.
 * @param paths - Repository-relative changed file paths.
 * @returns True for Host, Main, Preload, metadata and shared build inputs.
 */
export function dobeeDesktopRestartRequired(paths: readonly string[]): boolean {
  return paths.some(path => dobeeDesktopChangeKind(path) === 'restart')
}

/**
 * Choose plugin HMR, page refresh, or Node restart for one changed input.
 * @param path - Repository-relative input path.
 * @returns Reload action retaining running Node processes for UI-only edits.
 */
export function dobeeDesktopChangeKind(path: string): 'hmr' | 'reload' | 'restart' {
  const normalized = path.replaceAll('\\', '/')
  if (/^apps\/(?:web\/|desktop\/src\/client\/)/.test(normalized)) return 'reload'
  if (/^packages\/client\/[^/]+\/src\/client\//.test(normalized)) return 'hmr'
  if (/^packages\/client\/[^/]+\/src\/.*\.tsx$/.test(normalized)) return 'reload'
  if (/^packages\/client\/[^/]+\/src\/.*\.(?:css|png|svg|woff2?|ttf)$/.test(normalized)) return 'reload'
  return 'restart'
}

/** One queue retaining edits that arrive during an in-flight build. */
export class DobeeDesktopRebuildQueue {
  private readonly pending = new Set<string>()
  private work: Promise<void> | undefined
  private readonly controller = new AbortController()
  private applicationStopped = false

  constructor(private readonly operations: DobeeDesktopWatchOperations) {}

  /**
   * Queue changed source paths; at most one rebuild/restart operation runs at a time.
   * @param paths - Repository-relative source or configuration paths.
   * @returns Resolves after the current queue has drained.
   */
  enqueue(paths: readonly string[]): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve()
    for (const path of paths) this.pending.add(path)
    if (this.work === undefined) {
      const run = async (): Promise<void> => {
        try { await this.drain() } finally { this.work = undefined }
        if (this.pending.size > 0 && !this.stopped()) await this.enqueue([])
      }
      this.work = run()
    }
    return this.work
  }

  /** Stop admitting changes, cancel owned work, and await its teardown. */
  async close(): Promise<void> {
    this.controller.abort()
    this.pending.clear()
    await this.work
  }

  private stopped(): boolean { return this.controller.signal.aborted }

  private async drain(): Promise<void> {
    while (this.pending.size > 0 && !this.stopped()) {
      const paths = [...this.pending]
      this.pending.clear()
      try {
        const update = await this.operations.build(paths, this.controller.signal)
        if (!this.stopped() && (update === 'restart' || this.applicationStopped || dobeeDesktopRestartRequired(paths))) {
          await this.operations.restart(this.controller.signal)
          this.applicationStopped = false
        } else if (!this.stopped() && (update === 'reload' || paths.some(path => dobeeDesktopChangeKind(path) === 'reload'))) {
          await this.operations.reload(this.controller.signal)
        }
      } catch (error) {
        if (this.stopped()) throw error
        this.applicationStopped = true
        await this.operations.failed(error)
      }
    }
  }
}

/**
 * Watch repository inputs after the initial scan settles, excluding emitted artifacts.
 * @param root - Repository root.
 * @param changed - Callback for repository-relative added, removed or modified inputs.
 * @param failed - Callback for watcher failures after startup.
 * @param interval - Positive polling interval in milliseconds; polling also supports network-mounted workspaces.
 * @returns Async disposer that closes the watcher before its caller stops build processes.
 */
export async function dobeeWatchDesktopSources(
  root: string, changed: (path: string) => void, failed: (error: unknown) => void, interval = 500,
): Promise<() => Promise<void>> {
  if (!Number.isSafeInteger(interval) || interval < 1) throw new Error('dobee-watch: interval must be a positive integer')
  const canonicalRoot = realpathSync(root)
  const watcher = watch(canonicalRoot, {
    ignoreInitial: true,
    usePolling: true,
    interval,
    ignored: path => /(?:^|\/)(?:node_modules|lib|dist|\.git|\.dsh-build|\.desktop-build|\.cache|\.generated|\.dist)(?:\/|$)/
      .test(relative(canonicalRoot, path).replaceAll('\\', '/')) || path.endsWith('.tsbuildinfo'),
  })
  try { await once(watcher, 'ready') } catch (error) { await watcher.close(); throw error }
  const listener = (path: string): void => {
    const local = relative(canonicalRoot, path).replaceAll('\\', '/')
    if (!/\.(?:[cm]?[jt]sx?|json|ya?ml|css|html|png|svg|woff2?|ttf|txt|c|h|cc|cpp|cxx|rs)$/.test(local)) return
    if (/(?:^|\/)(?:tests|test)(?:\/|$)/.test(local) || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(local)) return
    changed(local)
  }
  watcher.on('add', listener).on('change', listener).on('unlink', listener).on('error', failed)
  return async () => {
    watcher.off('add', listener).off('change', listener).off('unlink', listener).off('error', failed)
    await watcher.close()
  }
}
