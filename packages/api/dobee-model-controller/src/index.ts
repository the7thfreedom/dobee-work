/** Thin Remote transport for the dobee provider manager; credentials never cross its results. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ProviderModel, ProviderModelsRequest, ProviderPreset, SubscriptionLoginFrame, SubscriptionStatus,
} from '@deepseek-ai/dsh-dobee-model-providers/types'
import type {} from '@deepseek-ai/dsh-dobee-model-providers/types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Product provider-management Remote service. */
    dobeeModels: DobeeModelsController
  }
}

/** Exposes the Host provider manager through an independently generated transport. */
export default class DobeeModelsController extends TypertRemoteService {
  /** Required provider definition; no native SDK enters this transport package. */
  static inject = ['dobeeProviderManager']

  /** @param ctx - context containing the dobee provider manager. */
  constructor(ctx: Context) { super(ctx, 'dobeeModels') }

  /** Read supported provider access categories.
   * @returns API and subscription presets with default endpoints.
   */
  @Remote
  presets(): ProviderPreset[] { return this.ctx.dobeeProviderManager.presets() }

  /**
   * Read the provider's local catalog without a network request.
   * @param connectionId - saved provider.
   * @returns local model metadata without endpoint I/O.
   */
  @Remote
  catalog(connectionId: string): Promise<ProviderModel[]> { return this.ctx.dobeeProviderManager.catalog(connectionId) }

  /**
   * Synchronize the provider's live model catalog.
   * @param request - staged endpoint facts.
   * @param signal - caller cancellation.
   * @returns live endpoint model candidates.
   */
  @Remote
  models(request: ProviderModelsRequest, signal: AbortSignal): Promise<ProviderModel[]> {
    return this.ctx.dobeeProviderManager.models(request, signal)
  }

  /**
   * Read public subscription account state.
   * @param connectionId - saved subscription.
   * @returns safe account metadata without any tokens.
   */
  @Remote
  status(connectionId: string): Promise<SubscriptionStatus> { return this.ctx.dobeeProviderManager.status(connectionId) }

  /**
   * Start account authorization for the initiating client.
   * @param connectionId - saved subscription.
   * @param signal - caller cancellation.
   * @returns public device-login notices.
   */
  @Remote({ mode: 'stream' })
  async *login(connectionId: string, signal: AbortSignal): AsyncIterable<SubscriptionLoginFrame> {
    yield* this.ctx.dobeeProviderManager.login(connectionId, signal)
  }

  /**
   * Withdraw an outstanding device authorization.
   * @param connectionId - saved subscription.
   * @returns after the login has stopped.
   */
  @Remote
  cancelLogin(connectionId: string): Promise<void> { return this.ctx.dobeeProviderManager.cancelLogin(connectionId) }

  /**
   * Forget the connection's subscription credentials.
   * @param connectionId - saved subscription.
   * @returns after the owned account grant has been removed.
   */
  @Remote
  logout(connectionId: string): Promise<void> { return this.ctx.dobeeProviderManager.logout(connectionId) }
}
