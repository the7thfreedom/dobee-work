import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ProviderPreset } from '@deepseek-ai/dsh-dobee-model-providers/types'
import { Controller, connectionOf, keyReference, modelDraft, validateDraft } from '../src/client/controller.ts'
import type { DefaultModel, Draft, LoginStream, Operations, Settings } from '../src/client/controller.ts'

const controllers: Controller[] = []
afterEach(async () => { await Promise.all(controllers.splice(0).map(controller => controller.dispose())) })

function form<T>(value: T) {
  let snapshot: ConfigFormSnapshot<T> = {
    status: 'ready', value, base: {}, user: {}, revision: 3, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: vi.fn<ConfigForm<T>['mutate']>(async () => true),
    set: vi.fn<ConfigForm<T>['set']>(async () => true),
    unset: vi.fn<ConfigForm<T>['unset']>(async () => true),
  } satisfies ConfigForm<T>
  return {
    scope, listeners,
    publish: (patch: Partial<ConfigFormSnapshot<T>>) => {
      snapshot = { ...snapshot, ...patch }
      for (const listener of listeners) listener()
    },
  }
}

const presets: ProviderPreset[] = [
  { source: 'deepseek', kind: 'api', baseURL: 'https://api.deepseek.com', api: 'openai-completions' },
  { source: 'openai', kind: 'api', baseURL: 'https://api.openai.com/v1', api: 'openai-responses' },
  { source: 'github-copilot', kind: 'subscription' },
]

async function fixture(overrides: Partial<Operations> = {}) {
  const settings = form<Settings>({ connections: {
    deepseek: { source: 'deepseek', apiKeyEnv: 'SHARED_KEY' },
    work: { source: 'openai', baseURL: 'https://work.example/v1' },
    copilot: { source: 'github-copilot', enabled: false },
  } })
  const defaults = form<DefaultModel>({ provider: 'other', model: 'old', reasoningEffort: 'high' })
  const operations: Operations = {
    presets: vi.fn(async () => presets),
    describe: vi.fn(async () => ({ configured: true, writable: true })),
    setCredential: vi.fn(async () => true),
    catalog: vi.fn(async () => [{ id: 'model-a', name: 'Model A' }, { id: 'model-b' }]),
    discover: vi.fn(async () => [{ id: 'synced', api: 'anthropic-messages', reasoning: true, contextWindow: 64000 }]),
    status: vi.fn<Operations['status']>(async () => ({ status: 'signed-out' })),
    login: vi.fn(async () => ({ async *[Symbol.asyncIterator]() {}, dispose: vi.fn() })),
    cancelLogin: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    ...overrides,
  }
  const controller = new Controller(settings.scope, defaults.scope, operations)
  controllers.push(controller)
  const state = () => controller.store.getSnapshot()
  await vi.waitFor(() => { expect(state().draft?.id).toBe('deepseek'); expect(state().credentialLoading).toBe(false) })
  return { controller, settings, defaults, operations, state }
}

function customDraft(): Draft {
  return {
    id: 'provider-auto', source: '', kind: 'api', enabled: true, enabledModels: null,
    displayName: '', api: 'openai-completions', baseURL: 'https://models.example/v1',
    apiKeyEnv: '', apiKey: '', timeoutMs: '', models: [modelDraft({ id: 'model-a' })],
    revision: 3, configCommitted: false, dirty: false,
  }
}

describe('provider draft values', () => {
  it('keeps API secrets outside settings and retains model-specific metadata', () => {
    const draft = { ...customDraft(), apiKey: 'private-key', models: [modelDraft({
      id: 'a', api: 'anthropic-messages', input: ['text', 'image'], reasoning: true, contextWindow: 100, maxTokens: 50,
    })] }
    expect(keyReference(draft.id)).toBe('DOBEE_PROVIDER_AUTO_API_KEY')
    expect(connectionOf(draft)).toMatchObject({
      apiKeyEnv: 'DOBEE_PROVIDER_AUTO_API_KEY', enabledModels: null,
      models: [{ id: 'a', api: 'anthropic-messages', input: ['text', 'image'], reasoning: true, contextWindow: 100, maxTokens: 50 }],
    })
    expect(JSON.stringify(connectionOf(draft))).not.toContain('private-key')
  })

  it('never writes endpoint, credential, or protocol fields for a subscription', () => {
    const draft = { ...customDraft(), kind: 'subscription' as const, source: 'github-copilot' }
    expect(validateDraft({ ...draft, baseURL: 'bad' })).toBeUndefined()
    expect(connectionOf(draft)).not.toHaveProperty('apiKeyEnv')
    expect(connectionOf(draft)).not.toHaveProperty('baseURL')
    expect(connectionOf(draft)).not.toHaveProperty('api')
  })

  it.each(['', 'file:///private/data', 'https://user:pass@example.com', 'invalid'])('rejects endpoint %s', (baseURL) => {
    expect(validateDraft({ ...customDraft(), baseURL })).toBe('invalidEndpoint')
  })

  it.each([' ', 'line\nbreak', 'key with spaces'])('rejects malformed key %s', (apiKey) => {
    expect(validateDraft({ ...customDraft(), apiKey })).toBe('invalidKey')
  })

  it.each(['0', '-1', '2.2', 'Infinity', '9007199254740992'])('rejects capacity %s', (contextWindow) => {
    expect(validateDraft({ ...customDraft(), models: [{ ...modelDraft({ id: 'a' }), contextWindow }] })).toBe('invalidModels')
  })

  it('rejects duplicate IDs, impossible capacities, and empty modalities', () => {
    expect(validateDraft({ ...customDraft(), models: [modelDraft({ id: 'a' }), modelDraft({ id: 'a' })] })).toBe('invalidModels')
    expect(validateDraft({ ...customDraft(), models: [modelDraft({ id: 'a', contextWindow: 100, maxTokens: 200 })] })).toBe('invalidModels')
    expect(validateDraft({ ...customDraft(), models: [modelDraft({ id: 'a', input: [] })] })).toBe('invalidModels')
  })
})

describe('provider selection and model lists', () => {
  it('waits for settings before selecting the official saved provider when presets arrive first', async () => {
    const f = await fixture()
    const settings = form<Settings>({ connections: { deepseek: { source: 'deepseek' } } })
    settings.publish({ status: 'loading', value: undefined })
    const controller = new Controller(settings.scope, f.defaults.scope, f.operations)
    controllers.push(controller)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().presets).toHaveLength(3) })
    expect(controller.store.getSnapshot().draft).toBeNull()
    settings.publish({ status: 'ready', value: { connections: { deepseek: { source: 'deepseek' } } } })
    expect(controller.store.getSnapshot().draft?.id).toBe('deepseek')
  })

  it('opens official DeepSeek with its default endpoint and offline model list', async () => {
    const f = await fixture()
    expect(f.state().draft).toMatchObject({ id: 'deepseek', kind: 'api', baseURL: 'https://api.deepseek.com', apiKey: '' })
    expect(f.operations.catalog).toHaveBeenCalledWith('deepseek')
    expect(f.state().candidates.map(model => model.id)).toEqual(['model-a', 'model-b'])
    expect(f.operations.discover).not.toHaveBeenCalled()
  })

  it('generates fresh custom IDs and uses Chat Completions without asking for implementation fields', async () => {
    const f = await fixture()
    f.controller.open()
    const first = f.state().draft?.id
    expect(first).toMatch(/^provider-[a-f0-9-]+$/)
    expect(f.state().draft?.api).toBe('openai-completions')
    await f.controller.refreshCredential()
    f.controller.edit({ baseURL: 'https://custom.example/v1', apiKey: 'key' })
    await f.controller.save()
    f.controller.open()
    expect(f.state().draft?.id).not.toBe(first)
  })

  it('retains dirty drafts and write-only key text across provider changes', async () => {
    const f = await fixture()
    f.controller.edit({ displayName: 'Retained', apiKey: 'new-key' })
    f.controller.open('work')
    f.controller.open('deepseek')
    expect(f.state().draft).toMatchObject({ displayName: 'Retained', apiKey: 'new-key', dirty: true })
  })

  it('restores an unsaved custom provider instead of abandoning its generated ID and key', async () => {
    const f = await fixture()
    f.controller.open()
    const id = f.state().draft?.id
    f.controller.edit({ baseURL: 'https://custom.example/v1', apiKey: 'retained-key' })
    f.controller.open('deepseek')
    f.controller.open()
    expect(f.state().draft).toMatchObject({ id, baseURL: 'https://custom.example/v1', apiKey: 'retained-key' })
  })

  it('live sync automatically adds candidates and preserves protocol, capacity, and reasoning metadata', async () => {
    const f = await fixture()
    f.controller.edit({ apiKey: 'draft-key' })
    await f.controller.discover()
    expect(f.operations.discover).toHaveBeenCalledWith({
      connectionId: 'deepseek', source: 'deepseek', baseURL: 'https://api.deepseek.com',
      api: 'openai-completions', apiKey: 'draft-key',
    }, expect.any(AbortSignal))
    expect(f.state().draft?.models).toEqual([modelDraft({
      id: 'synced', api: 'anthropic-messages', reasoning: true, contextWindow: 64000,
    })])
    expect(f.state().candidates[0]?.id).toBe('synced')
    expect(f.state().draft?.dirty).toBe(true)
  })

  it('keeps explicit checkbox selections limited to models in the synced list', async () => {
    const f = await fixture()
    f.controller.toggleModel('model-b', false)
    await f.controller.discover()
    expect(f.state().draft?.enabledModels).toEqual([])
    expect(f.state().candidates.map(model => model.id)).toEqual(['synced'])
  })

  it('writes checkbox selection as enabledModels and rejects defaults absent or disabled in the list', async () => {
    const f = await fixture()
    f.controller.toggleModel('model-a', false)
    expect(f.state().draft?.enabledModels).toEqual(['model-b'])
    await f.controller.save()
    const ops = vi.mocked(f.settings.scope.mutate).mock.calls[0]?.[0]
    expect(ops).toContainEqual({ op: 'set', path: ['connections', 'deepseek', 'enabledModels'], value: ['model-b'] })
    await f.controller.setDefault('deepseek', 'model-a')
    expect(f.state().error).toBe('invalidDefault')
    await f.controller.setDefault('deepseek', 'not-in-list')
    expect(f.defaults.scope.mutate).not.toHaveBeenCalled()
    await f.controller.setDefault('deepseek', 'model-b')
    expect(f.defaults.scope.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['provider'], value: 'dobee-deepseek' },
      { op: 'set', path: ['model'], value: 'model-b' },
      { op: 'unset', path: ['reasoningEffort'] },
    ], 3)
  })

  it('refuses default selection while a provider is disabled or the draft is unsaved', async () => {
    const f = await fixture()
    f.controller.edit({ enabled: false })
    await f.controller.setDefault('deepseek', 'model-a')
    expect(f.state().error).toBe('saveFirst')
    await f.controller.save()
    await f.controller.setDefault('deepseek', 'model-a')
    expect(f.state().error).toBe('invalidDefault')
  })

  it('retains models when sync fails', async () => {
    const f = await fixture({ discover: vi.fn(async () => { throw new Error('network') }) })
    await f.controller.discover()
    expect(f.state().candidates).toHaveLength(2)
    expect(f.state().error).toBe('syncFailed')
  })

  it('removes manual models from the list and preserves protocol metadata on the remaining declarations', async () => {
    const f = await fixture()
    await f.controller.discover()
    f.controller.edit({ models: [] })
    expect(f.state().candidates).toEqual([])
    f.controller.edit({ models: [modelDraft({ id: 'manual', api: 'openai-responses' })] })
    expect(f.state().candidates[0]?.id).toBe('manual')
    await f.controller.save()
    expect(vi.mocked(f.settings.scope.mutate).mock.calls[0]?.[0]).toContainEqual({
      op: 'set', path: ['connections', 'deepseek', 'models'], value: [{ id: 'manual', api: 'openai-responses' }],
    })
  })
})

describe('revision fences and credential retry', () => {
  it('mutates only owned fields, retaining stable saved IDs and Host-only image settings', async () => {
    const f = await fixture()
    f.controller.edit({ displayName: 'My DeepSeek' })
    expect(await f.controller.save()).toBe(true)
    const ops = vi.mocked(f.settings.scope.mutate).mock.calls[0]?.[0] ?? []
    expect(ops.every(op => op.path[0] === 'connections' && op.path[1] === 'deepseek' && op.path.length === 3)).toBe(true)
    expect(ops).toContainEqual({ op: 'set', path: ['connections', 'deepseek', 'apiKeyEnv'], value: 'SHARED_KEY' })
    expect(ops.some(op => op.path.includes('imagePixelBudget'))).toBe(false)
    expect(f.operations.setCredential).not.toHaveBeenCalled()
    expect(f.state().draft).toMatchObject({ id: 'deepseek', apiKey: '', dirty: false })
  })

  it('retains conflicts and retries only after an explicit save with the recovered revision', async () => {
    const f = await fixture()
    f.controller.edit({ apiKey: 'new-key', displayName: 'Retained' })
    vi.mocked(f.settings.scope.mutate).mockImplementationOnce(async () => {
      f.settings.publish({ revision: 4 })
      return false
    })
    expect(await f.controller.save()).toBe(false)
    expect(f.state().draft).toMatchObject({ displayName: 'Retained', apiKey: 'new-key', revision: 4, configCommitted: false })
    expect(f.operations.setCredential).not.toHaveBeenCalled()
    await f.controller.save()
    expect(vi.mocked(f.settings.scope.mutate).mock.calls[1]?.[1]).toBe(4)
  })

  it('retains failed writes and forbids a key write before configuration acceptance', async () => {
    const f = await fixture()
    f.controller.edit({ apiKey: 'new-key' })
    vi.mocked(f.settings.scope.mutate).mockRejectedValueOnce(new Error('write failed'))
    await f.controller.save()
    expect(f.state().draft?.apiKey).toBe('new-key')
    expect(f.operations.setCredential).not.toHaveBeenCalled()
    expect(f.state().error).toBe('failed')
  })

  it('retries only the credential and locks provider switching after the settings commit', async () => {
    const f = await fixture()
    f.controller.edit({ apiKey: 'new-key' })
    vi.mocked(f.operations.setCredential).mockResolvedValueOnce(false)
    await f.controller.save()
    expect(f.state().draft?.configCommitted).toBe(true)
    f.controller.edit({ displayName: 'Not allowed' })
    f.controller.open('work')
    f.controller.cancel()
    expect(f.state().draft?.id).toBe('deepseek')
    expect(f.state().draft?.displayName).toBe('')
    f.settings.publish({ writable: false })
    expect(await f.controller.save()).toBe(true)
    expect(f.settings.scope.mutate).toHaveBeenCalledTimes(1)
    expect(f.operations.setCredential).toHaveBeenCalledTimes(2)
    expect(f.state().draft?.apiKey).toBe('')
  })

  it('requires a key or configured credential, and never replaces a read-only credential', async () => {
    const f = await fixture({ describe: vi.fn(async () => ({ configured: false, writable: true })) })
    await f.controller.save()
    expect(f.state().error).toBe('keyRequired')
    expect(f.settings.scope.mutate).not.toHaveBeenCalled()
    vi.mocked(f.operations.describe).mockResolvedValue({ configured: true, writable: false })
    await f.controller.refreshCredential()
    f.controller.edit({ apiKey: 'replacement' })
    await f.controller.save()
    expect(f.state().error).toBe('credentialReadOnly')
  })

  it('retains shared credentials after confirmed provider deletion and retains rows on refusal', async () => {
    const f = await fixture()
    vi.mocked(f.settings.scope.mutate).mockResolvedValueOnce(false)
    expect(await f.controller.remove('deepseek')).toBe(false)
    expect(f.state().draft?.id).toBe('deepseek')
    expect(await f.controller.remove('deepseek')).toBe(true)
    expect(f.settings.scope.mutate).toHaveBeenLastCalledWith([{
      op: 'set', path: ['connections'], value: {
        work: { source: 'openai', baseURL: 'https://work.example/v1' }, copilot: { source: 'github-copilot', enabled: false },
      },
    }], 3)
    expect(f.operations.setCredential).not.toHaveBeenCalled()
    expect(f.operations.logout).not.toHaveBeenCalled()
  })

  it('does not delete the current default provider', async () => {
    const f = await fixture()
    f.defaults.publish({ value: { provider: 'dobee-deepseek', model: 'model-a' } })
    expect(await f.controller.remove('deepseek')).toBe(false)
    expect(f.state().error).toBe('changeDefault')
  })

  it('preserves unseen settings on other providers when deleting one connection', async () => {
    const f = await fixture()
    const other = { source: 'openai', imagePixelBudget: 1234, hostExtension: { futureSetting: true } }
    f.settings.publish({ value: { connections: { ...f.state().connections, other } } })
    await f.controller.remove('deepseek')
    expect(vi.mocked(f.settings.scope.mutate).mock.calls[0]?.[0]).toEqual([{
      op: 'set', path: ['connections'], value: { work: f.state().connections.work, copilot: f.state().connections.copilot, other },
    }])
  })
})

describe('subscription authorization', () => {
  it('saves a dormant subscription before login, shows device code, and syncs after authorization', async () => {
    const authorized = Promise.withResolvers<boolean>()
    const receivedCode = Promise.withResolvers<boolean>()
    const dispose = vi.fn()
    const stream: LoginStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'device-code', verificationUri: 'https://github.com/login/device', userCode: 'ABCD-1234', expiresAt: 9000 }
        receivedCode.resolve(true)
        await authorized.promise
        yield { type: 'authorized', account: 'octocat' }
      },
      dispose,
    }
    const f = await fixture({ login: vi.fn(async () => stream), status: vi.fn<Operations['status']>(async () => ({ status: 'signed-in', account: 'octocat' })) })
    f.controller.open(undefined, 'github-copilot')
    const id = f.state().draft?.id
    const task = f.controller.login()
    await receivedCode.promise
    expect(f.settings.scope.mutate).toHaveBeenCalledBefore(vi.mocked(f.operations.login))
    const written = vi.mocked(f.settings.scope.mutate).mock.calls[0]?.[0]?.[0]
    expect(written).toMatchObject({ op: 'set', value: { source: 'github-copilot', kind: 'subscription' } })
    expect(JSON.stringify(written)).not.toContain('apiKeyEnv')
    expect(JSON.stringify(written)).not.toContain('baseURL')
    expect(f.state().deviceCode?.userCode).toBe('ABCD-1234')
    authorized.resolve(true)
    await task
    expect(f.operations.discover).toHaveBeenCalledWith({ connectionId: id }, expect.any(AbortSignal))
    expect(f.state().subscription).toEqual({ status: 'signed-in', account: 'octocat' })
    expect(f.state().draft).toMatchObject({ enabled: true, dirty: false, apiKey: '' })
    expect(dispose).toHaveBeenCalledOnce()
    expect(f.operations.setCredential).not.toHaveBeenCalled()
  })

  it('restores account status from a saved subscription without querying credentials', async () => {
    const f = await fixture({ status: vi.fn<Operations['status']>(async () => ({ status: 'expired', account: 'octocat' })) })
    vi.mocked(f.operations.describe).mockClear()
    f.controller.open('copilot')
    await vi.waitFor(() => { expect(f.state().subscription?.status).toBe('expired') })
    expect(f.operations.describe).not.toHaveBeenCalled()
    await f.controller.discover()
    expect(f.operations.discover).toHaveBeenCalledWith({ connectionId: 'copilot' }, expect.any(AbortSignal))
    expect(f.state().error).toBeNull()
  })

  it('does not start device authorization when the initial subscription save is refused', async () => {
    const f = await fixture()
    f.controller.open(undefined, 'github-copilot')
    vi.mocked(f.settings.scope.mutate).mockResolvedValueOnce(false)
    await f.controller.login()
    expect(f.state().draft?.source).toBe('github-copilot')
    expect(f.state().error).toBe('conflict')
    expect(f.operations.login).not.toHaveBeenCalled()
    expect(f.state().deviceCode).toBeUndefined()
  })

  it('uses only the signed-in account’s live models, not declarations from a previous account', async () => {
    const f = await fixture({ status: vi.fn<Operations['status']>(async () => ({ status: 'signed-in', account: 'new-account' })) })
    f.settings.publish({ value: { connections: {
      ...f.state().connections, copilot: { source: 'github-copilot', models: [{ id: 'previous-account-model' }] },
    } } })
    f.controller.open('copilot')
    await vi.waitFor(() => { expect(f.state().subscription?.status).toBe('signed-in') })
    await f.controller.discover()
    expect(f.state().candidates.map(model => model.id)).toEqual(['synced'])
    expect(f.state().draft?.models.map(model => model.id)).toEqual(['synced'])
  })

  it('cancel waits for polling and stream disposal, and never syncs models', async () => {
    const started = Promise.withResolvers<boolean>()
    const dispose = vi.fn()
    const f = await fixture({
      login: vi.fn(async (_id: string, signal: AbortSignal) => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'device-code' as const, verificationUri: 'https://github.com/login/device', userCode: 'CODE', expiresAt: 9000 }
          started.resolve(true)
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
          yield { type: 'cancelled' as const }
        },
        dispose,
      })),
    })
    f.controller.open('copilot')
    const task = f.controller.login()
    await started.promise
    await f.controller.cancelLogin()
    await task
    expect(f.operations.cancelLogin).toHaveBeenCalledWith('copilot')
    expect(dispose).toHaveBeenCalledOnce()
    expect(f.state().loggingIn).toBe(false)
    expect(f.state().deviceCode).toBeUndefined()
    expect(f.operations.discover).not.toHaveBeenCalled()
  })

  it('surfaces terminal login errors and retains the provider for retry', async () => {
    const f = await fixture({ login: vi.fn(async () => ({
      async *[Symbol.asyncIterator]() { throw new Error('denied') },
      dispose: vi.fn(),
    })) })
    f.controller.open('copilot')
    await f.controller.login()
    expect(f.state().draft?.id).toBe('copilot')
    expect(f.state().error).toBe('loginFailed')
    expect(f.state().loggingIn).toBe(false)
  })

  it('signs out without exposing or replacing API credentials', async () => {
    let signedIn = true
    const f = await fixture({
      status: vi.fn<Operations['status']>(async () => ({ status: signedIn ? 'signed-in' : 'signed-out' })),
      logout: vi.fn(async () => { signedIn = false }),
    })
    f.controller.open('copilot')
    await vi.waitFor(() => { expect(f.state().subscription?.status).toBe('signed-in') })
    await f.controller.logout()
    expect(f.operations.logout).toHaveBeenCalledWith('copilot')
    expect(f.state().subscription?.status).toBe('signed-out')
    expect(f.state().candidates).toEqual([])
    expect(f.operations.setCredential).not.toHaveBeenCalled()
  })

  it('revokes the owned subscription grant before deleting its settings', async () => {
    const f = await fixture()
    f.controller.open('copilot')
    expect(await f.controller.remove('copilot')).toBe(true)
    expect(f.operations.logout).toHaveBeenCalledWith('copilot')
    expect(f.operations.logout).toHaveBeenCalledBefore(vi.mocked(f.settings.scope.mutate))
    expect(f.operations.setCredential).not.toHaveBeenCalled()
  })

  it('retains a subscription when grant removal fails, without deleting its settings', async () => {
    const f = await fixture({ logout: vi.fn(async () => { throw new Error('write failed') }) })
    f.controller.open('copilot')
    expect(await f.controller.remove('copilot')).toBe(false)
    expect(f.state().draft?.id).toBe('copilot')
    expect(f.settings.scope.mutate).not.toHaveBeenCalled()
  })

  it('keeps a signed-out subscription visible when settings deletion is refused', async () => {
    const f = await fixture({ status: vi.fn<Operations['status']>(async () => ({ status: 'signed-in', account: 'octocat' })) })
    f.controller.open('copilot')
    await vi.waitFor(() => { expect(f.state().subscription?.status).toBe('signed-in') })
    vi.mocked(f.settings.scope.mutate).mockResolvedValueOnce(false)
    expect(await f.controller.remove('copilot')).toBe(false)
    expect(f.state().draft?.id).toBe('copilot')
    expect(f.state().subscription?.status).toBe('signed-out')
  })

  it('fences deletion to the revision confirmed before subscription logout', async () => {
    const loggedOut = Promise.withResolvers<undefined>()
    const f = await fixture({ logout: vi.fn(() => loggedOut.promise) })
    f.controller.open('copilot')
    vi.mocked(f.settings.scope.mutate).mockResolvedValueOnce(false)
    const deleting = f.controller.remove('copilot')
    f.settings.publish({ revision: 4 })
    loggedOut.resolve(undefined)
    expect(await deleting).toBe(false)
    expect(vi.mocked(f.settings.scope.mutate).mock.calls[0]?.[1]).toBe(3)
    expect(f.state().error).toBe('conflict')
  })
})

describe('selection and teardown races', () => {
  it('keeps live-sync results when an older offline catalog read completes afterward', async () => {
    const catalog = Promise.withResolvers<Awaited<ReturnType<Operations['catalog']>>>()
    const f = await fixture()
    vi.mocked(f.operations.catalog).mockReturnValueOnce(catalog.promise)
    f.controller.open('work')
    await f.controller.discover()
    catalog.resolve([{ id: 'outdated-catalog' }])
    await vi.waitFor(() => { expect(f.state().catalogLoading).toBe(false) })
    expect(f.state().candidates.map(model => model.id)).toEqual(['synced'])
  })

  it('ignores stale catalog and credential replies after selecting another provider', async () => {
    const catalog = Promise.withResolvers<Awaited<ReturnType<Operations['catalog']>>>()
    const credential = Promise.withResolvers<Awaited<ReturnType<Operations['describe']>>>()
    const f = await fixture()
    vi.mocked(f.operations.catalog).mockReturnValueOnce(catalog.promise)
    vi.mocked(f.operations.describe).mockReturnValueOnce(credential.promise)
    f.controller.open('work')
    f.controller.open('copilot')
    catalog.resolve([{ id: 'stale' }])
    credential.resolve({ configured: true, writable: false })
    await catalog.promise
    await credential.promise
    await vi.waitFor(() => { expect(f.state().catalogLoading).toBe(false) })
    expect(f.state().draft?.id).toBe('copilot')
    expect(f.state().candidates.some(model => model.id === 'stale')).toBe(false)
    expect(f.state().credential).toBeUndefined()
  })

  it('ignores a late config completion and withdraws both form listeners during disposal', async () => {
    const accepted = Promise.withResolvers<boolean>()
    const f = await fixture()
    vi.mocked(f.settings.scope.mutate).mockReturnValueOnce(accepted.promise)
    f.controller.edit({ apiKey: 'never-write' })
    const save = f.controller.save()
    const disposed = f.controller.dispose()
    accepted.resolve(true)
    await disposed
    await save
    expect(f.operations.setCredential).not.toHaveBeenCalled()
    expect(f.state().draft).toBeNull()
    expect(f.settings.listeners.size).toBe(0)
    expect(f.defaults.listeners.size).toBe(0)
  })

  it('aborts live model sync and waits for the remote request before completing disposal', async () => {
    const response = Promise.withResolvers<Awaited<ReturnType<Operations['discover']>>>()
    const aborted = Promise.withResolvers<boolean>()
    const f = await fixture({
      discover: vi.fn((_request, signal: AbortSignal) => {
        signal.addEventListener('abort', () => { aborted.resolve(true) }, { once: true })
        return response.promise
      }),
    })
    const syncing = f.controller.discover()
    let completed = false
    const disposing = f.controller.dispose().then(() => { completed = true })
    await aborted.promise
    expect(completed).toBe(false)
    response.resolve([{ id: 'late' }])
    await Promise.all([syncing, disposing])
    expect(completed).toBe(true)
    expect(f.state().draft).toBeNull()
    expect(f.state().candidates.some(model => model.id === 'late')).toBe(false)
    f.controller.open('deepseek')
    expect(f.state().draft).toBeNull()
  })
})
