/** DobeeWork creation guidance on the shared task catalog's extension slot. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-schedule/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { ScheduleCreation, type ScheduleCreationInjected } from './ScheduleCreation.tsx'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Guided automation creation and its conversation draft. */
    'dobee.schedule.creation': keyof typeof en
  }
}

/** Services required to register the guide and prepare a conversation draft. */
export const inject = ['slots', 'locale', 'uiWorkspace']

/**
 * Mount creation guidance without replacing task management or scheduling.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('dobee.schedule.creation', { en, zh }), 'dobee-schedule: dictionaries')
  ctx.slots.inject('schedule.manager.creation', () => ctx.slots.register({
    name: 'schedule.manager.creation',
    locale: 'dobee.schedule.creation',
    inject: (): ScheduleCreationInjected => ({
      onContinue: (prompt) => { ctx.uiWorkspace.startSession(undefined, { prompt, appendPrompt: true }) },
    }),
  }, ScheduleCreation))
}
