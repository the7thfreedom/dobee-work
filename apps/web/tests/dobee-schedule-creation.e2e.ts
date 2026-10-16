/** Guided creation through the shipped Web composition, without sending a model request. */
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import type {} from '@deepseek-ai/dsh-schedule'

const mode = webSnapshotMode()
const en = {
  action: 'Create through chat',
  title: 'Create an automation task',
  instruction: 'What should the task do?',
  timing: 'When should it run?',
  next: 'Continue to conversation',
  emptyHint: 'Start with what to do and when, then send the request in a conversation. Created tasks appear here.',
  confirmation: 'This step only prepares a draft; it does not send a message or create a task. After you send it, the assistant may ask for details. A task card confirms creation.',
}
const zh = {
  action: '通过对话创建',
  title: '创建自动化任务',
  instruction: '要做什么',
  timing: '什么时候执行',
  next: '前往会话确认',
  emptyHint: '先描述任务内容和执行时间，再到会话中发送。创建成功的任务会显示在这里',
  confirmation: '这一步只准备草稿，不会发送消息，也不会创建任务。发送后，助手可能会向你确认细节；看到任务卡片才表示创建成功',
}

it.each([
  ['en-US', 'light', en, 'Automation tasks'],
  ['en-US', 'dark', en, 'Automation tasks'],
  ['zh-CN', 'light', zh, '自动化任务'],
  ['zh-CN', 'dark', zh, '自动化任务'],
] as const)('guides creation in %s %s without submitting the draft', async (locale, colorScheme, dictionary, panelName) => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  onTestFinished(() => scaffold.close())
  const eventTypes: string[] = []
  const unsubscribe = scaffold.ctx.on('session/event', (_session, event) => { eventTypes.push(event.type) })
  onTestFinished(() => { unsubscribe() })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ locale, colorScheme, viewport: { width: 1280, height: 840 } })
    const consoleState = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    const composer = page.locator('[data-composer-input][contenteditable="true"]').first()
    await composer.waitFor()
    await composer.fill('Keep my existing draft.')
    await page.getByRole('button', { name: panelName, exact: true }).click()
    const manager = page.getByTestId('task-manager-page')
    await manager.getByText(dictionary.emptyHint, { exact: true }).waitFor()
    expect(await manager.getByRole('button', { name: dictionary.action, exact: true }).count()).toBe(2)
    await manager.getByRole('button', { name: dictionary.action, exact: true }).last().click()
    const dialog = page.getByRole('dialog', { name: dictionary.title })
    await dialog.waitFor()
    expect(await dialog.getByRole('button', { name: dictionary.next }).isDisabled()).toBe(true)
    expect(await dialog.getByText(dictionary.confirmation, { exact: true }).isVisible()).toBe(true)
    await expect.poll(() => dialog.getByLabel(dictionary.instruction).evaluate(element => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await manager.getByRole('button', { name: dictionary.action, exact: true }).first().click()
    await dialog.waitFor()
    await page.mouse.click(1, 1)
    await dialog.waitFor({ state: 'hidden' })
    await manager.getByRole('button', { name: dictionary.action, exact: true }).first().click()
    await dialog.getByLabel(dictionary.instruction).fill('Review the release checklist')
    await dialog.getByLabel(dictionary.timing).fill('Every weekday at 09:00 Asia/Shanghai')
    const expectedPath = fileURLToPath(new URL(`./expected/dobee-schedule-creation/${locale}.expected.md`, import.meta.url))
    await mkdir(dirname(expectedPath), { recursive: true })
    await compareOrRefreshGolden(expectedPath, await captureStableAria(
      page, '[role="dialog"]', scaffold.workspaceCwd,
    ), mode)
    await page.setViewportSize({ width: 480, height: 540 })
    const box = await dialog.boundingBox()
    if (box === null) throw new Error('creation guide is not visible')
    expect(box.x).toBeGreaterThanOrEqual(24)
    expect(box.y).toBeGreaterThanOrEqual(24)
    expect(box.x + box.width).toBeLessThanOrEqual(456)
    expect(box.y + box.height).toBeLessThanOrEqual(516)
    await dialog.getByRole('button', { name: dictionary.next }).click()
    await composer.waitFor()
    await expect.poll(() => composer.innerText()).toContain('Review the release checklist')
    expect(await composer.innerText()).toContain('Every weekday at 09:00 Asia/Shanghai')
    expect(await composer.innerText()).toContain('Keep my existing draft.')
    expect(await scaffold.ctx.schedule.catalog()).toEqual([])
    expect(eventTypes).not.toContain('user/message')
    expect(eventTypes).not.toContain('request/header')
    expect(consoleState.pageErrors).toEqual([])
    expect(consoleState.warnings).toEqual([])
  } finally {
    await browser.close()
  }
})
