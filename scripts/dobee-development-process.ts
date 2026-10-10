/** Own development subprocess groups through graceful stop, escalation, and confirmed exit. */

import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'

/** Completion of one owned development process. */
export interface DobeeProcessExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

function missingProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

/** A process group on POSIX and a PID-owned descendant tree on Windows. */
export class DobeeDevelopmentProcess {
  readonly child: ChildProcess
  readonly exited: Promise<DobeeProcessExit>
  private finished = false
  private stopping: Promise<void> | undefined

  /**
   * @param command - Executable to spawn.
   * @param args - Shell-free executable arguments.
   * @param options - Working directory, environment and stdio; group ownership is fixed by the supervisor.
   */
  constructor(command: string, args: readonly string[], options: SpawnOptions) {
    this.child = spawn(command, args, { ...options, detached: process.platform !== 'win32' })
    this.exited = new Promise((resolve, reject) => {
      this.child.once('error', reject)
      this.child.once('exit', (code, signal) => {
        this.finished = true
        resolve({ code, signal })
      })
    })
  }

  /** Stop the owned tree and resolve only after its processes have exited. */
  stop(): Promise<void> {
    this.stopping ??= this.stopTree()
    return this.stopping
  }

  private async stopTree(): Promise<void> {
    const pid = this.child.pid
    if (pid === undefined) { await this.exited; return }
    if (process.platform === 'win32') {
      if (!this.finished) await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      await this.exited
      return
    }
    const signal = (value: NodeJS.Signals): void => {
      try { process.kill(-pid, value) } catch (error) { if (!missingProcess(error)) throw error }
    }
    const alive = (): boolean => {
      try { process.kill(-pid, 0); return true } catch (error) {
        if (missingProcess(error)) return false
        throw error
      }
    }
    signal('SIGTERM')
    const deadline = performance.now() + 6_000
    while (alive() && performance.now() < deadline) await delay(25)
    if (alive()) signal('SIGKILL')
    await this.exited
    const killedDeadline = performance.now() + 6_000
    while (alive() && performance.now() < killedDeadline) await delay(25)
    if (alive()) throw new Error(`dobee-development: process group ${String(pid)} did not exit`)
  }
}
