import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getNpmInvocation } from './release-kit/npm-command.mjs'
import { resolveBrowserExecutable } from './smoke-web-persistence.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifactRoot = resolve(projectRoot, 'artifacts', 'visual-qa', 'calendar')
const seededTitles = {
  overlapA: '深度工作 A',
  overlapB: '深度工作 B',
  deadline: '提交日历验收记录',
  recurring: '每日复盘',
  unscheduled: '安排验收回顾',
  visualUnscheduled: '整理下周计划',
}

async function main() {
  await mkdir(artifactRoot, { recursive: true })
  const npm = getNpmInvocation(['run', 'build:web'])
  await runCommand(npm.command, npm.args, npm.options)

  const port = await findAvailableLoopbackPort()
  const url = `http://127.0.0.1:${port}/`
  const preview = spawn(
    process.execPath,
    [resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: projectRoot, stdio: 'inherit', windowsHide: true },
  )

  try {
    await waitForPreview(url)
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), headless: true })
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
      await resetAndSeedWorkspace(page)
      await openCalendar(page)
      await page.getByRole('button', { name: '周', exact: true }).click()

      const seeded = await readSeedMetadata(page)
      assert.equal(seeded.taskCount, 6)
      assert.equal(seeded.occurrenceCount, 1)
      await page.locator('.calendar-item').filter({ hasText: seededTitles.overlapA }).waitFor({ state: 'visible' })
      await page.locator('.calendar-item').filter({ hasText: seededTitles.overlapB }).waitFor({ state: 'visible' })
      await page.locator('.calendar-item--deadline-marker').filter({ hasText: seededTitles.deadline }).waitFor({ state: 'visible' })
      await page.locator('.calendar-item').filter({ hasText: seededTitles.recurring }).waitFor({ state: 'visible' })

      await page.evaluate(() => localStorage.setItem('meow-study-appearance', 'dark'))
      await page.reload({ waitUntil: 'networkidle' })
      await openCalendar(page)
      await page.getByRole('button', { name: '周', exact: true }).click()
      await dragUnscheduledIntoCalendar(page, seeded.today)
      await page.screenshot({ path: resolve(artifactRoot, 'calendar-desktop-wide-drag-preview-1440x960.png') })
      await page.mouse.up()
      await page.getByRole('button', { name: `拖动安排 ${seededTitles.unscheduled}` }).waitFor({ state: 'hidden' })

      await resizeScheduledTask(page, seededTitles.unscheduled, 30)
      await moveScheduledTaskWithKeyboard(page, seededTitles.unscheduled)
      await assertPersistedSchedule(page, seeded.nextDay, 60)

      await page.getByRole('button', { name: '月', exact: true }).click()
      await page.getByText(seededTitles.unscheduled, { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: '议程', exact: true }).click()
      await page.getByText(seededTitles.unscheduled, { exact: true }).waitFor({ state: 'visible' })

      await page.reload({ waitUntil: 'networkidle' })
      await openCalendar(page)
      await page.getByRole('button', { name: '议程', exact: true }).click()
      await page.getByText(seededTitles.unscheduled, { exact: true }).waitFor({ state: 'visible' })
      await assertPersistedSchedule(page, seeded.nextDay, 60)

      await captureRemainingViewports(page)
      assert.equal(consoleErrors.length, 0, `Calendar smoke console error count: ${consoleErrors.length}`)
      assert.equal(pageErrors.length, 0, `Calendar smoke page error count: ${pageErrors.length}`)
      console.log(`Calendar Web smoke passed: tasks=${seeded.taskCount} occurrences=${seeded.occurrenceCount} viewports=5 consoleErrors=0 pageErrors=0`)
    } finally {
      await context.close()
      await browser.close()
    }
  } finally {
    if (!preview.killed) preview.kill()
  }
}

async function resetAndSeedWorkspace(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: /恢复演示内容/ }).click()
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  await page.evaluate(({ titles }) => new Promise((resolveSeed, rejectSeed) => {
    const request = indexedDB.open('meow-study', 2)
    request.onerror = () => rejectSeed(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('studyState', 'readwrite')
      const store = transaction.objectStore('studyState')
      const get = store.get('current')
      get.onerror = () => rejectSeed(get.error)
      get.onsuccess = () => {
        const state = structuredClone(get.result.state)
        const now = new Date()
        const today = now.toLocaleDateString('sv-SE')
        const next = new Date(`${today}T00:00:00`)
        next.setDate(next.getDate() + 1)
        const offsetMinutes = -now.getTimezoneOffset()
        const sign = offsetMinutes >= 0 ? '+' : '-'
        const offset = `${sign}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`
        const timestamp = (date, hour, minute) => `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`
        const listId = state.lists[0].id
        const base = (id, title, schedule, deadline = { dueAt: null, dueOn: null }) => ({
          id, revision: 1, mode: 'general', listId, sectionId: null, tagIds: [], title, notes: '', status: 'planned',
          schedule, deadline, priority: 'none', checklist: [], learning: null, recurrenceSeriesId: null,
          createdAt: now.toISOString(), updatedAt: now.toISOString(), deletedAt: null,
        })
        const recurring = base('task:calendar:recurring', titles.recurring, { startAt: null, startOn: null, estimateMinutes: 30 })
        recurring.recurrenceSeriesId = 'series:calendar:recurring'
        state.tasks = [
          base('task:calendar:overlap-a', titles.overlapA, { startAt: timestamp(today, 10, 0), startOn: null, estimateMinutes: 60 }),
          base('task:calendar:overlap-b', titles.overlapB, { startAt: timestamp(today, 10, 30), startOn: null, estimateMinutes: 60 }),
          base('task:calendar:deadline', titles.deadline, { startAt: null, startOn: null, estimateMinutes: null }, { dueAt: timestamp(today, 11, 30), dueOn: null }),
          recurring,
          base('task:calendar:unscheduled', titles.unscheduled, { startAt: null, startOn: null, estimateMinutes: 30 }),
          base('task:calendar:visual-unscheduled', titles.visualUnscheduled, { startAt: null, startOn: null, estimateMinutes: 30 }),
        ]
        state.recurrenceSeries = [{
          id: 'series:calendar:recurring', taskId: recurring.id, revision: 1,
          cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorAt: timestamp(today, 14, 0), anchorOn: null,
          end: { kind: 'never' }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          createdThrough: timestamp(today, 14, 0), createdCount: 1,
        }]
        state.occurrences = [{
          id: 'occurrence:calendar:recurring:1', seriesId: 'series:calendar:recurring', ordinal: 1,
          scheduledAt: timestamp(today, 14, 0), scheduledOn: null, status: 'pending', override: null, completedAt: null, revision: 1,
        }]
        state.reminderRules = []
        state.reminderDeliveries = []
        delete state.reminderMigration
        state.studySessions = []
        state.taskEvents = state.tasks.map((task, index) => ({
          id: `event:calendar:${index + 1}`, sequence: index + 1, taskId: task.id,
          type: 'planned', occurredAt: now.toISOString(), fromStatus: null, toStatus: task.status,
          reason: null, completionRecordId: null,
        }))
        state.completionRecords = []
        state.reviewTaskLinks = []
        state.commandReceipts = []
        state.revision += 1
        state.updatedAt = now.toISOString()
        store.put({ key: 'current', state })
      }
      transaction.onerror = () => rejectSeed(transaction.error)
      transaction.oncomplete = () => { database.close(); resolveSeed() }
    }
  }), { titles: seededTitles })
  await page.reload({ waitUntil: 'networkidle' })
}

async function readSeedMetadata(page) {
  return page.evaluate(({ title }) => new Promise((resolveState, rejectState) => {
    const request = indexedDB.open('meow-study', 2)
    request.onerror = () => rejectState(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('studyState', 'readonly')
      const get = transaction.objectStore('studyState').get('current')
      get.onerror = () => rejectState(get.error)
      get.onsuccess = () => {
        const state = get.result.state
        const task = state.tasks.find((item) => item.title === title)
        const today = new Date().toLocaleDateString('sv-SE')
        const next = new Date(`${today}T00:00:00`)
        next.setDate(next.getDate() + 1)
        resolveState({ taskCount: state.tasks.length, occurrenceCount: state.occurrences.length, taskId: task.id, today, nextDay: next.toLocaleDateString('sv-SE') })
        database.close()
      }
    }
  }), { title: seededTitles.unscheduled })
}

async function openCalendar(page) {
  const desktop = page.getByRole('navigation', { name: '待办导航' }).getByRole('button', { name: '日历', exact: true })
  const mobile = page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: '日历', exact: true })
  if (await desktop.isVisible()) await desktop.click()
  else await mobile.click()
  await page.getByRole('heading', { name: '日历', exact: true }).waitFor({ state: 'visible' })
}

async function dragUnscheduledIntoCalendar(page, today) {
  const source = page.getByRole('button', { name: `拖动安排 ${seededTitles.unscheduled}` })
  await source.waitFor({ state: 'visible' })
  await page.locator('.time-grid__scroll').evaluate((element) => { element.scrollTop = 480 })
  const sourceBox = await source.boundingBox()
  const dayBox = await page.locator(`.time-grid__header time[datetime="${today}"]`).boundingBox()
  const columnsBox = await page.locator('.time-grid__columns').boundingBox()
  assert.ok(sourceBox && dayBox && columnsBox, 'Calendar drag geometry is unavailable.')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dayBox.x + dayBox.width / 2, columnsBox.y + 12 * 60, { steps: 12 })
  await page.locator('.time-grid__preview').waitFor({ state: 'visible' })
}

async function resizeScheduledTask(page, title, pixels) {
  const item = page.locator('.calendar-item').filter({ hasText: title }).first()
  await item.waitFor({ state: 'visible' })
  const handle = item.getByRole('button', { name: `调整 ${title} 时长` })
  const box = await handle.boundingBox()
  assert.ok(box, 'Calendar resize handle geometry is unavailable.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + pixels, { steps: 8 })
  await page.locator('.time-grid__preview').waitFor({ state: 'visible' })
  await page.mouse.up()
  await waitForStoredTask(page, title, { estimateMinutes: 60 })
}

async function moveScheduledTaskWithKeyboard(page, title) {
  const item = page.locator('.calendar-item').filter({ hasText: title }).first()
  await item.focus()
  await item.press('Alt+ArrowRight')
}

async function assertPersistedSchedule(page, expectedDate, expectedMinutes) {
  await waitForStoredTask(page, seededTitles.unscheduled, { date: expectedDate, estimateMinutes: expectedMinutes })
}

async function waitForStoredTask(page, title, expected) {
  await page.waitForFunction(({ title: taskTitle, expectedValue }) => new Promise((resolveState) => {
    const request = indexedDB.open('meow-study', 2)
    request.onerror = () => resolveState(false)
    request.onsuccess = () => {
      const database = request.result
      const get = database.transaction('studyState', 'readonly').objectStore('studyState').get('current')
      get.onerror = () => { database.close(); resolveState(false) }
      get.onsuccess = () => {
        const task = get.result.state.tasks.find((item) => item.title === taskTitle)
        const ok = task
          && (expectedValue.date === undefined || task.schedule.startAt?.startsWith(`${expectedValue.date}T12:00:00`))
          && task.schedule.estimateMinutes === expectedValue.estimateMinutes
        database.close()
        resolveState(ok)
      }
    }
  }), { title, expectedValue: expected }, { timeout: 10_000 })
}

async function captureRemainingViewports(page) {
  await page.evaluate(() => localStorage.setItem('meow-study-appearance', 'light'))
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.reload({ waitUntil: 'networkidle' })
  await openCalendar(page)
  await page.getByRole('button', { name: '周', exact: true }).click()
  await page.getByTitle('选择日期').click()
  await page.locator('.date-picker').waitFor({ state: 'visible' })
  await page.waitForTimeout(150)
  await assertVisualState(page, true)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-desktop-min-date-picker-1280x800.png') })
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 820, height: 560 })
  await page.getByRole('button', { name: '月', exact: true }).click()
  await page.locator('.month-grid').waitFor({ state: 'visible' })
  const desktopOverflow = page.getByRole('button', { name: /还有 \d+ 项，查看全部/ }).first()
  await desktopOverflow.click()
  await page.locator('.month-grid__disclosure').waitFor({ state: 'visible' })
  await page.waitForTimeout(150)
  await assertVisualState(page, true)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-window-min-month-overflow-820x560.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '议程', exact: true }).click()
  await page.locator('.agenda-view').waitFor({ state: 'visible' })
  await assertVisualState(page, false)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-window-min-agenda-820x560.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => localStorage.setItem('meow-study-appearance', 'dark'))
  await page.reload({ waitUntil: 'networkidle' })
  await openCalendar(page)
  await page.getByRole('button', { name: '日', exact: true }).click()
  await page.getByTitle('选择日期').click()
  await page.locator('.popover-panel--mobile-sheet .date-picker').waitFor({ state: 'visible' })
  await page.waitForTimeout(150)
  await assertVisualState(page, true)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-mobile-date-sheet-390x844.png') })
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 320, height: 700 })
  await page.evaluate(() => localStorage.setItem('meow-study-appearance', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await openCalendar(page)
  await page.getByRole('button', { name: `安排 ${seededTitles.visualUnscheduled}`, exact: true }).click()
  await page.locator('.popover-panel--mobile-sheet .unscheduled-tray__panel').waitFor({ state: 'visible' })
  await page.waitForTimeout(150)
  await assertVisualState(page, true)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-mobile-min-planning-sheet-320x700.png') })
}

async function assertVisualState(page, requireOverlay) {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const nativeControls = Array.from(document.querySelectorAll('select,input[type="date"],input[type="time"],input[type="checkbox"]')).filter(visible)
    const overlays = Array.from(document.querySelectorAll('.popover-panel')).filter(visible).map((element) => {
      const box = element.getBoundingClientRect()
      return box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1
    })
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      nativeControlCount: nativeControls.length,
      overlayCount: overlays.length,
      overlaysInsideViewport: overlays.every(Boolean),
    }
  })
  assert.ok(result.horizontalOverflow <= 1, `Page has ${result.horizontalOverflow}px horizontal overflow.`)
  assert.equal(result.nativeControlCount, 0, 'An unadapted native form control is visible.')
  assert.equal(result.overlaysInsideViewport, true, 'A required overlay is clipped by the viewport.')
  if (requireOverlay) assert.ok(result.overlayCount > 0, 'Expected a visible themed overlay.')
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', ...options })
    child.once('error', rejectCommand)
    child.once('exit', (code, signal) => code === 0 ? resolveCommand() : rejectCommand(new Error(`${command} exited with ${signal ?? code}`)))
  })
}

function findAvailableLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return rejectPort(new Error('Could not allocate a calendar smoke port.'))
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port))
    })
  })
}

async function waitForPreview(url) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return } catch { /* Preview is still starting. */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`Timed out waiting for calendar Web preview at ${url}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
