/** Provider synchronization distinguishes API credentials from subscription account grants. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { credentialRef, credentialKey } from '@deepseek-ai/dsh-credentials'
import { DobeeModelManager } from '../src/manager.ts'
import { CopilotSubscriptions } from '../src/subscription.ts'
import { resolveConnections } from '../src/config.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function fixture(configs: Parameters<typeof resolveConnections>[0], replies: unknown[], maxPages = 10) {
  const root = await mkdtemp(join(tmpdir(), 'dobee-model-manager-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentials, { path: join(root, 'credentials.yml'), watch: false })
  const accounts = new CopilotSubscriptions(ctx.credentials, {
    clientId: 'fixture', loginTimeoutMs: 1000, requestTimeoutMs: 1000, refreshGraceMs: 0,
  })
  cleanups.push(() => accounts.dispose())
  const connections = resolveConnections(configs)
  const calls: { url: URL; headers: Headers }[] = []
  const manager = new DobeeModelManager(ctx, {
    connections: () => connections, subscriptions: accounts, requestTimeoutMs: 1000, maxModelPages: maxPages,
    fetch: (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      calls.push({ url, headers: new Headers(init?.headers) })
      if (replies.length === 0) throw new Error('Unexpected model-list request')
      return Promise.resolve(Response.json(replies.shift()))
    },
  })
  return { ctx, manager, calls }
}

it('returns API and subscription metadata without making a model-list request', async () => {
  const host = await fixture({}, [])
  expect(host.manager.presets().find(preset => preset.source === 'github-copilot')).toEqual({
    source: 'github-copilot', kind: 'subscription',
  })
  expect(host.manager.presets().find(preset => preset.source === 'deepseek')).toMatchObject({
    source: 'deepseek', kind: 'api', baseURL: 'https://api.deepseek.com',
  })
  expect(host.calls).toHaveLength(0)
})

it('uses the stored API key for live synchronization but never returns that key', async () => {
  const host = await fixture({ work: { source: 'deepseek', apiKeyEnv: 'FIXTURE_DEEPSEEK_KEY' } }, [
    { data: [{ id: 'deepseek-flash' }] },
  ])
  await host.ctx.credentials.set(credentialRef('FIXTURE_DEEPSEEK_KEY'), 'private-fixture-key')
  const models = await host.manager.models({ connectionId: 'work' }, new AbortController().signal)
  expect(models[0]).toMatchObject({ id: 'deepseek-flash', api: 'openai-completions' })
  expect(host.calls[0]?.url.href).toBe('https://api.deepseek.com/models')
  expect(host.calls[0]?.headers.get('authorization')).toBe('Bearer private-fixture-key')
  expect(JSON.stringify(models)).not.toContain('private-fixture-key')
})

it('follows Gemini page tokens and excludes embedding-only models', async () => {
  const host = await fixture({}, [
    { models: [{ name: 'models/gemini-fixture', inputTokenLimit: 1000, outputTokenLimit: 100 }], nextPageToken: 'second' },
    { models: [{ name: 'models/embed-fixture', supportedGenerationMethods: ['embedContent'] }] },
  ])
  const models = await host.manager.models({ source: 'google', apiKey: 'fixture-google-key' }, new AbortController().signal)
  expect(models).toEqual([{ id: 'gemini-fixture', name: 'gemini-fixture', contextWindow: 1000, maxTokens: 100, api: 'google-generative-ai' }])
  expect(host.calls[1]?.url.searchParams.get('pageToken')).toBe('second')
  expect(host.calls[0]?.headers.get('x-goog-api-key')).toBe('fixture-google-key')
})

it('rejects repeated pagination cursors instead of looping or returning a truncated list', async () => {
  const host = await fixture({}, [
    { models: [{ name: 'models/one' }], nextPageToken: 'same' },
    { models: [{ name: 'models/two' }], nextPageToken: 'same' },
  ])
  await expect(host.manager.models({ source: 'google', apiKey: 'fixture-google-key' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('refuses model synchronization before API credentials are configured', async () => {
  const host = await fixture({ work: { source: 'deepseek' } }, [])
  await expect(host.manager.models({ connectionId: 'work' }, new AbortController().signal)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  expect(host.calls).toHaveLength(0)
})

it('uses account tokens for Copilot and retains only account-approved model ids', async () => {
  const host = await fixture({ work: { source: 'github-copilot', kind: 'subscription' } }, [{
    data: [
      { id: 'gpt-enabled', supported_endpoints: ['/responses'], model_picker_enabled: true, policy: { state: 'enabled' } },
      { id: 'gpt-picker-hidden', supported_endpoints: ['/chat/completions'], model_picker_enabled: false, policy: { state: 'enabled' } },
      { id: 'gpt-disabled', supported_endpoints: ['/chat/completions'], policy: { state: 'disabled' } },
    ],
  }])
  await host.ctx.credentials.modifyRecord(credentialKey('dobee-model-providers', 'work'), () => Promise.resolve({
    kind: 'grant', payload: {
      version: 1, githubToken: 'fixture-github-token', token: 'fixture-copilot-token',
      expiresAt: Date.now() + 60_000, endpoint: 'https://api.individual.githubcopilot.com', account: 'octocat',
    },
  }))
  const models = await host.manager.models({ connectionId: 'work' }, new AbortController().signal)
  expect(models).toEqual([
    { id: 'gpt-enabled', name: 'gpt-enabled', api: 'openai-responses' },
    { id: 'gpt-picker-hidden', name: 'gpt-picker-hidden', api: 'openai-completions' },
  ])
  expect(host.calls[0]?.headers.get('authorization')).toBe('Bearer fixture-copilot-token')
  expect(host.calls[0]?.headers.get('editor-version')).toBe('vscode/1.107.0')
  expect(host.calls[0]?.headers.get('editor-plugin-version')).toBe('copilot-chat/0.35.0')
  expect(host.calls[0]?.headers.get('x-github-api-version')).toBe('2026-06-01')
  expect(JSON.stringify(models)).not.toContain('fixture-copilot-token')
  expect(await host.manager.status('work')).toMatchObject({ status: 'signed-in', account: 'octocat' })
})
