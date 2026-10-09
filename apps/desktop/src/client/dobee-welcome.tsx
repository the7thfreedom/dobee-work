/** Independent desktop welcome renderer plugin; it does not change account providers. */
import type { ReactElement } from 'react'
import { Welcome } from './WelcomePage.tsx'
import type { WelcomeApi } from '../welcome-api.ts'

/** Desktop renderer plugin identity. */
export const name = 'dobee-welcome'

/**
 * Mount DobeeWork branding with credential-free entry on the Login action.
 * API-key setup retains the desktop credential service and its validation.
 * @param api - isolated desktop operations and the resolved shell locale.
 * @returns the welcome renderer; entering writes no account or completion state.
 */
export function apply(api: WelcomeApi): ReactElement {
  const messages = {
    ...api.messages,
    welcomeTitle: 'DobeeWork',
    welcomeBrand: 'DobeeWork',
    welcomeTaglineBrand: 'DobeeWork',
  }
  return <Welcome api={{ ...api, messages }} signInAction="workspace" brand={
    <svg className="brand" viewBox="0 0 472 40" role="img" aria-label={messages.welcomeBrand}>
      <text x="236" y="32" textAnchor="middle" fill="currentColor" fontSize="36" fontWeight="500">{messages.welcomeBrand}</text>
    </svg>
  } />
}
