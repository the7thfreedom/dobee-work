import { fileURLToPath } from 'node:url'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { openSettings } from './support.ts'

const overlay = fileURLToPath(new URL('./dobee-model-providers.overlay.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/dobee-models/package.json', import.meta.url))

it.each([
  ['en-US', 'light'], ['en-US', 'dark'], ['zh-CN', 'light'], ['zh-CN', 'dark'],
] as const)('shows one green, red, or grey provider indicator in %s / %s', async (locale, colorScheme) => {
  const requests: Array<{ path: string | undefined; authorization: string | undefined }> = []
  let modelListStatus = 200
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization })
    response.writeHead(request.headers.authorization === 'Bearer fixture-key' ? modelListStatus : 401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'work-model' }] }))
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  }))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Model fixture did not bind a loopback port')
  const endpoint = `http://127.0.0.1:${address.port}/v1`
  const fixture = await mkdtemp(join(tmpdir(), 'dobee-model-provider-fixture-'))
  onTestFinished(() => rm(fixture, { recursive: true, force: true }))
  await copyFile(overlay, join(fixture, 'cordis.patch.yml'))
  await writeFile(join(fixture, 'package.json'), JSON.stringify({
    name: 'dsh-dobee-model-provider-fixture', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  const scaffold = await launchWebScaffold({
    extraInstallAnchors: [anchor],
    profile: { bundles: ['@deepseek-ai/dsh-dobee-models'], packages: [{ dir: fixture, enabled: true }] },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale, colorScheme, viewport: { width: 1280, height: 840 } })
  const consoleState = watchConsole(page)
  const chinese = locale === 'zh-CN'
  await page.goto(scaffold.authenticatedUrl)
  await page.locator('[class*="frame"]').first().waitFor()
  await openSettings(page, chinese ? 'zh' : 'en')
  const dialog = page.getByRole('dialog', { name: chinese ? '设置' : 'Settings', exact: true })
  await dialog.getByRole('button', { name: chinese ? '模型' : 'Models', exact: true }).click()
  const selector = `aside[aria-label="${chinese ? '提供商' : 'Providers'}"]`
  const sidebar = page.locator(selector)
  const deepseek = sidebar.getByRole('button', { name: /^DeepSeek / })
  const missingKey = chinese ? '已开启但未就绪：缺少 API Key' : 'Enabled, not ready: API key missing'
  await expect.poll(() => deepseek.getAttribute('aria-label')).toContain(missingKey)
  expect(await deepseek.innerText()).toBe('DeepSeek')
  expect(await deepseek.locator('[data-state="error"]').count()).toBe(1)
  const work = sidebar.getByRole('button', { name: /^Work gateway / })
  expect(await work.locator('[data-state="idle"]').count()).toBe(1)
  const empty = sidebar.getByRole('button', { name: chinese ? /^硅基流动 / : /^SiliconFlow / })
  await expect.poll(() => empty.locator('[data-state="error"]').count()).toBe(1)
  const copilot = sidebar.getByRole('button', { name: /^GitHub Copilot / })
  expect(await copilot.locator('[data-state="idle"]').count()).toBe(1)
  expect(await dialog.getByPlaceholder(chinese ? '可选显示名称' : 'Optional display name').count()).toBe(0)
  await work.click()
  await dialog.getByRole('switch', { name: chinese ? '启用提供商' : 'Enable provider' }).click()
  await dialog.getByLabel('Endpoint', { exact: true }).fill(endpoint)
  await dialog.getByLabel('API Key', { exact: true }).fill('fixture-key')
  await dialog.getByRole('button', { name: chinese ? '保存' : 'Save', exact: true }).click()
  await expect.poll(async () => ({
    label: await work.getAttribute('aria-label'),
    alerts: await dialog.getByRole('alert').allTextContents(),
  })).toEqual({
    label: `Work gateway — ${chinese ? '已开启，配置就绪' : 'Enabled and configured'}`,
    alerts: [],
  })
  expect(requests).toEqual([])
  await dialog.getByLabel('Endpoint', { exact: true }).fill(`${endpoint}/unsaved`)
  expect(await work.locator('[data-state="done"]').count()).toBe(1)
  await deepseek.click()
  expect(await work.locator('[data-state="done"]').count()).toBe(1)
  await work.click()
  expect(await work.locator('[data-state="done"]').count()).toBe(1)
  await dialog.getByRole('button', { name: chinese ? '放弃更改' : 'Discard changes' }).click()
  await expect.poll(() => dialog.getByLabel('Endpoint', { exact: true }).inputValue()).toBe(endpoint)
  await dialog.getByRole('button', { name: chinese ? '同步模型' : 'Sync models', exact: true }).click()
  await dialog.getByRole('button', { name: chinese ? '保存' : 'Save', exact: true }).click()
  await expect.poll(async () => ({
    label: await work.getAttribute('aria-label'),
    alerts: await dialog.getByRole('alert').allTextContents(),
  })).toEqual({ label: `Work gateway — ${chinese ? '已开启，配置就绪' : 'Enabled and configured'}`, alerts: [] })
  expect(await work.locator('[data-state="done"]').count()).toBe(1)
  expect(requests).toEqual([{ path: '/v1/models', authorization: 'Bearer fixture-key' }])
  modelListStatus = 404
  await dialog.getByRole('button', { name: chinese ? '同步模型' : 'Sync models', exact: true }).click()
  await expect.poll(() => dialog.getByRole('alert').count()).toBe(1)
  expect(await work.locator('[data-state="done"]').count()).toBe(1)
  await page.reload()
  await page.locator('[class*="frame"]').first().waitFor()
  await openSettings(page, chinese ? 'zh' : 'en')
  await dialog.getByRole('button', { name: chinese ? '模型' : 'Models', exact: true }).click()
  await expect.poll(() => work.locator('[data-state="done"]').count()).toBe(1)
  expect(requests).toHaveLength(2)
  expect(await work.innerText()).toBe('Work gateway')
  await deepseek.click()
  await expect.poll(() => deepseek.getAttribute('aria-label')).toContain(missingKey)
  const expected = fileURLToPath(new URL(`./expected/dobee-model-providers/${locale}.expected.md`, import.meta.url))
  await mkdir(dirname(expected), { recursive: true })
  await compareOrRefreshGolden(expected, await captureStableAria(page, selector, scaffold.workspaceCwd), webSnapshotMode())
  await work.click()
  await dialog.getByRole('switch', { name: chinese ? '启用提供商' : 'Enable provider' }).click()
  expect(await work.locator('[data-state="done"]').count()).toBe(1)
  await dialog.getByRole('button', { name: chinese ? '保存' : 'Save', exact: true }).click()
  await expect.poll(() => work.locator('[data-state="idle"]').count()).toBe(1)
  await dialog.getByRole('switch', { name: chinese ? '启用提供商' : 'Enable provider' }).click()
  await dialog.getByRole('button', { name: chinese ? '保存' : 'Save', exact: true }).click()
  await expect.poll(() => work.locator('[data-state="done"]').count()).toBe(1)
  await empty.click()
  await expect.poll(() => empty.locator('[data-state="error"]').count()).toBe(1)
  expect(await work.locator('[data-state="done"]').count()).toBe(1)
  await page.setViewportSize({ width: 600, height: 840 })
  expect(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await deepseek.hover()
  const tooltip = page.getByRole('tooltip').filter({ hasText: missingKey })
  await tooltip.waitFor()
  expect(await tooltip.evaluate(element => element.parentElement === document.body)).toBe(true)
  await expect.poll(async () => {
    const bounds = await tooltip.boundingBox()
    return bounds !== null && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 600 && bounds.y + bounds.height <= 840
  }).toBe(true)
  await page.mouse.move(0, 0)
  await expect.poll(() => tooltip.count()).toBe(0)
  expect(await sidebar.locator('[data-state="ongoing"], [data-state="warning"]').count()).toBe(0)
  expect(consoleState.pageErrors).toEqual([])
})
