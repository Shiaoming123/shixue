import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'
import { resolveBrowserExecutable } from '../scripts/smoke-web-persistence.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function availablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('Could not allocate a lifecycle test port.'))
        return
      }
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port))
    })
  })
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Vite has not started listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

test('global Quick Add ultimately focuses the composer after closing a delete confirmation', { timeout: 60_000 }, async () => {
  const port = await availablePort()
  const url = `http://127.0.0.1:${port}/`
  const viteCli = resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const vite = spawn(
    process.execPath,
    [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: projectRoot, stdio: 'ignore', windowsHide: true },
  )
  let browser

  try {
    await waitForServer(url)
    browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), headless: true })
    const page = await browser.newPage()
    page.setDefaultTimeout(5_000)
    await page.goto(url, { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: /^收件箱/ }).click()
    const marker = `lifecycle-focus-${Date.now()}`
    await page.getByRole('textbox', { name: '新建任务' }).fill(marker)
    await page.getByRole('button', { name: '添加', exact: true }).click()

    const taskRow = page.locator('.task-row').filter({ hasText: marker })
    await taskRow.waitFor({ state: 'visible' })
    await taskRow.hover()
    const deleteTrigger = taskRow.getByRole('button', { name: /^删除 / })
    await deleteTrigger.click()
    await page.getByRole('alertdialog').waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('button', { name: '取消', exact: true }).evaluate((element) => element === document.activeElement), true)

    await page.evaluate(() => window.dispatchEvent(new Event('shixue:quick-add')))
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))

    const composer = page.getByRole('textbox', { name: '新建任务' })
    assert.equal(await composer.evaluate((element) => element === document.activeElement), true)
  } finally {
    await browser?.close()
    if (!vite.killed) vite.kill()
  }
})
