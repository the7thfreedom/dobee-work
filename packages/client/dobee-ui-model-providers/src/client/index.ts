/** Browser entry for provider settings and the generated dobee remote contribution. */
import type { Context } from '@deepseek-ai/cordis'
import dobeeRemote from '@deepseek-ai/dsh-dobee-model-controller/remote'
import { mountProviders } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate provider settings after mounting its Host methods.
 * @param ctx - Client runtime.
 * @returns joined UI and remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountProviders(ctx, dobeeRemote)
}
