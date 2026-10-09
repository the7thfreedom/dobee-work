// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Section, OutcomeToast } from '../src/client/Section.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Draft, State } from '../src/client/controller.ts'
import type {} from '../src/client/mount.ts'

afterEach(cleanup)

function editor(patch: Partial<Draft> = {}): Draft {
  return {
    id: 'deepseek', originalId: 'deepseek', source: 'deepseek', kind: 'api',
    enabled: true, enabledModels: null, displayName: '', baseURL: 'https://api.deepseek.com',
    apiKeyEnv: 'SHARED_KEY', apiKey: '', timeoutMs: '', models: [],
    revision: 3, configCommitted: false, dirty: false, ...patch,
  }
}

function fixture(patch: Partial<State> = {}, chinese = false) {
  const state: State = {
    status: 'ready', writable: true, connections: {
      deepseek: { source: 'deepseek', apiKeyEnv: 'SHARED_KEY' },
      work: { source: 'openai', displayName: 'Work gateway' },
    }, presets: [
      { source: 'deepseek', kind: 'api', baseURL: 'https://api.deepseek.com' },
      { source: 'openai', kind: 'api', baseURL: 'https://api.openai.com/v1' },
      { source: 'anthropic', kind: 'api', baseURL: 'https://api.anthropic.com' },
      { source: 'google', kind: 'api', baseURL: 'https://generativelanguage.googleapis.com' },
      { source: 'github-copilot', kind: 'subscription' },
    ], defaultWritable: true, draft: editor(), credentialLoading: false, credential: { configured: true, writable: true },
    candidates: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b' }], catalogLoading: false,
    loggingIn: false, busy: false, error: null, toast: null, ...patch,
  }
  const dictionary: Record<string, string> = chinese ? zh : en
  const t: TranslateNS<'dobee.modelProviders'> = key => dictionary[key] ?? key
  const props = {
    t, useConnections: (selector: (value: State) => unknown) => selector(state),
    open: vi.fn(), edit: vi.fn(), cancel: vi.fn(), save: vi.fn(async () => true),
    discover: vi.fn(async () => {}), remove: vi.fn(async () => true), setDefault: vi.fn(async () => {}),
    toggleModel: vi.fn(), login: vi.fn(async () => {}), cancelLogin: vi.fn(async () => {}),
    logout: vi.fn(async () => {}), loadPresets: vi.fn(async () => {}), refreshInfo: vi.fn(async () => {}),
    refreshCredential: vi.fn(async () => {}), dismiss: vi.fn(), close: vi.fn(),
  } as ComponentProps<typeof Section>
  return { state, props }
}

describe('two-pane provider settings', () => {
  it.each([false, true])('shows Endpoint and write-only API Key, not internal IDs or credential references (Chinese: %s)', (chinese) => {
    const f = fixture({}, chinese)
    render(<Section {...f.props} />)
    const copy = chinese ? zh : en
    expect(screen.getByRole('textbox', { name: copy.baseURL })).toHaveProperty('value', 'https://api.deepseek.com')
    expect(screen.getByLabelText(copy.key)).toHaveProperty('type', 'password')
    expect(screen.getByLabelText(copy.key)).toHaveProperty('value', '')
    expect(screen.queryByText('Connection ID')).toBeNull()
    expect(screen.queryByText('连接 ID')).toBeNull()
    expect(screen.queryByText('Provider source')).toBeNull()
    expect(screen.queryByText('Credential reference')).toBeNull()
    expect(screen.queryByText('SHARED_KEY')).toBeNull()
    expect(screen.queryByText('dobee-deepseek')).toBeNull()
  })

  it('searches presets and saved names from the persistent sidebar', () => {
    const f = fixture()
    render(<Section {...f.props} />)
    fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'Gemini' } })
    const sidebar = screen.getByRole('complementary', { name: en.providers })
    expect(within(sidebar).queryByRole('button', { name: 'DeepSeek' })).toBeNull()
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Google Gemini' }))
    expect(f.props.open).toHaveBeenCalledWith(undefined, 'google')
    fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'work' } })
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Work gateway' }))
    expect(f.props.open).toHaveBeenCalledWith('work')
  })

  it('filters API and Subscription providers without offering unimplemented login providers', () => {
    const f = fixture()
    render(<Section {...f.props} />)
    const sidebar = screen.getByRole('complementary', { name: en.providers })
    fireEvent.click(within(sidebar).getByRole('button', { name: en.subscription }))
    expect(within(sidebar).queryByRole('button', { name: 'DeepSeek' })).toBeNull()
    fireEvent.click(within(sidebar).getByRole('button', { name: 'GitHub Copilot' }))
    expect(f.props.open).toHaveBeenCalledWith(undefined, 'github-copilot')
    expect(within(sidebar).queryByText('Claude Code')).toBeNull()
    expect(within(sidebar).queryByText('Codex')).toBeNull()
  })

  it('adds a custom provider without an ID form and stages enabled/name changes', () => {
    const f = fixture()
    render(<Section {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.addCustom }))
    expect(f.props.open).toHaveBeenCalledWith()
    fireEvent.click(screen.getByRole('switch', { name: en.enabled }))
    expect(f.props.edit).toHaveBeenCalledWith({ enabled: false })
    fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: 'Personal' } })
    expect(f.props.edit).toHaveBeenCalledWith({ displayName: 'Personal' })
  })

  it('shows synced models directly with checkboxes and default actions, never an editable default ID', () => {
    const f = fixture()
    render(<Section {...f.props} />)
    const model = screen.getByRole('checkbox', { name: 'Model A' })
    expect(model).toHaveProperty('checked', true)
    fireEvent.click(model)
    expect(f.props.toggleModel).toHaveBeenCalledWith('model-a', false)
    fireEvent.click(screen.getAllByRole('button', { name: en.setDefault })[0]!)
    expect(f.props.setDefault).toHaveBeenCalledWith('deepseek', 'model-a')
    expect(screen.queryByRole('textbox', { name: 'Default model ID' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.discover }))
    expect(f.props.discover).toHaveBeenCalledOnce()
  })

  it('disables default actions for unchecked models, disabled providers, and unsaved changes', () => {
    const f = fixture({ draft: editor({ enabledModels: ['model-b'] }) })
    const view = render(<Section {...f.props} />)
    expect(screen.getAllByRole('button', { name: en.setDefault })[0]).toHaveProperty('disabled', true)
    f.state.draft = editor({ dirty: true })
    view.rerender(<Section {...f.props} />)
    expect(screen.getAllByRole('button', { name: en.setDefault }).every(button => button.hasAttribute('disabled'))).toBe(true)
    f.state.draft = editor({ enabled: false })
    view.rerender(<Section {...f.props} />)
    expect(screen.getAllByRole('button', { name: en.setDefault }).every(button => button.hasAttribute('disabled'))).toBe(true)
  })

  it('retains the editor and models beside a failed sync notice', () => {
    const f = fixture({ error: 'syncFailed' })
    render(<Section {...f.props} />)
    expect(screen.getByRole('alert').textContent).toBe(en.syncFailed)
    expect(screen.getByRole('checkbox', { name: 'Model A' })).toBeDefined()
    expect(screen.getByRole('textbox', { name: en.baseURL })).toHaveProperty('value', 'https://api.deepseek.com')
  })

  it('keeps protocol and manual model capacity controls in advanced settings', () => {
    const f = fixture({ draft: editor({ models: [{ id: 'manual', name: '', contextWindow: '', maxTokens: '' }] }) })
    render(<Section {...f.props} />)
    const advanced = screen.getByText(en.advanced).closest('details')
    expect(advanced?.hasAttribute('open')).toBe(false)
    expect(screen.getByRole('textbox', { name: en.modelId, hidden: true })).toHaveProperty('value', 'manual')
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI Responses', hidden: true }))
    expect(f.props.edit).toHaveBeenCalledWith({ api: 'openai-responses' })
    expect(screen.getByRole('textbox', { name: en.context, hidden: true })).toBeDefined()
  })

  it('requires deletion confirmation and keeps the dialog open if deletion fails', async () => {
    const f = fixture()
    vi.mocked(f.props.remove).mockResolvedValueOnce(false)
    render(<Section {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: en.acknowledge }))
    fireEvent.click(within(dialog).getByRole('button', { name: en.remove }))
    await vi.waitFor(() => { expect(f.props.remove).toHaveBeenCalledWith('deepseek') })
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('retains a credential-only retry even after settings become read-only', () => {
    const f = fixture({ writable: false, draft: editor({ configCommitted: true, apiKey: 'pending-key' }) })
    render(<Section {...f.props} />)
    expect(screen.getByRole('button', { name: en.retryKey })).toHaveProperty('disabled', false)
    expect(screen.getByRole('textbox', { name: en.baseURL })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.discard })).toHaveProperty('disabled', true)
  })
})

describe('subscription account panel', () => {
  function subscription(patch: Partial<State> = {}) {
    return fixture({ draft: editor({
      id: 'copilot', originalId: 'copilot', source: 'github-copilot', kind: 'subscription', baseURL: '', apiKeyEnv: '',
    }), subscription: { status: 'signed-out' }, ...patch })
  }

  it('shows sign-in rather than endpoint, key, protocol, or token fields', () => {
    const f = subscription()
    render(<Section {...f.props} />)
    expect(screen.queryByRole('textbox', { name: en.baseURL })).toBeNull()
    expect(screen.queryByLabelText(en.key)).toBeNull()
    expect(screen.queryByText(en.advanced)).toBeNull()
    expect(screen.queryByText('Copilot token')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.login }))
    expect(f.props.login).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: en.discover })).toHaveProperty('disabled', true)
  })

  it('shows a selectable device code, browser verification link, and cancel action', () => {
    const f = subscription({ loggingIn: true, deviceCode: {
      type: 'device-code', verificationUri: 'https://github.com/login/device', userCode: 'ABCD-1234', expiresAt: 9000,
    } })
    render(<Section {...f.props} />)
    expect(screen.getByText('ABCD-1234')).toBeDefined()
    const link = screen.getByRole('link', { name: en.openVerification })
    expect(link.getAttribute('href')).toBe('https://github.com/login/device')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    fireEvent.click(screen.getByRole('button', { name: en.cancelLogin }))
    expect(f.props.cancelLogin).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('restores a signed-in account with sign-out and live model sync', () => {
    const f = subscription({ subscription: { status: 'signed-in', account: 'octocat' } })
    render(<Section {...f.props} />)
    expect(screen.getByText('octocat')).toBeDefined()
    expect(screen.getByRole('button', { name: en.discover })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    expect(f.props.logout).toHaveBeenCalledOnce()
  })

  it('shows expired authorization and invites sign-in again', () => {
    const f = subscription({ subscription: { status: 'expired', account: 'octocat' } })
    render(<Section {...f.props} />)
    expect(screen.getByText(en.accountExpired)).toBeDefined()
    expect(screen.getByRole('button', { name: en.reauthorize })).toBeDefined()
    expect(screen.getByRole('button', { name: en.discover })).toHaveProperty('disabled', false)
  })
})

it('renders operation outcomes in the shell overlay', () => {
  const f = fixture({ toast: { key: 'signedIn', success: true, sequence: 1 } })
  const props = { ...f.props } as ComponentProps<typeof OutcomeToast>
  render(<OutcomeToast {...props} />)
  expect(screen.getByText(en.signedIn)).toBeDefined()
})
