/** Localized brands and searchable aliases keyed by unchanged Host source IDs. */
import type { LocaleKey } from './locales.ts'
import { connectionOf, connectionTarget } from './controller.ts'
import type { PROTOCOLS, State } from './controller.ts'

const presets: Record<string, { label: LocaleKey; aliases: LocaleKey }> = {
  openai: { label: 'presetLabel.openai', aliases: 'presetAliases.openai' },
  anthropic: { label: 'presetLabel.anthropic', aliases: 'presetAliases.anthropic' },
  google: { label: 'presetLabel.google', aliases: 'presetAliases.google' },
  deepseek: { label: 'presetLabel.deepseek', aliases: 'presetAliases.deepseek' },
  qwen: { label: 'presetLabel.qwen', aliases: 'presetAliases.qwen' },
  doubao: { label: 'presetLabel.doubao', aliases: 'presetAliases.doubao' },
  zai: { label: 'presetLabel.zai', aliases: 'presetAliases.zai' },
  'moonshotai-cn': { label: 'presetLabel.moonshotai-cn', aliases: 'presetAliases.moonshotai-cn' },
  moonshotai: { label: 'presetLabel.moonshotai', aliases: 'presetAliases.moonshotai' },
  'minimax-cn': { label: 'presetLabel.minimax-cn', aliases: 'presetAliases.minimax-cn' },
  minimax: { label: 'presetLabel.minimax', aliases: 'presetAliases.minimax' },
  openrouter: { label: 'presetLabel.openrouter', aliases: 'presetAliases.openrouter' },
  siliconflow: { label: 'presetLabel.siliconflow', aliases: 'presetAliases.siliconflow' },
  'github-copilot': { label: 'presetLabel.github-copilot', aliases: 'presetAliases.github-copilot' },
}

const protocols: Record<typeof PROTOCOLS[number], LocaleKey> = {
  'openai-completions': 'protocolLabel.openai-completions',
  'openai-responses': 'protocolLabel.openai-responses',
  'anthropic-messages': 'protocolLabel.anthropic-messages',
}

/**
 * Resolve a known source's localized product brand.
 * @param source - stable Host source ID, if configured.
 * @param t - locale-bound dictionary lookup.
 * @returns localized brand, or undefined for a custom or unlisted source.
 */
export function sourceLabel(source: string | undefined, t: (key: LocaleKey) => string): string | undefined {
  const copy = source === undefined || !Object.hasOwn(presets, source) ? undefined : presets[source]
  return copy === undefined ? undefined : t(copy.label)
}

/**
 * Match a source ID, localized brand, or useful brand alias.
 * @param source - source preset ID.
 * @param query - user-entered search text.
 * @param t - locale-bound dictionary lookup.
 * @returns whether the preset matches the case-insensitive search.
 */
export function matchesPreset(source: string, query: string, t: (key: LocaleKey) => string): boolean {
  const copy = Object.hasOwn(presets, source) ? presets[source] : undefined
  const terms = [source, ...(copy === undefined ? [] : [t(copy.label), t(copy.aliases)])]
  return terms.join(' ').toLowerCase().includes(query.trim().toLowerCase())
}

/**
 * Display a protocol's product name without changing its stored identifier.
 * @param protocol - accepted Host protocol ID.
 * @param t - locale-bound dictionary lookup.
 * @returns localized product name.
 */
export function protocolLabel(protocol: typeof PROTOCOLS[number], t: (key: LocaleKey) => string): string {
  return t(protocols[protocol])
}

/**
 * Project saved access and live model-interface verification into one readiness mark.
 * @param state - current editor and retained provider checks.
 * @param id - saved or staged provider ID; absent for an unopened preset.
 * @returns green for verified readiness, red for enabled but not ready, or grey for disabled/unconfigured.
 */
export function providerReadiness(state: State, id: string | undefined): {
  state: 'done' | 'error' | 'idle'
  label: LocaleKey
} {
  const draft = state.draft?.id === id ? state.draft : null
  const saved = id === undefined ? undefined : state.connections[id]
  if (id === undefined || (saved === undefined && draft?.originalId === undefined)) {
    return { state: 'idle', label: 'notConfigured' }
  }
  const connection = draft === null ? saved : connectionOf(draft)
  if (connection === undefined) return { state: 'idle', label: 'notConfigured' }
  if (connection.enabled === false) return { state: 'idle', label: 'disabled' }
  if (draft?.dirty || draft?.configCommitted) return { state: 'error', label: 'providerUnsaved' }
  const check = state.checks[id]
  const matched = check?.target === connectionTarget(id, connection, state.presets)
  const subscription = connection.source === 'github-copilot' || connection.kind === 'subscription'
  if (subscription) {
    const account = draft === null ? check?.subscription : state.subscription ?? check?.subscription
    if (account?.status === 'signed-out') return { state: 'error', label: 'providerSignInRequired' }
    if (account?.status === 'expired') return { state: 'error', label: 'providerAccessExpired' }
    if (account?.status !== 'signed-in') return { state: 'error', label: 'providerUnverified' }
  } else {
    const credential = draft === null ? check?.credential : state.credential ?? check?.credential
    if (credential?.configured === false) return { state: 'error', label: 'providerMissingKey' }
    if (credential?.configured !== true) {
      return { state: 'error', label: state.credentialLoading && draft !== null ? 'providerChecking' : 'providerCredentialUnknown' }
    }
  }
  if (!matched) return { state: 'error', label: 'providerUnverified' }
  if (check.failure !== undefined) return { state: 'error', label: 'providerVerificationFailed' }
  if (check.verifiedModels === undefined) return { state: 'error', label: 'providerUnverified' }
  const configured = connection.models
  const available = check.verifiedModels.some(model =>
    (configured === undefined || configured.length === 0 || configured.some(item => item.id === model))
    && (connection.enabledModels === undefined || connection.enabledModels === null || connection.enabledModels.includes(model)))
  return { state: available ? 'done' : 'error', label: available ? 'providerReady' : 'providerNoModels' }
}
