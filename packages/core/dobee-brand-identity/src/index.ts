/** Independent DobeeWork identity for the existing harness-owned prompt section. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

const UPSTREAM_IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'

/** Prompt assembly service required by the Host plugin. */
export const inject = ['systemPrompt']

/**
 * Replace the harness identity without adding it to compositions that omit it.
 * Complete prompts and deployment persona sections retain their own text.
 * @param ctx - Host context whose prompt assemblies use the DobeeWork identity.
 */
export function apply(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return {
      ...assembly,
      sections: assembly.sections.map(section => section.name === 'harness:identity' && section.text === UPSTREAM_IDENTITY
        ? { ...section, text: 'You are an AI agent powered by DobeeWork.' }
        : section),
    }
  })
}
