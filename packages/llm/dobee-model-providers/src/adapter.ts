/** Independent dobee adapter over provider-library transports. */
import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai'
import { LlmAdapter, LlmError, ReasoningEffortId, attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk, ToolCallId, ImageAttachmentAccessResolver } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { contextOf, replayOf } from './context.ts'
import type { Connection } from './config.ts'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { copilotClientHeaders } from './copilot-headers.ts'

const manifest: unknown = createRequire(import.meta.url)('../package.json')
if (manifest === null || typeof manifest !== 'object' || !('version' in manifest) || typeof manifest.version !== 'string') {
  throw new Error('Dobee package metadata has no version')
}
const version = manifest.version

const thinkingLevels: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function efforts(model: Model<Api>): ModelThinkingLevel[] {
  if (!model.reasoning) return []
  return thinkingLevels.filter(level => model.thinkingLevelMap?.[level] !== null
    && (!['xhigh', 'max'].includes(level) || model.thinkingLevelMap?.[level] !== undefined))
}

function metadata(connection: Connection, model: Model<Api>): LlmResolvedModelInfo {
  const levels = efforts(model)
  return {
    provider: connection.route, id: model.id, name: model.name, inputModalities: [...model.input],
    context: { contextWindow: model.contextWindow }, defaultMaxTokens: model.maxTokens,
    ...levels.length === 0 ? {} : {
      reasoning: { efforts: levels.map(level => ({ id: ReasoningEffortId(level), name: level })) },
    },
  }
}

function failureCode(status: number | undefined, message: string): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (/quota|insufficient.*credit|balance/i.test(message)) return 'QUOTA'
  if (status === 429) return 'RATE_LIMIT'
  if (status !== undefined && status >= 500) return 'SERVER'
  if (/context.*(?:length|window)|too many tokens/i.test(message)) return 'CONTEXT_WINDOW_EXCEEDED'
  if (status !== undefined && status >= 400) return 'INVALID_REQUEST'
  return 'TRANSPORT'
}

/** Transport generation, credential and image dependencies supplied by the dobee plugin. */
export interface AdapterOptions {
  /** Read the current immutable route generation. */
  connections: () => ReadonlyMap<string, Connection>
  /** Resolve precisely the captured connection's credential. */
  apiKey: (connection: Connection) => Promise<string | undefined>
  /** Read the current durable attachment service. */
  attachments: () => AttachmentStore | undefined
  /** Read access to an image in the current tool execution world. */
  imageAccess: ImageAttachmentAccessResolver
  /** Resolve a subscription account grant rather than an API-key reference. */
  subscription?: (connection: Connection, signal?: AbortSignal) => Promise<{ apiKey: string; baseURL: string; account: string }>
  /** Last account-approved model ids; an unsigned account has none. */
  subscriptionModels?: (connection: Connection) => Promise<readonly string[]>
}

/** Executes dobee routes directly without mounting or invoking another Harness adapter. */
export class DobeeAdapter extends LlmAdapter {
  constructor(private readonly options: AdapterOptions) { super() }

  private connection(route: string): Connection {
    const connection = this.options.connections().get(route)
    if (connection === undefined) throw new LlmError(`Unknown dobee connection "${route}"`, 'NO_ADAPTER')
    return connection
  }

  override providerInfo(provider: string) {
    const connection = this.connection(provider)
    return { id: provider, name: connection.name }
  }

  override async listModels(provider: string) {
    const connection = this.connection(provider)
    if (!connection.config.enabled) return []
    const allowed = connection.config.kind === 'subscription'
      ? await this.options.subscriptionModels?.(connection) ?? [] : undefined
    return connection.models.filter(model => allowed === undefined || allowed.includes(model.id)).map(model => metadata(connection, model))
  }

  override async resolveModel(provider: string, model: string) {
    const connection = this.connection(provider)
    await this.assertAvailable(connection, model)
    return metadata(connection, this.model(connection, model))
  }

  private model(connection: Connection, id: string): Model<Api> {
    const model = connection.models.find(item => item.id === id)
    if (model === undefined) throw new LlmError(`Unknown model "${id}" on "${connection.route}"`, 'UNKNOWN_MODEL')
    return model
  }

  override async prepareCall(provider: string, model: string): Promise<PreparedAdapterCall> {
    const connection = this.connection(provider)
    await this.assertAvailable(connection, model)
    const resolved = this.model(connection, model)
    return Promise.resolve<PreparedAdapterCall>({
      model: metadata(connection, resolved), stream: options => this.dispatch(connection, resolved, options),
    })
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const connection = this.connection(options.provider)
    return this.dispatch(connection, this.model(connection, options.model), options)
  }

  private async assertAvailable(connection: Connection, model: string): Promise<void> {
    if (!connection.config.enabled) throw new LlmError('This provider is disabled', 'PROVIDER_DISABLED')
    if (connection.config.kind !== 'subscription') return
    const allowed = await this.options.subscriptionModels?.(connection) ?? []
    if (!allowed.includes(model)) throw new LlmError('Sign in and synchronize subscription models before selecting this model', 'AUTH_REQUIRED')
  }

  private async *dispatch(connection: Connection, model: Model<Api>, options: GenerateOptions): AsyncGenerator<StreamChunk> {
    if (options.stop !== undefined) throw new LlmError('Stop sequences are unsupported by this adapter', 'UNSUPPORTED_OPTION')
    const reasoning = options.reasoningEffort === undefined
      ? undefined : efforts(model).find(level => level === options.reasoningEffort)
    if (options.reasoningEffort !== undefined && reasoning === undefined) throw new LlmError('Unsupported model reasoning effort', 'UNSUPPORTED_OPTION')
    const deadline = AbortSignal.timeout(connection.config.timeoutMs)
    const expired = (): boolean => deadline.aborted
    const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
    await this.assertAvailable(connection, model.id)
    let apiKey: string | undefined
    let requestModel = model
    let authScope: string | undefined
    if (connection.config.kind === 'subscription') {
      const authenticate = this.options.subscription
      if (authenticate === undefined) throw new LlmError('Subscription authentication is unavailable', 'AUTH_REQUIRED')
      const auth = await authenticate(connection, signal)
      apiKey = auth.apiKey
      requestModel = { ...model, baseUrl: auth.baseURL }
      authScope = createHash('sha256').update(`${auth.account}\0${auth.baseURL}`).digest('hex')
    } else apiKey = await this.options.apiKey(connection)
    options.signal?.throwIfAborted()
    if (expired()) throw new LlmError('Model request timed out', 'TIMEOUT')
    const context = await contextOf({ ...options, signal }, connection, this.options.attachments(), this.options.imageAccess, authScope)
    let status: number | undefined
    const stream = connection.runtime.streamSimple(requestModel, context, {
      ...apiKey === undefined ? {} : { apiKey },
      signal,
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      maxTokens: options.maxTokens ?? model.maxTokens,
      ...reasoning === undefined || reasoning === 'off' ? {} : { reasoning },
      timeoutMs: connection.config.timeoutMs,
      maxRetries: 0,
      fetch: async (input, init) => {
        const response = await fetch(input, { ...init, redirect: 'error' })
        status = response.status
        return response
      },
      onResponse: (response) => { status = response.status },
      transformHeaders: headers => ({
        ...Object.fromEntries(Object.entries(headers).filter(([key]) =>
          key.toLowerCase() !== 'user-agent'
          && (connection.config.source !== 'github-copilot'
            || !['editor-version', 'editor-plugin-version', 'copilot-integration-id'].includes(key.toLowerCase())))),
        ...attributionHeaders({
          product: 'dobee-work', version, url: 'https://github.com/the7thfreedom/dobee-work',
        }),
        ...connection.config.source === 'github-copilot' ? copilotClientHeaders() : {},
      }),
    })
    const calls = new Map<number, { id: string; name: string }>()
    for await (const event of stream) {
      switch (event.type) {
        case 'start': break
        case 'text_start': yield { type: 'block-start', index: event.contentIndex, blockType: 'text' }; break
        case 'text_delta': yield { type: 'text-delta', index: event.contentIndex, text: event.delta }; break
        case 'text_end': yield { type: 'block-end', index: event.contentIndex, block: { type: 'text', text: event.content } }; break
        case 'thinking_start': yield { type: 'block-start', index: event.contentIndex, blockType: 'reasoning' }; break
        case 'thinking_delta': yield { type: 'reasoning-delta', index: event.contentIndex, text: event.delta }; break
        case 'thinking_end': yield { type: 'block-end', index: event.contentIndex, block: { type: 'reasoning', text: event.content } }; break
        case 'toolcall_start': {
          const block = event.partial.content[event.contentIndex]
          if (block?.type !== 'toolCall') throw new LlmError('Invalid provider tool-call start', 'INVALID_RESPONSE')
          calls.set(event.contentIndex, block)
          yield { type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }
          break
        }
        case 'toolcall_delta': {
          const call = calls.get(event.contentIndex)
          if (call === undefined) throw new LlmError('Provider tool delta has no start', 'INVALID_RESPONSE')
          yield { type: 'tool-call-delta', index: event.contentIndex, id: brandString<ToolCallId>(call.id), name: call.name, argumentsDelta: event.delta }
          break
        }
        case 'toolcall_end':
          yield {
            type: 'block-end', index: event.contentIndex,
            block: { type: 'tool-call', id: brandString<ToolCallId>(event.toolCall.id), name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.arguments) },
          }
          break
        case 'done':
        case 'error': {
          const message = event.type === 'done' ? event.message : event.error
          const usage = message.usage
          yield { type: 'usage', usage: {
            inputTokens: usage.input, outputTokens: usage.output, totalTokens: usage.totalTokens,
            cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite,
          } }
          const error = apiKey === undefined ? message.errorMessage : message.errorMessage?.split(apiKey).join('[redacted]')
          if (options.signal?.aborted) {
            yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Model request cancelled' } } }
          } else if (expired()) {
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT', message: 'Model request timed out' } } }
          } else if (message.stopReason === 'aborted') {
            yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Provider request cancelled' } } }
          } else if (event.type === 'error' || ['error', 'pending', 'deferred'].includes(message.stopReason)) {
            yield { type: 'finish', reason: { kind: 'error', failure: {
              code: failureCode(status, error ?? ''), message: error ?? 'Provider request failed',
              ...status === undefined ? {} : { status },
            } } }
          } else if (message.content.length === 0) {
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE', message: 'Provider returned no content' } } }
          } else {
            yield {
              type: 'finish',
              reason: { kind: message.stopReason === 'toolUse' ? 'tool-calls' : message.stopReason === 'length' ? 'max-tokens' : 'stop' },
              replayState: replayOf(message, model.id, authScope),
            }
          }
          return
        }
        default: assertNever(event, 'dobee provider event')
      }
    }
    throw new LlmError('Provider stream ended without a terminal response', 'STREAM_CLOSED')
  }
}
