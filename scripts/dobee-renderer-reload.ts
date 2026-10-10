/** Refresh development Renderer targets only after verifying their owning Electron process. */

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function command(url: string, method: string, signal: AbortSignal): Promise<unknown> {
  const target = new URL(url)
  if (target.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('dobee-renderer: debugging WebSocket must be on loopback')
  }
  const socket = new WebSocket(url)
  try {
    return await new Promise((resolve, reject) => {
      const abort = (): void => { reject(new Error(`dobee-renderer: ${method} cancelled`, { cause: signal.reason })) }
      signal.addEventListener('abort', abort, { once: true })
      const finish = (value: unknown): void => { signal.removeEventListener('abort', abort); resolve(value) }
      const fail = (error: unknown): void => {
        signal.removeEventListener('abort', abort)
        reject(error instanceof Error ? error : new Error(`dobee-renderer: ${method} failed`, { cause: error }))
      }
      socket.addEventListener('open', () =>{  socket.send(JSON.stringify({ id: 1, method })) }, { once: true })
      socket.addEventListener('error', () =>{  fail(new Error(`dobee-renderer: ${method} connection failed`)) }, { once: true })
      socket.addEventListener('close', () =>{  fail(new Error(`dobee-renderer: ${method} connection closed`)) }, { once: true })
      socket.addEventListener('message', (event) => {
        try {
          if (typeof event.data !== 'string') throw new Error('dobee-renderer: invalid debugger response')
          const value: unknown = JSON.parse(event.data)
          if (!record(value) || value.id !== 1) return
          if ('error' in value) throw new Error(`dobee-renderer: ${method} rejected: ${JSON.stringify(value.error)}`)
          finish(value.result)
        } catch (error) { fail(error) }
      })
      if (signal.aborted) abort()
    })
  } finally { socket.close() }
}

/**
 * Reload the application's pages without restarting Electron or Host.
 * @param port - Renderer debugging port owned by the development launcher.
 * @param pid - Main-process PID that must own the debugging endpoint.
 * @param signal - Cancellation signal; network operations have a bounded deadline.
 * @returns Resolves after every eligible page accepts Page.reload; rejects a foreign process or unavailable debugger.
 */
export async function dobeeReloadDesktopRenderer(port: number, pid: number, signal: AbortSignal): Promise<void> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  const base = `http://127.0.0.1:${String(port)}`
  const versionResponse = await fetch(`${base}/json/version`, { signal: bounded })
  if (!versionResponse.ok) throw new Error(`dobee-renderer: debugger discovery returned ${String(versionResponse.status)}`)
  const version: unknown = await versionResponse.json()
  if (!record(version) || typeof version.webSocketDebuggerUrl !== 'string') throw new Error('dobee-renderer: missing browser debugger')
  const processes = await command(version.webSocketDebuggerUrl, 'SystemInfo.getProcessInfo', bounded)
  if (!record(processes) || !Array.isArray(processes.processInfo)) throw new Error('dobee-renderer: missing debugger process inventory')
  const inventory: readonly unknown[] = processes.processInfo
  if (!inventory.some(item => record(item) && item.type === 'browser' && item.id === pid)) {
    throw new Error('dobee-renderer: debugging endpoint belongs to another process')
  }
  const pagesResponse = await fetch(`${base}/json/list`, { signal: bounded })
  if (!pagesResponse.ok) throw new Error(`dobee-renderer: page discovery returned ${String(pagesResponse.status)}`)
  const pages: unknown = await pagesResponse.json()
  if (!Array.isArray(pages)) throw new Error('dobee-renderer: invalid page inventory')
  const targets: readonly unknown[] = pages
  let reloaded = 0
  for (const page of targets) {
    if (!record(page) || page.type !== 'page' || typeof page.url !== 'string'
      || !/^(?:dsh-app:|file:)/.test(page.url)) continue
    if (typeof page.webSocketDebuggerUrl !== 'string') throw new Error('dobee-renderer: page has no debugger')
    await command(page.webSocketDebuggerUrl, 'Page.reload', bounded)
    reloaded++
  }
  if (reloaded === 0) throw new Error('dobee-renderer: no application page is available to reload')
}
