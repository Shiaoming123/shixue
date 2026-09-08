import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveBrowserExecutable } from './smoke-web-persistence.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:18476/'
assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'Use an explicit loopback preview URL.')
const output = resolve('artifacts/soft-surface')
await mkdir(output, { recursive: true })
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const sourceDiff = git('diff', 'HEAD', '--', 'src', 'public', 'index.html', 'vite.config.ts')
const executablePath = resolveBrowserExecutable()
const browser = await chromium.launch({ executablePath, headless: true })
const report = {
  sourceCommit: git('rev-parse', 'HEAD').trim(),
  sourceDiffSha256: createHash('sha256').update(sourceDiff).digest('hex'),
  scriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  browserExecutable: executablePath, browserVersion: browser.version(), url,
  startedAt: new Date().toISOString(), results: [], success: false,
}
try {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({ viewport, colorScheme: mode, timezoneId: 'Asia/Shanghai' })
      const page = await context.newPage()
      page.setDefaultTimeout(10_000)
      const result = { viewport, mode, errors: [], warnings: [], captures: [], checks: [], success: false }
      report.results.push(result)
      page.on('console', (message) => {
        if (message.type() === 'error') result.errors.push(message.text())
        if (message.type() === 'warning') result.warnings.push(message.text())
      })
      page.on('pageerror', (error) => result.errors.push(error.message))
      const nav = page.locator(viewport.width < 820 ? '.tabbar' : '.sidebar')
      async function route(label) {
        if (label === '设置') {
          await page.locator(viewport.width < 820 ? '.mobile-header' : '.sidebar').getByRole('button', { name: '设置', exact: true }).click()
        } else if (['主题', '节律', '回顾'].includes(label)) {
          await nav.getByRole('button', { name: /^学习/ }).click()
          await page.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: label, exact: true }).click()
        } else if (viewport.width < 820 && ['最近 7 天', '已完成'].includes(label)) {
          await nav.getByRole('button', { name: '清单', exact: true }).click()
          await page.getByRole('button', { name: '更多清单', exact: true }).click()
          await page.getByRole('menuitem', { name: label, exact: true }).click()
        } else await nav.getByRole('button', { name: new RegExp(`^${label}`) }).click()
      }
      async function capture(name) {
        await page.waitForTimeout(420)
        const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
        assert.ok(overflow.scroll <= overflow.width + 1, `${name}: document horizontal overflow ${JSON.stringify(overflow)}`)
        const path = `${mode}-${viewport.width}-${name}.png`
        await page.screenshot({ path: resolve(output, path), fullPage: true })
        result.captures.push({ name, path, overflow })
      }
      try {
        await page.goto(url)
        await page.locator('.tasks-view').waitFor()
        await route('设置')
        await page.getByRole('button', { name: mode === 'dark' ? '深色' : '浅色', exact: true }).click()
        assert.equal(await page.locator('html').getAttribute('data-mode'), mode)
        result.contrast = await page.evaluate(() => {
          const probe = document.createElement('span'); document.body.append(probe)
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          const rgb = (token) => { probe.style.color = `var(${token})`; ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(probe).color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
          const lum = (color) => color.map((value) => value / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
          const pairs = ['--text', '--muted', '--accent'].flatMap((foreground) => ['--surface', '--bg'].map((background) => {
            const a = lum(rgb(foreground)); const b = lum(rgb(background))
            return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
          }))
          probe.remove(); return pairs
        })
        assert.ok(result.contrast.every(({ ratio }) => ratio >= 4.5), `Normal text semantic contrast: ${JSON.stringify(result.contrast)}`)
        await capture('settings')
        for (const [label, name] of [['收件箱', 'inbox'], ['今天', 'today'], ['最近 7 天', 'upcoming'], ['清单', 'lists'], ['已完成', 'completed'], ['日历', 'calendar'], ['主题', 'topics'], ['节律', 'rhythm'], ['回顾', 'review']]) {
          await route(label)
          await capture(name)
        }
        await page.getByRole('button', { name: '完成记录', exact: true }).click()
        await capture('records')
        await route('今天')
        await page.locator('.page-title h1').click()
        await page.keyboard.press('n')
        const composer = page.locator('.quick-add-composer')
        const input = composer.getByRole('textbox', { name: '新建任务' })
        assert.equal(await input.evaluate((element) => element === document.activeElement), true, 'N focuses Quick Add')
        const marker = `柔和表面验收 ${mode} ${viewport.width}`
        await input.fill(marker)
        const learning = composer.getByRole('button', { name: '学习任务', exact: true })
        assert.equal(await learning.getAttribute('aria-pressed'), 'false')
        await learning.click()
        assert.equal(await learning.getAttribute('aria-pressed'), 'true')
        await composer.getByRole('button', { name: '添加', exact: true }).click()
        await page.getByRole('button', { name: '编辑任务', exact: true }).waitFor()
        await capture('detail')
        await page.reload()
        await route('今天')
        await page.locator('.task-main').filter({ hasText: marker }).click()
        result.checks.push('N Quick Add; aria-pressed; created learning task persists after reload')
        await page.getByRole('button', { name: '编辑任务', exact: true }).click()
        const edit = page.getByRole('dialog', { name: '编辑任务', exact: true })
        await edit.waitFor()
        await capture('edit')
        const date = edit.getByRole('button', { name: '日期', exact: true })
        await date.click()
        await page.locator('.date-panel').waitFor()
        await capture('date-picker')
        await page.keyboard.press('Escape')
        await page.locator('.date-panel').waitFor({ state: 'hidden' })
        await page.waitForTimeout(250)
        assert.equal(await date.evaluate((element) => element === document.activeElement), true, 'Escape restores date trigger focus')
        await edit.getByRole('button', { name: '取消', exact: true }).click()
        result.checks.push('Nested date picker Escape restores focus and retains edit sheet')
        await page.getByRole('button', { name: '开始学习', exact: true }).click()
        await page.locator('.focus-view').waitFor()
        await capture('focus')
        await page.getByRole('button', { name: '完成并记录', exact: true }).click()
        await page.getByRole('dialog', { name: '把时间变成证据', exact: true }).waitFor()
        await capture('completion')
        await page.getByPlaceholder('用自己的话写一句结论').fill(`${marker}：验证了实验界面的学习完成链路`)
        await page.getByPlaceholder('文件、链接、测试结果或作品').fill('隔离浏览器上下文中的自动化记录')
        await page.getByPlaceholder('一个可在下次直接开始的动作').fill('检查本次记录')
        await page.getByRole('button', { name: '保存学习记录', exact: true }).click()
        await page.getByRole('dialog', { name: '把时间变成证据', exact: true }).waitFor({ state: 'hidden' })
        await route('回顾')
        await page.getByRole('button', { name: '完成记录', exact: true }).click()
        await page.locator('.record-main').filter({ hasText: marker }).waitFor()
        result.checks.push('Focus -> required learning evidence -> completion record')
        await page.emulateMedia({ reducedMotion: 'reduce' })
        for (const label of ['今天', '日历', '收件箱', '主题', '今天']) await route(label)
        await page.waitForTimeout(100)
        assert.equal(await page.locator('[role="dialog"]:visible').count(), 0)
        const transparent = await page.locator('main').evaluate((main) => [...main.querySelectorAll('*')].filter((el) => {
          const style = getComputedStyle(el)
          return el.getBoundingClientRect().width > 100 && el.getBoundingClientRect().height > 100 && style.opacity === '0' && style.pointerEvents !== 'none'
        }).map((el) => el.className))
        assert.deepEqual(transparent, [], 'No invisible large pointer-catching layer after rapid routes')
        await capture('reduced-motion')
        result.checks.push('Reduced motion; rapid navigation; no transparent blocking layer')
        if (viewport.width === 1440) {
          await page.evaluate(() => { document.body.style.zoom = '2' })
          await page.waitForTimeout(100)
          result.cssZoom200 = await page.evaluate(() => ({ kind: 'CSS zoom 2; not OS scaling or browser zoom', viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }))
          await page.screenshot({ path: resolve(output, `${mode}-1440-css-zoom-200.png`), fullPage: true })
          await page.evaluate(() => { document.body.style.zoom = '' })
        }
        assert.deepEqual(result.errors, [])
        result.success = true
      } catch (error) {
        result.failure = error.stack ?? String(error)
        await page.screenshot({ path: resolve(output, `${mode}-${viewport.width}-failure.png`) }).catch(() => {})
      } finally { await context.close() }
    }
  }
  report.success = report.results.every((result) => result.success)
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
}
console.log(JSON.stringify({ success: report.success, report: resolve(output, 'report.json'), results: report.results.map(({ viewport, mode, success, failure }) => ({ viewport, mode, success, failure })) }, null, 2))
if (!report.success) process.exitCode = 1
