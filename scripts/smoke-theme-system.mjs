import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveBrowserExecutable } from './smoke-web-persistence.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:18476/'
const output = resolve('artifacts/theme-system')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'light' })
const page = await context.newPage()
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(error.message))

try {
  await page.goto(url)
  await page.locator('.tasks-view').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: '设置', exact: true }).click()
  const cards = page.locator('.theme-card:not(.theme-card--custom)')
  assert.ok(await cards.count() >= 7)
  for (const card of await cards.all()) {
    await card.click()
    const id = await page.locator('html').getAttribute('data-theme')
    assert.ok(id && id !== 'custom')
    if (id === 'forest' || id === 'amber') {
      await page.waitForTimeout(280)
      await page.screenshot({ path: resolve(output, `desktop-${id}-light.png`), fullPage: true })
    }
  }

  await page.getByRole('button', { name: '跟随系统', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'light')

  const custom = page.getByLabel('选择自定义主色')
  await custom.fill('#d946ef')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'custom')
  const contrast = await page.evaluate(() => {
    const sample = document.createElement('span')
    document.body.append(sample)
    const rgb = (token) => {
      sample.style.color = `var(${token})`
      const match = getComputedStyle(sample).color.match(/\d+(?:\.\d+)?/g)
      return match.slice(0, 3).map(Number)
    }
    const luminance = (color) => color.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
    const pairs = ['--text', '--muted', '--accent', '--accent-alt', '--success', '--warning', '--danger'].flatMap((foreground) => ['--bg', '--surface', '--surface-alt'].map((background) => ({ foreground, background, ratio: ratio(rgb(foreground), rgb(background)) })))
    sample.remove()
    return pairs
  })
  assert.ok(contrast.every(({ ratio }) => ratio >= 4.5), JSON.stringify(contrast))
  await page.screenshot({ path: resolve(output, 'desktop-custom-light.png'), fullPage: true })
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark')
  await page.screenshot({ path: resolve(output, 'desktop-custom-dark.png'), fullPage: true })
  await page.getByRole('button', { name: '跟随系统', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  await page.locator('.tasks-view').waitFor()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'custom')
  assert.equal(await page.locator('html').getAttribute('data-mode'), 'light')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('meow-study-theme-preference')))
  assert.deepEqual(saved, { themeId: 'custom', mode: 'system', customPrimary: '#d946ef' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.mobile-header').getByRole('button', { name: '设置', exact: true }).click()
  await page.screenshot({ path: resolve(output, 'mobile-custom-light.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ success: true, presets: await cards.count(), contrastPairs: contrast.length, output }, null, 2))
} finally {
  await context.close()
  await browser.close()
}
