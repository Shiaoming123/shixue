import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getNpmInvocation } from './release-kit/npm-command.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
export function webSmokeUrl(port) {
  return `http://127.0.0.1:${port}/`
}

async function findAvailableLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('Could not allocate a loopback port for the Web smoke.'))
        return
      }
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port))
    })
  })
}

export function createStudyMarker(now = new Date().toISOString()) {
  return `study-task-${now.replace(/[^a-zA-Z0-9]+/g, '-')}`
}

export function resolveBrowserExecutable({
  platform = process.platform,
  env = process.env,
  exists = existsSync,
} = {}) {
  const explicitPath = env.MEOW_BROWSER_PATH?.trim()
  if (explicitPath) {
    if (!exists(explicitPath)) {
      throw new Error(`MEOW_BROWSER_PATH does not exist: ${explicitPath}`)
    }
    return explicitPath
  }

  const candidates =
    platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : platform === 'darwin'
        ? [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          ]
        : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium']

  const executable = candidates.find((candidate) => exists(candidate))
  if (!executable) {
    throw new Error(
      'No supported local browser was found. Install Edge or Chrome, or set MEOW_BROWSER_PATH to its executable.',
    )
  }
  return executable
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', ...options })
    child.once('error', rejectCommand)
    child.once('exit', (code, signal) => {
      if (code === 0) return resolveCommand()
      rejectCommand(new Error(`${command} exited with ${signal ?? code}`))
    })
  })
}

async function waitForPreview(url) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite has not started listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`Timed out waiting for Web preview at ${url}`)
}

function stopPreview(preview) {
  if (!preview.killed) preview.kill()
}

async function main() {
  const npm = getNpmInvocation(['run', 'build:web'])
  await runCommand(npm.command, npm.args, npm.options)

  const previewPort = await findAvailableLoopbackPort()
  const url = webSmokeUrl(previewPort)
  const viteCli = resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const preview = spawn(
    process.execPath,
    [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'],
    { cwd: projectRoot, stdio: 'inherit', windowsHide: true },
  )

  try {
    await waitForPreview(url)
    const executablePath = resolveBrowserExecutable()
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ executablePath, headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
    const page = await context.newPage()
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`))

    try {
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.locator('.shell').waitFor({ state: 'visible' })
      if (await page.getByText('自动更新', { exact: true }).count()) {
        throw new Error('Web preview rendered a desktop-only updater entry.')
      }

      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name: /恢复演示内容/ }).click()
      await page.getByRole('button', { name: '确认恢复', exact: true }).click()

      const marker = createStudyMarker()
      const editedMarker = `${marker}-edited`
      await page.getByRole('button', { name: /^收件箱/ }).click()
      await page.keyboard.press('/')
      const taskSearch = page.getByRole('searchbox', { name: '搜索任务' })
      await taskSearch.waitFor({ state: 'visible' })
      if (!(await taskSearch.evaluate((element) => element === document.activeElement))) {
        throw new Error('The task search shortcut did not move focus to the search field.')
      }
      await taskSearch.fill('')
      await page.getByRole('textbox', { name: '新建任务' }).fill(marker)
      await page.getByRole('button', { name: '添加', exact: true }).click()
      await page.locator('.task-row').filter({ hasText: marker }).waitFor({ state: 'visible' })

      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^收件箱/ }).click()
      const inboxRow = page.locator('.task-row').filter({ hasText: marker })
      await inboxRow.getByText(marker, { exact: true }).waitFor({ state: 'visible' })
      await inboxRow.locator('.task-main').click()
      await page.getByRole('button', { name: '编辑任务' }).click()
      await page.getByRole('dialog', { name: '编辑任务' }).getByLabel('任务标题').fill(editedMarker)
      await page.getByRole('dialog', { name: '编辑任务' }).getByLabel('任务备注').fill('持久化编辑验证')
      const today = new Date().toLocaleDateString('sv-SE')
      await page.getByRole('dialog', { name: '编辑任务' }).getByLabel('日期').fill(today)
      await page.getByRole('dialog', { name: '编辑任务' }).getByLabel('优先级').selectOption('high')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page.getByRole('button', { name: /^今天/ }).click()
      await page.locator('.task-row').getByText(editedMarker, { exact: true }).waitFor({ state: 'visible' })
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^今天/ }).click()
      await page.getByRole('searchbox', { name: '搜索任务' }).fill('持久化编辑验证')
      await page.locator('.task-row').getByText(editedMarker, { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('searchbox', { name: '搜索任务' }).fill('')
      await page.getByRole('button', { name: `完成 ${editedMarker}` }).click()
      await page.getByRole('button', { name: /^已完成/ }).click()
      await page.getByText(editedMarker, { exact: true }).waitFor({ state: 'visible' })

      await page.locator('.task-row').filter({ hasText: editedMarker }).getByRole('button').nth(1).click()
      await page.getByRole('complementary', { name: '任务详情', exact: true }).waitFor({ state: 'visible' })
      await page.screenshot({
        path: resolve(projectRoot, 'docs', 'design', 'shixue-tasks-desktop-implementation.png'),
      })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.evaluate(() => localStorage.setItem('meow-study-appearance', 'dark'))
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('navigation', { name: '移动端主导航' }).waitFor({ state: 'visible' })
      await page
        .getByRole('navigation', { name: '移动端主导航' })
        .getByRole('button', { name: '今天', exact: true })
        .click()
      await page.screenshot({
        path: resolve(projectRoot, 'docs', 'design', 'shixue-tasks-mobile-implementation.png'),
      })
      await page
        .getByRole('navigation', { name: '移动端主导航' })
        .getByRole('button', { name: '主题', exact: true })
        .click()
      await page.getByRole('heading', { name: '清单与主题' }).waitFor({ state: 'visible' })

      if (errors.length > 0) {
        throw new Error(`Web preview emitted errors:\n${errors.join('\n')}`)
      }
      console.log(`Study Web persistence and responsive smoke passed: ${marker}`)
    } finally {
      await context.close()
      await browser.close()
    }
  } finally {
    stopPreview(preview)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
