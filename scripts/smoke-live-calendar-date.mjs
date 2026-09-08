import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveBrowserExecutable } from './smoke-web-persistence.mjs'

const url = process.argv[2]
assert.ok(url && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(url), 'Pass an explicit loopback preview URL.')
const output = resolve('artifacts/visual-qa/live-calendar-date')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), headless: true })
const results = []
try {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.setFixedTime(new Date('2026-12-31T23:59:59+08:00'))
    await page.goto(url)
    const nav = page.locator(viewport.width < 820 ? '.tabbar' : '.sidebar')
    await nav.getByRole('button', { name: /^收件箱/ }).click()
    const composer = page.locator('.quick-add-composer')
    await composer.getByRole('textbox', { name: '新建任务' }).fill('跨年日界任务 明天')
    await composer.getByRole('button', { name: '添加', exact: true }).click()
    await page.getByRole('button', { name: '关闭任务详情', exact: true }).click()
    await nav.getByRole('button', { name: /^今天/ }).click()
    const title = page.locator('.tasks-view .page-title')
    await title.getByText(/12月31日/).waitFor({ state: 'visible' })
    const task = page.locator('.task-main').filter({ hasText: '跨年日界任务' })
    assert.equal(await task.count(), 0, 'Tomorrow task must not be in Today before midnight.')
    await page.screenshot({ path: resolve(output, `before-${viewport.width}.png`) })
    const loadedAt = await page.evaluate(() => performance.timeOrigin)
    await page.clock.setFixedTime(new Date('2027-01-01T00:00:01+08:00'))
    await title.getByText(/1月1日/).waitFor({ state: 'visible', timeout: 5_000 })
    await task.waitFor({ state: 'visible', timeout: 5_000 })
    assert.equal(await page.evaluate(() => performance.timeOrigin), loadedAt, 'The same page must update without reload.')
    assert.deepEqual(errors, [])
    await page.screenshot({ path: resolve(output, `after-${viewport.width}.png`) })
    results.push({ viewport, success: true, reloads: 0, dateLabel: await title.textContent(), errors })
    await context.close()
  }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(results, null, 2)}\n`)
  console.log(JSON.stringify(results))
} finally {
  await browser.close()
}
