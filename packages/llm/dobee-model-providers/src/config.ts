/** Connection validation and provider defaults owned by dobee. */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { builtinModels, builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import type { Api, Model, Models, Provider, ProviderStreams } from '@earendil-works/pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ProviderKind, ProviderPreset } from './types.ts'

/** One explicit model; absent properties inherit matching native catalog metadata. */
export interface ModelConfig {
  /** Exact upstream model identifier. */
  id: string
  /** Optional display name. */
  name?: string
  /** Combined input and output token capacity. */
  contextWindow?: number
  /** Maximum output tokens. */
  maxTokens?: number
  /** Accepted input modalities. */
  input?: readonly ('text' | 'image')[]
  /** Whether the model accepts reasoning controls. */
  reasoning?: boolean
  /** Model-specific protocol for mixed-protocol provider catalogs. */
  api?: string
}

/** One independent connection to a native provider or compatible endpoint. */
export interface ConnectionConfig {
  /** API-key access or subscription account authentication. */
  kind?: ProviderKind
  /** Whether the connection is offered for model calls. */
  enabled?: boolean
  /** Selected model ids; null or omission selects the complete catalog. */
  enabledModels?: readonly string[] | null
  /** Native provider or dobee preset identifier. */
  source?: string
  /** Connection label in model pickers. */
  displayName?: string
  /** Explicit compatible protocol; omission preserves native dispatch. */
  api?: string
  /** Endpoint override. */
  baseURL?: string
  /** Credential reference; never a secret value. */
  apiKeyEnv?: string
  /** Explicit catalog replacing the source catalog. */
  models?: readonly ModelConfig[]
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Pixel budget for each normalized image. */
  imagePixelBudget?: number
  /** Encoded-byte target for each request image. */
  imageMaxBytes?: number
  /** Aggregate base64 image payload limit. */
  maxRequestImageBytes?: number
}

/** Live configuration for independent dobee connections. */
export interface Config {
  /** Connection ids become registered routes prefixed with `dobee-`. */
  connections: Volatile<Record<string, ConnectionConfig>>
  /** GitHub Copilot public device-authorization client; deployments may select their registered client. */
  copilotClientId: string
  /** Maximum duration of a user-initiated device authorization. */
  loginTimeoutMs: number
  /** Per-request timeout for authorization and model catalog requests. */
  authRequestTimeoutMs: number
  /** Refresh short-lived subscription credentials before their expiration. */
  tokenRefreshGraceMs: number
  /** Maximum model-list pages accepted from one synchronization. */
  maxModelPages: number
}

const modelSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().min(1).step(1),
  maxTokens: z.number().min(1).step(1),
  input: z.array(z.union(['text', 'image'])),
  reasoning: z.boolean(),
  api: z.union(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']),
})
const connectionSchema = z.object({
  kind: z.union(['api', 'subscription']),
  enabled: z.boolean().default(true),
  enabledModels: z.union([z.const(null), z.array(z.string())]).default(null),
  source: z.string(),
  displayName: z.string(),
  api: z.union(['openai-completions', 'openai-responses', 'anthropic-messages']),
  baseURL: z.string(),
  apiKeyEnv: z.string().role('credential-ref'),
  models: z.array(modelSchema),
  timeoutMs: z.number().min(1).max(2_147_483_647).step(1).default(300_000),
  imagePixelBudget: z.number().min(1).step(1).default(4_194_304),
  imageMaxBytes: z.number().min(1).step(1).default(1_048_576),
  maxRequestImageBytes: z.number().min(1).step(1).default(20_971_520),
})

/** Validate complete connection settings before they become live. */
export const Config = z.object({
  connections: z.dict(connectionSchema).default({
    deepseek: { source: 'deepseek', apiKeyEnv: 'DOBEE_DEEPSEEK_API_KEY' },
  }).volatile(),
  copilotClientId: z.string().default('Iv1.b507a08c87ecfe98'),
  loginTimeoutMs: z.number().min(1).max(2_147_483_647).step(1).default(900_000),
  authRequestTimeoutMs: z.number().min(1).max(2_147_483_647).step(1).default(30_000),
  tokenRefreshGraceMs: z.number().min(0).max(2_147_483_647).step(1).default(30_000),
  maxModelPages: z.number().min(1).step(1).default(100),
})

/** Brand defaults for providers absent from the installed native catalog. */
export const COMPATIBLE_PRESETS: Readonly<Record<string, { name: string; baseURL: string; models: ModelConfig[] }>> = {
  qwen: {
    name: 'Qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [{ id: 'qwen-plus' }, { id: 'qwen-max' }],
  },
  doubao: {
    name: 'Doubao', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', models: [],
  },
  siliconflow: {
    name: 'SiliconFlow', baseURL: 'https://api.siliconflow.cn/v1', models: [],
  },
}

const protocols: Readonly<Record<string, () => ProviderStreams>> = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
}
const nativeProviders = new Map(builtinProviders().map(provider => [provider.id, provider]))
const noCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** A request generation capturing its configuration, models, and transport collection. */
export interface Connection {
  /** User-owned stable connection id. */
  id: string
  /** Harness route identity. */
  route: string
  /** Human-facing connection label. */
  name: string
  /** Detached configuration for this generation. */
  config: ConnectionConfig & {
    kind: ProviderKind
    enabled: boolean
    timeoutMs: number
    imagePixelBudget: number
    imageMaxBytes: number
    maxRequestImageBytes: number
  }
  /** Native provider whose protocols serve this connection. */
  provider: Provider
  /** Resolved model catalog. */
  models: readonly Model<Api>[]
  /** Full configured catalog, including models the user has not enabled. */
  catalogModels: readonly Model<Api>[]
  /** Collection with precisely this connection's transport. */
  runtime: Models
}

/**
 * Read a native or compatible preset without network access.
 * @param source - source provider identifier.
 * @returns source defaults, or undefined for an unknown source.
 */
export function preset(source: string): ConnectionConfig | undefined {
  const native = nativeProviders.get(source)
  const first = native?.getModels()[0]
  if (native !== undefined) return { source, ...first === undefined ? {} : { baseURL: first.baseUrl } }
  const value = COMPATIBLE_PRESETS[source]
  return value === undefined ? undefined : {
    source, displayName: value.name, api: 'openai-completions', baseURL: value.baseURL,
    models: value.models,
  }
}

/**
 * Describe preset authentication and endpoint defaults without requesting credentials.
 * @returns supported user-facing provider choices.
 */
export function providerPresets(): ProviderPreset[] {
  return [
    'openai', 'anthropic', 'google', 'deepseek', 'qwen', 'doubao', 'zai',
    'moonshotai-cn', 'moonshotai', 'minimax-cn', 'minimax', 'openrouter', 'siliconflow', 'github-copilot',
  ].map((source) => {
    const value = preset(source)
    const kind = source === 'github-copilot' ? 'subscription' : 'api'
    return {
      source, kind,
      ...kind === 'subscription' || value?.baseURL === undefined ? {} : { baseURL: value.baseURL },
      ...value?.api === undefined ? {} : { api: value.api },
    }
  })
}

/**
 * Construct one isolated provider connection without changing a native provider.
 * @param id - stable settings key.
 * @param input - validated connection settings.
 * @returns a detached transport generation.
 */
export function resolveConnection(id: string, input: ConnectionConfig): Connection {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new LlmError(`Invalid connection id "${id}"`, 'INVALID_CONNECTION')
  const defaults = input.source === undefined ? undefined : preset(input.source)
  if (input.source !== undefined && defaults === undefined) throw new LlmError(`Unknown provider source "${input.source}"`, 'UNKNOWN_PROVIDER')
  const config = structuredClone({
    kind: input.source === 'github-copilot' ? 'subscription' as const : 'api' as const,
    enabled: true,
    timeoutMs: 300_000, imagePixelBudget: 4_194_304,
    imageMaxBytes: 1_048_576, maxRequestImageBytes: 20_971_520,
    ...defaults, ...input,
  })
  if (config.kind === 'subscription' && config.source !== 'github-copilot') {
    throw new LlmError('This provider has no supported subscription login', 'UNSUPPORTED_AUTH')
  }
  if (config.source === 'github-copilot' && config.kind !== 'subscription') {
    throw new LlmError('GitHub Copilot requires subscription authentication', 'INVALID_CONNECTION')
  }
  if (config.kind === 'api' && config.source !== undefined && config.apiKeyEnv === undefined) {
    config.apiKeyEnv = `DOBEE_${id.toUpperCase().replaceAll('-', '_')}_API_KEY`
  }
  if (config.apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv)) {
    throw new LlmError(`Connection "${id}" has an invalid credential reference`, 'INVALID_CONNECTION')
  }
  if (config.baseURL !== undefined) {
    const endpoint = new URL(config.baseURL)
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      throw new LlmError(`Connection "${id}" needs an HTTP(S) endpoint without embedded credentials`, 'INVALID_CONNECTION')
    }
  }
  const native = config.source === undefined ? undefined : nativeProviders.get(config.source)
  const nativeModels = native?.getModels() ?? []
  const providerId = native?.id ?? `dobee-${id}`
  const entries = config.models !== undefined && config.models.length > 0
    ? config.models : defaults?.models ?? nativeModels
  if (native === undefined && (config.api === undefined || config.baseURL === undefined)) {
    throw new LlmError(`Connection "${id}" needs a protocol and endpoint`, 'INVALID_CONNECTION')
  }
  const seen = new Set<string>()
  const catalogModels = entries.map((entry): Model<Api> => {
    if (entry.id.trim().length === 0 || seen.has(entry.id)) throw new LlmError(`Connection "${id}" has an empty or duplicate model id`, 'INVALID_CONNECTION')
    seen.add(entry.id)
    const base = nativeModels.find(model => model.id === entry.id)
    const prototype = nativeModels[0]
    const api = (config.kind === 'subscription' ? undefined : config.api) ?? entry.api ?? base?.api ?? prototype?.api
    const baseUrl = config.baseURL ?? base?.baseUrl ?? prototype?.baseUrl
    if (api === undefined || baseUrl === undefined) throw new LlmError(`Model "${entry.id}" needs a protocol and endpoint`, 'INVALID_CONNECTION')
    if (config.api !== undefined && protocols[config.api] === undefined) throw new LlmError(`Unsupported protocol "${config.api}"`, 'INVALID_CONNECTION')
    const inputTypes = entry.input !== undefined && entry.input.length > 0 ? entry.input : base?.input ?? ['text']
    if (inputTypes.length === 0) throw new LlmError(`Model "${entry.id}" needs an input modality`, 'INVALID_CONNECTION')
    return {
      ...base, id: entry.id, name: entry.name ?? base?.name ?? entry.id, api, provider: providerId, baseUrl,
      input: [...inputTypes], reasoning: entry.reasoning ?? base?.reasoning ?? false,
      contextWindow: entry.contextWindow ?? base?.contextWindow ?? 32_768,
      maxTokens: entry.maxTokens ?? base?.maxTokens ?? 4096, cost: base?.cost ?? noCost,
    }
  })
  const name = config.displayName ?? native?.name ?? config.source ?? id
  const factory = config.kind === 'subscription' || config.api === undefined ? undefined : protocols[config.api]
  const implementation = factory?.()
  if (native === undefined && implementation === undefined) throw new LlmError(`Connection "${id}" needs a supported protocol`, 'INVALID_CONNECTION')
  const provider: Provider = {
    id: providerId, name,
    auth: { apiKey: { name, resolve: ({ credential }) => Promise.resolve({
      auth: credential?.key === undefined ? {} : { apiKey: credential.key }, source: name,
    }) } },
    getModels: () => catalogModels,
    stream: (model, context, options) => {
      if (implementation !== undefined) return implementation.stream(model, context, options)
      if (native !== undefined) return native.stream(model, context, options)
      throw new LlmError('Provider transport is unavailable', 'NO_ADAPTER')
    },
    streamSimple: (model, context, options) => {
      if (implementation !== undefined) return implementation.streamSimple(model, context, options)
      if (native !== undefined) return native.streamSimple(model, context, options)
      throw new LlmError('Provider transport is unavailable', 'NO_ADAPTER')
    },
  }
  const runtime = builtinModels()
  runtime.clearProviders()
  runtime.setProvider(provider)
  const selected = config.enabledModels
  if (selected !== undefined && selected !== null && selected.some(model => !catalogModels.some(item => item.id === model))) {
    throw new LlmError(`Connection "${id}" selects a model outside its catalog`, 'INVALID_CONNECTION')
  }
  const models = selected === undefined || selected === null ? catalogModels : catalogModels.filter(model => selected.includes(model.id))
  return { id, route: `dobee-${id}`, name, config, provider, models, catalogModels, runtime }
}

/**
 * Materialize and validate every connection in one settings generation.
 * @param configs - connection settings.
 * @returns connections keyed by Harness route.
 */
export function resolveConnections(configs: Record<string, ConnectionConfig>): ReadonlyMap<string, Connection> {
  return new Map(Object.entries(configs).map(([id, config]) => {
    const connection = resolveConnection(id, config)
    return [connection.route, connection]
  }))
}
