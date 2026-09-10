import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBrowserExecutable } from './smoke-web-persistence.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifacts = resolve(root, 'artifacts', 'desktop-shell-2026-09-10')

async function main() {
  await mkdir(artifacts, { recursive: true })
  const port = await freePort()
  const url = `http://127.0.0.1:${port}/`
  const preview = spawn(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'inherit', windowsHide: true })
  try {
    await waitFor(url)
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), headless: true })
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    try {
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.locator('.loading').waitFor({ state: 'hidden' })
      await verifyCalendarBlankSelection(page)
      await verifyUnifiedInspector(page)
      await verifySettingsScrollAndScale(page)
      await verifyResizableSidebar(page)
      for (const viewport of [{ width: 800, height: 560 }, { width: 1180, height: 760 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(viewport)
        await page.goto(url, { waitUntil: 'networkidle' })
        await page.locator('.loading').waitFor({ state: 'hidden' })
        const overflow = await page.evaluate(() => ({ html: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }))
        assert.deepEqual(overflow, { html: 0, body: 0 })
        await page.screenshot({ path: resolve(artifacts, `shell-${viewport.width}x${viewport.height}.png`) })
      }
      assert.deepEqual(errors, [])
      console.log('Desktop shell smoke passed: blank-range=45m, single-inspector, settings-scroll-owner, font-scale, persisted-resizers, viewports=800x560,1180x760,1366x768,1920x1080, consoleErrors=0')
    } catch (error) {
      await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true })
      throw error
    } finally {
      await context.close(); await browser.close()
    }
  } finally { if (!preview.killed) preview.kill() }
}

async function verifyCalendarBlankSelection(page) {
  await page.getByRole('navigation', { name: '待办导航' }).getByRole('button', { name: '日历', exact: true }).click()
  await page.locator('.calendar-workspace').waitFor()
  await page.getByRole('button', { name: '日', exact: true }).click()
  await page.locator('.time-grid__scroll').evaluate((element) => { element.scrollTop = 480 })
  const day = page.locator('.time-grid__day').first()
  const box = await day.boundingBox(); assert.ok(box)
  const x = box.x + box.width - 14
  await page.mouse.move(x, box.y + 600); await page.mouse.down(); await page.mouse.move(x, box.y + 645, { steps: 4 }); await page.mouse.up()
  const draft = page.getByRole('dialog', { name: '快速新建日程' })
  await draft.waitFor()
  assert.equal(await draft.getByLabel('开始').locator('input').inputValue(), '10:00')
  assert.equal(await draft.getByLabel('结束').locator('input').inputValue(), '10:45')
  const draftBox = await draft.boundingBox(); assert.ok(draftBox)
  assert.ok(Math.abs(draftBox.y - (box.y + 600)) < 220, 'quick card must stay near the selected time range')
  await page.locator('.calendar-toolbar').click({ position: { x: 10, y: 10 } })
  await draft.waitFor({ state: 'hidden' })
}

async function verifyUnifiedInspector(page) {
  await page.getByRole('navigation', { name: '待办导航' }).getByRole('button', { name: /今天/ }).click()
  await page.locator('.task-main').first().click()
  const panels = page.locator('.sheet-panel')
  assert.equal(await panels.count(), 1)
  const before = await panels.first().boundingBox(); assert.ok(before)
  await page.getByRole('button', { name: '编辑任务' }).click()
  await page.getByRole('heading', { name: '编辑任务' }).waitFor()
  assert.equal(await panels.count(), 1)
  const after = await panels.first().boundingBox(); assert.ok(after)
  assert.equal(Math.round(after.width), Math.round(before.width))
  assert.equal(await panels.first().evaluate((element) => element.scrollWidth <= element.clientWidth), true)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '编辑任务' }).waitFor()
  await page.getByRole('button', { name: '关闭任务详情' }).click()
}

async function verifySettingsScrollAndScale(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const content = page.locator('.settings-content')
  await content.waitFor()
  await page.locator('.settings-navigation').getByRole('button', { name: '数据' }).click()
  await page.waitForFunction(() => document.querySelector('.settings-content').scrollTop > 0)
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0)
  const slider = page.getByRole('slider', { name: '全局字体大小' })
  const peer = await page.context().newPage()
  await peer.goto(new URL('/', page.url()).toString(), { waitUntil: 'networkidle' })
  await slider.fill('110')
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim()), '1.1')
  await peer.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim() === '1.1')
  await peer.close()
}

async function verifyResizableSidebar(page) {
  await page.goto(new URL('/', page.url()).toString(), { waitUntil: 'networkidle' })
  const resizer = page.getByRole('separator', { name: '调整侧边栏宽度' })
  await resizer.focus(); await resizer.press('ArrowRight')
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width), 240)
}

function freePort() { return new Promise((resolvePort, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolvePort(address.port)) }) }) }
async function waitFor(url) { for (let i = 0; i < 80; i++) { try { const response = await fetch(url); if (response.ok) return } catch {} await new Promise((resolveWait) => setTimeout(resolveWait, 100)) } throw new Error(`Preview did not start: ${url}`) }

await main()
