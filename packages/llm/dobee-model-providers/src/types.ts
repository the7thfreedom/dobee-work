/** Client-safe provider classification, model candidates, and subscription login notices. */

/** User-facing provider access category. */
export type ProviderKind = 'api' | 'subscription'

/** Provider-defined defaults; users do not select an internal transport implementation. */
export interface ProviderPreset {
  /** Stable source identity. */
  source: string
  /** API-key access or account subscription. */
  kind: ProviderKind
  /** Default endpoint for API providers. */
  baseURL?: string
  /** Default compatible wire protocol when the provider needs one. */
  api?: string
}

/** Safe subscription account status without access or refresh tokens. */
export interface SubscriptionStatus {
  /** Local authorization status; an expired token can be refreshed before a request. */
  status: 'signed-out' | 'signed-in' | 'expired'
  /** Public account login name. */
  account?: string
  /** Copilot token expiration in Unix milliseconds. */
  expiresAt?: number
}

/** One login notice; no secret credential ever crosses this stream. */
export type SubscriptionLoginFrame =
  | { type: 'device-code'; verificationUri: string; userCode: string; expiresAt: number }
  | { type: 'authorized'; account: string }
  | { type: 'cancelled' }

/** Model discovery request from a staged API connection or saved subscription. */
export interface ProviderModelsRequest {
  /** Existing connection id, if already saved. */
  connectionId?: string
  /** Selected source preset for an unsaved connection. */
  source?: string
  /** API endpoint override from the current form. */
  baseURL?: string
  /** Compatible protocol override from advanced settings. */
  api?: string
  /** Write-only draft API key; used for this request alone. */
  apiKey?: string
}

/** A model returned by a provider with whatever metadata it discloses. */
export interface ProviderModel {
  /** Exact wire model identifier. */
  id: string
  /** Human-facing model name. */
  name?: string
  /** Combined token capacity. */
  contextWindow?: number
  /** Output-token capacity. */
  maxTokens?: number
  /** Model-specific wire protocol, needed by mixed-protocol subscriptions. */
  api?: string
  /** Accepted input modalities when disclosed. */
  input?: ('text' | 'image')[]
  /** Reasoning support when disclosed. */
  reasoning?: boolean
}

/** Host provider-management operations; transport adapters expose these through their own namespace. */
export interface ProviderManager {
  /** Read supported provider access categories.
   * @returns preset access categories and endpoint defaults.
   */
  presets(): ProviderPreset[]
  /**
   * Read model metadata without contacting the endpoint.
   * @param connectionId - saved connection.
   * @returns installed or declared model metadata.
   */
  catalog(connectionId: string): Promise<ProviderModel[]>
  /**
   * Synchronize the endpoint model catalog.
   * @param request - staged connection.
   * @param signal - cancellation.
   * @returns live model candidates.
   */
  models(request: ProviderModelsRequest, signal: AbortSignal): Promise<ProviderModel[]>
  /**
   * Read public subscription account state.
   * @param connectionId - subscription connection.
   * @returns safe account status.
   */
  status(connectionId: string): Promise<SubscriptionStatus>
  /**
   * Begin subscription authorization for the initiating surface.
   * @param connectionId - subscription connection.
   * @param signal - cancellation.
   * @returns public authorization notices.
   */
  login(connectionId: string, signal: AbortSignal): AsyncIterable<SubscriptionLoginFrame>
  /**
   * Withdraw an outstanding authorization attempt.
   * @param connectionId - subscription connection.
   * @returns after login withdrawal.
   */
  cancelLogin(connectionId: string): Promise<void>
  /**
   * Forget the connection-owned subscription grant.
   * @param connectionId - subscription connection.
   * @returns after credential deletion.
   */
  logout(connectionId: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-owned model management, independent of the Remote transport. */
    dobeeProviderManager: ProviderManager
  }
}
