/** DobeeWork occupants for the existing sidebar and conversation brand slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DobeeBrandMark, DobeeBrandName } from './Brand.tsx'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DobeeWork product spelling and decorative initial. */
    dobeeBrand: keyof typeof en
  }
}

/** Services needed for locale registration and brand-slot contributions. */
export const inject = ['slots', 'locale']

/**
 * Install brand occupants independently of the build profile.
 * Sidebar and hero contributions follow their declaring slots through HMR.
 * @param ctx - Browser root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('dobeeBrand', { en, zh }), 'dobee-brand: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', locale: 'dobeeBrand' }, DobeeBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', locale: 'dobeeBrand' }, DobeeBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark', locale: 'dobeeBrand' }, DobeeBrandMark))
}
