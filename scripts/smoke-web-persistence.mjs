import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getNpmInvocation } from './release-kit/npm-command.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const quickAddArtifactRoot = resolve(projectRoot, 'artifacts', 'visual-qa', 'quick-add')
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
  await mkdir(quickAddArtifactRoot, { recursive: true })
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
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    try {
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.locator('.shell').waitFor({ state: 'visible' })
      if (await page.getByText('自动更新', { exact: true }).count()) {
        throw new Error('Web preview rendered a desktop-only updater entry.')
      }

      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name: /恢复演示内容/ }).click()
      await page.getByRole('button', { name: '确认恢复', exact: true }).click()

      const quickAddTitle = '明天下午3点 复习线代 #数学 p1'
      const quickAdd = page.locator('.quick-add-composer')
      await page.getByRole('button', { name: /^收件箱/ }).click()
      await quickAdd.getByRole('textbox', { name: '新建任务' }).fill(quickAddTitle)
      await quickAdd.getByRole('button', { name: /编辑计划.*15:00/ }).waitFor({ state: 'visible' })
      await quickAdd.getByRole('button', { name: '编辑标签 · 数学', exact: true }).waitFor({ state: 'visible' })
      await quickAdd.getByRole('button', { name: '编辑优先级 · 高优先级', exact: true }).waitFor({ state: 'visible' })

      await quickAdd.getByRole('button', { name: /编辑计划.*15:00/ }).click()
      const scheduleEditor = page.getByRole('dialog', { name: /编辑计划/ })
      if ((await scheduleEditor.getAttribute('aria-modal')) !== 'false') {
        throw new Error('Desktop schedule editor must remain a non-modal popover.')
      }
      const timeInput = scheduleEditor.getByRole('textbox', { name: '本地时间，可选' })
      await timeInput.fill('14:00')
      await timeInput.press('Tab')
      await page.screenshot({
        path: resolve(quickAddArtifactRoot, 'quick-add-desktop-picker-1440x960.png'),
      })
      await scheduleEditor.getByRole('button', { name: '应用', exact: true }).click()
      await quickAdd.getByRole('button', { name: /编辑计划.*14:00/ }).waitFor({ state: 'visible' })
      await quickAdd.getByRole('button', { name: '添加', exact: true }).click()

      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^全部/ }).click()
      await page.getByRole('searchbox', { name: '搜索任务' }).fill(quickAddTitle)
      const quickAddRow = page.locator('.task-row').filter({ hasText: quickAddTitle })
      await quickAddRow.getByText(quickAddTitle, { exact: true }).waitFor({ state: 'visible' })
      await quickAddRow.locator('.task-main').click()
      const quickAddDetail = page.getByRole('complementary', { name: '任务详情', exact: true })
      await quickAddDetail.getByRole('heading', { name: quickAddTitle, exact: true }).waitFor({ state: 'visible' })
      const plannedValue = quickAddDetail.locator('.facts div').filter({ hasText: '计划日期' }).locator('dd')
      if ((await plannedValue.textContent()) !== '明天 14:00') {
        throw new Error(`Quick add schedule was not preserved after reload: ${await plannedValue.textContent()}`)
      }
      const priorityValue = quickAddDetail.locator('.facts div').filter({ hasText: '优先级' }).locator('dd')
      if ((await priorityValue.textContent()) !== '高') {
        throw new Error(`Quick add priority was not preserved after reload: ${await priorityValue.textContent()}`)
      }
      const tagValue = quickAddDetail.locator('.facts div').filter({ hasText: '标签' }).locator('dd')
      if ((await tagValue.textContent()) !== '#数学') {
        throw new Error(`Quick add tag was not preserved after reload: ${await tagValue.textContent()}`)
      }

      await quickAddDetail.getByRole('button', { name: '编辑任务', exact: true }).click()
      const quickAddEditDialog = page.getByRole('dialog', { name: '编辑任务' })
      await quickAddEditDialog.getByLabel('任务备注').fill('精确时间编辑验证')
      await quickAddEditDialog.getByRole('button', { name: '保存', exact: true }).click()
      await quickAddEditDialog.waitFor({ state: 'hidden' })
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^全部/ }).click()
      await page.getByRole('searchbox', { name: '搜索任务' }).fill(quickAddTitle)
      const editedQuickAddRow = page.locator('.task-row').filter({ hasText: quickAddTitle })
      await editedQuickAddRow.locator('.task-main').click()
      const editedQuickAddDetail = page.getByRole('complementary', { name: '任务详情', exact: true })
      await editedQuickAddDetail.getByText('精确时间编辑验证', { exact: true }).waitFor({ state: 'visible' })
      const editedPlannedValue = editedQuickAddDetail.locator('.facts div').filter({ hasText: '计划日期' }).locator('dd')
      if ((await editedPlannedValue.textContent()) !== '明天 14:00') {
        throw new Error(`Quick add timed schedule changed after editing: ${await editedPlannedValue.textContent()}`)
      }

      const timedDeadlineTitle = '截止明天下午4点 提交报告'
      const timedDeadlineLookup = '提交报告'
      await page.getByRole('button', { name: /^收件箱/ }).click()
      const timedDeadlineComposer = page.locator('.quick-add-composer')
      const timedDeadlineInput = timedDeadlineComposer.getByRole('textbox', { name: '新建任务' })
      await timedDeadlineInput.fill(timedDeadlineTitle)
      await timedDeadlineComposer.getByRole('button', { name: /编辑截止.*16:00/ }).waitFor({ state: 'visible' })
      await timedDeadlineComposer.getByRole('button', { name: '添加', exact: true }).click()
      await timedDeadlineInput.waitFor({ state: 'visible' })
      await page.waitForFunction(() => document.querySelector('.quick-add-composer input')?.value === '' || document.querySelector('.quick-add-message.error'))
      if (await timedDeadlineInput.inputValue()) {
        throw new Error(`Timed deadline quick add failed: ${await timedDeadlineComposer.locator('.quick-add-message').textContent()}`)
      }
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^全部/ }).click()
      await page.getByRole('searchbox', { name: '搜索任务' }).fill(timedDeadlineLookup)
      await page.locator('.task-row').filter({ hasText: timedDeadlineLookup }).locator('.task-main').click()
      const timedDeadlineDetail = page.getByRole('complementary', { name: '任务详情', exact: true })
      const deadlineValue = timedDeadlineDetail.locator('.facts div').filter({ hasText: '截止日期' }).locator('dd')
      if ((await deadlineValue.textContent()) !== '明天 16:00') {
        throw new Error(`Quick add timed deadline was not preserved after reload: ${await deadlineValue.textContent()}`)
      }
      await timedDeadlineDetail.getByRole('button', { name: '编辑任务', exact: true }).click()
      const timedDeadlineEdit = page.getByRole('dialog', { name: '编辑任务' })
      await timedDeadlineEdit.getByLabel('任务备注').fill('精确截止编辑验证')
      await timedDeadlineEdit.getByRole('button', { name: '保存', exact: true }).click()
      await timedDeadlineEdit.waitFor({ state: 'hidden' })
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^全部/ }).click()
      await page.getByRole('searchbox', { name: '搜索任务' }).fill(timedDeadlineLookup)
      await page.locator('.task-row').filter({ hasText: timedDeadlineLookup }).locator('.task-main').click()
      const editedDeadlineDetail = page.getByRole('complementary', { name: '任务详情', exact: true })
      await editedDeadlineDetail.getByText('精确截止编辑验证', { exact: true }).waitFor({ state: 'visible' })
      const editedDeadlineValue = editedDeadlineDetail.locator('.facts div').filter({ hasText: '截止日期' }).locator('dd')
      if ((await editedDeadlineValue.textContent()) !== '明天 16:00') {
        throw new Error(`Quick add timed deadline changed after editing: ${await editedDeadlineValue.textContent()}`)
      }
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
      await page.getByRole('dialog', { name: '编辑任务' }).getByRole('button', { name: '日期', exact: true }).click()
      await page.getByRole('gridcell', { name: today, exact: true }).click()
      await page.getByRole('dialog', { name: '编辑任务' }).getByRole('button', { name: '优先级', exact: true }).click()
      await page.getByRole('listbox', { name: '优先级', exact: true }).getByRole('option', { name: '高', exact: true }).click()
      const taskEditDialog = page.getByRole('dialog', { name: '编辑任务' })
      await taskEditDialog.getByRole('button', { name: '保存', exact: true }).click()
      await taskEditDialog.waitFor({ state: 'hidden' })
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
      await page.evaluate(() => localStorage.setItem('meow-study-appearance', 'dark'))
      for (const viewport of [
        { width: 700, height: 844, hasBottomNav: true, modalPicker: true },
        { width: 810, height: 844, hasBottomNav: true, modalPicker: true },
        { width: 819, height: 844, hasBottomNav: true, modalPicker: true },
        { width: 820, height: 844, hasBottomNav: false, modalPicker: false },
        { width: 320, height: 700, hasBottomNav: true, modalPicker: true },
        { width: 390, height: 844, hasBottomNav: true, modalPicker: true },
      ]) {
        await page.setViewportSize(viewport)
        await page.reload({ waitUntil: 'networkidle' })
        const mobileNav = page.getByRole('navigation', { name: '移动端主导航' })
        await mobileNav.waitFor({ state: viewport.hasBottomNav ? 'visible' : 'hidden' })
        if (viewport.hasBottomNav) {
          await mobileNav.getByRole('button', { name: '收件箱', exact: true }).click()
        } else {
          const sidebar = page.locator('.sidebar')
          await sidebar.getByRole('button', { name: /^收件箱/ }).click()
          const sidebarBox = await sidebar.boundingBox()
          if (!sidebarBox || sidebarBox.width < 70 || sidebarBox.width > 74) {
            throw new Error(`Medium layout does not use the 72px icon sidebar at ${viewport.width}px: ${JSON.stringify(sidebarBox)}`)
          }
        }
        const compactQuickAdd = page.locator('.quick-add-composer')
        await compactQuickAdd.getByRole('textbox', { name: '新建任务' }).fill(quickAddTitle)
        const scheduleTrigger = compactQuickAdd.getByRole('button', { name: /编辑计划.*15:00/ })
        await scheduleTrigger.click()
        const scheduleSheet = page.getByRole('dialog', { name: /编辑计划/ })
        await scheduleSheet.waitFor({ state: 'visible' })
        if ((await scheduleSheet.getAttribute('aria-modal')) !== String(viewport.modalPicker)) {
          throw new Error(`Schedule editor modality is wrong at ${viewport.width}px.`)
        }
        if (viewport.modalPicker && !(await scheduleSheet.evaluate((element) => element.contains(document.activeElement)))) {
          throw new Error(`Compact schedule editor did not receive focus at ${viewport.width}px.`)
        }
        const apply = scheduleSheet.getByRole('button', { name: '应用', exact: true })
        await apply.scrollIntoViewIfNeeded()
        const applyBox = await apply.boundingBox()
        if (viewport.hasBottomNav) {
          const bottomNavBox = await mobileNav.boundingBox()
          if (!applyBox || !bottomNavBox || applyBox.y + applyBox.height > bottomNavBox.y) {
            throw new Error(`Compact picker actions overlap bottom navigation at ${viewport.width}px: apply=${JSON.stringify(applyBox)}, nav=${JSON.stringify(bottomNavBox)}`)
          }
        }
        if (!viewport.modalPicker) {
          await apply.click()
          await compactQuickAdd.getByRole('button', { name: /编辑计划.*15:00/ }).waitFor({ state: 'visible' })
          const mediumDetail = page.getByRole('complementary', { name: '任务详情', exact: true })
          if (!(await mediumDetail.isVisible())) await page.locator('.task-row').first().locator('.task-main').click()
          await mediumDetail.waitFor({ state: 'visible' })
          const [detailPosition, detailBox, tasksBox] = await Promise.all([
            mediumDetail.evaluate((element) => getComputedStyle(element).position),
            mediumDetail.boundingBox(),
            page.locator('.tasks-scroll').boundingBox(),
          ])
          if (detailPosition !== 'fixed' || !detailBox || !tasksBox || detailBox.x >= tasksBox.x + tasksBox.width) {
            throw new Error(`Medium detail is not an overlay drawer at ${viewport.width}px.`)
          }
          await mediumDetail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
          continue
        }
        await apply.focus()
        await page.keyboard.press('Tab')
        if (viewport.modalPicker && !(await scheduleSheet.evaluate((element) => element.contains(document.activeElement)))) {
          throw new Error(`Compact schedule editor did not trap focus at ${viewport.width}px.`)
        }
        await page.keyboard.press('Escape')
        await scheduleSheet.waitFor({ state: 'hidden' })
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('编辑计划'))
        await scheduleTrigger.click()
        await scheduleSheet.waitFor({ state: 'visible' })
        await page.mouse.click(2, 2)
        await scheduleSheet.waitFor({ state: 'hidden' })
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('编辑计划'))
        await scheduleTrigger.click()
        await scheduleSheet.waitFor({ state: 'visible' })
        if (viewport.width === 320) await scheduleSheet.getByRole('button', { name: '应用', exact: true }).scrollIntoViewIfNeeded()
        if (viewport.width === 390 || viewport.width === 320) {
          await scheduleSheet.evaluate((element) =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          if ((await scheduleSheet.evaluate((element) => getComputedStyle(element).opacity)) !== '1') {
            throw new Error('Compact schedule editor did not settle before visual capture.')
          }
          await page.screenshot({
            path: resolve(quickAddArtifactRoot, viewport.width === 390 ? 'quick-add-mobile-picker-390x844.png' : 'quick-add-mobile-min-picker-320x700.png'),
          })
        }
        if (viewport.width === 320) {
          const geometry = await scheduleSheet.evaluate((element) => ({
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          }))
          if (geometry.scrollWidth > geometry.clientWidth) {
            throw new Error(`Quick add candidate editor overflows at 320px: ${JSON.stringify(geometry)}`)
          }
          if (!(await apply.isVisible())) throw new Error('Quick add Apply action is not reachable at 320px.')
        }
        await scheduleSheet.getByRole('button', { name: '应用', exact: true }).click()
        await compactQuickAdd.getByRole('button', { name: /编辑计划.*15:00/ }).waitFor({ state: 'visible' })

        const tagTrigger = compactQuickAdd.getByRole('button', { name: '编辑标签 · 数学', exact: true })
        await tagTrigger.click()
        const tagSheet = page.getByRole('dialog', { name: '编辑标签 · 数学', exact: true })
        const tagListTrigger = tagSheet.getByRole('button', { name: '选择标签 · 数学', exact: true })
        await tagListTrigger.click()
        const tagList = page.getByRole('listbox', { name: '选择标签 · 数学', exact: true })
        await tagList.waitFor({ state: 'visible' })
        if (!(await tagSheet.evaluate((element) => element.contains(document.activeElement)))) {
          throw new Error(`Nested tag editor escaped the compact modal at ${viewport.width}px.`)
        }
        await page.keyboard.press('Escape')
        await tagList.waitFor({ state: 'hidden' })
        await tagSheet.waitFor({ state: 'visible' })
        if (!(await tagListTrigger.evaluate((element) => element === document.activeElement))) {
          throw new Error(`Nested tag editor did not restore focus at ${viewport.width}px.`)
        }
        await tagListTrigger.click()
        await tagList.waitFor({ state: 'visible' })
        await page.mouse.click(2, 2)
        await tagList.waitFor({ state: 'hidden' })
        await tagSheet.waitFor({ state: 'visible' })
        if (!(await tagListTrigger.evaluate((element) => element === document.activeElement))) {
          throw new Error(`Nested tag editor outside close did not restore focus at ${viewport.width}px.`)
        }
        await tagListTrigger.click()
        await tagList.waitFor({ state: 'visible' })
        await tagList.getByRole('option', { name: '数学', exact: true }).click()
        await tagList.waitFor({ state: 'hidden' })
        await tagSheet.getByRole('button', { name: '应用', exact: true }).click()
        await tagSheet.waitFor({ state: 'hidden' })
        if (!(await tagTrigger.evaluate((element) => element === document.activeElement))) {
          throw new Error(`Compact tag sheet did not restore chip focus at ${viewport.width}px.`)
        }
        await tagTrigger.click()
        await tagSheet.waitFor({ state: 'visible' })
        await page.mouse.click(2, 2)
        await tagSheet.waitFor({ state: 'hidden' })
        if (!(await tagTrigger.evaluate((element) => element === document.activeElement))) {
          throw new Error(`Compact tag sheet outside close did not restore focus at ${viewport.width}px.`)
        }
      }
      await page
        .getByRole('navigation', { name: '移动端主导航' })
        .getByRole('button', { name: '主题', exact: true })
        .click()
      await page.getByRole('heading', { name: '清单与主题' }).waitFor({ state: 'visible' })

      if (consoleErrors.length > 0 || pageErrors.length > 0) {
        throw new Error(`Web preview emitted errors:\n${[
          ...consoleErrors.map((message) => `console: ${message}`),
          ...pageErrors.map((message) => `page: ${message}`),
        ].join('\n')}`)
      }
      console.log(`Fresh browser errors: console=${consoleErrors.length}, page=${pageErrors.length}`)
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
