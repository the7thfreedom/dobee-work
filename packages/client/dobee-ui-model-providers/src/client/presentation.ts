/** Localized brands and searchable aliases keyed by unchanged Host source IDs. */
import type { LocaleKey } from './locales.ts'
import type { PROTOCOLS } from './controller.ts'

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
