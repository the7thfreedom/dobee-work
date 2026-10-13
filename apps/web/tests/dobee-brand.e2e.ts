/** Brand presentation through the shipped Loader composition and built browser plugins. */
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'

const mode = webSnapshotMode()
const legacy = ['DeepSeek', 'Harness'].join(' ')
const expectedPath = fileURLToPath(new URL('./expected/dobee-brand/identity.expected.txt', import.meta.url))

it.each([
  ['en-US', 'light'], ['en-US', 'dark'], ['zh-CN', 'light'], ['zh-CN', 'dark'],
] as const)('shows DobeeWork in the %s %s browser composition', async (locale, colorScheme) => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ locale, colorScheme, viewport: { width: 1280, height: 840 } })
    const consoleState = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor()
    const name = page.locator('[data-dobee-brand]')
    await name.waitFor()
    expect(await name.textContent()).toBe('DobeeWork')
    expect(await page.title()).toBe('DobeeWork')
    const marks = page.locator('[data-dobee-brand-mark]')
    expect(await marks.count()).toBeGreaterThan(0)
    expect(await marks.locator('path').count()).toBe(0)
    expect(await page.locator('body').innerText()).not.toContain(legacy)
    await mkdir(dirname(expectedPath), { recursive: true })
    await compareOrRefreshGolden(
      expectedPath,
      `title: ${await page.title()}\nsidebar: ${await name.textContent()}\nmarks: ${(await marks.allTextContents()).join(' | ')}`,
      mode,
    )
    expect(consoleState.pageErrors).toEqual([])
    expect(consoleState.warnings).toEqual([])
  } finally {
    await browser.close()
  }
})
