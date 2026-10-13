// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { DobeeBrandMark, DobeeBrandName } from '../src/client/Brand.tsx'

afterEach(() => { cleanup() })

const holes = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'] as const

it('fills declared brand slots and removes all occupants on unload', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.slots.register({
      name: 'root',
      children: Object.fromEntries(holes.map(name => [name, { kind: 'single', scope: 'root' }])),
    } as never, () => null)
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    for (const hole of holes) expect(ctx.slots.entries(hole)).toHaveLength(1)
    await fiber.dispose()
    for (const hole of holes) expect(ctx.slots.entries(hole)).toHaveLength(0)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('renders localized typography without upstream brand paths', () => {
  const t = (key: string): string => key === 'product' ? 'DobeeWork' : 'D'
  const name = render(<DobeeBrandName t={t} />)
  expect(name.container.textContent).toBe('DobeeWork')
  name.unmount()
  const mark = render(<DobeeBrandMark size={34} className="owner-geometry" t={t} />)
  expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
  expect(mark.container.querySelector('svg')?.getAttribute('class')).toBe('owner-geometry')
  expect(mark.container.querySelector('path')).toBeNull()
  expect(mark.container.textContent).toBe('D')
})
