/** Searchable provider sidebar, API or subscription details, and shell-owned feedback. */
import { useState } from 'react'
import {
  Button, Checkbox, Input, RiskConfirmation, Switch, Toast, IconLoadingOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PROTOCOLS, modelDraft, providerRoute } from './controller.ts'
import { matchesPreset, protocolLabel, sourceLabel } from './presentation.ts'
import type { Controller, Draft, ModelDraft, State } from './controller.ts'
import type { LocaleKey } from './locales.ts'
import css from './Section.module.css'

/** Observable and plain callbacks bound by the slot renderer. */
export interface Face {
  hooks: { connections: SnapshotStore<State> }
  open: Controller['open']
  edit: Controller['edit']
  cancel: Controller['cancel']
  save: Controller['save']
  discover: Controller['discover']
  remove: Controller['remove']
  setDefault: Controller['setDefault']
  toggleModel: Controller['toggleModel']
  login: Controller['login']
  cancelLogin: Controller['cancelLogin']
  logout: Controller['logout']
  loadPresets: Controller['loadPresets']
  refreshInfo: Controller['refreshInfo']
  refreshCredential: Controller['refreshCredential']
  dismiss: Controller['dismiss']
}

type Localized = PropsLocale<'dobee.modelProviders'>
type SectionProps = PropsRuntime<'settings.section'> & InjectFace<Face> & Localized

function ModelFields({ model, onChange, t, disabled }: {
  model: ModelDraft
  onChange: (model: ModelDraft) => void
  t: Localized['t']
  disabled: boolean
}) {
  const field = (key: 'id' | 'name' | 'contextWindow' | 'maxTokens', label: LocaleKey) => (
    <label className={css.field}>
      <span>{t(label)}</span>
      <Input value={model[key]} disabled={disabled}
        inputMode={key === 'contextWindow' || key === 'maxTokens' ? 'numeric' : 'text'}
        onChange={(event) => { onChange({ ...model, [key]: event.currentTarget.value }) }} />
    </label>
  )
  return <div className={css.modelFields}>
    <div className={css.grid}>
      {field('id', 'modelId')}{field('name', 'modelName')}
      {field('contextWindow', 'context')}{field('maxTokens', 'output')}
    </div>
    <Checkbox checked={model.input === undefined} disabled={disabled} label={t('inheritInput')}
      onChange={(checked) => { onChange({ ...model, input: checked ? undefined : ['text'] }) }} />
    {model.input !== undefined && <div className={css.actions}>
      {(['text', 'image'] as const).map(input => <Checkbox key={input}
        checked={model.input?.includes(input) ?? false} disabled={disabled} label={t(input)}
        onChange={(checked) => {
          const values = model.input ?? []
          onChange({ ...model, input: checked ? [...values, input] : values.filter(value => value !== input) })
        }} />)}
    </div>}
    <div className={css.actions} role="group" aria-label={t('reasoning')}>
      {([undefined, true, false] as const).map(value => <Button key={String(value)} size="sm"
        disabled={disabled} aria-pressed={model.reasoning === value}
        variant={model.reasoning === value ? 'outline' : 'ghost'}
        onClick={() => { onChange({ ...model, reasoning: value }) }}>
        {t(value === undefined ? 'inheritReasoning' : value ? 'yes' : 'no')}
      </Button>)}
    </div>
  </div>
}

function Advanced({ draft, edit, locked, t }: {
  draft: Draft
  edit: Controller['edit']
  locked: boolean
  t: Localized['t']
}) {
  return <details className={css.advanced}>
    <summary>{t('advanced')}</summary>
    <div className={css.modelFields}>
      <div className={css.actions} role="group" aria-label={t('api')}>
        {PROTOCOLS.map(api => <Button key={api} disabled={locked} size="sm"
          aria-pressed={draft.api === api} variant={draft.api === api ? 'outline' : 'ghost'}
          onClick={() => { edit({ api }) }}>{protocolLabel(api, t)}</Button>)}
      </div>
      <label className={css.field}>
        <span>{t('timeout')}</span>
        <Input value={draft.timeoutMs} inputMode="numeric" disabled={locked}
          onChange={(event) => { edit({ timeoutMs: event.currentTarget.value }) }} />
      </label>
      <p className={css.hint}>{t('manualHint')}</p>
      {draft.models.map((model, index) => <div className={css.card} key={index}>
        <ModelFields model={model} disabled={locked} t={t}
          onChange={(next) => { edit({ models: draft.models.map((current, i) => i === index ? next : current) }) }} />
        <Button disabled={locked} size="sm"
          onClick={() => { edit({ models: draft.models.filter((_, i) => i !== index) }) }}>{t('removeModel')}</Button>
      </div>)}
      <Button disabled={locked} variant="outline"
        onClick={() => { edit({ models: [...draft.models, modelDraft({ id: '' })] }) }}>{t('addModel')}</Button>
    </div>
  </details>
}

/**
 * Render a two-pane provider editor without internal ID, source, or credential-reference fields.
 * @param props - framework-bound state, actions, and locale.
 * @returns provider settings and confirmed deletion.
 */
export function Section(props: SectionProps) {
  const { t } = props
  const state = props.useConnections(value => value)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'api' | 'subscription'>('all')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const draft = state.draft
  const locked = state.busy || state.loggingIn || draft?.configCommitted === true || !state.writable
  const canSelect = !state.busy && !state.loggingIn && draft?.configCommitted !== true
  const hasAccount = state.subscription !== undefined && state.subscription.status !== 'signed-out'
  const visibleSaved = Object.entries(state.connections).filter(([, connection]) => {
    const kind = connection.source === 'github-copilot' ? 'subscription' : connection.kind ?? 'api'
    const label = connection.displayName || sourceLabel(connection.source, t) || t('custom')
    return (filter === 'all' || filter === kind) && (
      [label, connection.baseURL ?? ''].join(' ').toLowerCase().includes(search.trim().toLowerCase())
      || matchesPreset(connection.source ?? '', search, t))
  })
  const visiblePresets = state.presets.filter(preset => (filter === 'all' || filter === preset.kind)
    && !Object.values(state.connections).some(connection => connection.source === preset.source)
    && matchesPreset(preset.source, search, t))
  if (state.status === 'loading') return <div className={css.loading}><IconLoadingOutlineRegular className={css.spinner} /></div>
  return <section className={css.section}>
    <div className={css.panes}>
      <aside className={css.sidebar} aria-label={t('providers')}>
        <Input aria-label={t('search')} placeholder={t('search')} value={search}
          onChange={(event) => { setSearch(event.currentTarget.value) }} />
        <div className={css.filters} role="group" aria-label={t('providerKind')}>
          {(['all', 'api', 'subscription'] as const).map(kind => <Button key={kind} size="sm"
            aria-pressed={filter === kind} variant={filter === kind ? 'outline' : 'ghost'}
            onClick={() => { setFilter(kind) }}>{t(kind)}</Button>)}
        </div>
        <div className={css.providerList}>
          {draft?.originalId === undefined && draft?.source === '' && filter !== 'subscription' &&
            <Button className={css.provider} variant="outline" aria-pressed={true} disabled={!canSelect}
              onClick={() => { props.open() }}>{draft.displayName || t('custom')}</Button>}
          {visibleSaved.map(([id, connection]) => <Button key={id} className={css.provider}
            variant={draft?.id === id ? 'outline' : 'ghost'} aria-pressed={draft?.id === id}
            disabled={!canSelect} onClick={() => { props.open(id) }}>
            <span className={css.providerName}>{connection.displayName || sourceLabel(connection.source, t) || t('custom')}</span>
            {!connection.displayName && sourceLabel(connection.source, t) === undefined &&
              connection.baseURL !== undefined && <span className={css.badge}>{connection.baseURL}</span>}
            {connection.enabled === false && <span className={css.badge}>{t('disabled')}</span>}
          </Button>)}
          {visiblePresets.map(preset => <Button key={preset.source} className={css.provider}
            variant={draft?.originalId === undefined && draft?.source === preset.source ? 'outline' : 'ghost'}
            aria-pressed={draft?.originalId === undefined && draft?.source === preset.source}
            disabled={!canSelect} onClick={() => { props.open(undefined, preset.source) }}>
            <span className={css.providerName}>{sourceLabel(preset.source, t) || preset.source}</span>
          </Button>)}
          {visibleSaved.length + visiblePresets.length === 0 && <p className={css.hint}>{t('noProviders')}</p>}
        </div>
        <Button variant="outline" disabled={!canSelect || !state.writable}
          onClick={() => { setFilter('api'); setSearch(''); props.open() }}>{t('addCustom')}</Button>
      </aside>
      <div className={css.detail}>
        {!state.writable && <p className={css.hint}>{t('unavailable')}</p>}
        {draft === null ? <>
          <p className={css.hint}>{t('selectProvider')}</p>
          {state.error !== null && <p role="alert" className={css.error}>{t(state.error)}</p>}
          {state.error === 'catalogFailed' && <Button onClick={() => { void props.loadPresets() }}>{t('retry')}</Button>}
        </> : <>
          <div className={css.detailHeader}>
            <h2 className={css.heading}>{draft.displayName || sourceLabel(draft.source, t) || t('custom')}</h2>
            <Switch checked={draft.enabled} disabled={locked} label={t('enabled')}
              onChange={(enabled) => { props.edit({ enabled }) }} />
          </div>
          <div className={css.actions}><span className={css.badge}>{t(draft.kind)}</span></div>
          <label className={css.field}>
            <span>{t('name')}</span>
            <Input value={draft.displayName} disabled={locked} placeholder={t('optionalName')}
              onChange={(event) => { props.edit({ displayName: event.currentTarget.value }) }} />
          </label>
          {draft.kind === 'api' ? <>
            <label className={css.field}>
              <span>{t('baseURL')}</span>
              <Input value={draft.baseURL} disabled={locked} type="url"
                onChange={(event) => { props.edit({ baseURL: event.currentTarget.value }) }} />
            </label>
            <label className={css.field}>
              <span>{t('key')}</span>
              <Input type="password" autoComplete="new-password" value={draft.apiKey}
                placeholder={state.credential?.configured ? t('keepKey') : t('enterKey')}
                disabled={state.busy || state.loggingIn || state.credentialLoading
                  || (!draft.configCommitted && !state.writable)
                  || (state.credential?.writable === false && draft.apiKey === '')}
                onChange={(event) => { props.edit({ apiKey: event.currentTarget.value }) }} />
            </label>
            <p className={css.hint}>{t('keyHint')}</p>
            <div className={css.credentialStatus}>
              <span className={css.hint}>{t(state.credentialLoading ? 'checkingCredential'
                : state.credential === undefined ? 'unknown' : state.credential.configured ? 'configured' : 'missing')}</span>
              {!state.credentialLoading && state.credential === undefined &&
                <Button size="sm" disabled={state.busy} onClick={() => { void props.refreshCredential() }}>{t('retry')}</Button>}
            </div>
            {draft.configCommitted && <p className={css.hint}>{t('pendingCredential')}</p>}
          </> : <>
            <div className={css.card}>
              <p className={css.hint}>{t(state.subscription?.status === 'signed-in' ? 'accountSignedIn'
                : state.subscription?.status === 'expired' ? 'accountExpired' : 'accountSignedOut')}</p>
              {state.subscription?.account !== undefined && <span>{state.subscription.account}</span>}
              {state.deviceCode !== undefined && <div className={css.deviceCode}>
                <p className={css.hint}>{t('deviceHint')}</p>
                <a href={state.deviceCode.verificationUri} target="_blank" rel="noreferrer">{t('openVerification')}</a>
                <span>{t('deviceCode')}</span><code>{state.deviceCode.userCode}</code>
              </div>}
              <div className={css.actions}>
                {state.loggingIn ? <Button onClick={() => { void props.cancelLogin() }}>{t('cancelLogin')}</Button>
                  : <Button variant="primary" disabled={locked} onClick={() => { void props.login() }}>
                    {t(hasAccount ? 'reauthorize' : 'login')}
                  </Button>}
                {!state.loggingIn && state.subscription?.status !== undefined && state.subscription.status !== 'signed-out'
                  && <Button disabled={locked} onClick={() => { void props.logout() }}>{t('logout')}</Button>}
              </div>
            </div>
          </>}
          <div className={css.detailHeader}>
            <h3 className={css.heading}>{t('models')}</h3>
            <Button disabled={locked || (draft.kind === 'subscription' && !hasAccount)}
              onClick={() => { void props.discover() }}>{t('discover')}</Button>
          </div>
          {state.catalogLoading && state.candidates.length === 0
            ? <div className={css.skeleton} aria-label={t('models')} />
            : <div className={css.models}>
              {state.candidates.length === 0 && <p className={css.hint}>{t('noModels')}</p>}
              {state.candidates.map((model) => {
                const enabled = draft.enabledModels === null || draft.enabledModels.includes(model.id)
                const isDefault = state.defaultModel?.provider === providerRoute(draft.id) && state.defaultModel.model === model.id
                return <div key={model.id} className={css.modelRow}>
                  <div className={css.modelName}>
                    <Checkbox checked={enabled} label={model.name || model.id} disabled={locked}
                      onChange={(checked) => { props.toggleModel(model.id, checked) }} />
                    {model.name !== undefined && model.name !== model.id && <span className={css.hint}>{model.id}</span>}
                  </div>
                  <Button size="sm" variant="ghost" disabled={locked || !state.defaultWritable || !draft.enabled || !enabled
                    || draft.originalId === undefined || draft.dirty || isDefault
                    || (draft.kind === 'subscription' && !hasAccount)}
                  onClick={() => { void props.setDefault(draft.id, model.id) }}>{t(isDefault ? 'default' : 'setDefault')}</Button>
                </div>
              })}
            </div>}
          <p className={css.hint}>{t('modelsHint')}</p>
          {draft.kind === 'api' && <Advanced draft={draft} edit={props.edit} locked={locked} t={t} />}
          <div className={css.notice} aria-live="polite">
            {state.error !== null && <p role="alert" className={css.error}>{t(state.error)}</p>}
            {(state.error === 'catalogFailed' || state.error === 'accountFailed') &&
              <Button disabled={locked} onClick={() => { void props.refreshInfo() }}>{t('retry')}</Button>}
          </div>
          <div className={css.actions}>
            <Button variant="primary" disabled={state.busy || state.loggingIn || state.credentialLoading
              || (!draft.configCommitted && !state.writable)}
            onClick={() => { void props.save() }}>{t(draft.configCommitted ? 'retryKey' : 'save')}</Button>
            <Button disabled={locked || !draft.dirty} onClick={props.cancel}>{t('discard')}</Button>
            {draft.originalId !== undefined && <Button disabled={locked}
              onClick={() => { setAcknowledged(false); setRemoveId(draft.id) }}>{t('remove')}</Button>}
          </div>
        </>}
      </div>
    </div>
    <RiskConfirmation open={removeId !== null} title={t('deleteTitle')} description={t('deleteHint')}
      acknowledgeLabel={t('acknowledge')} acknowledged={acknowledged} onAcknowledgedChange={setAcknowledged}
      disabled={state.busy} confirmLabel={t('remove')} cancelLabel={t('cancel')} closeLabel={t('close')}
      onCancel={() => { if (!state.busy) setRemoveId(null) }}
      onConfirm={() => {
        if (removeId !== null) void props.remove(removeId).then((removed) => { if (removed) setRemoveId(null) })
      }} />
  </section>
}

/**
 * Preserve feedback after the Settings panel closes.
 * @param props - framework state and localized copy.
 * @returns a transient outcome toast, or nothing.
 */
export function OutcomeToast(props: PropsRuntime<'shell.overlay'> & InjectFace<Face> & Localized) {
  const toast = props.useConnections(value => value.toast)
  return toast === null ? null : <Toast key={toast.sequence} text={props.t(toast.key)} onDone={props.dismiss}
    {...toast.success ? { tone: 'success' as const } : {}} />
}
