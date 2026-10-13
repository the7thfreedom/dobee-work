import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { expect, it } from 'vitest'
import * as brand from '../src/index.ts'

it('replaces only the harness identity and restores it when unloaded', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, { personaPrefix: 'Deployment persona.' })
    const original = renderPrompt(await ctx.systemPrompt.assemble())
    const fiber = ctx.plugin(brand)
    await fiber.await()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(
      'You are an AI agent powered by DobeeWork.\n\nDeployment persona.',
    )
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(original)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('preserves omitted identities and explicit complete prompts', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(brand).await()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('')
    ctx.systemPrompt.section({ name: 'complete', order: 0, complete: true, text: 'Explicit identity.' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Explicit identity.')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('preserves a scoped identity that shadows the upstream default', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(brand).await()
    const key = {}
    await ctx.plugin({
      inject: ['systemPrompt'],
      apply(owned: Context) {
        const scope = createScope(owned, key)
        scope.ctx.systemPrompt.section({ name: 'harness:identity', order: -1000, text: 'Custom agent identity.' })
      },
    }).await()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))).toBe('Custom agent identity.')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('You are an AI agent powered by DobeeWork.')
  } finally {
    await ctx.fiber.dispose()
  }
})
