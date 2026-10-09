/** Host-owned provider defaults, model synchronization, and subscription account operations. */
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmError, attributionHeaders, assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Connection } from './config.ts'
import { preset, providerPresets } from './config.ts'
import type { ProviderModel, ProviderModelsRequest, ProviderPreset, SubscriptionLoginFrame, SubscriptionStatus } from './types.ts'
import type { CopilotSubscriptions } from './subscription.ts'
import { copilotClientHeaders } from './copilot-headers.ts'

/** Live provider generation and Host-only subscription credentials. */
export interface ModelServicesOptions {
  /** Current immutable connection generation. */
  connections: () => ReadonlyMap<string, Connection>
  /** Account authorization owner. */
  subscriptions: CopilotSubscriptions
  /** Request deadline for unsaved endpoint drafts. */
  requestTimeoutMs: number
  /** Bound on paginated endpoint model-list work. */
  maxModelPages: number
  /** Optional instance-local network transport. */
  fetch?: typeof fetch
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function capacity(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function listing(value: unknown, google: boolean, copilot: boolean): ProviderModel[] {
  const rows = record(value) ? google ? value.models : value.data : undefined
  if (!Array.isArray(rows)) throw new LlmError('Provider returned an invalid model listing', 'INVALID_RESPONSE')
  const result: ProviderModel[] = []
  for (const raw of rows) {
    if (!record(raw)) throw new LlmError('Provider returned an invalid model entry', 'INVALID_RESPONSE')
    if (google && Array.isArray(raw.supportedGenerationMethods) && !raw.supportedGenerationMethods.includes('generateContent')) continue
    const id = google && typeof raw.name === 'string' ? raw.name.replace(/^models\//, '') : raw.id
    if (typeof id !== 'string' || id.length === 0) throw new LlmError('Provider returned a model without an id', 'INVALID_RESPONSE')
    const policy = record(raw.policy) ? raw.policy : undefined
    const capabilities = record(raw.capabilities) ? raw.capabilities : undefined
    const supports = record(capabilities?.supports) ? capabilities.supports : undefined
    if (copilot && (policy?.state === 'disabled' || supports?.tool_calls === false)) continue
    const limits = record(capabilities?.limits) ? capabilities.limits : undefined
    const contextWindow = capacity(raw.contextWindow) ?? capacity(raw.inputTokenLimit) ?? capacity(limits?.max_context_window_tokens)
    const maxTokens = capacity(raw.maxTokens) ?? capacity(raw.outputTokenLimit)
      ?? capacity(raw.max_tokens) ?? capacity(limits?.max_output_tokens)
    const endpoints: readonly unknown[] = Array.isArray(raw.supported_endpoints) ? raw.supported_endpoints : []
    const api = google ? 'google-generative-ai' : !copilot ? undefined
      : endpoints.includes('/responses') ? 'openai-responses'
        : endpoints.includes('/v1/messages') && !endpoints.includes('/chat/completions') ? 'anthropic-messages' : 'openai-completions'
    const vision = typeof supports?.vision === 'boolean' ? supports.vision : undefined
    result.push({
      id, name: typeof raw.displayName === 'string' ? raw.displayName : typeof raw.name === 'string' && !google ? raw.name
        : typeof raw.display_name === 'string' ? raw.display_name : id,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...api === undefined ? {} : { api },
      ...vision === undefined ? {} : { input: vision ? ['text', 'image'] : ['text'] },
    })
  }
  return result
}

/** All requests use Host transports; the browser receives model metadata and public login instructions only. */
export class DobeeModelManager extends Service {
  /**
   * @param ctx - context owning credentials and provider lifecycle.
   * @param options - live routes and authorization dependencies.
   */
  constructor(ctx: Context, private readonly options: ModelServicesOptions) {
    super(ctx, 'dobeeProviderManager')
  }

  private connection(id: string): Connection {
    const connection = this.options.connections().get(`dobee-${id}`)
    if (connection === undefined) throw new LlmError('Save this provider before using it', 'UNKNOWN_PROVIDER')
    return connection
  }

  private subscription(id: string): Connection {
    const connection = this.connection(id)
    if (connection.config.kind !== 'subscription') throw new LlmError('This is an API provider, not a subscription', 'UNSUPPORTED_AUTH')
    return connection
  }

  /**
   * Describe access categories and default endpoints without requesting credentials.
   * @returns supported provider presets.
   */
  presets(): ProviderPreset[] { return providerPresets() }

  /**
   * Read the installed or configured catalog without making an external request.
   * @param connectionId - saved provider id.
   * @returns available local metadata; subscription results use the last account synchronization.
   */
  async catalog(connectionId: string): Promise<ProviderModel[]> {
    const connection = this.connection(connectionId)
    const allowed = connection.config.kind === 'subscription' ? await this.options.subscriptions.allowedModels(connectionId) : undefined
    return connection.catalogModels.filter(model => allowed === undefined || allowed.includes(model.id)).map(model => ({
      id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      input: [...model.input], reasoning: model.reasoning, api: model.api,
    }))
  }

  /**
   * Synchronize the provider's actual endpoint catalog without writing configuration.
   * @param request - saved connection or staged API endpoint and write-only key.
   * @param signal - cancellation from the initiating client.
   * @returns models reported by the provider; account permissions are retained on the Host.
   */
  async models(request: ProviderModelsRequest, signal: AbortSignal): Promise<ProviderModel[]> {
    const connection = request.connectionId === undefined ? undefined : this.connection(request.connectionId)
    const defaults = preset(request.source ?? connection?.config.source ?? '')
    const subscription = connection?.config.kind === 'subscription'
    if (request.source === 'github-copilot' && !subscription) throw new LlmError('Save the subscription provider and sign in first', 'AUTH_REQUIRED')
    const authentication = subscription ? await this.options.subscriptions.authenticate(connection.id, signal) : undefined
    const endpoint = authentication?.baseURL ?? request.baseURL ?? connection?.config.baseURL ?? defaults?.baseURL
    if (endpoint === undefined) throw new LlmError('Enter an API endpoint', 'INVALID_CONNECTION')
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new LlmError('Invalid API endpoint', 'INVALID_CONNECTION')
    const source = request.source ?? connection?.config.source
    const google = source === 'google' && request.api === undefined && connection?.config.api === undefined
    const protocol = request.api ?? connection?.config.api ?? defaults?.api
      ?? (source === 'anthropic' || source === 'minimax' || source === 'minimax-cn' ? 'anthropic-messages' : 'openai-completions')
    const anthropic = protocol === 'anthropic-messages' && !subscription
    let key = authentication?.apiKey ?? request.apiKey
    if (key === undefined && connection?.config.apiKeyEnv !== undefined) {
      key = (await this.ctx.credentials.resolve(credentialRef(connection.config.apiKeyEnv)))?.value
    }
    if (key === undefined) throw new LlmError('Configure an API key before synchronizing models', 'MISSING_CREDENTIAL')
    key = assertUsableApiKey(key, 'dobee-model-providers', 'provider')
    if (anthropic) url.pathname = `${url.pathname.replace(/\/$/, '').replace(/\/v1$/, '')}/v1/models`
    else url.pathname = `${url.pathname.replace(/\/$/, '')}/models`
    url.search = anthropic ? '?limit=1000' : ''
    const transport = this.options.fetch ?? fetch
    const models: ProviderModel[] = []
    const cursors = new Set<string>()
    for (let page = 0; ; page++) {
      if (page >= this.options.maxModelPages) throw new LlmError('Model catalog exceeds the configured page limit', 'MODEL_DISCOVERY')
      const response = await transport(url, {
        redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(connection?.config.timeoutMs ?? this.options.requestTimeoutMs)]),
        headers: {
          ...attributionHeaders(),
          ...google ? { 'x-goog-api-key': key } : anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` },
          ...subscription ? copilotClientHeaders() : {},
        },
      })
      if (!response.ok) {
        let detail = ''
        try {
          const text = await response.text()
          detail = text.split(key).join('[redacted]').slice(0, 500)
        } catch (_error) {
          // Non-JSON endpoint diagnostics are omitted to avoid reflecting arbitrary response bodies.
        }
        throw new LlmError(
          `Model synchronization failed with HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`,
          'MODEL_DISCOVERY', { status: response.status },
        )
      }
      const value: unknown = await response.json()
      models.push(...listing(value, google, subscription))
      if (!google && record(value) && value.has_more === true
        && (typeof value.last_id !== 'string' || value.last_id.length === 0)) {
        throw new LlmError('Provider omitted its model pagination cursor', 'INVALID_RESPONSE')
      }
      const cursor = record(value)
        ? google ? value.nextPageToken : value.has_more === true ? value.last_id : undefined
        : undefined
      if (cursor === undefined || cursor === '') break
      if (typeof cursor !== 'string' || cursors.has(cursor)) throw new LlmError('Provider returned an invalid pagination cursor', 'INVALID_RESPONSE')
      cursors.add(cursor)
      url.searchParams.set(google ? 'pageToken' : 'after_id', cursor)
    }
    const native = connection?.catalogModels ?? []
    const unique = [...new Map(models.map(model => [model.id, model])).values()]
    const enriched = unique.map((model) => {
      const known = native.find(entry => entry.id === model.id)
      return {
        ...known === undefined ? {} : {
          name: known.name, contextWindow: known.contextWindow, maxTokens: known.maxTokens,
          input: [...known.input], reasoning: known.reasoning, api: known.api,
        },
        ...model,
      }
    })
    if (subscription) await this.options.subscriptions.rememberModels(connection.id, enriched.map(model => model.id))
    return enriched
  }

  /**
   * Read public subscription account metadata.
   * @param connectionId - saved subscription connection.
   * @returns status without any token values.
   */
  status(connectionId: string): Promise<SubscriptionStatus> {
    this.subscription(connectionId)
    return this.options.subscriptions.status(connectionId)
  }

  /**
   * Authorize a saved subscription through its browser/device flow.
   * @param connectionId - saved subscription connection.
   * @param signal - disconnect or caller cancellation.
   * @returns public device instructions followed by authorization or cancellation.
   */
  async *login(connectionId: string, signal: AbortSignal): AsyncIterable<SubscriptionLoginFrame> {
    this.subscription(connectionId)
    yield* this.options.subscriptions.login(connectionId, signal)
  }

  /**
   * Cancel and join the initiating connection's login.
   * @param connectionId - saved subscription connection.
   */
  cancelLogin(connectionId: string): Promise<void> {
    this.subscription(connectionId)
    return this.options.subscriptions.cancel(connectionId)
  }

  /**
   * Remove the connection's account grant without deleting its provider settings.
   * @param connectionId - saved subscription connection.
   */
  logout(connectionId: string): Promise<void> {
    this.subscription(connectionId)
    return this.options.subscriptions.logout(connectionId)
  }
}
