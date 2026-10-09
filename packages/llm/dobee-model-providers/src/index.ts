/** Independent dobee provider registration, settings, and Host-only model discovery. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { assertUsableApiKey, attributionHeaders, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import { Config, preset, resolveConnection, resolveConnections } from './config.ts'
import type { Connection } from './config.ts'
import { DobeeAdapter } from './adapter.ts'
import { CopilotSubscriptions } from './subscription.ts'
import { DobeeModelManager } from './manager.ts'

export { Config } from './config.ts'
export type { ConnectionConfig, ModelConfig } from './config.ts'
export { DobeeAdapter } from './adapter.ts'
export { DobeeModelManager } from './manager.ts'
export type * from './types.ts'

/** Cordis plugin identity. */
export const name = 'dobee-model-providers'
/** Required shared services; dobee never supplies its own secret store. */
export const inject = ['llm', 'credentials']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Register dobee routes and discovery against one live settings namespace.
 * @param ctx - plugin context.
 * @param config - validated live connection configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const namespace = ctx.fiber.entry?.options.id ?? name
  ctx.on('internal/config', function (this: import('@deepseek-ai/cordis').Fiber, _raw, next) {
    const raw: unknown = next()
    if (this !== ctx.fiber) return raw
    if (!isRecord(raw) || !isRecord(raw.connections)) throw new LlmError('Connections must be a dictionary', 'INVALID_CONNECTION')
    const candidate = Config(raw)
    resolveConnections(candidate.connections.get())
    return raw
  })
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  let raw = config.connections.get()
  let connections = resolveConnections(raw)
  let registration: AdapterRegistrationHandle | undefined
  let directory: DirectoryRegistrationHandle | undefined
  const subscriptions = new CopilotSubscriptions(ctx.credentials, {
    clientId: config.copilotClientId, loginTimeoutMs: config.loginTimeoutMs,
    requestTimeoutMs: config.authRequestTimeoutMs, refreshGraceMs: config.tokenRefreshGraceMs,
  })
  ctx.effect(() => () => subscriptions.dispose())
  new DobeeModelManager(ctx, {
    connections: () => connections, subscriptions, requestTimeoutMs: config.authRequestTimeoutMs,
    maxModelPages: config.maxModelPages,
  })
  const apiKey = async (connection: Connection): Promise<string | undefined> => {
    const ref = connection.config.apiKeyEnv
    if (ref === undefined) return undefined
    const credential = await ctx.credentials.resolve(credentialRef(ref))
    if (credential === undefined) throw new LlmError(`No credential configured for "${connection.route}" (${ref})`, 'MISSING_CREDENTIAL')
    return assertUsableApiKey(credential.value, name, ref)
  }
  const adapter = new DobeeAdapter({
    connections: () => connections,
    apiKey,
    attachments: () => ctx.get('attachments'),
    imageAccess: (ref) => {
      const attachments = ctx.get('attachments')
      return attachments === undefined ? undefined : resolveImageAttachmentAccess(
        attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref,
      )
    },
    subscription: (connection, signal) => subscriptions.authenticate(connection.id, signal),
    subscriptionModels: connection => subscriptions.allowedModels(connection.id),
  })
  const synchronize = (): void => {
    const nextRaw = config.connections.get()
    const next = nextRaw === raw ? connections : resolveConnections(nextRaw)
    const entries = [...next.values()].map(connection => ({
      provider: connection.route, displayName: connection.name, settingsNs: namespace,
      settingsPath: ['connections', connection.id], declared: true,
    }))
    const previous = connections
    connections = next
    try {
      const routes = [...next.values()].filter(connection => connection.config.enabled).map(connection => connection.route)
      if (routes.length > 0 && registration === undefined) registration = ctx.llm.registerAdapter(routes, adapter)
      else registration?.replace(routes)
      if (entries.length > 0 && directory === undefined) directory = ctx.llm.registerConfigurableProviders(entries)
      else directory?.replace(entries)
      raw = nextRaw
    } catch (error) {
      connections = previous
      registration?.replace([...previous.values()].filter(connection => connection.config.enabled).map(connection => connection.route))
      throw error
    }
  }
  ctx.effect(() => {
    synchronize()
    return () => { directory?.(); registration?.() }
  }, 'dobee model routes')
  ctx.on('loader/volatile-update', synchronize)

  ctx.llm.registerModelDiscovery(namespace, async (
    request: LlmModelDiscoveryRequest, signal?: AbortSignal,
  ): Promise<readonly LlmDiscoveredModel[]> => {
    const connection = request.provider === undefined ? undefined : connections.get(request.provider)
    const source = request.provider?.replace(/^dobee-/, '')
    const sourcePreset = source === undefined ? undefined : preset(source)
    const known = connection ?? (source !== undefined && sourcePreset !== undefined
      && (sourcePreset.models === undefined || sourcePreset.models.length > 0)
      ? resolveConnection(source, sourcePreset) : undefined)
    const copilot = known?.config.source === 'github-copilot'
    if (known !== undefined && request.baseURL === undefined && !copilot) {
      return known.models.map(model => ({
        id: model.id, name: model.name, contextWindow: model.contextWindow,
        maxTokens: model.maxTokens, inputModalities: model.input,
      }))
    }
    const endpoint = request.baseURL ?? known?.models[0]?.baseUrl ?? sourcePreset?.baseURL
    if (endpoint === undefined) throw new LlmError('Model discovery needs an endpoint', 'INVALID_DISCOVERY')
    const url = new URL(endpoint)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new LlmError('Invalid model discovery endpoint', 'INVALID_DISCOVERY')
    const protocol = request.api ?? known?.models[0]?.api ?? sourcePreset?.api
    if (!copilot && !['openai-completions', 'openai-responses', 'anthropic-messages'].includes(protocol ?? '')) {
      throw new LlmError('This protocol has no endpoint model-discovery implementation; enter models manually', 'UNSUPPORTED_OPTION')
    }
    const key = request.apiKey === undefined
      ? (connection === undefined ? undefined : await apiKey(connection))
      : assertUsableApiKey(request.apiKey, name, 'draft')
    if (copilot && key === undefined) throw new LlmError('Copilot discovery requires an authorized Copilot token, not a GitHub PAT', 'MISSING_CREDENTIAL')
    const anthropic = protocol === 'anthropic-messages' && !copilot
    url.pathname = `${url.pathname.replace(/\/$/, '').replace(anthropic ? /\/v1$/ : /$^/, '')}${anthropic ? '/v1/models' : '/models'}`
    url.search = anthropic ? '?limit=1000' : ''
    const response = await fetch(url, {
      redirect: 'error',
      signal: signal === undefined
        ? AbortSignal.timeout(known?.config.timeoutMs ?? 300_000)
        : AbortSignal.any([signal, AbortSignal.timeout(known?.config.timeoutMs ?? 300_000)]),
      headers: {
        ...attributionHeaders(),
        ...key === undefined ? {} : anthropic ? { 'x-api-key': key } : { authorization: `Bearer ${key}` },
        ...anthropic ? { 'anthropic-version': '2023-06-01' } : {},
        ...copilot ? { 'copilot-integration-id': 'dobee-work' } : {},
      },
    })
    if (!response.ok) throw new LlmError(`Model discovery failed with HTTP ${response.status}`, response.status === 401 || response.status === 403 ? 'AUTH' : 'MODEL_DISCOVERY', { status: response.status })
    const body: unknown = await response.json()
    if (!isRecord(body) || !Array.isArray(body.data)) throw new LlmError('Provider returned an invalid model listing', 'INVALID_RESPONSE')
    if (body.has_more === true) throw new LlmError('Model listing is paginated; enter the desired model ids manually', 'UNSUPPORTED_OPTION')
    const result: LlmDiscoveredModel[] = []
    for (const entry of body.data) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) throw new LlmError('Model listing contains an invalid model', 'INVALID_RESPONSE')
      const policy = isRecord(entry.policy) ? entry.policy : undefined
      if (copilot && (policy?.state === 'disabled' || entry.model_picker_enabled === false)) continue
      const native = known?.models.find(model => model.id === entry.id)
      result.push({
        id: entry.id, name: typeof entry.name === 'string' ? entry.name : typeof entry.display_name === 'string' ? entry.display_name : entry.id,
        ...native === undefined ? {} : { contextWindow: native.contextWindow, maxTokens: native.maxTokens, inputModalities: native.input },
      })
    }
    return result
  })
}
