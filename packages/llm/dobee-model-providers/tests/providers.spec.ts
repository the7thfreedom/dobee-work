/** Independent connections and real Loader dispatch through local provider HTTP fixtures. */
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createUserMessage, BlockAssembler, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import * as plugin from '../src/index.ts'
import { Config, resolveConnection, resolveConnections } from '../src/config.ts'
import { DobeeAdapter } from '../src/adapter.ts'
import { contextOf, replayOf } from '../src/context.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function server(status = 200, hang = false) {
  const requests: { path: string; headers: import('node:http').IncomingHttpHeaders; body: unknown }[] = []
  const handle = async (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> => {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      const value: unknown = chunk
      if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new Error('Invalid fixture request bytes')
      chunks.push(Buffer.from(value))
    }
    const text = Buffer.concat(chunks).toString()
    requests.push({ path: request.url ?? '', headers: request.headers, body: text ? JSON.parse(text) : null })
    if (status !== 200) {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Fixture failure', type: 'invalid_request_error' } }))
    } else if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
    } else if (hang) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.flushHeaders()
    } else {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const frames = [
        { choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {
          tool_calls: [{ index: 0, id: 'call-fixture', type: 'function', function: { name: 'echo', arguments: '{"value":"ok"}' } }],
        }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
      ]
      for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
      response.end('data: [DONE]\n\n')
    }
  }
  const http = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    })
  })
  await new Promise<void>((resolve) => { http.listen(0, '127.0.0.1', resolve) })
  cleanups.push(async () => {
    const closed = new Promise<void>((resolve, reject) => {
      http.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    http.closeAllConnections()
    await closed
  })
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture has no bound port')
  return { url: `http://127.0.0.1:${address.port}/v1`, requests }
}

function request(provider = 'dobee-test'): GenerateOptions {
  return {
    provider, model: 'fixture-model',
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Say hello' }] })],
    tools: [{ name: 'echo', description: 'Echo a value', parameters: { type: 'object', properties: { value: { type: 'string' } } } }],
  }
}

function adapter(connections: ReturnType<typeof resolveConnections>, key = 'fixture-key') {
  return new DobeeAdapter({
    connections: () => connections, apiKey: async () => key, attachments: () => undefined, imageAccess: () => undefined,
  })
}

async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('dobee connection settings', () => {
  it('inherits the native catalog for the shipped default', () => {
    const config = Config({})
    const resolved = resolveConnections(config.connections.get())
    expect(resolved.get('dobee-deepseek')?.models.map(model => model.id)).toContain('deepseek-flash')
  })

  it('preserves native provider identity and protocols for multiple connections', () => {
    const first = resolveConnection('work', { source: 'anthropic' })
    const second = resolveConnection('personal', { source: 'anthropic', baseURL: 'https://example.com' })
    expect(first.route).not.toBe(second.route)
    expect(first.provider.id).toBe('anthropic')
    expect(second.models.every(model => model.provider === 'anthropic' && model.api === 'anthropic-messages')).toBe(true)
    expect(first.models[0]?.baseUrl).not.toBe('https://example.com')
  })

  it.each([
    ['Bad_ID', { source: 'openai' }],
    ['test', { source: 'unknown' }],
    ['test', { source: 'openai', baseURL: 'https://user:password@example.com' }],
    ['test', { source: 'openai', apiKeyEnv: 'secret-with-hyphen' }],
    ['test', { api: 'openai-completions', baseURL: 'https://example.com', models: [{ id: 'a' }, { id: 'a' }] }],
  ])('rejects invalid connection %s', (id, config) => {
    expect(() => resolveConnection(id, config)).toThrow()
  })

  it('keeps Gemini native and custom routes explicit', () => {
    expect(resolveConnection('gemini', { source: 'google' }).models[0]?.api).toBe('google-generative-ai')
    expect(resolveConnection('proxy', {
      api: 'openai-responses', baseURL: 'https://example.com/v1', models: [{ id: 'private' }],
    }).models[0]?.api).toBe('openai-responses')
  })

  it('accepts an API connection before its model catalog has been synchronized', () => {
    const connection = resolveConnection('gateway', {
      kind: 'api', api: 'openai-completions', baseURL: 'https://example.com/v1',
    })
    expect(connection.catalogModels).toEqual([])
    expect(connection.models).toEqual([])
  })

  it('requires connection-owned credentials for native providers, without ambient fallback', () => {
    expect(resolveConnection('work-openai', { source: 'openai' }).config.apiKeyEnv).toBe('DOBEE_WORK_OPENAI_API_KEY')
    expect(resolveConnection('local', {
      api: 'openai-completions', baseURL: 'http://localhost:1234/v1', models: [{ id: 'local' }],
    }).config.apiKeyEnv).toBeUndefined()
  })
})

describe('dobee request execution', () => {
  it('streams text, tool arguments, usage and native replay from a real endpoint', async () => {
    const fixture = await server()
    const connections = resolveConnections({ test: {
      api: 'openai-completions', baseURL: fixture.url, models: [{ id: 'fixture-model' }],
    } })
    const chunks = await collect(adapter(connections).stream(request()))
    expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')).toBe('hello')
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'block-end', block: { type: 'tool-call', id: 'call-fixture', name: 'echo', arguments: '{"value":"ok"}' },
    }))
    expect(chunks.at(-2)).toMatchObject({ type: 'usage', usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 } })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { version: 1 } } })
    expect(fixture.requests[0]?.headers['user-agent']).toContain('dobee-work/')
    expect(fixture.requests[0]?.headers.authorization).toBe('Bearer fixture-key')
  })

  it.each([[401, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'SERVER']])('classifies HTTP %s', async (status, code) => {
    const fixture = await server(status)
    const connections = resolveConnections({ test: {
      api: 'openai-completions', baseURL: fixture.url, models: [{ id: 'fixture-model' }],
    } })
    expect((await collect(adapter(connections).stream(request()))).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code } } })
    expect(fixture.requests).toHaveLength(1)
  })

  it('binds a prepared call to the original endpoint generation', async () => {
    const original = await server()
    const replacement = await server()
    let connections = resolveConnections({ test: { api: 'openai-completions', baseURL: original.url, models: [{ id: 'fixture-model' }] } })
    const runtime = new DobeeAdapter({ connections: () => connections, apiKey: async () => 'fixture-key', attachments: () => undefined, imageAccess: () => undefined })
    const prepared = await runtime.prepareCall('dobee-test', 'fixture-model')
    connections = resolveConnections({ test: { api: 'openai-completions', baseURL: replacement.url, models: [{ id: 'fixture-model' }] } })
    await collect(prepared.stream(request()))
    expect(original.requests).toHaveLength(1)
    expect(replacement.requests).toHaveLength(0)
    await collect(runtime.stream(request()))
    expect(replacement.requests).toHaveLength(1)
  })

  it('retains same-route native signatures and drops them after switching routes', async () => {
    const connection = resolveConnection('test', { source: 'anthropic' })
    const selected = connection.models[0]
    if (selected === undefined) throw new Error('Anthropic fixture has no model')
    const native = {
      role: 'assistant' as const, content: [{ type: 'thinking' as const, thinking: 'reason', thinkingSignature: 'signature' }],
      api: 'anthropic-messages', provider: 'anthropic', model: selected.id, stopReason: 'stop' as const,
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      }, timestamp: 0,
    }
    const message = createAssistantMessage({
      content: [{ type: 'reasoning', text: 'reason' }],
      source: { provider: connection.route, model: selected.id, replayState: replayOf(native, selected.id) },
    })
    const same = await contextOf({ ...request(), model: selected.id, messages: [message] }, connection, undefined, () => undefined)
    expect(same.messages[0]).toMatchObject({ content: [{ thinkingSignature: 'signature' }] })
    const other = await contextOf(
      { ...request(), model: selected.id, messages: [message] },
      resolveConnection('other', { source: 'anthropic' }), undefined, () => undefined,
    )
    expect(other.messages[0]).toMatchObject({ content: [{ type: 'thinking', thinking: 'reason' }] })
    expect(JSON.stringify(other)).not.toContain('signature')
  })

  it('retains Gemini tool signatures and drops them after repointing the same connection', async () => {
    const connection = resolveConnection('gemini', { source: 'google', models: [{ id: 'gemini-2.5-flash' }] })
    const native = {
      role: 'assistant' as const,
      content: [{ type: 'toolCall' as const, id: 'call-google', name: 'echo', arguments: { value: 'ok' }, thoughtSignature: 'google-signature' }],
      api: 'google-generative-ai', provider: 'google', model: 'gemini-2.5-flash', stopReason: 'toolUse' as const,
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      }, timestamp: 0,
    }
    const message = createAssistantMessage({
      content: [{ type: 'tool-call', id: brandString<ToolCallId>('call-google'), name: 'echo', arguments: '{"value":"ok"}' }],
      source: { provider: connection.route, model: native.model, replayState: replayOf(native, native.model) },
    })
    const options = { ...request(), provider: connection.route, model: native.model, messages: [message] }
    const same = await contextOf(options, connection, undefined, () => undefined)
    expect(same.messages[0]).toMatchObject({ content: [{ thoughtSignature: 'google-signature' }] })
    const repointed = resolveConnection('gemini', {
      api: 'openai-completions', baseURL: 'https://example.com/v1', models: [{ id: native.model }],
    })
    const changed = await contextOf(options, repointed, undefined, () => undefined)
    expect(JSON.stringify(changed)).not.toContain('google-signature')
  })

  it('rejects unsupported stop controls before contacting the provider', async () => {
    const fixture = await server()
    const connections = resolveConnections({ test: { api: 'openai-completions', baseURL: fixture.url, models: [{ id: 'fixture-model' }] } })
    await expect(collect(adapter(connections).stream({ ...request(), stop: ['end'] }))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
    expect(fixture.requests).toHaveLength(0)
  })

  it('ends a stalled response with TIMEOUT rather than a user cancellation', async () => {
    const fixture = await server(200, true)
    const connections = resolveConnections({ test: {
      api: 'openai-completions', baseURL: fixture.url, models: [{ id: 'fixture-model' }], timeoutMs: 2000,
    } })
    const chunks = await collect(adapter(connections).stream(request()))
    expect(fixture.requests).toHaveLength(1)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT' } } })
  })
})

it('boots dobee through a real Loader and withdraws its registrations on disposal', async () => {
  const fixture = await server()
  const root = await mkdtemp(join(tmpdir(), 'dobee-model-loader-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'credentials.yml'), 'version: 1\nrefs:\n  DOBEE_TEST_KEY: fixture-key\n', { mode: 0o600 })
  await writeFile(join(root, 'cordis.yml'), [
    '- id: llm\n  name: fixture-llm',
    `- id: credentials\n  name: fixture-credentials\n  config:\n    path: ${JSON.stringify(join(root, 'credentials.yml'))}`,
    '- id: dobee-model-providers\n  name: fixture-dobee\n  config:\n    connections:',
    `      test:\n        api: openai-completions\n        baseURL: ${fixture.url}\n        apiKeyEnv: DOBEE_TEST_KEY\n        models:\n          - id: fixture-model`,
  ].join('\n'))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  const modules = new Map<string, unknown>([['fixture-llm', LlmRuntime], ['fixture-credentials', Credentials], ['fixture-dobee', plugin]])
  const internal: ModuleLoaderV2 = {
    version: 'v2', loadCache: new Map(),
    import: (specifier) => {
      if (!modules.has(specifier)) throw new Error(`Unexpected import ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('Unexpected register') },
    getOrCreateModuleJob(): never { throw new Error('Unexpected job') },
    resolveSync(): never { throw new Error('Unexpected resolve') },
    load(): never { throw new Error('Unexpected load') },
  }
  ctx.loader.internal = internal
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: join(root, 'cordis.yml') } })
  await ctx.loader.await()
  expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['dobee-test'])
  const models = await ctx.llm.discoverModels('dobee-model-providers', { provider: 'dobee-test' })
  expect(models[0]?.id).toBe('fixture-model')
  const assembled = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(request())) assembled.push(chunk)
  expect(assembled.blocks()[0]).toEqual({ type: 'text', text: 'hello' })
  const llm = ctx.llm
  await ctx.fiber.dispose()
  expect(llm.listProviders()).toEqual([])
  expect(llm.listConfigurableProviders()).toEqual([])
})
