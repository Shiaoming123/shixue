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
      await verifyAppleDesign(page)
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

async function verifyAppleDesign(page) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  await page.getByRole('navigation', { name: '待办导航' }).getByRole('button', { name: '日历', exact: true }).click()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: '更多选项', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '新建日程', exact: true })
  const title = editor.getByRole('textbox', { name: '日程标题', exact: true })
  check(await title.evaluate((input) => input.required && input.validity.valueMissing), 'Shared Input must forward required to the native input')
  await editor.getByRole('button', { name: '重复', exact: true }).click()
  await page.getByRole('option', { name: '每年', exact: true }).click()
  const month = editor.getByRole('spinbutton', { name: '月份', exact: true })
  await month.fill('13')
  check(await month.evaluate((input) => input.min === '1' && input.max === '12' && input.validity.rangeOverflow), 'Shared Input must preserve numeric constraints')
  await page.emulateMedia({ forcedColors: 'active' })
  await title.focus()
  check(await title.evaluate((input) => getComputedStyle(input).outlineStyle !== 'none' && parseFloat(getComputedStyle(input).outlineWidth) >= 2), 'Keyboard focus must remain visible without box shadows in forced colors')
  await page.screenshot({ path: resolve(artifacts, 'apple-forced-colors.png') })
  await page.emulateMedia({ forcedColors: 'none' })
  const cancel = editor.getByRole('button', { name: '取消', exact: true })
  await cancel.hover()
  await page.mouse.down()
  check(await cancel.evaluate((button) => ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(button).transform)), 'Reduced motion must disable press scaling')
  await page.mouse.up()

  await page.getByRole('button', { name: '设置', exact: true }).click()
  for (const name of ['森林绿', '暖阳橙']) {
    const card = page.getByRole('button', { name: new RegExp(`^${name}`) })
    await card.click()
    check(await card.getAttribute('aria-pressed') === 'true', `${name} remains selectable`)
    await page.screenshot({ path: resolve(artifacts, `apple-theme-${name}.png`) })
  }
  await page.getByLabel('选择自定义主色').fill('#d946ef')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'custom')
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.screenshot({ path: resolve(artifacts, 'apple-custom-dark.png') })
  await page.getByRole('button', { name: /^拾学蓝/ }).click()
  await page.getByRole('button', { name: '深色', exact: true }).click()
  const cdp = await page.context().newCDPSession(page)
  for (const feature of ['prefers-reduced-transparency', 'prefers-contrast']) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: feature, value: feature === 'prefers-contrast' ? 'more' : 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
    check(await page.evaluate((name) => matchMedia(`(${name}: ${name === 'prefers-contrast' ? 'more' : 'reduce'})`).matches, feature), `Browser must emulate ${feature}`)
    const material = await page.locator('.sidebar').evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, filter: style.backdropFilter }
    })
    check(!material.background.includes(' / ') && !material.background.startsWith('rgba(') && material.filter === 'none', `Dark ${feature} must have opaque chrome without blur: ${JSON.stringify(material)}`)
    check(await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return ['--material-thin', '--material-regular', '--material-clear'].every((name) => style.getPropertyValue(name).trim() === style.getPropertyValue('--surface').trim())
    }), `All dark material tokens must use opaque surfaces for ${feature}`)
  }
  await page.screenshot({ path: resolve(artifacts, 'apple-dark-contrast.png') })
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await cdp.detach()
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await page.getByRole('navigation', { name: '待办导航' }).getByRole('button', { name: '日历', exact: true }).click()
  await page.getByRole('button', { name: /^未安排/ }).click()
  await page.getByRole('button', { name: '管理日历', exact: true }).click()
  const manager = page.getByRole('dialog', { name: '管理日历', exact: true })
  const longTitle = 'AppleDesignLongCalendarName'.repeat(5)
  await manager.getByRole('textbox', { name: '日历名称', exact: true }).fill(longTitle)
  await manager.getByRole('button', { name: '保存日历', exact: true }).click()
  const edit = manager.getByRole('button', { name: `编辑 ${longTitle}`, exact: true })
  await edit.waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '2'))
  check(await edit.evaluate((button) => button.scrollWidth <= button.clientWidth && button.getBoundingClientRect().right <= innerWidth), 'Long action labels must wrap inside the sheet at 200% text scale')
  check(await manager.locator('.checkbox-label').last().evaluate((label) => label.scrollWidth <= label.clientWidth), 'Long checkbox labels must wrap without losing text')
  await page.screenshot({ path: resolve(artifacts, 'apple-long-label-200.png') })
  await manager.getByRole('button', { name: '保存日历', exact: true }).scrollIntoViewIfNeeded()
  check(await manager.getByRole('button', { name: '保存日历', exact: true }).evaluate((button) => {
    const box = button.getBoundingClientRect()
    return box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth
  }), 'Save remains reachable after large text reflow')
  await page.evaluate(() => document.documentElement.style.removeProperty('--font-scale'))
  await page.setViewportSize({ width: 1366, height: 768 })
  await manager.getByRole('button', { name: '关闭', exact: true }).click()
  assert.deepEqual(failures, [], 'Apple Design accessibility regression checks')
  console.log('Apple Design smoke passed: native input constraints, forced-color focus, dark reduced-transparency/contrast, long action labels at CSS text scale 200%')
}

function freePort() { return new Promise((resolvePort, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolvePort(address.port)) }) }) }
async function waitFor(url) { for (let i = 0; i < 80; i++) { try { const response = await fetch(url); if (response.ok) return } catch {} await new Promise((resolveWait) => setTimeout(resolveWait, 100)) } throw new Error(`Preview did not start: ${url}`) }

await main()
