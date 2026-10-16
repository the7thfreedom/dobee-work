// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { ScheduleCreation, type ScheduleCreationInjected } from '../src/client/ScheduleCreation.tsx'
import { apply, inject } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

it.each([en, zh])('collects both fields before preparing an unsent localized request', (dictionary) => {
  const onContinue = vi.fn()
  const t = makeTranslate(dictionary)
  render(<ScheduleCreation placement="header" t={t} onContinue={onContinue} />)
  fireEvent.click(screen.getByRole('button', { name: dictionary.action }))
  expect(onContinue).not.toHaveBeenCalled()
  expect(screen.getByText(dictionary.confirmation)).toBeTruthy()
  expect(screen.getByText(dictionary.management)).toBeTruthy()
  const next = screen.getByRole<HTMLButtonElement>('button', { name: dictionary.next })
  expect(next.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(dictionary.instruction), { target: { value: '  Review release  ' } })
  expect(next.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(dictionary.timing), { target: { value: '   ' } })
  expect(next.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(dictionary.timing), { target: { value: '  Weekdays at 09:00 Asia/Shanghai  ' } })
  expect(next.disabled).toBe(false)
  fireEvent.click(next)
  expect(onContinue).toHaveBeenCalledExactlyOnceWith(t('draft', {
    instruction: 'Review release', timing: 'Weekdays at 09:00 Asia/Shanghai',
  }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('explains the empty-state flow and lets the user cancel without opening a conversation', () => {
  const onContinue = vi.fn()
  render(<ScheduleCreation placement="empty" t={makeTranslate(zh)} onContinue={onContinue} />)
  expect(screen.getByText(zh.emptyHint)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.action }))
  fireEvent.change(screen.getByLabelText(zh.instruction), { target: { value: '整理日报' } })
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(onContinue).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.action }))
  expect(screen.getByLabelText<HTMLInputElement>(zh.instruction).value).toBe('整理日报')
  fireEvent.click(screen.getByRole('button', { name: zh.close }))
  expect(onContinue).not.toHaveBeenCalled()
})

it('contributes to both creation placements and delegates only draft initialization', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const startSession = vi.fn()
    ctx.provide('uiWorkspace', { startSession } as never)
    ctx.slots.register({
      name: 'root',
      children: { 'schedule.manager.creation': { kind: 'single', scope: 'root' } },
    }, ({ renderSlot }: PropsRenderSlots<'schedule.manager.creation'>) =>
      renderSlot('schedule.manager.creation', { placement: 'header' }))
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    const entries = ctx.slots.entries('schedule.manager.creation')
    expect(entries).toHaveLength(1)
    const injected: object | undefined = entries[0]!.inject?.()
    if (injected === undefined) throw new Error('creation entry has no injected actions')
    const face = injected as ScheduleCreationInjected
    face.onContinue('unsent automation request')
    expect(startSession).toHaveBeenCalledExactlyOnceWith(undefined, {
      prompt: 'unsent automation request', appendPrompt: true,
    })
    await fiber.dispose()
    expect(ctx.slots.entries('schedule.manager.creation')).toHaveLength(0)
  } finally {
    await ctx.fiber.dispose()
  }
})
