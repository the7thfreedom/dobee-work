/** Isolate persistent client build configuration from the Desktop launcher's environment and module cache. */

import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { DobeeDevelopmentProcess } from './dobee-development-process.ts'
import { readClientBuildRecord } from './client-build-environment.ts'

/** Shell-free IPC peer for the resident UI compiler process. */
export class DobeeResidentUiProcess {
  private readonly process: DobeeDevelopmentProcess
  private readonly ready = Promise.withResolvers<void>()
  private readonly requests = new Map<number, { resolve(value: boolean): void; reject(error: Error): void }>()
  private nextId = 1
  private stopping = false

  /**
   * @param root - Repository root with complete built client artifacts.
   * @param environment - Development environment; recorded public build values replace inherited values.
   * @param interval - Persistent compiler filesystem polling interval.
   */
  constructor(root: string, environment: NodeJS.ProcessEnv, interval: number) {
    const record = readClientBuildRecord(root)
    this.process = new DobeeDevelopmentProcess(globalThis.process.execPath, [
      '--import', 'tsx/esm', resolve(root, 'scripts/dobee-ui-resident.ts'),
    ], {
      cwd: root,
      env: { ...environment, ...record.environment, DOBEE_WATCH_INTERVAL: String(interval) },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    this.process.child.on('message', (value: unknown) => {
      if (typeof value !== 'object' || value === null || !('type' in value)) {  this.fail(new Error('dobee-resident: invalid response')); return }
      if (value.type === 'ready') { this.ready.resolve(); return }
      if (value.type !== 'result' || !('id' in value) || typeof value.id !== 'number') {
        this.fail(new Error('dobee-resident: invalid response'))
        return
      }
      const request = this.requests.get(value.id)
      if (request === undefined) return
      this.requests.delete(value.id)
      if ('error' in value && typeof value.error === 'string') request.reject(new Error(value.error))
      else if ('reused' in value && typeof value.reused === 'boolean') request.resolve(value.reused)
      else request.reject(new Error('dobee-resident: result omitted the build verdict'))
    })
    void this.process.exited.then((result) => {
      if (!this.stopping) this.fail(new Error(`dobee-resident: compiler process exited ${String(result.code ?? result.signal)}`))
    }, (error: unknown) => { this.fail(error instanceof Error ? error : new Error(String(error))) })
    // An early exit can precede the first build request.
    void this.ready.promise.catch(() => {})
  }

  /**
   * Request a serialized UI rebuild without launching another compiler process.
   * @param paths - Repository-relative changed inputs.
   * @param signal - Cancellation signal; cancellation closes and settles the compiler tree.
   * @returns Whether the resident process completed the build; false selects the ordinary build.
   */
  async build(paths: readonly string[], signal: AbortSignal): Promise<boolean> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(45_000)])
    const cancel = (): void => {
      this.fail(new Error('dobee-resident: build cancelled or exceeded its deadline'))
      void this.close().catch((error: unknown) => { this.fail(error instanceof Error ? error : new Error(String(error))) })
    }
    bounded.addEventListener('abort', cancel, { once: true })
    try {
      if (bounded.aborted) { cancel(); throw new Error('dobee-resident: build cancelled') }
      await this.ready.promise
      const id = this.nextId++
      return await new Promise<boolean>((resolve, reject) => {
        this.requests.set(id, { resolve, reject })
        this.process.child.send({ type: 'build', id, paths }, (error) => {
          if (error !== null) { this.requests.delete(id); reject(error) }
        })
      })
    } finally {
      bounded.removeEventListener('abort', cancel)
      if (bounded.aborted) await this.close()
    }
  }

  /** Close persistent watchers and settle the owned process group before another build starts. */
  async close(): Promise<void> {
    this.stopping = true
    this.fail(new Error('dobee-resident: compiler process closed'))
    if (this.process.child.connected) {
      this.process.child.send({ type: 'stop' }, () => {})
      const timeout = new AbortController()
      try {
        await Promise.race([this.process.exited, delay(6_000, undefined, { signal: timeout.signal })])
      } finally { timeout.abort() }
    }
    await this.process.stop()
  }

  private fail(error: Error): void {
    this.ready.reject(error)
    for (const request of this.requests.values()) request.reject(error)
    this.requests.clear()
  }
}
