/** Registered Copilot IDE compatibility profile with dobee application attribution. */
import { APP_IDENTITY, attributionHeaders } from '@deepseek-ai/dsh-llm'

/**
 * Select the registered IDE protocol profile required by Copilot's internal API.
 * @returns shared headers for token exchange, model listing, and model calls.
 */
export function copilotClientHeaders(): Record<string, string> {
  return {
    ...attributionHeaders({
      product: 'dobee-work', version: APP_IDENTITY.version, url: 'https://github.com/the7thfreedom/dobee-work',
    }),
    'editor-version': 'vscode/1.107.0',
    'editor-plugin-version': 'copilot-chat/0.35.0',
    'copilot-integration-id': 'vscode-chat',
    'x-github-api-version': '2026-06-01',
  }
}
