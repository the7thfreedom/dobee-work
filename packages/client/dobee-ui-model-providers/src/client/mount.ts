/** Source-safe lifecycle for generated dobee remotes and provider settings. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-dobee-model-controller/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { Controller, NAMESPACE } from './controller.ts'
import type { DefaultModel, Settings } from './controller.ts'
import { Section, OutcomeToast } from './Section.tsx'
import type { Face } from './Section.tsx'
import { en, zh } from './locales.ts'
import type { LocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Independent dobee connection settings copy. */
    'dobee.modelProviders': LocaleKey
  }
}

/** Services required to register settings and call Host operations. */
export const inject = ['slots', 'locale', 'configForms', 'remote']

function registerUi(ctx: Context): void {
  const locale = 'dobee.modelProviders'
  ctx.effect(() => ctx.locale.register(locale, { en, zh }))
  const t = ctx.locale.bind(locale)
  const controller = new Controller(
    ctx.configForms.get<Settings>(NAMESPACE),
    ctx.configForms.get<DefaultModel>('agent-default-model'),
    {
      presets: async () => {
        const reply = await ctx.remote.dobeeModels.presets()
        if (!reply.ok) throw reply.error
        return reply.value
      },
      describe: async (ref) => {
        const reply = await ctx.remote.credentials.describe([ref])
        return reply.ok ? reply.value[ref] : undefined
      },
      setCredential: async (ref, secret) => (await ctx.remote.credentials.set(ref, secret)).ok,
      catalog: async (id) => {
        const reply = await ctx.remote.dobeeModels.catalog(id)
        if (!reply.ok) throw reply.error
        return reply.value
      },
      discover: async (request, signal) => {
        const reply = await ctx.remote.dobeeModels.models(request, signal)
        if (!reply.ok) throw reply.error
        return reply.value
      },
      status: async (id) => {
        const reply = await ctx.remote.dobeeModels.status(id)
        if (!reply.ok) throw reply.error
        return reply.value
      },
      login: (id, signal) => ctx.remote.dobeeModels.login(id, signal),
      cancelLogin: async (id) => {
        const reply = await ctx.remote.dobeeModels.cancelLogin(id)
        if (!reply.ok) throw reply.error
      },
      logout: async (id) => {
        const reply = await ctx.remote.dobeeModels.logout(id)
        if (!reply.ok) throw reply.error
      },
    },
  )
  const face = (): Face => ({
    hooks: { connections: controller.store },
    open: (id, source) => { controller.open(id, source) },
    edit: (patch) => { controller.edit(patch) },
    cancel: () => { controller.cancel() },
    save: () => controller.save(),
    discover: () => controller.discover(),
    remove: id => controller.remove(id),
    setDefault: (id, model) => controller.setDefault(id, model),
    toggleModel: (id, enabled) => { controller.toggleModel(id, enabled) },
    login: () => controller.login(),
    cancelLogin: () => controller.cancelLogin(),
    logout: () => controller.logout(),
    loadPresets: () => controller.loadPresets(),
    refreshInfo: () => controller.refreshInfo(),
    refreshCredential: () => controller.refreshCredential(),
    dismiss: () => { controller.dismiss() },
  })
  ctx.effect(() => () => controller.dispose())
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', () => { void controller.refreshCredential() }))
  ctx.effect(() => ctx.configForms.whileServed([NAMESPACE], () => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section', id: NAMESPACE, order: 11, label: () => t('title'), locale, inject: face,
    }, Section))))
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dobee-model-providers.outcome', locale, inject: face,
  }, OutcomeToast)))
}

/**
 * Mount the generated remote before binding provider settings and account actions.
 * @param ctx - Client runtime.
 * @param contribution - generated dobee method and codec definitions.
 * @returns disposer joining UI withdrawal and remote unmount.
 */
export async function mountProviders(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.dobeeModels', 'remote.credentials', 'slots', 'locale', 'configForms'], registerUi)
  try { await ui } catch (error) {
    try { await ui.dispose() } finally { await disposeRemote() }
    throw error
  }
  return async () => { try { await ui.dispose() } finally { await disposeRemote() } }
}
