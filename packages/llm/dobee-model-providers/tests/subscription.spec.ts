/** Device authorization and refresh use isolated stores and instance-local HTTP fixtures. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { CopilotSubscriptions } from '../src/subscription.ts'
import type { SubscriptionLoginFrame } from '../src/types.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function fixture(responses: Record<string, unknown>[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'dobee-subscriptions-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentials, { path: join(root, 'credentials.yaml'), watch: false })
  let time = 1000
  const calls: { url: string; headers: Headers }[] = []
  const waits: number[] = []
  const manager = new CopilotSubscriptions(ctx.credentials, {
    clientId: 'fixture-client', loginTimeoutMs: 60_000, requestTimeoutMs: 1000, refreshGraceMs: 1000,
  }, {
    now: () => time,
    wait: (milliseconds, signal) => {
      signal.throwIfAborted()
      waits.push(milliseconds)
      time += milliseconds
      return Promise.resolve()
    },
    fetch: (input, init) => {
      init?.signal?.throwIfAborted()
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, headers: new Headers(init?.headers) })
      const response = responses.shift()
      if (response === undefined) throw new Error('Unexpected subscription HTTP request')
      return Promise.resolve(Response.json(response))
    },
  })
  cleanups.push(() => manager.dispose())
  return { ctx, manager, calls, waits, responses, setTime: (value: number) => { time = value } }
}

const device = {
  device_code: 'private-device-code', user_code: 'ABCD-EFGH',
  verification_uri: 'https://github.com/login/device', expires_in: 60, interval: 1,
}
const exchange = { token: 'copilot-fixture-token', expires_at: 100, endpoints: { api: 'https://api.individual.githubcopilot.com' } }

async function collect(frames: AsyncIterable<SubscriptionLoginFrame>) {
  const result: SubscriptionLoginFrame[] = []
  for await (const frame of frames) result.push(frame)
  return result
}

it('publishes device instructions, stores the grant, and never returns token values', async () => {
  const host = await fixture([
    device, { error: 'authorization_pending' }, { error: 'slow_down' },
    { access_token: 'github-fixture-token' }, { login: 'octocat' }, exchange,
  ])
  expect(await host.manager.status('work')).toEqual({ status: 'signed-out' })
  const frames = await collect(host.manager.login('work', new AbortController().signal))
  expect(frames).toEqual([
    { type: 'device-code', verificationUri: device.verification_uri, userCode: device.user_code, expiresAt: 61_000 },
    { type: 'authorized', account: 'octocat' },
  ])
  expect(JSON.stringify(frames)).not.toContain('fixture-token')
  expect(host.waits).toEqual([1000, 1000, 6000])
  expect(await host.manager.status('work')).toEqual({ status: 'signed-in', account: 'octocat', expiresAt: 100_000 })
  const auth = await host.manager.authenticate('work')
  expect(auth).toEqual({ apiKey: exchange.token, baseURL: exchange.endpoints.api, account: 'octocat' })
  const exchangeCall = host.calls.find(call => call.url.endsWith('/copilot_internal/v2/token'))
  expect(exchangeCall?.headers.get('editor-version')).toBe('vscode/1.107.0')
  expect(exchangeCall?.headers.get('editor-plugin-version')).toBe('copilot-chat/0.35.0')
  expect(exchangeCall?.headers.get('copilot-integration-id')).toBe('vscode-chat')
  expect(exchangeCall?.headers.get('user-agent')).not.toContain('Visual Studio Code')
})

it('refreshes once under the durable record lock for concurrent model calls', async () => {
  const host = await fixture([device, { access_token: 'github-fixture-token' }, { login: 'octocat' }, exchange])
  await collect(host.manager.login('work', new AbortController().signal))
  await host.manager.rememberModels('work', ['gpt-fixture'])
  host.setTime(100_000)
  expect((await host.manager.status('work')).status).toBe('expired')
  host.responses.push({ ...exchange, token: 'refreshed-fixture-token', expires_at: 200 })
  const [first, second] = await Promise.all([host.manager.authenticate('work'), host.manager.authenticate('work')])
  expect(first.apiKey).toBe('refreshed-fixture-token')
  expect(second.apiKey).toBe(first.apiKey)
  expect(host.calls.filter(call => call.url.endsWith('/copilot_internal/v2/token'))).toHaveLength(2)
  expect(await host.manager.allowedModels('work')).toEqual(['gpt-fixture'])
})

it('joins cancellation while the generator is paused at device instructions', async () => {
  const host = await fixture([device, device])
  const first = host.manager.login('work', new AbortController().signal)
  expect((await first.next()).value).toMatchObject({ type: 'device-code' })
  await host.manager.cancel('work')
  expect((await first.next()).done).toBe(true)
  expect(await host.manager.status('work')).toEqual({ status: 'signed-out' })
  const second = host.manager.login('work', new AbortController().signal)
  expect((await second.next()).value).toMatchObject({ type: 'device-code' })
  await host.manager.cancel('work')
})

it('cancels an attempt before its generator starts and releases the connection', async () => {
  const host = await fixture([device])
  host.manager.login('work', new AbortController().signal)
  await host.manager.cancel('work')
  expect(host.calls).toHaveLength(0)
  const next = host.manager.login('work', new AbortController().signal)
  await next.next()
  await host.manager.cancel('work')
})

it('keeps an old grant after refresh failure and requires reauthorization after logout', async () => {
  const host = await fixture([device, { access_token: 'github-fixture-token' }, { login: 'octocat' }, exchange])
  await collect(host.manager.login('work', new AbortController().signal))
  host.setTime(100_000)
  host.responses.push({ error: 'unauthorized' })
  await expect(host.manager.authenticate('work')).rejects.toMatchObject({ code: 'AUTH' })
  expect(await host.manager.status('work')).toMatchObject({ status: 'expired', account: 'octocat' })
  await host.manager.logout('work')
  expect(await host.manager.status('work')).toEqual({ status: 'signed-out' })
  await expect(host.manager.authenticate('work')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
})

it('refuses an authorization link outside GitHub and never writes a grant', async () => {
  const host = await fixture([{ ...device, verification_uri: 'https://example.com/collect' }])
  await expect(collect(host.manager.login('work', new AbortController().signal))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  expect(await host.ctx.credentials.readRecord(credentialKey('dobee-model-providers', 'work'))).toBeUndefined()
})

it('refuses a token endpoint outside the Copilot service', async () => {
  const host = await fixture([
    device, { access_token: 'github-fixture-token' }, { login: 'octocat' },
    { ...exchange, endpoints: { api: 'https://example.com/token-collector' } },
  ])
  await expect(collect(host.manager.login('work', new AbortController().signal))).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  expect(await host.manager.status('work')).toEqual({ status: 'signed-out' })
})

it('treats denial as cancellation rather than an authorized account', async () => {
  const host = await fixture([device, { error: 'access_denied' }])
  expect((await collect(host.manager.login('work', new AbortController().signal))).at(-1)).toEqual({ type: 'cancelled' })
  expect(await host.manager.status('work')).toEqual({ status: 'signed-out' })
})
