import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getNpmInvocation } from './release-kit/npm-command.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const quickAddArtifactRoot = resolve(projectRoot, 'artifacts', 'visual-qa', 'quick-add')
const rhythmArtifactRoot = resolve(projectRoot, 'artifacts', 'visual-qa', 'learning-rhythm')
const weeklyEvidenceArtifactRoot = resolve(projectRoot, 'artifacts', 'visual-qa', 'weekly-evidence')
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
  await mkdir(rhythmArtifactRoot, { recursive: true })
  await mkdir(weeklyEvidenceArtifactRoot, { recursive: true })
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
    const hostNow = new Date()
    const smokeClock = new Date(hostNow)
    smokeClock.setDate(hostNow.getDate() - ((hostNow.getDay() + 6) % 7))
    smokeClock.setHours(12, 0, 0, 0)
    const smokeNow = smokeClock.toISOString()
    await context.addInitScript(({ now }) => {
      const NativeDate = Date
      const fixedTime = NativeDate.parse(now)
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [fixedTime])) }
        static now() { return fixedTime }
      }
    }, { now: smokeNow })
    const page = await context.newPage()
    const consoleErrors = []
    const consoleWarnings = []
    const pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
      if (message.type() === 'warning' && message.text().includes('Extraneous non-props attributes')) {
        consoleWarnings.push(message.text())
      }
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

      const rhythmTaskTitle = '精听并跟读一段 3 分钟技术视频'
      const rhythmTopicTitle = '英语：听懂 AI 技术分享'
      const rhythmLearned = '我能稳定听出重音并复述三个关键观点。'
      await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
      const rhythmSearch = page.getByRole('dialog', { name: '搜索学习事实', exact: true })
      await rhythmSearch.getByRole('searchbox', { name: '搜索任务与完成记录', exact: true }).fill(rhythmTaskTitle)
      await rhythmSearch.locator('.result-row').filter({ hasText: rhythmTaskTitle }).click()
      const rhythmTaskDetail = page.getByRole('complementary', { name: '任务详情', exact: true })
      await rhythmTaskDetail.getByRole('heading', { name: rhythmTaskTitle, exact: true }).waitFor({ state: 'visible' })
      await rhythmTaskDetail.getByRole('button', { name: '编辑任务', exact: true }).click()
      const rhythmTaskEditor = page.getByRole('dialog', { name: '编辑任务', exact: true })
      await rhythmTaskEditor.getByRole('button', { name: '保存重复', exact: true }).click()
      await rhythmTaskEditor.getByRole('button', { name: '保存', exact: true }).click()
      await rhythmTaskEditor.waitFor({ state: 'hidden' })

      await page.locator('.sidebar').getByRole('button', { name: /^学习/ }).click()
      await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '节律', exact: true }).click()
      const rhythmView = page.locator('.rhythm-view')
      const rhythmRow = rhythmView.locator('.rhythm-row').filter({ hasText: rhythmTaskTitle })
      await rhythmRow.getByText(rhythmTaskTitle, { exact: true }).waitFor({ state: 'visible' })
      await rhythmRow.getByText(/本周 0 \/ \d+ 次/).waitFor({ state: 'visible' })
      await page.screenshot({ path: resolve(rhythmArtifactRoot, 'learning-rhythm-desktop-before-1440x960.png') })
      await rhythmRow.getByRole('button', { name: '继续本次', exact: true }).click()
      await rhythmTaskDetail.getByText('本次计划', { exact: true }).waitFor({ state: 'visible' })
      await rhythmTaskDetail.locator('.primary').getByText('完成本次', { exact: true }).click()
      const completionSheet = page.getByRole('dialog', { name: '把时间变成证据', exact: true })
      await completionSheet.getByLabel('今天真正弄懂了什么？', { exact: true }).fill(rhythmLearned)
      await completionSheet.getByLabel('成果或证据在哪里？', { exact: true }).fill('Web smoke：节律实例完成链路')
      await completionSheet.getByLabel('下一步具体做什么？', { exact: true }).fill('下一次继续跟读并对照录音')
      await completionSheet.getByRole('button', { name: '保存学习记录', exact: true }).click()
      await completionSheet.waitFor({ state: 'hidden' })
      await page.locator('.sidebar').getByRole('button', { name: /^学习/ }).click()
      await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '节律', exact: true }).click()
      await rhythmView.locator('.recent-learned').filter({ hasText: rhythmLearned }).waitFor({ state: 'visible' })
      await rhythmView.getByText(/本周 1 \/ \d+ 次/).waitFor({ state: 'visible' })

      await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '回顾', exact: true }).click()
      const weeklySummary = page.locator('.weekly-summary')
      await weeklySummary.getByRole('heading', { name: '本周证据', exact: true }).waitFor({ state: 'visible' })
      const learningTopicSummary = weeklySummary.locator('.weekly-topics > article').filter({ hasText: rhythmTopicTitle })
      const evidenceCoverageMetric = learningTopicSummary.getByRole('button', { name: /1 \/ 1\s*已留证据/ })
      await evidenceCoverageMetric.waitFor({ state: 'visible' })
      const dueReviewMetric = learningTopicSummary.getByRole('button', { name: /\d+\s*本周应复习/ })
      await dueReviewMetric.click()
      const dueReviewSource = weeklySummary.locator('.due-review-row').filter({ hasText: rhythmTaskTitle }).first()
      await dueReviewSource.waitFor({ state: 'visible' })
      if (!(await dueReviewSource.getAttribute('data-due-review-id'))?.startsWith('review-link:')) {
        throw new Error('Weekly review coverage did not expose the exact review-link source.')
      }
      if (!/^(本周稍后|今日到期|已逾期|已完成)，/.test(await dueReviewSource.getAttribute('aria-label') ?? '')) {
        throw new Error('Weekly due-review source did not expose its state in text.')
      }
      await dueReviewSource.click()
      await rhythmTaskDetail.getByRole('heading', { name: `复习 · ${rhythmTaskTitle}`, exact: true }).waitFor({ state: 'visible' })
      await rhythmTaskDetail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name: /^学习/ }).click()
      await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '回顾', exact: true }).click()
      await weeklySummary.getByRole('heading', { name: '本周证据', exact: true }).waitFor({ state: 'visible' })
      const restoredLearningTopicSummary = weeklySummary.locator('.weekly-topics > article').filter({ hasText: rhythmTopicTitle })
      const restoredDueReviewMetric = restoredLearningTopicSummary.getByRole('button', { name: /\d+\s*本周应复习/ })
      await restoredDueReviewMetric.click()
      await weeklySummary.locator('.due-review-scope').getByRole('button', { name: '返回本周证据', exact: true }).click()
      if (!(await restoredDueReviewMetric.evaluate((element) => element === document.activeElement))) {
        throw new Error('Weekly due-review drilldown did not restore metric focus.')
      }
      await restoredLearningTopicSummary.getByRole('button', { name: /\d+\s*计划\s*预计/ }).click()
      const planSources = weeklySummary.locator('.plan-source-row').filter({ hasText: rhythmTaskTitle })
      await planSources.first().waitFor({ state: 'visible' })
      const focusedPlanTarget = await page.evaluate(() => document.activeElement?.className ?? '')
      if (!String(focusedPlanTarget).includes((await planSources.count()) === 1 ? 'plan-source-row' : 'plan-scope')) {
        throw new Error('Weekly plan drilldown did not focus its source list.')
      }
      if (!(await planSources.first().getAttribute('data-plan-source-id'))?.startsWith('occurrence:')) {
        throw new Error('Weekly recurring plan did not expose an occurrence source.')
      }
      if (!/^(待完成|已完成|已取消|已跳过)，/.test(await planSources.first().getAttribute('aria-label') ?? '')) {
        throw new Error('Weekly plan source did not expose its status in text.')
      }
      await planSources.first().click()
      await rhythmTaskDetail.getByRole('heading', { name: rhythmTaskTitle, exact: true }).waitFor({ state: 'visible' })
      await rhythmTaskDetail.getByText('本次计划', { exact: true }).waitFor({ state: 'visible' })
      await rhythmTaskDetail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name: /^学习/ }).click()
      await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '回顾', exact: true }).click()
      await weeklySummary.getByRole('heading', { name: '本周证据', exact: true }).waitFor({ state: 'visible' })
      const activeReviewCard = page.locator('.review-card')
      await activeReviewCard.getByRole('button', { name: '想过了，查看证据', exact: true }).click()
      await activeReviewCard.getByRole('button', { name: '记得清楚', exact: true }).click()
      await page.getByText('已安排下一次回顾。', { exact: true }).waitFor({ state: 'visible' })
      const completedDueMetric = weeklySummary.locator('.coverage-metrics button:not([disabled])').filter({ hasText: '已完成到期复习' }).first()
      await completedDueMetric.click()
      const completedDueSource = weeklySummary.locator('.due-review-row').filter({ hasText: '已完成' }).first()
      await completedDueSource.waitFor({ state: 'visible' })
      const completedDueRecordId = await completedDueSource.getAttribute('data-record-id')
      if (!completedDueRecordId) throw new Error('Completed due-review source did not retain its completion record identity.')
      await completedDueSource.click()
      const completedDueRecord = page.locator(`.record-main[data-record-id="${completedDueRecordId}"]`)
      await completedDueRecord.waitFor({ state: 'visible' })
      if (!(await completedDueRecord.evaluate((element) => element === document.activeElement))) {
        throw new Error('Completed due-review source did not focus its exact completion record.')
      }
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('.sidebar').getByRole('button', { name: /^学习/ }).click()
      await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '回顾', exact: true }).click()
      await weeklySummary.getByRole('heading', { name: '本周证据', exact: true }).waitFor({ state: 'visible' })
      await weeklySummary.locator('.coverage-metrics').getByRole('button', { name: /[1-9]\d*\s*已完成到期复习/ }).first().waitFor({ state: 'visible' })
      const refreshedLearningTopicSummary = weeklySummary.locator('.weekly-topics > article').filter({ hasText: rhythmTopicTitle })
      await refreshedLearningTopicSummary.getByRole('button', { name: /1 \/ 1\s*已留证据/ }).click()
      const weeklyRecord = page.locator('.record-list > article').filter({ hasText: rhythmLearned })
      await weeklyRecord.getByText(rhythmLearned, { exact: true }).waitFor({ state: 'visible' })
      const weeklyRecordMain = weeklyRecord.locator('.record-main')
      if (!(await weeklyRecordMain.evaluate((element) => element === document.activeElement))) {
        throw new Error('Weekly evidence drilldown did not focus its single source record.')
      }
      const openWeeklyTask = weeklyRecord.getByRole('button', { name: '查看原任务', exact: true })
      if (!(await openWeeklyTask.isVisible())) await weeklyRecord.locator('.record-main').click()
      await openWeeklyTask.click()
      await page.getByRole('complementary', { name: '任务详情', exact: true }).getByRole('heading', { name: rhythmTaskTitle, exact: true }).waitFor({ state: 'visible' })
      const taskSurface = page.locator('.tasks-view')
      await taskSurface.getByRole('button', { name: '筛选', exact: true }).click()
      await taskSurface.getByRole('button', { name: '清单', exact: true }).click()
      await page.getByRole('listbox', { name: '清单', exact: true }).getByRole('option', { name: '全部清单', exact: true }).click()
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('.sidebar').getByRole('button', { name: /^学习/ }).click()
      await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '节律', exact: true }).click()
      await rhythmView.locator('.recent-learned').filter({ hasText: rhythmLearned }).waitFor({ state: 'visible' })
      await rhythmView.getByText(/本周 1 \/ \d+ 次/).waitFor({ state: 'visible' })

      const managedTag = `烟测标签-${Date.now()}`
      const renamedManagedTag = `${managedTag}-已改名`
      await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
      const desktopGlobalSearch = page.getByRole('dialog', { name: '搜索学习事实', exact: true })
      await desktopGlobalSearch.waitFor({ state: 'visible' })
      const desktopGlobalSearchInput = desktopGlobalSearch.getByRole('searchbox', { name: '搜索任务与完成记录', exact: true })
      if (!(await desktopGlobalSearchInput.evaluate((element) => element === document.activeElement))) {
        throw new Error('Opening global search did not move focus to the search field.')
      }
      await desktopGlobalSearchInput.fill('持久化')
      await desktopGlobalSearch.getByRole('heading', { name: /^任务/ }).waitFor({ state: 'visible' })
      await desktopGlobalSearch.getByRole('heading', { name: /^完成记录/ }).waitFor({ state: 'visible' })
      await desktopGlobalSearch.getByRole('button', { name: '管理标签', exact: true }).click()

      const tagManager = page.getByRole('dialog', { name: '管理标签', exact: true })
      await tagManager.getByLabel('新标签', { exact: true }).fill(managedTag)
      await tagManager.getByRole('button', { name: '创建', exact: true }).click()
      await tagManager.getByText(managedTag, { exact: true }).waitFor({ state: 'visible' })
      await tagManager.getByRole('button', { name: `重命名标签 ${managedTag}`, exact: true }).click()
      await tagManager.getByRole('textbox', { name: `重命名标签 ${managedTag}`, exact: true }).fill(renamedManagedTag)
      await tagManager.getByRole('button', { name: '保存标签名称', exact: true }).click()
      await tagManager.getByText(renamedManagedTag, { exact: true }).waitFor({ state: 'visible' })
      await tagManager.getByRole('button', { name: `归档标签 ${renamedManagedTag}`, exact: true }).click()
      await tagManager.getByText(renamedManagedTag, { exact: true }).waitFor({ state: 'visible' })
      await tagManager.getByRole('button', { name: '关闭标签管理', exact: true }).click()
      await desktopGlobalSearch.waitFor({ state: 'visible' })
      if (!(await desktopGlobalSearchInput.evaluate((element) => element === document.activeElement))) {
        throw new Error('Closing tag management did not restore the global search context and focus.')
      }
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      await page.getByText('已撤销。', { exact: true }).waitFor({ state: 'visible' })
      await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
      await page.getByRole('dialog', { name: '搜索学习事实', exact: true }).getByRole('button', { name: '管理标签', exact: true }).click()
      const reopenedTagManager = page.getByRole('dialog', { name: '管理标签', exact: true })
      const activeTagSection = reopenedTagManager.getByRole('heading', { name: '正在使用', exact: true }).locator('..').locator('..')
      await activeTagSection.getByText(renamedManagedTag, { exact: true }).waitFor({ state: 'visible' })
      await reopenedTagManager.getByRole('button', { name: '关闭标签管理', exact: true }).click()
      await desktopGlobalSearch.waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')

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
      const quickAddInput = quickAdd.getByRole('textbox', { name: '新建任务' })
      await page.waitForFunction(() => document.querySelector('.quick-add-composer input')?.value === '' || document.querySelector('.quick-add-message.error'))
      if (await quickAddInput.inputValue()) {
        throw new Error(`Quick add failed: ${await quickAdd.locator('.quick-add-message').textContent()}`)
      }

      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^最近 7 天/ }).click()
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
      await page.getByRole('button', { name: /^最近 7 天/ }).click()
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
      await page.getByRole('button', { name: /^最近 7 天/ }).click()
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
      await page.getByRole('button', { name: /^最近 7 天/ }).click()
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
      const today = smokeClock.toLocaleDateString('sv-SE')
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

      await page.locator('.task-row').filter({ hasText: editedMarker }).locator('.task-main').click()
      await page.locator('.detail-drawer').waitFor({ state: 'visible' })
      await page.evaluate(() => localStorage.setItem('meow-study-appearance', 'dark'))
      for (const viewport of [
        { width: 700, height: 844, hasBottomNav: true, modalPicker: true },
        { width: 810, height: 844, hasBottomNav: true, modalPicker: true },
        { width: 819, height: 844, hasBottomNav: true, modalPicker: true },
        { width: 820, height: 844, hasBottomNav: false, modalPicker: false },
        { width: 390, height: 844, hasBottomNav: true, modalPicker: true },
        { width: 320, height: 700, hasBottomNav: true, modalPicker: true },
        { width: 359, height: 700, hasBottomNav: true, modalPicker: true },
        { width: 360, height: 700, hasBottomNav: true, modalPicker: true },
        { width: 369, height: 700, hasBottomNav: true, modalPicker: true },
        { width: 370, height: 700, hasBottomNav: true, modalPicker: true },
      ]) {
        console.log(`Responsive smoke viewport: ${viewport.width}x${viewport.height}`)
        await page.setViewportSize(viewport)
        await page.reload({ waitUntil: 'networkidle' })
        const mobileNav = page.getByRole('navigation', { name: '移动端主导航' })
        await mobileNav.waitFor({ state: viewport.hasBottomNav ? 'visible' : 'hidden' })
        if (viewport.hasBottomNav) {
          await mobileNav.getByRole('button', { name: '收件箱', exact: true }).click()
          if (viewport.width === 390) {
            await mobileNav.getByRole('button', { name: '清单', exact: true }).click()
            await page.getByRole('heading', { name: '全部任务', exact: true }).waitFor({ state: 'visible' })
            const listsMoreTrigger = page.getByRole('button', { name: '更多清单', exact: true })
            await listsMoreTrigger.click()
            const listsMoreSheet = page.getByRole('dialog', { name: '清单更多导航', exact: true })
            await listsMoreSheet.getByRole('menuitem', { name: '最近 7 天', exact: true }).click()
            await page.getByRole('heading', { name: '最近 7 天', exact: true }).waitFor({ state: 'visible' })
            await mobileNav.getByRole('button', { name: '清单', exact: true }).click()
            await page.getByRole('button', { name: '更多清单', exact: true }).click()
            await page.getByRole('dialog', { name: '清单更多导航', exact: true }).getByRole('menuitem', { name: '已完成', exact: true }).click()
            await page.getByRole('heading', { name: '已完成', exact: true }).waitFor({ state: 'visible' })
            await mobileNav.getByRole('button', { name: '学习', exact: true }).click()
            await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '回顾', exact: true }).click()
            await page.getByRole('heading', { name: '确认自己是否真的记住', exact: true }).waitFor({ state: 'visible' })
            await mobileNav.getByRole('button', { name: '收件箱', exact: true }).click()
          }
        } else {
          const sidebar = page.locator('.sidebar')
          await sidebar.getByRole('button', { name: /^收件箱/ }).click()
          const sidebarBox = await sidebar.boundingBox()
          if (!sidebarBox || sidebarBox.width < 70 || sidebarBox.width > 74) {
            throw new Error(`Medium layout does not use the 72px icon sidebar at ${viewport.width}px: ${JSON.stringify(sidebarBox)}`)
          }
        }

        const primaryNavigation = viewport.hasBottomNav ? mobileNav : page.locator('.sidebar')
        await primaryNavigation.getByRole('button', { name: /^学习/ }).click()
        await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '节律', exact: true }).click()
        const responsiveRhythm = page.locator('.rhythm-view')
        await responsiveRhythm.getByText(rhythmTaskTitle, { exact: true }).waitFor({ state: 'visible' })
        const rhythmGeometry = await responsiveRhythm.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return {
            left: box.left,
            right: box.right,
            width: box.width,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            viewportWidth: document.documentElement.clientWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
          }
        })
        if (rhythmGeometry.left < -0.5 || rhythmGeometry.right > rhythmGeometry.viewportWidth + 0.5
          || rhythmGeometry.scrollWidth > rhythmGeometry.clientWidth || rhythmGeometry.pageScrollWidth > rhythmGeometry.viewportWidth) {
          throw new Error(`Learning rhythm overflows at ${viewport.width}px: ${JSON.stringify(rhythmGeometry)}`)
        }
        const undersizedRhythmAction = await responsiveRhythm.getByRole('button').evaluateAll((buttons) => buttons
          .map((button) => ({ label: button.textContent?.trim(), height: button.getBoundingClientRect().height }))
          .find(({ height }) => height < 44))
        if (undersizedRhythmAction) {
          throw new Error(`Learning rhythm action is smaller than 44px at ${viewport.width}px: ${JSON.stringify(undersizedRhythmAction)}`)
        }
        if (viewport.width === 820 || viewport.width === 390 || viewport.width === 320) {
          await page.screenshot({
            path: resolve(rhythmArtifactRoot, viewport.width === 820
              ? 'learning-rhythm-medium-820x844.png'
              : viewport.width === 390
                ? 'learning-rhythm-mobile-390x844.png'
                : 'learning-rhythm-mobile-min-320x700.png'),
          })
        }
        await page.getByRole('navigation', { name: '学习导航', exact: true }).getByRole('button', { name: '回顾', exact: true }).click()
        const responsiveWeeklySummary = page.locator('.weekly-summary')
        await responsiveWeeklySummary.getByRole('heading', { name: '本周证据', exact: true }).waitFor({ state: 'visible' })
        const weeklyGeometry = await responsiveWeeklySummary.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return { left: box.left, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, viewportWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth }
        })
        if (weeklyGeometry.left < -0.5 || weeklyGeometry.right > weeklyGeometry.viewportWidth + 0.5
          || weeklyGeometry.scrollWidth > weeklyGeometry.clientWidth || weeklyGeometry.pageScrollWidth > weeklyGeometry.viewportWidth) {
          throw new Error(`Weekly evidence overflows at ${viewport.width}px: ${JSON.stringify(weeklyGeometry)}`)
        }
        const undersizedWeeklyMetric = await responsiveWeeklySummary.locator('.weekly-metrics').getByRole('button').evaluateAll((buttons) => buttons
          .map((button) => ({ label: button.textContent?.trim(), height: button.getBoundingClientRect().height }))
          .find(({ height }) => height < 44))
        if (undersizedWeeklyMetric) throw new Error(`Weekly evidence metric is smaller than 44px at ${viewport.width}px: ${JSON.stringify(undersizedWeeklyMetric)}`)
        const undersizedPlanMetric = await responsiveWeeklySummary.locator('.plan-metrics').getByRole('button').evaluateAll((buttons) => buttons
          .map((button) => ({ label: button.textContent?.trim(), height: button.getBoundingClientRect().height }))
          .find(({ height }) => height < 44))
        if (undersizedPlanMetric) throw new Error(`Weekly plan metric is smaller than 44px at ${viewport.width}px: ${JSON.stringify(undersizedPlanMetric)}`)
        const undersizedCoverageMetric = await responsiveWeeklySummary.locator('.coverage-metrics').getByRole('button').evaluateAll((buttons) => buttons
          .map((button) => ({ label: button.textContent?.trim(), height: button.getBoundingClientRect().height }))
          .find(({ height }) => height < 44))
        if (undersizedCoverageMetric) throw new Error(`Weekly coverage metric is smaller than 44px at ${viewport.width}px: ${JSON.stringify(undersizedCoverageMetric)}`)
        const responsiveTopicSummary = responsiveWeeklySummary.locator('.weekly-topics > article').filter({ hasText: rhythmTopicTitle })
        const planGridColumns = await responsiveTopicSummary.locator('.plan-metrics').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length)
        const coverageGridColumns = await responsiveTopicSummary.locator('.coverage-metrics').first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length)
        if (viewport.width === 820 && planGridColumns !== 2) {
          throw new Error(`Weekly plan metrics are not two columns at 820px: ${planGridColumns}`)
        }
        if (viewport.width === 820 && coverageGridColumns !== 2) {
          throw new Error(`Weekly coverage metrics are not two columns at 820px: ${coverageGridColumns}`)
        }
        if ((viewport.width === 390 || viewport.width === 320) && planGridColumns !== 1) {
          throw new Error(`Weekly plan metrics are not one column at ${viewport.width}px: ${planGridColumns}`)
        }
        if ((viewport.width === 390 || viewport.width === 320) && coverageGridColumns !== 1) {
          throw new Error(`Weekly coverage metrics are not one column at ${viewport.width}px: ${coverageGridColumns}`)
        }
        if (viewport.width === 820 || viewport.width === 390 || viewport.width === 320) {
          await page.screenshot({ path: resolve(weeklyEvidenceArtifactRoot, `weekly-evidence-${viewport.width}x${viewport.height}.png`) })
          const responsiveDueMetric = responsiveTopicSummary.getByRole('button', { name: /\d+\s*本周应复习/ })
          await responsiveDueMetric.scrollIntoViewIfNeeded()
          await responsiveDueMetric.click()
          const responsiveDueScope = responsiveWeeklySummary.locator('.due-review-scope')
          const responsiveDueSource = responsiveWeeklySummary.locator('.due-review-row').filter({ hasText: rhythmTaskTitle }).first()
          await responsiveDueSource.scrollIntoViewIfNeeded()
          const expandedDueGeometry = await responsiveWeeklySummary.evaluate((element) => {
            const row = element.querySelector('.due-review-row')
            const back = element.querySelector('.due-review-scope button')
            const rowBox = row?.getBoundingClientRect()
            const backBox = back?.getBoundingClientRect()
            return {
              viewportWidth: document.documentElement.clientWidth,
              pageScrollWidth: document.documentElement.scrollWidth,
              summaryScrollWidth: element.scrollWidth,
              summaryClientWidth: element.clientWidth,
              row: rowBox ? { left: rowBox.left, right: rowBox.right, height: rowBox.height } : null,
              back: backBox ? { left: backBox.left, right: backBox.right, height: backBox.height } : null,
            }
          })
          if (!expandedDueGeometry.row || !expandedDueGeometry.back
            || expandedDueGeometry.row.left < -0.5 || expandedDueGeometry.row.right > expandedDueGeometry.viewportWidth + 0.5
            || expandedDueGeometry.back.left < -0.5 || expandedDueGeometry.back.right > expandedDueGeometry.viewportWidth + 0.5
            || expandedDueGeometry.row.height < 44 || expandedDueGeometry.back.height < 44
            || expandedDueGeometry.summaryScrollWidth > expandedDueGeometry.summaryClientWidth
            || expandedDueGeometry.pageScrollWidth > expandedDueGeometry.viewportWidth) {
            throw new Error(`Expanded weekly due reviews are not reachable at ${viewport.width}px: ${JSON.stringify(expandedDueGeometry)}`)
          }
          await page.screenshot({ path: resolve(weeklyEvidenceArtifactRoot, `weekly-due-reviews-${viewport.width}x${viewport.height}.png`) })
          await responsiveDueScope.getByRole('button', { name: '返回本周证据', exact: true }).click()
          if (!(await responsiveDueMetric.evaluate((element) => element === document.activeElement))) {
            throw new Error(`Weekly due-review drilldown did not restore metric focus at ${viewport.width}px.`)
          }
          const responsivePlanMetric = responsiveTopicSummary.getByRole('button', { name: /\d+\s*计划\s*预计/ })
          await responsivePlanMetric.scrollIntoViewIfNeeded()
          await responsivePlanMetric.click()
          const responsivePlanScope = responsiveWeeklySummary.locator('.plan-scope')
          const responsivePlanSource = responsiveWeeklySummary.locator('.plan-source-row').filter({ hasText: rhythmTaskTitle }).first()
          await responsivePlanSource.scrollIntoViewIfNeeded()
          const expandedPlanGeometry = await responsiveWeeklySummary.evaluate((element) => {
            const row = element.querySelector('.plan-source-row')
            const back = element.querySelector('.plan-scope button')
            const rowBox = row?.getBoundingClientRect()
            const backBox = back?.getBoundingClientRect()
            return {
              viewportWidth: document.documentElement.clientWidth,
              pageScrollWidth: document.documentElement.scrollWidth,
              summaryScrollWidth: element.scrollWidth,
              summaryClientWidth: element.clientWidth,
              row: rowBox ? { left: rowBox.left, right: rowBox.right, height: rowBox.height } : null,
              back: backBox ? { left: backBox.left, right: backBox.right, height: backBox.height } : null,
            }
          })
          if (!expandedPlanGeometry.row || !expandedPlanGeometry.back
            || expandedPlanGeometry.row.left < -0.5 || expandedPlanGeometry.row.right > expandedPlanGeometry.viewportWidth + 0.5
            || expandedPlanGeometry.back.left < -0.5 || expandedPlanGeometry.back.right > expandedPlanGeometry.viewportWidth + 0.5
            || expandedPlanGeometry.row.height < 44 || expandedPlanGeometry.back.height < 44
            || expandedPlanGeometry.summaryScrollWidth > expandedPlanGeometry.summaryClientWidth
            || expandedPlanGeometry.pageScrollWidth > expandedPlanGeometry.viewportWidth) {
            throw new Error(`Expanded weekly plan is not reachable at ${viewport.width}px: ${JSON.stringify(expandedPlanGeometry)}`)
          }
          await page.screenshot({ path: resolve(weeklyEvidenceArtifactRoot, `weekly-plan-sources-${viewport.width}x${viewport.height}.png`) })
          await responsivePlanScope.getByRole('button', { name: '返回本周证据', exact: true }).click()
          if (!(await responsivePlanMetric.evaluate((element) => element === document.activeElement))) {
            throw new Error(`Weekly plan drilldown did not restore metric focus at ${viewport.width}px.`)
          }
        }
        await primaryNavigation.getByRole('button', { name: /^收件箱/ }).click()

        const searchTrigger = viewport.hasBottomNav
          ? page.getByRole('button', { name: '全局搜索', exact: true })
          : page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true })
        await searchTrigger.click()
        const globalSearch = page.getByRole('dialog', { name: '搜索学习事实', exact: true })
        await globalSearch.waitFor({ state: 'visible' })
        await globalSearch.getByRole('searchbox', { name: '搜索任务与完成记录', exact: true }).fill('持久化')
        await globalSearch.getByRole('heading', { name: /^任务/ }).waitFor({ state: 'visible' })
        await globalSearch.getByRole('heading', { name: /^完成记录/ }).waitFor({ state: 'visible' })
        if (viewport.width === 820 || viewport.width === 390) {
          const searchDateTrigger = globalSearch.getByRole('button', { name: '开始日期', exact: true })
          await searchDateTrigger.click()
          const searchDatePicker = page.getByRole('dialog', { name: '开始日期', exact: true })
          await searchDatePicker.waitFor({ state: 'visible' })
          if ((await searchDatePicker.getAttribute('aria-modal')) !== String(viewport.hasBottomNav)) {
            throw new Error(`Global search date picker modality is wrong at ${viewport.width}px.`)
          }
          if (await searchDatePicker.getByRole('gridcell').count() !== 42) {
            throw new Error(`Global search date picker did not expose 42 day targets at ${viewport.width}px.`)
          }
          await page.keyboard.press('Escape')
          await searchDatePicker.waitFor({ state: 'hidden' })
          if (!(await searchDateTrigger.evaluate((element) => element === document.activeElement))) {
            throw new Error(`Global search date picker did not restore focus at ${viewport.width}px.`)
          }
        }
        const searchGeometry = await globalSearch.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return {
            left: box.left,
            right: box.right,
            width: box.width,
            viewportWidth: document.documentElement.clientWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
          }
        })
        if (searchGeometry.left < -0.5 || searchGeometry.right > searchGeometry.viewportWidth + 0.5
          || searchGeometry.pageScrollWidth > searchGeometry.viewportWidth) {
          throw new Error(`Global search overflows at ${viewport.width}px: ${JSON.stringify(searchGeometry)}`)
        }
        if (viewport.width === 820 && searchGeometry.width < 760) {
          throw new Error(`Global search did not use the wide desktop dialog at ${viewport.width}px: ${JSON.stringify(searchGeometry)}`)
        }
        if (viewport.width === 390 || viewport.width === 320) {
          await page.screenshot({
            path: resolve(quickAddArtifactRoot, viewport.width === 390 ? 'global-search-mobile-390x844.png' : 'global-search-mobile-min-320x700.png'),
          })
        }
        await page.keyboard.press('Escape')
        await globalSearch.waitFor({ state: 'hidden' })

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
          const bottomNavBox = await page.locator('.tabbar').boundingBox()
          if (!applyBox || !bottomNavBox || applyBox.y + applyBox.height > bottomNavBox.y) {
            throw new Error(`Compact picker actions overlap bottom navigation at ${viewport.width}px: apply=${JSON.stringify(applyBox)}, nav=${JSON.stringify(bottomNavBox)}`)
          }
        }
        if (!viewport.modalPicker) {
          await apply.click()
          await compactQuickAdd.getByRole('button', { name: /编辑计划.*15:00/ }).waitFor({ state: 'visible' })
          const mediumDetail = page.getByRole('dialog', { name: '任务详情', exact: true })
          if (!(await mediumDetail.isVisible())) await page.locator('.task-row').first().locator('.task-main').click()
          await mediumDetail.waitFor({ state: 'visible' })
          if ((await mediumDetail.getAttribute('aria-modal')) !== 'true') {
            throw new Error(`Medium detail must isolate the covered task list at ${viewport.width}px.`)
          }
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
        const verifiesMinimumGeometry = [320, 359, 360, 369, 370, 390].includes(viewport.width)
        if (verifiesMinimumGeometry) await scheduleSheet.getByRole('button', { name: '应用', exact: true }).scrollIntoViewIfNeeded()
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
        if (verifiesMinimumGeometry) {
          const sheetPanel = scheduleSheet
          const geometry = await sheetPanel.evaluate((element) => ({
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth,
          }))
          if (geometry.scrollWidth > geometry.clientWidth) {
            throw new Error(`Quick add candidate editor overflows at ${viewport.width}px: ${JSON.stringify(geometry)}`)
          }
          if (geometry.pageScrollWidth > geometry.pageClientWidth) {
            throw new Error(`Quick add page overflows at ${viewport.width}px: ${JSON.stringify(geometry)}`)
          }
          const dayBoxes = await scheduleSheet.getByRole('gridcell').evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect()
              return { x: box.x, y: box.y, width: box.width, height: box.height }
            }),
          )
          if (dayBoxes.length !== 42) {
            throw new Error(`Quick add calendar did not expose 42 day targets at ${viewport.width}px: ${dayBoxes.length}`)
          }
          const undersized = dayBoxes.find(({ width, height }) => width < 44 || height < 44)
          if (undersized) throw new Error(`Quick add calendar day target is smaller than 44px at ${viewport.width}px: ${JSON.stringify(undersized)}`)
          const sheetBox = await sheetPanel.boundingBox()
          if (viewport.width <= 369 && (!sheetBox || sheetBox.x > 0.5 || sheetBox.width < viewport.width - 1)) {
            throw new Error(`Quick add Sheet is not edge-to-edge at ${viewport.width}px: ${JSON.stringify(sheetBox)}`)
          }
          if (viewport.width === 370 && (!sheetBox || sheetBox.x <= 0.5 || sheetBox.width >= viewport.width - 1)) {
            throw new Error(`Quick add Sheet did not restore its inset above the compact threshold: ${JSON.stringify(sheetBox)}`)
          }
          const clipped = sheetBox && dayBoxes.find(({ x, width }) => x < sheetBox.x - 0.5 || x + width > sheetBox.x + sheetBox.width + 0.5)
          if (clipped) {
            throw new Error(`Quick add calendar day target is clipped by the Sheet at ${viewport.width}px: ${JSON.stringify({ sheetBox, clipped })}`)
          }
          for (let index = 1; index < dayBoxes.length; index += 1) {
            const previous = dayBoxes[index - 1]
            const current = dayBoxes[index]
            const sameRow = Math.abs(previous.y - current.y) < 1
            if (sameRow && previous.x + previous.width > current.x + 0.5) {
              throw new Error(`Quick add calendar day targets overlap at ${viewport.width}px: ${JSON.stringify({ previous, current })}`)
            }
          }
          const applyBox = await apply.boundingBox()
          if (!(await apply.isVisible()) || !applyBox || applyBox.y < 0 || applyBox.y + applyBox.height > viewport.height) {
            throw new Error(`Quick add Apply action is not reachable at ${viewport.width}px: ${JSON.stringify(applyBox)}`)
          }
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
        .getByRole('button', { name: '学习', exact: true })
        .click()
      await page.getByRole('heading', { name: '清单与主题' }).waitFor({ state: 'visible' })

      if (consoleErrors.length > 0 || consoleWarnings.length > 0 || pageErrors.length > 0) {
        throw new Error(`Web preview emitted errors:\n${[
          ...consoleErrors.map((message) => `console: ${message}`),
          ...consoleWarnings.map((message) => `warning: ${message}`),
          ...pageErrors.map((message) => `page: ${message}`),
        ].join('\n')}`)
      }
      console.log(`Fresh browser errors: console=${consoleErrors.length}, warnings=${consoleWarnings.length}, page=${pageErrors.length}`)
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
