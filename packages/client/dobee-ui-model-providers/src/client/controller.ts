/** Provider selection, retained drafts, revision-fenced writes, and account authorization. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ProviderKind, ProviderModel, ProviderModelsRequest, ProviderPreset, SubscriptionLoginFrame, SubscriptionStatus,
} from '@deepseek-ai/dsh-dobee-model-providers/types'
import type { LocaleKey } from './locales.ts'

/** Host settings namespace. */
export const NAMESPACE = 'dobee-model-providers'
/** Compatible protocols exposed only in advanced API settings. */
export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const
/** Model metadata remains intact when a model is enabled or made the default. */
export type Model = { [Key in keyof ProviderModel]: ProviderModel[Key] }
/** Editor-owned connection fields; mutation leaves other Host fields untouched. */
export type Connection = {
  source?: string
  kind?: ProviderKind
  enabled?: boolean
  enabledModels?: string[] | null
  displayName?: string
  api?: string
  baseURL?: string
  apiKeyEnv?: string
  models?: Model[]
  timeoutMs?: number
}
/** Host provider settings. */
export interface DobeeProviderSettings { connections: Record<string, Connection> }
/** Existing default-model namespace. */
export interface DefaultModel { provider: string; model: string; reasoningEffort?: string }
/** String-valued capacity fields retain invalid manual additions. */
export interface ModelDraft {
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  api?: string
  input?: Array<'text' | 'image'> | undefined
  reasoning?: boolean | undefined
}
/** Secrets exist only in retained, in-memory drafts. IDs and credential references are internal. */
export interface Draft {
  id: string
  originalId?: string
  source: string
  kind: ProviderKind
  enabled: boolean
  enabledModels: string[] | null
  displayName: string
  api?: string | undefined
  baseURL: string
  apiKeyEnv: string
  apiKey: string
  timeoutMs: string
  models: ModelDraft[]
  revision?: number | undefined
  configCommitted: boolean
  dirty: boolean
}
/** A login stream owns remote cancellation and must be disposed after iteration. */
export interface LoginStream extends AsyncIterable<SubscriptionLoginFrame> {
  dispose(): void | Promise<void>
}
/** Source-safe callbacks; transport failures reject without exposing secret values. */
export interface Operations {
  presets: () => Promise<ProviderPreset[]>
  describe: (ref: string) => Promise<CredentialInfo | undefined>
  setCredential: (ref: string, secret: string) => Promise<boolean>
  catalog: (connectionId: string) => Promise<Model[]>
  discover: (request: ProviderModelsRequest, signal: AbortSignal) => Promise<Model[]>
  status: (connectionId: string) => Promise<SubscriptionStatus>
  login: (connectionId: string, signal: AbortSignal) => LoginStream | Promise<LoginStream>
  cancelLogin: (connectionId: string) => Promise<void>
  logout: (connectionId: string) => Promise<void>
}
/** Framework-observed provider page state. */
export interface State {
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  connections: Record<string, Connection>
  presets: ProviderPreset[]
  defaultModel?: DefaultModel | undefined
  defaultWritable: boolean
  draft: Draft | null
  credential?: CredentialInfo | undefined
  credentialLoading: boolean
  candidates: Model[]
  catalogLoading: boolean
  subscription?: SubscriptionStatus | undefined
  deviceCode?: Extract<SubscriptionLoginFrame, { type: 'device-code' }> | undefined
  loggingIn: boolean
  busy: boolean
  error: LocaleKey | null
  toast: { key: LocaleKey; success: boolean; sequence: number } | null
}

/**
 * Derive the conventional secret reference without requiring user input.
 * @param id - generated or existing connection ID.
 * @returns connection-specific credential reference.
 */
export function keyReference(id: string): string {
  return `DOBEE_${id.toUpperCase().replaceAll('-', '_')}_API_KEY`
}

/**
 * Address a saved connection in the Host model registry.
 * @param id - stable connection ID.
 * @returns provider route.
 */
export function providerRoute(id: string): string { return `dobee-${id}` }

function positiveInteger(text: string): boolean {
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) > 0
}

/**
 * Validate editable fields without requiring knowledge of internal route IDs.
 * @param draft - staged provider values.
 * @returns localized field error, if any.
 */
export function validateDraft(draft: Draft): LocaleKey | undefined {
  if (draft.kind === 'subscription') return undefined
  if (draft.apiKey !== '' && !/^[\x21-\x7e]+$/.test(draft.apiKey)) return 'invalidKey'
  if (draft.timeoutMs !== '' && (!positiveInteger(draft.timeoutMs) || Number(draft.timeoutMs) > 2_147_483_647)) return 'invalidTimeout'
  try {
    const url = new URL(draft.baseURL)
    if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '') return 'invalidEndpoint'
  } catch (_error) {
    // Endpoints are user-entered URLs, not same-process typed values.
    return 'invalidEndpoint'
  }
  const ids = draft.models.map(model => model.id.trim())
  if (ids.some(id => id === '') || new Set(ids).size !== ids.length || draft.models.some(model =>
    (model.contextWindow !== '' && !positiveInteger(model.contextWindow))
    || (model.maxTokens !== '' && !positiveInteger(model.maxTokens))
    || (model.contextWindow !== '' && model.maxTokens !== '' && Number(model.maxTokens) > Number(model.contextWindow))
    || model.input?.length === 0)) return 'invalidModels'
  return undefined
}

/**
 * Project model metadata into manual capacity fields.
 * @param model - provider-disclosed or declared metadata.
 * @returns editable fields preserving omitted capabilities and protocol.
 */
export function modelDraft(model: Model): ModelDraft {
  return {
    id: model.id, name: model.name ?? '', contextWindow: model.contextWindow?.toString() ?? '',
    maxTokens: model.maxTokens?.toString() ?? '',
    ...(model.api === undefined ? {} : { api: model.api }),
    ...(model.input === undefined ? {} : { input: [...model.input] }),
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
  }
}

/**
 * Project validated values into secret-free Host configuration.
 * @param draft - provider draft.
 * @returns editor-owned fields; subscriptions have no endpoint or credential reference.
 */
export function connectionOf(draft: Draft): Connection {
  return {
    ...(draft.source === '' ? {} : { source: draft.source }),
    kind: draft.kind, enabled: draft.enabled,
    enabledModels: draft.enabledModels === null ? null : [...draft.enabledModels],
    ...(draft.displayName.trim() === '' ? {} : { displayName: draft.displayName.trim() }),
    ...(draft.kind === 'subscription' ? {} : {
      baseURL: draft.baseURL,
      apiKeyEnv: draft.apiKeyEnv || keyReference(draft.id),
      ...(draft.api === undefined ? {} : { api: draft.api }),
      ...(draft.timeoutMs === '' ? {} : { timeoutMs: Number(draft.timeoutMs) }),
    }),
    ...(draft.models.length === 0 ? {} : {
      models: draft.models.map(model => ({
        id: model.id.trim(),
        ...(model.name.trim() === '' ? {} : { name: model.name.trim() }),
        ...(model.contextWindow === '' ? {} : { contextWindow: Number(model.contextWindow) }),
        ...(model.maxTokens === '' ? {} : { maxTokens: Number(model.maxTokens) }),
        ...(model.api === undefined ? {} : { api: model.api }),
        ...(model.input === undefined ? {} : { input: [...model.input] }),
        ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
      })),
    }),
  }
}

/** Draft lifetime and authorization outlive Settings panel remounts. */
export class Controller {
  /** Observable bound by the slot renderer. */
  readonly store = createSnapshotStore<State>({
    status: 'loading', writable: false, connections: {}, presets: [], defaultWritable: false,
    draft: null, credentialLoading: false, candidates: [], catalogLoading: false,
    loggingIn: false, busy: false, error: null, toast: null,
  })
  private readonly unsubscribe: Array<() => void>
  private readonly drafts = new Map<string, { draft: Draft; candidates: Model[]; error: LocaleKey | null }>()
  private readonly pending = new Set<Promise<unknown>>()
  private disposed = false
  private selection = 0
  private credentialRead = 0
  private catalogRead = 0
  private statusRead = 0
  private modelEdits = 0
  private sequence = 0
  private presetsReady = false
  private request: AbortController | undefined
  private loginTask: Promise<void> | undefined
  private shutdown: Promise<void> | undefined
  private currentKey = ''

  private isActive(): boolean { return !this.disposed }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    void promise.then(() => { this.pending.delete(promise) }, () => { this.pending.delete(promise) })
    return promise
  }

  /**
   * @param form - provider settings form.
   * @param defaults - existing default-model form.
   * @param operations - remote callbacks.
   */
  constructor(
    private readonly form: ConfigForm<DobeeProviderSettings>,
    private readonly defaults: ConfigForm<DefaultModel>,
    private readonly operations: Operations,
  ) {
    this.unsubscribe = [form.subscribe(() => { this.sync() }), defaults.subscribe(() => { this.sync() })]
    this.sync()
    void this.loadPresets()
  }

  private sync(): void {
    if (this.disposed) return
    const snapshot = this.form.getSnapshot()
    const defaults = this.defaults.getSnapshot()
    this.store.update((state) => {
      state.status = snapshot.status
      state.writable = snapshot.writable
      state.connections = snapshot.value?.connections ?? {}
      state.defaultModel = defaults.value
      state.defaultWritable = defaults.status === 'ready' && defaults.writable
    })
    if (this.presetsReady && snapshot.status === 'ready' && this.store.getSnapshot().draft === null) this.openInitial()
  }

  /** Reload the provider list after a catalog-service failure. */
  async loadPresets(): Promise<void> {
    if (!this.isActive()) return
    try {
      const presets = await this.track(this.operations.presets())
      if (this.disposed) return
      this.presetsReady = true
      this.store.update((state) => { state.presets = presets; state.error = null })
      if (this.store.getSnapshot().draft === null) this.openInitial()
    } catch (_error) { this.failure('catalogFailed', false) }
  }

  private openInitial(): void {
    const state = this.store.getSnapshot()
    if (state.status !== 'ready') return
    const connections = state.connections
    const id = Object.hasOwn(connections, 'deepseek') ? 'deepseek' : Object.keys(connections)[0]
    if (id !== undefined) this.open(id)
    else this.open(undefined, 'deepseek')
  }

  /**
   * Select a saved provider or prepare a preset with an automatically generated ID.
   * Unsaved drafts are retained when changing selection; credential-only retry cannot be abandoned.
   * @param id - existing saved ID.
   * @param source - preset identity, or empty for a custom API provider.
   */
  open(id?: string, source = ''): void {
    if (this.disposed) return
    const state = this.store.getSnapshot()
    if (state.busy || state.loggingIn || state.draft?.configCommitted) return
    const connection = id === undefined ? undefined : state.connections[id]
    if (id !== undefined && connection === undefined) return
    const key = id === undefined ? (source === '' ? 'custom' : `preset:${source}`) : `saved:${id}`
    if (key === this.currentKey) return
    if (state.draft !== null) this.drafts.set(this.currentKey, {
      draft: state.draft, candidates: state.candidates, error: state.error,
    })
    this.currentKey = key
    const cached = this.drafts.get(key)
    const preset = state.presets.find(item => item.source === (connection?.source ?? source))
    const kind = connection?.source === 'github-copilot' ? 'subscription' : connection?.kind ?? preset?.kind ?? 'api'
    const generated = `provider-${randomUUID()}`
    const draft: Draft = cached?.draft ?? {
      id: id ?? generated, ...(id === undefined ? {} : { originalId: id }),
      source: connection?.source ?? source, kind,
      enabled: connection?.enabled ?? true, enabledModels: connection?.enabledModels ?? null,
      displayName: connection?.displayName ?? '',
      api: connection?.api ?? preset?.api ?? (source === '' ? 'openai-completions' : undefined),
      baseURL: kind === 'subscription' ? '' : connection?.baseURL ?? preset?.baseURL ?? '',
      apiKeyEnv: kind === 'subscription' ? '' : connection?.apiKeyEnv ?? '',
      apiKey: '', timeoutMs: connection?.timeoutMs?.toString() ?? '',
      models: (connection?.models ?? []).map(modelDraft),
      revision: this.form.getSnapshot().revision, configCommitted: false, dirty: false,
    }
    const selection = ++this.selection
    this.credentialRead++
    this.store.update((next) => {
      next.draft = draft
      next.candidates = cached?.candidates ?? connection?.models ?? []
      next.error = cached?.error ?? null
      next.credential = undefined
      next.credentialLoading = false
      next.subscription = undefined
      next.deviceCode = undefined
      next.catalogLoading = id !== undefined
    })
    if (kind === 'api') void this.refreshCredential()
    else if (id !== undefined) void this.refreshStatus(selection)
    if (id !== undefined) void this.loadCatalog(id, selection)
  }

  private async loadCatalog(id: string, selection: number): Promise<void> {
    const read = ++this.catalogRead
    const modelEdits = this.modelEdits
    try {
      const models = await this.track(this.operations.catalog(id))
      if (this.disposed || selection !== this.selection || read !== this.catalogRead || modelEdits !== this.modelEdits) return
      this.store.update((state) => {
        state.candidates = state.draft?.kind === 'subscription' ? models : mergeModels(state.candidates, models)
      })
    } catch (_error) {
      if (!this.disposed && selection === this.selection && read === this.catalogRead && modelEdits === this.modelEdits) {
        this.failure('catalogFailed', false)
      }
    } finally {
      if (!this.disposed && selection === this.selection && read === this.catalogRead) {
        this.store.update((state) => { state.catalogLoading = false })
      }
    }
  }

  /** Retry offline catalog and account presence reads without discarding fields. */
  async refreshInfo(): Promise<void> {
    const draft = this.store.getSnapshot().draft
    if (draft?.originalId === undefined || this.store.getSnapshot().busy || this.store.getSnapshot().loggingIn) return
    this.store.update((state) => { state.catalogLoading = true; state.error = null })
    await Promise.all([this.loadCatalog(draft.id, this.selection), this.refreshStatus()])
  }

  /**
   * Change fields without exposing connection IDs, sources, or credential references.
   * @param patch - editable provider values.
   */
  edit(patch: Partial<Pick<Draft, 'displayName' | 'enabled' | 'enabledModels' | 'api' | 'baseURL' | 'apiKey' | 'timeoutMs' | 'models'>>): void {
    const state = this.store.getSnapshot()
    if (state.draft === null || state.busy || state.loggingIn) return
    if (state.draft.configCommitted && Object.keys(patch).some(key => key !== 'apiKey')) return
    if (patch.models !== undefined) this.modelEdits++
    const removedIds = state.draft.models.filter(model => !patch.models?.some(next => next.id === model.id)).map(model => model.id)
    this.store.update((next) => {
      if (next.draft !== null) { Object.assign(next.draft, patch); next.draft.dirty = true }
      next.error = null
      if (patch.models !== undefined && next.draft !== null) {
        next.candidates = mergeModels(next.candidates.filter(model => !removedIds.includes(model.id)),
          patch.models.filter(model => model.id.trim() !== '').map(model => ({
            id: model.id.trim(), ...(model.name.trim() === '' ? {} : { name: model.name.trim() }),
          })))
      }
    })
  }

  /**
   * Toggle a model from the actual catalog; null means all current and future models.
   * @param id - model in the displayed catalog.
   * @param enabled - requested checkbox state.
   */
  toggleModel(id: string, enabled: boolean): void {
    const state = this.store.getSnapshot()
    const draft = state.draft
    if (draft === null || !state.candidates.some(model => model.id === id)) return
    const ids = draft.enabledModels ?? state.candidates.map(model => model.id)
    this.edit({ enabledModels: enabled ? [...new Set([...ids, id])] : ids.filter(value => value !== id) })
  }

  /** Discard the selected draft, unless a committed configuration still needs its credential. */
  cancel(): void {
    const state = this.store.getSnapshot()
    if (state.busy || state.loggingIn || state.draft?.configCommitted) return
    const id = state.draft?.originalId
    const source = state.draft?.source ?? ''
    this.drafts.delete(this.currentKey)
    this.currentKey = ''
    this.store.update((next) => { next.draft = null; next.error = null })
    this.open(id, source)
  }

  /** Refresh credential presence only; stale replies cannot update another provider. */
  async refreshCredential(): Promise<void> {
    if (!this.isActive()) return
    const draft = this.store.getSnapshot().draft
    const read = ++this.credentialRead
    if (draft === null || draft.kind === 'subscription') return
    this.store.update((state) => { state.credentialLoading = true })
    let credential: CredentialInfo | undefined
    try { credential = await this.track(this.operations.describe(draft.apiKeyEnv || keyReference(draft.id))) }
    catch (_error) { credential = undefined /* Failed presence queries never clear stored secrets. */ }
    if (this.disposed || read !== this.credentialRead) return
    this.store.update((state) => { state.credential = credential; state.credentialLoading = false })
  }

  private async refreshStatus(selection = this.selection): Promise<void> {
    const draft = this.store.getSnapshot().draft
    if (draft?.originalId === undefined || draft.kind !== 'subscription') return
    const read = ++this.statusRead
    try {
      const status = await this.track(this.operations.status(draft.id))
      if (!this.disposed && selection === this.selection && read === this.statusRead) {
        this.store.update((state) => { state.subscription = status })
      }
    } catch (_error) {
      if (!this.disposed && selection === this.selection && read === this.statusRead) this.failure('accountFailed', false)
    }
  }

  /**
   * Save the selected provider; a credential refusal leaves a credential-only retry checkpoint.
   * @returns whether the complete save was accepted.
   */
  async save(): Promise<boolean> {
    const state = this.store.getSnapshot()
    const draft = state.draft
    if (draft === null || state.busy || state.loggingIn || state.credentialLoading) return false
    const invalid = validateDraft(draft)
    if (invalid !== undefined) { this.failure(invalid, false); return false }
    if (draft.kind === 'api' && draft.apiKey === '' && state.credential?.configured !== true) {
      this.failure('keyRequired', false); return false
    }
    if (draft.kind === 'api' && draft.apiKey !== '' && state.credential?.writable === false) {
      this.failure('credentialReadOnly', false); return false
    }
    if (!draft.configCommitted && !state.writable) { this.failure('unavailable', false); return false }
    this.store.update((next) => { next.busy = true; next.error = null })
    try {
      if (!draft.configCommitted) {
        if (!await this.commit(draft)) return false
        if (this.disposed) return false
        this.store.update((next) => {
          if (next.draft !== null) { next.draft.configCommitted = true; next.draft.originalId = draft.id }
        })
      }
      if (draft.kind === 'api' && draft.apiKey !== '' &&
        !await this.track(this.operations.setCredential(draft.apiKeyEnv || keyReference(draft.id), draft.apiKey))) {
        this.failure('credentialFailed'); return false
      }
      if (this.disposed) return false
      this.drafts.delete(this.currentKey)
      this.currentKey = `saved:${draft.id}`
      this.store.update((next) => {
        if (next.draft !== null) {
          next.draft.apiKey = ''
          next.draft.configCommitted = false
          next.draft.dirty = false
          next.draft.revision = this.form.getSnapshot().revision
        }
        next.error = null
      })
      if (draft.kind === 'api') await this.refreshCredential()
      this.notice('saved')
      return true
    } catch (_error) {
      this.failure(this.store.getSnapshot().draft?.configCommitted ? 'credentialFailed' : 'failed')
      return false
    } finally {
      if (!this.disposed) this.store.update((next) => { next.busy = false })
    }
  }

  private async commit(draft: Draft): Promise<boolean> {
    const connection = connectionOf(draft)
    const fields = ['source', 'kind', 'enabled', 'enabledModels', 'displayName', 'api', 'baseURL', 'apiKeyEnv', 'models', 'timeoutMs'] as const
    const ops = draft.originalId === undefined
      ? [{ op: 'set' as const, path: ['connections', draft.id], value: connection }]
      : fields.map(field => connection[field] === undefined
        ? { op: 'unset' as const, path: ['connections', draft.id, field] }
        : { op: 'set' as const, path: ['connections', draft.id, field], value: connection[field] })
    const accepted = await this.track(this.form.mutate(ops, draft.revision))
    if (this.disposed) return false
    if (!accepted) {
      this.store.update((state) => {
        if (state.draft !== null) state.draft.revision = this.form.getSnapshot().revision
      })
      this.failure('conflict')
    }
    return accepted
  }

  /** Live model synchronization automatically fills the list and retains returned metadata. */
  async discover(): Promise<void> {
    const state = this.store.getSnapshot()
    const draft = state.draft
    if (draft === null || state.busy || state.loggingIn || draft.configCommitted) return
    if (draft.kind === 'subscription' && (draft.originalId === undefined
      || state.subscription === undefined || state.subscription.status === 'signed-out')) {
      this.failure('loginRequired', false); return
    }
    const invalid = validateDraft({ ...draft, models: [] })
    if (invalid !== undefined) { this.failure(invalid, false); return }
    const request = new AbortController()
    this.request = request
    this.store.update((next) => { next.busy = true; next.error = null })
    try {
      const candidates = await this.track(this.operations.discover(draft.kind === 'subscription' ? { connectionId: draft.id } : {
        ...(draft.originalId === undefined ? {} : { connectionId: draft.id }),
        ...(draft.source === '' ? {} : { source: draft.source }),
        baseURL: draft.baseURL,
        ...(draft.api === undefined ? {} : { api: draft.api }),
        ...(draft.apiKey === '' ? {} : { apiKey: draft.apiKey }),
      }, request.signal))
      if (this.disposed) return
      const declarations = draft.kind === 'subscription' ? candidates : mergeModels(connectionOf(draft).models ?? [], candidates)
      this.modelEdits++
      this.store.update((next) => {
        next.candidates = declarations
        if (next.draft !== null) {
          next.draft.models = declarations.map(modelDraft)
          if (next.draft.enabledModels !== null) {
            next.draft.enabledModels = next.draft.enabledModels.filter(id => declarations.some(model => model.id === id))
          }
          next.draft.dirty = true
        }
      })
      if (draft.kind === 'subscription') await this.refreshStatus()
      this.notice('discovered')
    } catch (_error) { if (!request.signal.aborted) this.failure('syncFailed') }
    finally {
      if (this.request === request) this.request = undefined
      if (!this.disposed) this.store.update((next) => { next.busy = false })
    }
  }

  /** Save a subscription first, then start device authorization without any token input. */
  async login(): Promise<void> {
    if (this.loginTask !== undefined) return this.loginTask
    const task = this.performLogin()
    this.loginTask = task
    try { await task } finally { this.loginTask = undefined }
  }

  private async performLogin(): Promise<void> {
    const before = this.store.getSnapshot()
    if (before.draft?.kind !== 'subscription' || before.busy || before.loggingIn || !before.writable) return
    if (!await this.save()) return
    const draft = this.store.getSnapshot().draft
    if (draft === null || !this.isActive()) return
    const request = new AbortController()
    this.request = request
    this.store.update((state) => { state.loggingIn = true; state.deviceCode = undefined; state.error = null })
    let authorized = false
    try {
      authorized = await this.authorize(draft.id, request.signal)
    } catch (_error) {
      if (!request.signal.aborted) this.failure('loginFailed')
    } finally {
      if (this.request === request) this.request = undefined
      if (!this.disposed) this.store.update((state) => { state.loggingIn = false; state.deviceCode = undefined })
    }
    if (this.disposed || request.signal.aborted || !authorized || this.store.getSnapshot().error !== null) return
    await this.refreshStatus()
    this.edit({ enabled: true })
    await this.discover()
    if (this.store.getSnapshot().error === null) await this.save()
    this.notice('signedIn')
  }

  private async authorize(id: string, signal: AbortSignal): Promise<boolean> {
    const stream = await this.track(Promise.resolve(this.operations.login(id, signal)))
    let authorized = false
    try {
      for await (const frame of stream) {
        if (this.disposed || signal.aborted) return false
        switch (frame.type) {
          case 'device-code':
            this.store.update((state) => { state.deviceCode = frame })
            break
          case 'authorized':
            authorized = true
            this.store.update((state) => { state.subscription = { status: 'signed-in', account: frame.account } })
            break
          case 'cancelled':
            return false
          default:
            assertNever(frame)
        }
      }
      return authorized
    } finally { await stream.dispose() }
  }

  /** Cancel Host polling and wait until the owned stream has settled. */
  async cancelLogin(): Promise<void> {
    const draft = this.store.getSnapshot().draft
    const task = this.loginTask
    if (draft === null || !this.store.getSnapshot().loggingIn) return
    this.request?.abort()
    try { await this.track(this.operations.cancelLogin(draft.id)) }
    catch (_error) { this.failure('failed') }
    await task
  }

  /** Clear the selected subscription authorization; no shared API credentials are removed. */
  async logout(): Promise<void> {
    const state = this.store.getSnapshot()
    if (state.draft?.kind !== 'subscription' || state.draft.originalId === undefined || state.busy || state.loggingIn) return
    this.store.update((next) => { next.busy = true; next.error = null })
    try {
      await this.track(this.operations.logout(state.draft.id))
      if (this.disposed) return
      this.modelEdits++
      await this.refreshStatus()
      this.store.update((next) => { next.candidates = [] })
      this.notice('signedOut')
    } catch (_error) { this.failure('failed') }
    finally { if (!this.disposed) this.store.update((next) => { next.busy = false }) }
  }

  /**
   * Delete a provider after revoking its owned subscription grant; shared API keys remain stored.
   * @param id - saved provider ID, confirmed by the UI.
   * @returns whether deletion succeeded.
   */
  async remove(id: string): Promise<boolean> {
    const state = this.store.getSnapshot()
    if (state.busy || state.loggingIn || state.draft?.configCommitted || !Object.hasOwn(state.connections, id)) return false
    if (!state.writable) { this.failure('unavailable', false); return false }
    if (state.defaultModel?.provider === providerRoute(id)) { this.failure('changeDefault'); return false }
    const revision = this.form.getSnapshot().revision
    this.store.update((next) => { next.busy = true })
    try {
      const connection = state.connections[id]
      if (connection?.source === 'github-copilot' || connection?.kind === 'subscription') {
        await this.track(this.operations.logout(id))
        if (this.disposed) return false
        this.statusRead++
        this.modelEdits++
        if (state.draft?.id === id) this.store.update((next) => { next.subscription = { status: 'signed-out' }; next.candidates = [] })
      }
      const connections = Object.fromEntries(Object.entries(state.connections).filter(([key]) => key !== id))
      if (!await this.track(this.form.mutate([{ op: 'set', path: ['connections'], value: connections }], revision))) {
        this.failure('conflict'); return false
      }
      if (this.disposed) return false
      this.drafts.delete(`saved:${id}`)
      this.currentKey = ''
      this.selection++
      this.credentialRead++
      this.store.update((next) => {
        next.draft = null; next.candidates = []; next.error = null; next.catalogLoading = false
      })
      this.notice('deleted')
      return true
    } catch (_error) { this.failure('failed'); return false }
    finally { if (!this.disposed) this.store.update((next) => { next.busy = false }) }
  }

  /**
   * Select an enabled model from the actual catalog and clear incompatible reasoning settings.
   * @param id - saved selected provider ID.
   * @param model - enabled model in the displayed list.
   * @returns fulfillment after accepted selection or visible refusal.
   */
  async setDefault(id: string, model: string): Promise<void> {
    const state = this.store.getSnapshot()
    const draft = state.draft
    if (state.busy || state.loggingIn) return
    if (!state.defaultWritable) { this.failure('unavailable', false); return }
    if (draft?.id !== id || draft.originalId === undefined || draft.dirty || draft.configCommitted) {
      this.failure('saveFirst', false); return
    }
    if (!draft.enabled || !state.candidates.some(item => item.id === model)
      || (draft.enabledModels !== null && !draft.enabledModels.includes(model))
      || (draft.kind === 'subscription' && (state.subscription === undefined || state.subscription.status === 'signed-out'))) {
      this.failure('invalidDefault', false); return
    }
    this.store.update((next) => { next.busy = true })
    try {
      if (!await this.track(this.defaults.mutate([
        { op: 'set', path: ['provider'], value: providerRoute(id) },
        { op: 'set', path: ['model'], value: model },
        { op: 'unset', path: ['reasoningEffort'] },
      ], this.defaults.getSnapshot().revision))) { this.failure('conflict'); return }
      this.notice('defaultSaved')
    } catch (_error) { this.failure('failed') }
    finally { if (!this.disposed) this.store.update((next) => { next.busy = false }) }
  }

  private failure(key: LocaleKey, toast = true): void {
    if (this.disposed) return
    this.store.update((state) => { state.error = key })
    if (toast) this.notice(key, false)
  }

  private notice(key: LocaleKey, success = true): void {
    if (!this.disposed) this.store.update((state) => { state.toast = { key, success, sequence: ++this.sequence } })
  }

  /** Clear the displayed transient outcome. */
  dismiss(): void { this.store.update((state) => { state.toast = null }) }

  /**
   * Withdraw listeners, erase secret drafts, cancel owned requests, and join login teardown.
   * @returns fulfillment once login stream disposal completes.
   */
  async dispose(): Promise<void> {
    if (this.shutdown !== undefined) return this.shutdown
    this.disposed = true
    this.selection++
    this.credentialRead++
    for (const off of this.unsubscribe) off()
    this.request?.abort()
    this.drafts.clear()
    this.store.update((state) => { state.draft = null; state.toast = null })
    this.shutdown = Promise.allSettled([...this.pending, ...(this.loginTask === undefined ? [] : [this.loginTask])]).then(() => {})
    await this.shutdown
  }
}

function mergeModels(existing: readonly Model[], incoming: readonly Model[]): Model[] {
  const models = new Map(existing.map(model => [model.id, model]))
  for (const model of incoming) models.set(model.id, { ...models.get(model.id), ...model })
  return [...models.values()]
}
