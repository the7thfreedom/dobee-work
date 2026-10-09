/** Copilot device authorization, account-owned credentials, and serialized token refresh. */
import { setTimeout as delay } from 'node:timers/promises'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { attributionHeaders, assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { SubscriptionLoginFrame, SubscriptionStatus } from './types.ts'
import { copilotClientHeaders } from './copilot-headers.ts'

/** Copilot credentials remain on the Host and never enter settings or Remote results. */
interface CopilotGrant {
  version: 1
  githubToken: string
  token: string
  expiresAt: number
  endpoint: string
  account: string
  allowedModels?: string[]
}

/** Deployment policy for subscription authorization. */
export interface SubscriptionOptions {
  /** Public OAuth device client; GitHub shows its identity on the consent page. */
  clientId: string
  /** Maximum time for the user to complete authorization. */
  loginTimeoutMs: number
  /** Deadline for each authorization HTTP request. */
  requestTimeoutMs: number
  /** Time before expiration at which the Copilot token is exchanged again. */
  refreshGraceMs: number
}

/** Instance-local protocol dependencies for deterministic authorization tests. */
export interface SubscriptionTransport {
  /** HTTP transport, preserving cancellation. */
  fetch: typeof fetch
  /** Current Unix milliseconds. */
  now: () => number
  /** Cancellation-aware device polling delay. */
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')
}
function copilotEndpoint(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.hostname !== 'api.githubcopilot.com' && !url.hostname.endsWith('.githubcopilot.com'))) {
    throw new LlmError('Invalid Copilot account endpoint', 'INVALID_CREDENTIAL')
  }
  return value.replace(/\/$/, '')
}

function grantOf(value: CredentialRecord | undefined): CopilotGrant | undefined {
  if (value === undefined) return undefined
  const payload = value.kind === 'grant' ? value.payload : undefined
  if (!record(payload) || payload.version !== 1 || typeof payload.githubToken !== 'string'
    || typeof payload.token !== 'string' || typeof payload.account !== 'string'
    || !/^[A-Za-z0-9-]{1,39}$/.test(payload.account)
    || typeof payload.endpoint !== 'string' || typeof payload.expiresAt !== 'number'
    || !Number.isFinite(payload.expiresAt) || payload.githubToken.length === 0 || payload.token.length === 0) {
    throw new LlmError('Stored Copilot authorization is invalid; sign in again', 'INVALID_CREDENTIAL')
  }
  if (payload.allowedModels !== undefined && !strings(payload.allowedModels)) {
    throw new LlmError('Stored subscription model availability is invalid; synchronize models again', 'INVALID_CREDENTIAL')
  }
  return {
    version: 1, githubToken: payload.githubToken, token: payload.token,
    account: payload.account, endpoint: copilotEndpoint(payload.endpoint), expiresAt: payload.expiresAt,
    ...strings(payload.allowedModels) ? { allowedModels: payload.allowedModels } : {},
  }
}

/** Owns one device attempt per connection and one durable account grant per connection. */
export class CopilotSubscriptions {
  private readonly running = new Map<string, { controller: AbortController; done: Promise<void>; close: () => Promise<void> }>()
  private disposed = false

  /**
   * @param credentials - shared credential storage with per-record exclusion.
   * @param options - protocol and timeout policy.
   * @param transport - instance-local HTTP and clock dependencies.
   */
  constructor(
    private readonly credentials: CredentialProvider,
    private readonly options: SubscriptionOptions,
    private readonly transport: SubscriptionTransport = {
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      wait: async (milliseconds, signal) => { await delay(milliseconds, undefined, { signal }) },
    },
  ) {}

  private key(id: string) { return credentialKey('dobee-model-providers', id) }

  private async json(url: string, init: RequestInit, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const deadline = AbortSignal.timeout(this.options.requestTimeoutMs)
    const headers = new Headers(init.headers)
    for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
    headers.set('accept', 'application/json')
    const response = await this.transport.fetch(url, {
      ...init, redirect: 'error',
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
      headers,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new LlmError(`Subscription request failed with HTTP ${response.status}`, 'AUTH', { status: response.status })
    }
    let value: unknown
    try { value = await response.json() }
    catch (error) { throw new LlmError('Subscription server returned invalid JSON', 'INVALID_RESPONSE', { cause: error }) }
    if (!record(value)) throw new LlmError('Subscription server returned an invalid response', 'INVALID_RESPONSE')
    return value
  }

  private async exchange(githubToken: string, account: string, signal?: AbortSignal): Promise<CopilotGrant> {
    const reply = await this.json('https://api.github.com/copilot_internal/v2/token', {
      headers: { ...copilotClientHeaders(), authorization: `Bearer ${githubToken}` },
    }, signal)
    if (typeof reply.token !== 'string' || typeof reply.expires_at !== 'number' || !Number.isFinite(reply.expires_at)) {
      throw new LlmError('The account did not return a usable Copilot token', 'AUTH')
    }
    const endpoints = record(reply.endpoints) ? reply.endpoints : undefined
    const proxy = /(?:^|;)proxy-ep=([^;]+)/.exec(reply.token)?.[1]
    const endpoint = typeof endpoints?.api === 'string' ? endpoints.api
      : proxy === undefined ? 'https://api.githubcopilot.com' : `https://${proxy.replace(/^proxy\./, 'api.')}`
    const expiresAt = reply.expires_at * 1000
    if (reply.token.length === 0 || expiresAt <= this.transport.now()) throw new LlmError('Copilot returned an expired token', 'AUTH')
    return { version: 1, githubToken, token: reply.token, expiresAt, endpoint: copilotEndpoint(endpoint), account }
  }

  /**
   * Read local account metadata without returning a credential or making an HTTP request.
   * @param id - connection id.
   * @returns signed-out, signed-in, or expired account metadata.
   */
  async status(id: string): Promise<SubscriptionStatus> {
    const grant = grantOf(await this.credentials.readRecord(this.key(id)))
    return grant === undefined ? { status: 'signed-out' } : {
      status: grant.expiresAt <= this.transport.now() ? 'expired' : 'signed-in',
      account: grant.account, expiresAt: grant.expiresAt,
    }
  }

  /**
   * Resolve a current Copilot token, refreshing under the credential store's cross-process lock.
   * @param id - authorized connection id.
   * @param signal - operation cancellation.
   * @returns Host-only request authentication and the account-selected endpoint.
   */
  async authenticate(id: string, signal?: AbortSignal): Promise<{ apiKey: string; baseURL: string; account: string }> {
    signal?.throwIfAborted()
    let resolved: CopilotGrant | undefined
    await this.credentials.modifyRecord(this.key(id), async (current) => {
      const grant = grantOf(current)
      if (grant === undefined) throw new LlmError('Sign in to the subscription provider first', 'AUTH_REQUIRED')
      resolved = grant.expiresAt - this.options.refreshGraceMs > this.transport.now()
        ? grant : await this.exchange(grant.githubToken, grant.account, signal)
      if (grant.allowedModels !== undefined) resolved.allowedModels = [...grant.allowedModels]
      signal?.throwIfAborted()
      return resolved === grant ? undefined : { kind: 'grant', payload: resolved }
    })
    if (resolved === undefined) throw new LlmError('Subscription authentication was not resolved', 'AUTH_REQUIRED')
    return {
      apiKey: assertUsableApiKey(resolved.token, 'dobee-model-providers', 'subscription'),
      baseURL: resolved.endpoint, account: resolved.account,
    }
  }

  /**
   * Run the GitHub device flow and commit the account grant before reporting success.
   * @param id - connection id.
   * @param callerSignal - disconnect or cancellation from the initiating UI.
   * @returns public device instructions and a settled login result, never token values.
   */
  login(id: string, callerSignal: AbortSignal): AsyncGenerator<SubscriptionLoginFrame> {
    if (this.disposed) throw new LlmError('Subscription provider is disposed', 'AUTH_CANCELLED')
    if (this.running.has(id)) throw new LlmError('A login is already in progress', 'AUTH_IN_PROGRESS')
    const controller = new AbortController()
    const finished = Promise.withResolvers<void>()
    const iterator = this.performLogin(id, callerSignal, controller, () => { finished.resolve() })
    this.running.set(id, {
      controller, done: finished.promise, close: async () => {
        await iterator.return(undefined)
        if (this.running.get(id)?.controller === controller) this.running.delete(id)
        finished.resolve()
      },
    })
    return iterator
  }

  private async *performLogin(
    id: string, callerSignal: AbortSignal, controller: AbortController, finish: () => void,
  ): AsyncGenerator<SubscriptionLoginFrame> {
    const signal = AbortSignal.any([controller.signal, callerSignal, AbortSignal.timeout(this.options.loginTimeoutMs)])
    try {
      signal.throwIfAborted()
      const device = await this.json('https://github.com/login/device/code', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: this.options.clientId, scope: 'read:user' }),
      }, signal)
      if (typeof device.device_code !== 'string' || typeof device.user_code !== 'string'
        || typeof device.verification_uri !== 'string' || typeof device.expires_in !== 'number'
        || !Number.isFinite(device.expires_in) || device.expires_in <= 0) {
        throw new LlmError('GitHub returned invalid device authorization instructions', 'INVALID_RESPONSE')
      }
      const verification = new URL(device.verification_uri)
      if (verification.origin !== 'https://github.com' || verification.username || verification.password) {
        throw new LlmError('GitHub returned an unexpected authorization page', 'INVALID_RESPONSE')
      }
      let interval = typeof device.interval === 'number' && Number.isFinite(device.interval) && device.interval > 0 ? device.interval * 1000 : 5000
      const expiresAt = this.transport.now() + device.expires_in * 1000
      yield { type: 'device-code', verificationUri: verification.href, userCode: device.user_code, expiresAt }
      while (this.transport.now() < expiresAt) {
        await this.transport.wait(interval, signal)
        const token = await this.json('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_id: this.options.clientId, device_code: device.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        }, signal)
        if (token.error === 'authorization_pending') continue
        if (token.error === 'slow_down') { interval += 5000; continue }
        if (token.error === 'access_denied') { yield { type: 'cancelled' }; return }
        if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
          throw new LlmError('GitHub authorization failed or expired; start sign-in again', 'AUTH')
        }
        const user = await this.json('https://api.github.com/user', {
          headers: { authorization: `Bearer ${token.access_token}` },
        }, signal)
        if (typeof user.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(user.login)) {
          throw new LlmError('GitHub returned no valid account identity', 'AUTH')
        }
        const grant = await this.exchange(token.access_token, user.login, signal)
        signal.throwIfAborted()
        await this.credentials.modifyRecord(this.key(id), () => {
          signal.throwIfAborted()
          return Promise.resolve({ kind: 'grant', payload: grant })
        })
        yield { type: 'authorized', account: user.login }
        return
      }
      throw new LlmError('Device authorization expired; start sign-in again', 'AUTH_EXPIRED')
    } catch (error) {
      if (controller.signal.aborted || callerSignal.aborted) { yield { type: 'cancelled' }; return }
      if (signal.aborted) throw new LlmError('Subscription sign-in timed out', 'AUTH_EXPIRED', { cause: error })
      throw error
    } finally {
      this.running.delete(id)
      finish()
    }
  }

  /**
   * Withdraw and join an attempt before another login or logout can proceed.
   * @param id - connection id.
   * @returns after the attempt's network and polling work has ended.
   */
  async cancel(id: string): Promise<void> {
    const attempt = this.running.get(id)
    if (attempt === undefined) return
    attempt.controller.abort()
    await attempt.close()
    await attempt.done
  }

  /**
   * Remove only this connection's subscription authorization.
   * @param id - connection id.
   * @returns after login withdrawal and credential deletion.
   */
  async logout(id: string): Promise<void> {
    await this.cancel(id)
    await this.credentials.deleteRecord(this.key(id))
  }

  /**
   * Read account-approved model ids without making a network request.
   * @param id - connection id.
   * @returns the last synchronized account catalog, or an empty list before synchronization.
   */
  async allowedModels(id: string): Promise<readonly string[]> {
    return grantOf(await this.credentials.readRecord(this.key(id)))?.allowedModels ?? []
  }

  /**
   * Persist model availability alongside the current account without changing its tokens.
   * @param id - connection id.
   * @param models - model identifiers returned by the account's listing API.
   */
  async rememberModels(id: string, models: readonly string[]): Promise<void> {
    await this.credentials.modifyRecord(this.key(id), (current) => {
      const grant = grantOf(current)
      if (grant === undefined) throw new LlmError('Subscription account has signed out', 'AUTH_REQUIRED')
      return Promise.resolve({ kind: 'grant', payload: { ...grant, allowedModels: [...models] } })
    })
  }

  /** Stop accepting logins and join all outstanding attempts before plugin disposal. */
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all([...this.running.keys()].map(id => this.cancel(id)))
  }
}
