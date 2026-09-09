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
const UNADAPTED_NATIVE_CONTROL_SELECTOR = [
  'select',
  'input[type="date"]',
  'input[type="time"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
].join(',')
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
  if (!process.argv.includes('--skip-build')) {
    const npm = getNpmInvocation(['run', 'build:web'])
    await runCommand(npm.command, npm.args, npm.options)
  }

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
      if (process.argv.includes('--participants-only')) {
        await exerciseParticipants(page)
        assert.equal(consoleErrors.length, 0); assert.equal(pageErrors.length, 0)
        console.log('Calendar participants smoke passed: widths=820,320 organizer,required,optional,local-response,persist,reopen,remove,external-readonly externalRequests=0 consoleErrors=0 pageErrors=0')
        return
      }
      if (process.argv.includes('--scheduling-only')) {
        await exerciseScheduling(page)
        assert.equal(consoleErrors.length, 0); assert.equal(pageErrors.length, 0)
        console.log('Calendar scheduling smoke passed: widths=1280,820,320 preview-clock,adopt,undo,stale-revision,missing-estimate,busy,no-capacity,external-unknown,focus,weekly-review consoleErrors=0 pageErrors=0')
        return
      }
      await openCalendar(page)
      await page.getByRole('button', { name: '周', exact: true }).click()

      const seeded = await readSeedMetadata(page)
      assert.equal(seeded.taskCount, 6)
      assert.equal(seeded.occurrenceCount, 1)
      if (process.argv.includes('--mobile-layout-only')) {
        await page.evaluate(() => new Promise((resolveSeed, rejectSeed) => {
          const request = indexedDB.open('meow-study', 2)
          request.onerror = () => rejectSeed(request.error)
          request.onsuccess = () => {
            const database = request.result
            const transaction = database.transaction('studyState', 'readwrite'); const store = transaction.objectStore('studyState'); const get = store.get('current')
            get.onsuccess = () => {
              const state = get.result.state; const task = state.tasks[0]
              for (let index = 0; index < 4; index++) {
                const id = `mobile-layout:${index}`
                state.tasks.push({ ...task, id, title: `布局压力条目 ${index}`, schedule: index < 2 ? { ...task.schedule } : { startAt: null, startOn: task.schedule.startAt.slice(0, 10), estimateMinutes: null } })
                state.taskEvents.push({ ...state.taskEvents[0], id: `mobile-layout:event:${index}`, taskId: id, sequence: state.taskEvents.length + 1 })
              }
              state.revision++; store.put({ key: 'current', state })
            }
            transaction.onerror = () => rejectSeed(transaction.error)
            transaction.oncomplete = () => { database.close(); resolveSeed() }
          }
        }))
        await page.setViewportSize({ width: 320, height: 700 }); await page.reload({ waitUntil: 'networkidle' }); await openCalendar(page)
        await assertCalendarActionsReachable(page)
        const calendarBox = await page.locator('.calendar-workspace').boundingBox()
        const navigationBox = await page.getByRole('navigation', { name: '移动端主导航' }).boundingBox()
        assert.ok(calendarBox.y + calendarBox.height <= navigationBox.y + 1, 'Calendar scrolling viewport must end above the fixed navigation')
        assert.ok((await page.locator('.time-grid__scroll').boundingBox()).height >= 120)
        await page.getByRole('button', { name: `打开 ${seededTitles.overlapA}`, exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: resolve(artifactRoot, 'calendar-mobile-timeline-320x700.png') })
        assert.equal(consoleErrors.length, 0); assert.equal(pageErrors.length, 0)
        console.log('Calendar mobile layout passed: 320px, four overlapping tasks, two all-day rows, actions reachable, timeline >=120px')
        return
      }
      if (process.argv.includes('--month-layout-only')) {
        await verifyMonthLayout(page)
        assert.equal(consoleErrors.length, 0)
        assert.equal(pageErrors.length, 0)
        console.log('Calendar month layout passed: widths=820,320 consoleErrors=0 pageErrors=0')
        return
      }
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

      await exerciseCalendarActions(page, seeded)
      await exerciseCalendarEvents(page, seeded)
      await exerciseCalendarSlotsAndOutcomes(page, seeded)
      await captureRemainingViewports(page)
      assert.equal(consoleErrors.length, 0, `Calendar smoke console error count: ${consoleErrors.length}`)
      assert.equal(pageErrors.length, 0, `Calendar smoke page error count: ${pageErrors.length}`)
      console.log(`Calendar Web smoke passed: tasks=${seeded.taskCount} occurrences=${seeded.occurrenceCount} viewports=5 actions=quick-add,details,complete,reopen,focus,filters,clock,event-create,event-edit,event-delete,event-undo,event-series,event-reminder,event-readonly,blank-slot,slot-task,slot-event,task-toggle,learning-evidence,event-outcomes,unlink,touch-scroll consoleErrors=0 pageErrors=0`)
    } catch (error) {
      await page.screenshot({ path: resolve(artifactRoot, 'calendar-smoke-failure.png'), fullPage: true })
      console.error('Visible alerts:', await page.getByRole('alert').allTextContents())
      console.error('Browser errors:', [...pageErrors, ...consoleErrors])
      throw error
    } finally {
      await context.close()
      await browser.close()
    }
  } finally {
    if (!preview.killed) preview.kill()
  }
}

async function exerciseParticipants(page) {
  const externalRequests = []
  const origin = new URL(page.url()).origin
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (/^https?:$/.test(url.protocol) && url.origin !== origin) { externalRequests.push(`${route.request().method()} ${url.origin}`); return route.abort() }
    return route.continue()
  })
  const title = '参与者本地记录验收'
  const create = page.getByRole('dialog', { name: '新建日程', exact: true })
  const detail = page.getByRole('dialog', { name: '日程详情', exact: true })
  const before = await readCalendarWorkspace(page)
  await page.setViewportSize({ width: 820, height: 1000 })
  await openCalendar(page)
  await page.getByRole('button', { name: '新建日程', exact: true }).click()
  await create.getByLabel('日程标题', { exact: true }).fill(title)
  const toggle = create.getByRole('button', { name: '参与者 · 0', exact: true })
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await create.getByLabel('组织者姓名', { exact: true }).count(), 0)
  await toggle.click()
  await create.getByText(/仅保存本地记录，不会发送邀请或 RSVP/).waitFor()
  await create.getByLabel('组织者姓名', { exact: true }).fill('验收组织者')
  await create.getByLabel('组织者邮箱', { exact: true }).fill('organizer@example.invalid')
  for (const index of [1, 2]) {
    await create.getByRole('button', { name: '添加参与者', exact: true }).click()
    await create.getByLabel(`参与者 ${index} 姓名`, { exact: true }).fill(`验收参与者 ${index}`)
    await create.getByLabel(`参与者 ${index} 邮箱`, { exact: true }).fill(`attendee${index}@example.invalid`)
    await chooseEventOption(page, create, `参与者 ${index} 类型`, index === 1 ? '必选' : '可选')
    await chooseEventOption(page, create, `参与者 ${index} 本地响应记录`, index === 1 ? '接受' : '待定')
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await create.locator('.participants').screenshot({ path: resolve(artifactRoot, 'calendar-participants-820.png') })
  await create.getByRole('button', { name: '保存日程', exact: true }).click()
  await create.waitFor({ state: 'hidden' })
  const event = await waitForCalendarEvent(page, title, (entry) => entry.attendees.length === 2)
  assert.deepEqual(event.organizer, { name: '验收组织者', email: 'organizer@example.invalid' })
  assert.deepEqual(event.attendees.map(({ role, response }) => [role, response]), [['required', 'accepted'], ['optional', 'tentative']])
  assert.deepEqual((await readCalendarWorkspace(page)).tasks, before.tasks)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.reload({ waitUntil: 'networkidle' }); await openCalendar(page)
  await page.getByRole('button', { name: '议程', exact: true }).click()
  await page.locator('.agenda-view__row').filter({ hasText: title }).click()
  assert.equal(await detail.getByRole('button', { name: '参与者 · 2', exact: true }).getAttribute('aria-expanded'), 'false')
  await detail.getByRole('button', { name: '参与者 · 2', exact: true }).click()
  assert.equal(await detail.getByLabel('组织者邮箱', { exact: true }).inputValue(), 'organizer@example.invalid')
  assert.equal(await detail.getByLabel('参与者 2 邮箱', { exact: true }).inputValue(), 'attendee2@example.invalid')
  assert.equal(await detail.getByRole('button', { name: '参与者 2 类型', exact: true }).innerText(), '可选')
  assert.equal(await detail.getByRole('button', { name: '参与者 1 本地响应记录', exact: true }).innerText(), '接受')
  await detail.getByLabel('参与者 2 邮箱', { exact: true }).scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-participants-320x900.png') })
  await detail.getByRole('button', { name: '移除参与者 1', exact: true }).click()
  const save = detail.getByRole('button', { name: '保存日程', exact: true })
  await save.scrollIntoViewIfNeeded()
  const box = await save.boundingBox()
  assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 900)
  await save.click(); await detail.waitFor({ state: 'hidden' })
  const removed = await waitForCalendarEvent(page, title, (entry) => entry.attendees.length === 1)
  assert.deepEqual(removed.attendees, [event.attendees[1]])
  assert.deepEqual(removed.organizer, event.organizer)
  await page.evaluate((eventId) => new Promise((done, fail) => {
    const request = indexedDB.open('meow-study', 2)
    request.onerror = () => fail(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('studyState', 'readwrite'), store = tx.objectStore('studyState'), get = store.get('current')
      get.onsuccess = () => {
        const state = get.result.state, event = state.calendarEvents.find((item) => item.id === eventId), source = state.calendarSources.find((item) => item.id === event.sourceId)
        state.calendarSources.push({ ...source, id: 'participants:external', provider: 'google', permission: 'read', title: '只读参与者验收' })
        state.calendarEvents.push({ ...event, id: 'participants:external:event', sourceId: 'participants:external', title: '只读参与者验收' })
        state.revision++; store.put({ key: 'current', state })
      }
      tx.oncomplete = () => { db.close(); done() }; tx.onerror = () => fail(tx.error)
    }
  }), removed.id)
  await page.reload({ waitUntil: 'networkidle' }); await openCalendar(page)
  await page.getByRole('button', { name: '议程', exact: true }).click()
  for (const width of [320, 820]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: '议程', exact: true }).click()
    const readOnlyBefore = await readCalendarWorkspace(page)
    await page.locator('.agenda-view__row').filter({ hasText: '只读参与者验收' }).click()
    await detail.getByRole('button', { name: '参与者 · 1', exact: true }).click()
    await detail.getByText(/以下为来源日历的只读记录/).waitFor()
    for (const label of ['组织者姓名', '组织者邮箱', '参与者 1 姓名', '参与者 1 邮箱']) assert.equal(await detail.getByLabel(label, { exact: true }).isDisabled(), true)
    for (const label of ['参与者 1 类型', '参与者 1 来源响应']) assert.equal(await detail.getByRole('button', { name: label, exact: true }).isDisabled(), true)
    assert.equal(await detail.getByRole('button', { name: /添加参与者|移除参与者|保存日程/ }).count(), 0)
    await detail.locator('.participants').scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(artifactRoot, `calendar-participants-readonly-${width}x900.png`) })
    await detail.getByRole('button', { name: '关闭', exact: true }).click()
    assert.deepEqual(await readCalendarWorkspace(page), readOnlyBefore)
  }
  assert.deepEqual(externalRequests, [], 'Local participant records must never trigger external requests')
}

async function schedulingFixture(page, mode = 'normal') {
  await page.evaluate((mode) => new Promise((done, fail) => {
    const request = indexedDB.open('meow-study', 2)
    request.onerror = () => fail(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('studyState', 'readwrite'), store = tx.objectStore('studyState'), get = store.get('current')
      get.onsuccess = () => {
        const state = get.result.state
        if (mode !== 'revision') {
          const task = structuredClone(state.tasks.find((task) => task.id === 'task:calendar:unscheduled'))
          task.status = 'planned'; task.revision++; task.schedule = { startAt: null, startOn: null, estimateMinutes: mode === 'missing' ? null : mode === 'capacity' ? 1440 : 30 }
          task.deadline = { dueOn: null, dueAt: null }
          state.tasks = [task]; state.recurrenceSeries = []; state.occurrences = []; state.calendarEvents = []; state.calendarEventLinks = []; state.eventOutcomes = []
          state.studySessions = []; state.completionRecords = []; state.reviewTaskLinks = []; state.commandReceipts = []
          state.taskEvents = [{ id: `scheduling:seed:${mode}`, taskId: task.id, sequence: 1, type: 'planned', occurredAt: new Date().toISOString(), fromStatus: null, toStatus: 'planned', reason: null, completionRecordId: null }]
          state.calendarSources = state.calendarSources.filter((source) => source.provider === 'local')
          if (mode === 'external') state.calendarSources.push({ ...state.calendarSources[0], id: 'calendar:scheduling:external', provider: 'google', permission: 'read', selected: false, hidden: true })
          if (mode === 'busy') {
            const start = new Date().toLocaleDateString('sv-SE'), end = new Date(`${start}T00:00:00`); end.setDate(end.getDate() + 7)
            state.calendarEvents.push({ id: 'event:scheduling:locked', revision: 1, sourceId: state.calendarSources[0].id, title: '整周已占用', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time: { kind: 'all-day', startOn: start, endOnExclusive: end.toLocaleDateString('sv-SE') }, recurrence: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null })
          }
        }
        state.revision++; state.updatedAt = new Date().toISOString(); store.put({ key: 'current', state })
      }
      tx.oncomplete = () => { db.close(); done() }; tx.onerror = () => fail(tx.error)
    }
  }), mode)
  if (mode !== 'revision') { await page.reload({ waitUntil: 'networkidle' }); await openCalendar(page) }
}

async function openScheduling(page) {
  await page.getByRole('button', { name: `安排 ${seededTitles.unscheduled}`, exact: true }).click()
  await page.getByRole('button', { name: '建议安排', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '建议安排', exact: true })
  await panel.waitFor()
  assert.equal(await panel.locator('.date-trigger').count(), 2)
  const dateBoxes = await panel.locator('.date-trigger').evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom } }))
  assert.ok(dateBoxes[0].right <= dateBoxes[1].left || dateBoxes[0].bottom <= dateBoxes[1].top, 'Date triggers must not overlap')
  await panel.getByRole('button', { name: '开始日期', exact: true }).click()
  const datePicker = page.locator('.date-picker:visible')
  await datePicker.waitFor()
  assert.equal(await datePicker.evaluateAll((pickers) => pickers.length === 1 && pickers.every((picker) => {
    return [...picker.querySelectorAll('[role="gridcell"]')].every((cell) => { const bounds = cell.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight })
  })), true, 'The one expanded calendar must keep every date cell within the viewport')
  await page.keyboard.press('Escape')
  await datePicker.waitFor({ state: 'hidden' })
  await panel.waitFor()
  return panel
}

async function exerciseScheduling(page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await schedulingFixture(page)
  let panel = await openScheduling(page)
  const before = await readCalendarWorkspace(page)
  await panel.getByRole('button', { name: '查找建议时间', exact: true }).click()
  await panel.getByRole('list', { name: '建议时间' }).waitFor()
  const previewText = await panel.getByRole('list', { name: '建议时间' }).innerText()
  await page.waitForTimeout(2200)
  assert.equal(await panel.getByRole('list', { name: '建议时间' }).innerText(), previewText, 'Two real clock ticks must not erase the preview')
  assert.deepEqual(await readCalendarWorkspace(page), before)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-scheduling-1280x900.png') })
  await panel.getByRole('button', { name: '采用', exact: true }).first().click()
  await panel.waitFor({ state: 'hidden' })
  const saved = await readCalendarWorkspace(page)
  assert.ok(saved.tasks[0].schedule.startAt)
  assert.equal(saved.taskEvents.at(-1).type, 'rescheduled')
  assert.equal(saved.tasks[0].status, 'planned')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  for (let attempt = 0; attempt < 100 && (await readCalendarWorkspace(page)).tasks[0].schedule.startAt !== null; attempt++) await page.waitForTimeout(50)
  assert.equal((await readCalendarWorkspace(page)).tasks[0].schedule.startAt, null)

  panel = await openScheduling(page)
  await panel.getByRole('button', { name: '查找建议时间', exact: true }).click()
  await panel.getByRole('list', { name: '建议时间' }).waitFor()
  await schedulingFixture(page, 'revision')
  const concurrent = await readCalendarWorkspace(page)
  await panel.getByRole('button', { name: '采用', exact: true }).first().click()
  await panel.getByRole('alert').waitFor()
  assert.deepEqual(await readCalendarWorkspace(page), concurrent, 'A stale Workspace preview must not write')
  await panel.getByRole('button', { name: '关闭', exact: true }).click()

  for (const mode of ['missing', 'capacity', 'busy', 'external']) {
    await schedulingFixture(page, mode); panel = await openScheduling(page)
    if (mode === 'missing') {
      assert.equal(await panel.getByRole('button', { name: '查找建议时间', exact: true }).isDisabled(), true)
      await panel.getByText(/请先打开任务详情，填写预计时长/).waitFor()
    } else {
      await panel.getByRole('button', { name: '查找建议时间', exact: true }).click()
      await panel.getByText(mode === 'external' ? /部分忙闲信息未知或已过期/ : /截止前没有足够的连续空闲时间/).waitFor()
      assert.equal(await panel.getByRole('button', { name: '采用', exact: true }).count(), 0)
    }
    await panel.getByRole('button', { name: '关闭', exact: true }).click()
  }

  await schedulingFixture(page)
  for (const width of [820, 320]) {
    await page.setViewportSize({ width, height: 900 })
    panel = await openScheduling(page)
    await panel.getByRole('button', { name: '查找建议时间', exact: true }).click()
    await panel.getByRole('list', { name: '建议时间' }).waitFor()
    const adopt = panel.getByRole('button', { name: '采用', exact: true }).first()
    await adopt.scrollIntoViewIfNeeded()
    const box = await adopt.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(artifactRoot, `calendar-scheduling-${width}x900.png`) })
    await panel.getByRole('button', { name: '关闭', exact: true }).click()
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  panel = await openScheduling(page)
  await panel.getByRole('button', { name: '开始日期', exact: true }).click()
  await page.locator('.date-picker:visible').getByRole('button', { name: '明天', exact: true }).click()
  await panel.getByRole('textbox', { name: '工作开始', exact: true }).fill('12:00')
  await panel.getByRole('textbox', { name: '工作开始', exact: true }).press('Tab')
  await panel.getByRole('button', { name: '查找建议时间', exact: true }).click()
  await panel.getByRole('button', { name: '采用', exact: true }).first().click()
  await panel.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '议程', exact: true }).click()
  const scheduledForFocus = (await readCalendarWorkspace(page)).tasks[0].schedule.startAt
  assert.match(scheduledForFocus, /T04:00:00\.000Z$/, 'Shanghai noon must remain a UTC instant in storage')
  const expectedTime = await page.evaluate((value) => new Intl.DateTimeFormat('en-GB', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)), scheduledForFocus)
  await page.locator('.agenda-view').getByText(expectedTime, { exact: true }).waitFor()
  assert.equal(expectedTime, '12:00')
  await page.getByRole('button', { name: '日', exact: true }).click()
  await page.getByRole('button', { name: '下一段时间', exact: true }).click()
  await page.getByRole('button', { name: `安排 ${seededTitles.unscheduled}`, exact: true }).click()
  const movePanel = page.locator('.calendar-item__panel')
  assert.equal(await movePanel.getByRole('textbox', { name: '开始时间', exact: true }).inputValue(), '12:00')
  await movePanel.getByRole('textbox', { name: '开始时间', exact: true }).fill('13:00')
  await movePanel.getByRole('button', { name: '保存安排', exact: true }).click()
  for (let attempt = 0; attempt < 100 && (await readCalendarWorkspace(page)).tasks[0].schedule.startAt === scheduledForFocus; attempt++) await page.waitForTimeout(50)
  assert.equal(Date.parse((await readCalendarWorkspace(page)).tasks[0].schedule.startAt) - Date.parse(scheduledForFocus), 3_600_000)
  await page.getByRole('button', { name: '议程', exact: true }).click()
  await page.locator('.agenda-view').getByText('13:00', { exact: true }).waitFor()
  await page.locator('.agenda-view').getByText(seededTitles.unscheduled, { exact: true }).click()
  const detail = page.locator('.detail-drawer')
  await detail.getByRole('button', { name: '开始学习', exact: true }).click()
  await page.locator('.focus-view').waitFor()
  assert.equal((await readCalendarWorkspace(page)).studySessions.length, 1)
  await page.locator('.focus-view').getByRole('button', { name: '暂停', exact: true }).click()
  await page.locator('.focus-view').getByRole('button', { name: '日历', exact: true }).click()
  await detail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
  await page.getByRole('navigation', { name: '待办导航' }).getByRole('button', { name: '回顾', exact: true }).click()
  const review = page.getByRole('region', { name: '本周回顾', exact: true })
  await review.waitFor()
  assert.match(await review.innerText(), /计划/)
  assert.match(await review.innerText(), /实际专注/)
  assert.match(await review.innerText(), /真实移动/)
  await review.locator('dl > div').filter({ hasText: '真实移动' }).getByText('2 次', { exact: true }).waitFor()
  assert.match(await review.innerText(), /0 项完成/)
  assert.equal((await readCalendarWorkspace(page)).taskEvents.some((event) => event.type === 'completed'), false)
  await review.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-scheduling-weekly-1280x900.png') })
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
        state.tags = [{ id: 'tag:calendar:qa', title: '日历验收', position: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(), archivedAt: null }]
        state.tasks[0].priority = 'high'
        state.tasks[0].tagIds = ['tag:calendar:qa']
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
          && (expectedValue.estimateMinutes === undefined || task.schedule.estimateMinutes === expectedValue.estimateMinutes)
          && (expectedValue.startOn === undefined || task.schedule.startOn === expectedValue.startOn)
          && (expectedValue.status === undefined || task.status === expectedValue.status)
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
  await assertCalendarActionsReachable(page)
  await page.getByRole('button', { name: '周', exact: true }).click()
  await page.getByTitle('选择日期').click()
  await page.locator('.date-picker').waitFor({ state: 'visible' })
  await assertDateGrid(page)
  const desktopDatePopover = page.locator('.popover-panel:not(.popover-panel--mobile-sheet)').filter({ has: page.locator('.date-picker') })
  assert.equal(await desktopDatePopover.getAttribute('role'), 'dialog', 'Desktop date Popover must expose its controlled dialog panel.')
  assert.equal(await desktopDatePopover.getAttribute('aria-modal'), 'false', 'Desktop date Popover must remain explicitly non-modal.')
  assert.equal(await desktopDatePopover.getAttribute('aria-label'), '选择日历日期', 'Desktop date Popover must have an accessible name.')
  await page.waitForTimeout(150)
  await assertVisualState(page, true)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-desktop-min-date-picker-1280x800.png') })
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 820, height: 560 })
  await assertIconSidebarBreakpoint(page)
  await assertCalendarActionsReachable(page)
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
  await assertCalendarActionsReachable(page)
  await page.getByTitle('选择日期').click()
  const dateSheet = page.getByRole('dialog', { name: '选择日历日期', exact: true })
  await dateSheet.waitFor({ state: 'visible' })
  await assertModalSheet(dateSheet, '选择日历日期')
  await assertDateGrid(page, 44)
  await assertFocusTrap(page, dateSheet)
  await page.waitForTimeout(150)
  await assertVisualState(page, true)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-mobile-date-sheet-390x844.png') })
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 320, height: 700 })
  await page.evaluate(() => localStorage.setItem('meow-study-appearance', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await openCalendar(page)
  await assertCalendarActionsReachable(page)
  await page.getByRole('button', { name: `安排 ${seededTitles.visualUnscheduled}`, exact: true }).click()
  const planningSheet = page.getByRole('dialog', { name: `安排 ${seededTitles.visualUnscheduled}`, exact: true })
  await planningSheet.waitFor({ state: 'visible' })
  await assertModalSheet(planningSheet, `安排 ${seededTitles.visualUnscheduled}`)
  const primaryAction = planningSheet.getByRole('button', { name: '加入日历', exact: true })
  await primaryAction.scrollIntoViewIfNeeded()
  await primaryAction.focus()
  const primaryBox = await primaryAction.boundingBox()
  assert.ok(primaryBox && primaryBox.height >= 44, 'The mobile-min planning primary action must be at least 44px tall.')
  assert.ok(primaryBox.y >= 0 && primaryBox.y + primaryBox.height <= 700, 'The mobile-min planning primary action must be visible after Sheet scrolling.')
  await page.waitForTimeout(150)
  await assertVisualState(page, true)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-mobile-min-planning-sheet-320x700.png') })
}

async function verifyMonthLayout(page) {
  for (const width of [820, 320]) {
    await page.setViewportSize({ width, height: width === 820 ? 560 : 700 })
    await page.locator('.calendar-workspace').getByRole('button', { name: '月', exact: true }).click()
    const overflow = page.getByRole('button', { name: /还有 \d+ 项，查看全部/ }).first()
    await overflow.click()
    await page.locator('.month-grid__disclosure').waitFor({ state: 'visible' })
    await assertVisualState(page, true)
    await page.waitForTimeout(150)
    const dialog = page.getByRole('dialog').filter({ has: page.locator('.month-grid__disclosure') })
    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()
    assert.ok(box && box.height > 0 && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'The stable month disclosure dialog must fit inside the viewport')
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
    await page.screenshot({ path: resolve(artifactRoot, `calendar-month-layout-latest-${width}.png`) })
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.month-grid__fact').evaluateAll((facts) => facts.every((fact) => {
      const bounds = fact.getBoundingClientRect()
      return Array.from(fact.children).every((child) => {
        const box = child.getBoundingClientRect()
        return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
      })
    })), true, 'Month fact labels must fit inside their own day column')
  }
}

async function exerciseCalendarActions(page, seeded) {
  const calendar = page.locator('.calendar-workspace')
  const detail = page.getByRole('dialog', { name: '任务详情', exact: true })
  await calendar.getByRole('button', { name: '今天', exact: true }).click()
  for (const mode of ['日', '周', '月', '议程']) {
    await calendar.getByRole('button', { name: mode, exact: true }).click()
    const card = mode === '月'
      ? page.locator('.month-grid__fact').filter({ hasText: seededTitles.overlapA }).first()
      : mode === '议程'
        ? page.locator('.agenda-view__row').filter({ hasText: seededTitles.overlapA }).first()
        : page.getByRole('button', { name: `打开 ${seededTitles.overlapA}`, exact: true }).first()
    await card.click()
    await detail.getByRole('heading', { name: seededTitles.overlapA, exact: true }).waitFor()
    await detail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
    assert.equal(await calendar.isVisible(), true, `${mode} detail must return to calendar`)
  }

  await calendar.getByRole('button', { name: '日', exact: true }).click()
  await calendar.getByRole('button', { name: '下一段时间', exact: true }).click()
  const anchor = await calendar.getByTitle('选择日期').innerText()
  const scroll = page.locator('.time-grid__scroll')
  assert.ok(await scroll.evaluate((element) => element.scrollTop) > 0, 'A future day must locate working hours')
  await scroll.evaluate((element) => { element.scrollTop = 123 })
  await page.waitForTimeout(1250) // Let the real one-second application clock update.
  assert.equal(await scroll.evaluate((element) => element.scrollTop), 123, 'Clock ticks must not reset manual scrolling')

  const title = '日历新增验收条目'
  await calendar.getByRole('textbox', { name: '新建任务', exact: true }).fill(title)
  await calendar.getByRole('button', { name: '添加', exact: true }).click()
  await waitForStoredTask(page, title, { startOn: seeded.nextDay, status: 'planned' })
  await detail.getByRole('heading', { name: title, exact: true }).waitFor()
  await detail.getByRole('button', { name: '完成任务', exact: true }).click()
  await waitForStoredTask(page, title, { status: 'completed' })
  await detail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
  await chooseCalendarFilter(page, '状态', '已完成')
  await page.getByRole('button', { name: `打开 ${title}`, exact: true }).waitFor()
  await clearCalendarFilters(page)
  await page.getByRole('button', { name: `打开 ${title}`, exact: true }).click()
  await detail.getByRole('button', { name: '重新打开任务', exact: true }).click()
  await waitForStoredTask(page, title, { status: 'planned' })
  await detail.getByRole('button', { name: '开始学习', exact: true }).click()
  await page.locator('.focus-view').waitFor()
  assert.equal(await calendar.isVisible(), false, 'Focus must hide the calendar')
  await page.locator('.focus-view').getByRole('button', { name: '暂停', exact: true }).click()
  await page.locator('.focus-view').getByRole('button', { name: '日历', exact: true }).click()
  await detail.getByRole('button', { name: '完成任务', exact: true }).click()
  await waitForStoredTask(page, title, { status: 'completed' })
  await detail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
  assert.equal(await calendar.getByTitle('选择日期').innerText(), anchor, 'Focus return must preserve the selected date')
  await calendar.getByRole('button', { name: '今天', exact: true }).click()

  for (const [label, option] of [['标签', '日历验收'], ['优先级', '高优先级']]) {
    await chooseCalendarFilter(page, label, option)
    await page.getByRole('button', { name: `打开 ${seededTitles.overlapA}`, exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: `打开 ${seededTitles.overlapB}`, exact: true }).count(), 0)
    await clearCalendarFilters(page)
    await page.getByRole('button', { name: `打开 ${seededTitles.overlapB}`, exact: true }).waitFor()
  }
  await calendar.getByRole('button', { name: /^筛选/ }).click()
  await page.getByLabel('搜索日历任务', { exact: true }).fill('没有匹配的验收任务')
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await calendar.getByText('当前日期范围没有匹配的安排，可清除筛选或查看未安排任务。', { exact: true }).waitFor()
  await clearCalendarFilters(page)
}

async function readCalendarWorkspace(page) {
  return page.evaluate(() => new Promise((resolveState, rejectState) => {
    const request = indexedDB.open('meow-study', 2)
    request.onerror = () => rejectState(request.error)
    request.onsuccess = () => {
      const database = request.result
      const get = database.transaction('studyState', 'readonly').objectStore('studyState').get('current')
      get.onerror = () => { database.close(); rejectState(get.error) }
      get.onsuccess = () => { database.close(); resolveState(get.result.state) }
    }
  }))
}

async function waitForCalendarEvent(page, title, predicate) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const event = (await readCalendarWorkspace(page)).calendarEvents.find((entry) => entry.title === title)
    if (event && predicate(event)) return event
    await page.waitForTimeout(50)
  }
  const event = (await readCalendarWorkspace(page)).calendarEvents.find((entry) => entry.title === title)
  throw new Error(`Calendar event did not persist expected state: ${title}; revision=${event?.revision} recurrence=${JSON.stringify(event?.recurrence)}`)
}

async function chooseEventOption(page, editor, label, option) {
  await editor.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function exerciseCalendarEvents(page, seeded) {
  const calendar = page.locator('.calendar-workspace')
  const create = page.getByRole('dialog', { name: '新建日程', exact: true })
  const detail = page.getByRole('dialog', { name: '日程详情', exact: true })
  const fixedTitle = '独立日程验收'
  const allDayTitle = '全天系列验收'
  const beforeTasks = (await readCalendarWorkspace(page)).tasks
  await calendar.getByRole('button', { name: '今天', exact: true }).click()
  await calendar.getByRole('button', { name: '新建日程', exact: true }).click()
  await create.getByLabel('日程标题', { exact: true }).fill(fixedTitle)
  const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  await create.getByLabel('IANA 时区', { exact: true }).fill(timezone)
  await create.getByRole('button', { name: '保存日程', exact: true }).click()
  await create.waitFor({ state: 'hidden' })
  const fixed = await waitForCalendarEvent(page, fixedTitle, (event) => event.time.kind === 'fixed' && event.deletedAt === null)
  assert.equal(fixed.time.timezone, timezone)
  assert.equal(Date.parse(fixed.time.endAt) - Date.parse(fixed.time.startAt), 3_600_000)

  // Isolate the event so month overflow cannot hide the tested card.
  await calendar.getByRole('button', { name: /^筛选/ }).click()
  await page.getByLabel('搜索日历任务', { exact: true }).fill(fixedTitle)
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  for (const mode of ['日', '周', '月', '议程']) {
    await calendar.getByRole('button', { name: mode, exact: true }).click()
    const card = mode === '月'
      ? page.locator('.month-grid__fact').filter({ hasText: fixedTitle }).first()
      : mode === '议程'
        ? page.locator('.agenda-view__row').filter({ hasText: fixedTitle }).first()
        : page.getByRole('button', { name: `打开 ${fixedTitle}`, exact: true }).first()
    await card.click()
    assert.equal(await detail.getByLabel('日程标题', { exact: true }).inputValue(), fixedTitle)
    await detail.getByRole('button', { name: '关闭', exact: true }).click()
  }
  await clearCalendarFilters(page)
  await calendar.getByRole('button', { name: '日', exact: true }).click()
  await page.getByRole('button', { name: `打开 ${fixedTitle}`, exact: true }).click()
  await detail.getByRole('textbox', { name: '结束时间', exact: true }).fill('11:00')
  await detail.getByRole('textbox', { name: '结束时间', exact: true }).press('Tab')
  await detail.getByRole('button', { name: '保存日程', exact: true }).click()
  await detail.waitFor({ state: 'hidden' })
  const edited = await waitForCalendarEvent(page, fixedTitle, (event) => event.revision > fixed.revision)
  assert.equal(Date.parse(edited.time.endAt) - Date.parse(edited.time.startAt), 7_200_000)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await waitForCalendarEvent(page, fixedTitle, (event) => event.revision > edited.revision && event.time.endAt === fixed.time.endAt)
  await page.getByRole('button', { name: `打开 ${fixedTitle}`, exact: true }).click()
  await detail.getByRole('button', { name: '删除日程', exact: true }).click()
  await detail.waitFor({ state: 'hidden' })
  const deleted = await waitForCalendarEvent(page, fixedTitle, (event) => event.deletedAt !== null)
  assert.equal(await page.getByRole('button', { name: `打开 ${fixedTitle}`, exact: true }).count(), 0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await waitForCalendarEvent(page, fixedTitle, (event) => event.deletedAt === null && event.revision > deleted.revision)
  await page.getByRole('button', { name: `打开 ${fixedTitle}`, exact: true }).click()
  await detail.getByRole('button', { name: '添加提醒', exact: true }).click()
  await detail.getByRole('button', { name: '停用提醒：开始时', exact: true }).waitFor()
  const reminder = (await readCalendarWorkspace(page)).reminderRules.find((rule) => rule.target.kind === 'event' && rule.target.eventId === fixed.id)
  assert.ok(reminder?.enabled)
  assert.equal(reminder.target.originalStart, null)
  await detail.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('button', { name: `打开 ${fixedTitle}`, exact: true }).click()
  await detail.getByText('已停用，历史保留', { exact: true }).waitFor()
  const disabledReminder = (await readCalendarWorkspace(page)).reminderRules.find((rule) => rule.id === reminder.id)
  assert.equal(disabledReminder.enabled, false)
  assert.equal(disabledReminder.revision, reminder.revision + 1)
  await detail.getByRole('button', { name: '关闭', exact: true }).click()

  await calendar.getByRole('button', { name: '新建日程', exact: true }).click()
  await create.getByLabel('日程标题', { exact: true }).fill(allDayTitle)
  await chooseEventOption(page, create, '时间类型', '全天')
  await create.getByRole('button', { name: '保存日程', exact: true }).click()
  await create.waitFor({ state: 'hidden' })
  const allDay = await waitForCalendarEvent(page, allDayTitle, (event) => event.time.kind === 'all-day')
  assert.deepEqual(allDay.time, { kind: 'all-day', startOn: seeded.today, endOnExclusive: seeded.nextDay })
  await page.getByRole('button', { name: `打开 ${allDayTitle}`, exact: true }).click()
  await chooseEventOption(page, detail, '重复', '每天')
  await chooseEventOption(page, detail, '重复结束', '指定次数')
  await detail.getByLabel('重复次数', { exact: true }).fill('2')
  await detail.getByRole('button', { name: '保存日程', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '确认修改整个系列', exact: true })
  await confirmation.waitFor()
  assert.equal((await readCalendarWorkspace(page)).calendarEvents.find((event) => event.id === allDay.id).recurrence, null, 'Series preview must not write before confirmation')
  await confirmation.getByRole('button', { name: '确认保存', exact: true }).click()
  await confirmation.waitFor({ state: 'hidden' })
  await detail.waitFor({ state: 'hidden' })
  await waitForCalendarEvent(page, allDayTitle, (event) => event.recurrence?.end.count === 2)
  assert.deepEqual((await readCalendarWorkspace(page)).tasks, beforeTasks, 'Independent events must not create or mutate tasks')

  // External fixtures are seeded only after real local UI creation succeeds.
  await page.evaluate(({ eventId }) => new Promise((resolveSeed, rejectSeed) => {
    const request = indexedDB.open('meow-study', 2)
    request.onerror = () => rejectSeed(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('studyState', 'readwrite')
      const store = transaction.objectStore('studyState')
      const get = store.get('current')
      get.onsuccess = () => {
        const state = get.result.state
        const event = state.calendarEvents.find((entry) => entry.id === eventId)
        const source = state.calendarSources.find((entry) => entry.id === event.sourceId)
        state.calendarSources.push({ ...source, id: 'source:calendar:readonly', provider: 'ics', permission: 'read', title: '只读验收日历' })
        state.calendarEvents.push({ ...event, id: 'event:calendar:readonly', sourceId: 'source:calendar:readonly', title: '只读日程验收' })
        state.revision += 1
        store.put({ key: 'current', state })
      }
      transaction.onerror = () => rejectSeed(transaction.error)
      transaction.oncomplete = () => { database.close(); resolveSeed() }
    }
  }), { eventId: fixed.id })
  await page.reload({ waitUntil: 'networkidle' })
  await openCalendar(page)
  await calendar.getByRole('button', { name: '日', exact: true }).click()
  const readOnlyBefore = (await readCalendarWorkspace(page)).calendarEvents
  await page.getByRole('button', { name: '打开 只读日程验收', exact: true }).click()
  assert.equal(await detail.getByLabel('日程标题', { exact: true }).isDisabled(), true)
  assert.equal(await detail.getByRole('button', { name: '保存日程', exact: true }).count(), 0)
  assert.equal(await detail.getByRole('button', { name: '删除日程', exact: true }).count(), 0)
  await detail.getByRole('button', { name: '关闭', exact: true }).click()
  assert.deepEqual((await readCalendarWorkspace(page)).calendarEvents, readOnlyBefore)
}

async function exerciseCalendarSlotsAndOutcomes(page, seeded) {
  const calendar = page.locator('.calendar-workspace')
  const chooser = page.getByRole('dialog', { name: '创建安排', exact: true })
  const editor = page.getByRole('dialog', { name: '新建日程', exact: true })
  const detail = page.getByRole('dialog', { name: '日程详情', exact: true })
  const taskDetail = page.getByRole('dialog', { name: '任务详情', exact: true })
  await calendar.getByRole('button', { name: '今天', exact: true }).click()
  await calendar.getByRole('button', { name: '日', exact: true }).click()
  const factCounts = async () => { const state = await readCalendarWorkspace(page); return [state.tasks.length, state.calendarEvents.length, state.eventOutcomes.length] }
  async function blank(minute, end = minute, cancel = '') {
    await page.locator('.time-grid__scroll').evaluate((element, value) => { element.scrollTop = Math.max(0, value - 80) }, minute)
    const day = page.locator('.time-grid__day').first()
    const box = await day.boundingBox()
    assert.ok(box)
    const x = box.x + box.width - 15
    await page.mouse.move(x, box.y + minute)
    await page.mouse.down()
    if (end !== minute) await page.mouse.move(x, box.y + end, { steps: 4 })
    if (cancel === 'escape') await page.keyboard.press('Escape')
    if (cancel === 'pointercancel') await day.dispatchEvent('pointercancel', { pointerId: 1 })
    await page.mouse.up()
  }
  const before = await factCounts()
  await blank(780)
  await chooser.waitFor()
  assert.deepEqual(await factCounts(), before, 'Choosing an empty slot must not create a fact')
  await chooser.getByRole('button', { name: '取消', exact: true }).click()
  await blank(780, 840, 'escape')
  assert.equal(await chooser.isVisible(), false, 'Escape cancels the empty-range draft')
  await blank(780, 840, 'pointercancel')
  assert.equal(await chooser.isVisible(), false, 'pointercancel cancels the empty-range draft')
  assert.deepEqual(await factCounts(), before)

  await blank(780, 825)
  await chooser.getByRole('button', { name: '创建任务', exact: true }).click()
  const taskCreate = page.getByRole('dialog', { name: '创建任务时间盒', exact: true })
  const taskTitle = '空白时间盒任务验收'
  await taskCreate.getByRole('textbox', { name: '新建任务', exact: true }).fill(taskTitle)
  await taskCreate.getByRole('button', { name: '添加', exact: true }).click()
  await waitForStoredTask(page, taskTitle, { estimateMinutes: 45 })
  let storedTask = (await readCalendarWorkspace(page)).tasks.find((entry) => entry.title === taskTitle)
  const wall = await page.evaluate((value) => { const date = new Date(value); return [date.toLocaleDateString('sv-SE'), date.getHours(), date.getMinutes()] }, storedTask.schedule.startAt)
  assert.deepEqual(wall, [seeded.today, 13, 0])
  await taskDetail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
  await calendar.getByRole('button', { name: `完成 ${taskTitle}`, exact: true }).click()
  await waitForStoredTask(page, taskTitle, { status: 'completed' })
  await calendar.getByRole('button', { name: `重新打开 ${taskTitle}`, exact: true }).click()
  await waitForStoredTask(page, taskTitle, { status: 'planned' })
  const body = calendar.getByRole('button', { name: `打开 ${taskTitle}`, exact: true })
  await body.scrollIntoViewIfNeeded()
  const bodyBox = await body.boundingBox()
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + 8)
  await page.mouse.down(); await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + 38, { steps: 3 }); await page.mouse.up()
  assert.equal(await chooser.isVisible(), false, 'Dragging a task card must not open the empty-slot creator')

  await blank(900, 960)
  await chooser.getByRole('button', { name: '创建日程', exact: true }).click()
  assert.equal(await editor.getByRole('textbox', { name: '开始时间', exact: true }).inputValue(), '15:00')
  assert.equal(await editor.getByRole('textbox', { name: '结束时间', exact: true }).inputValue(), '16:00')
  const eventTitle = '会后动作验收日程'
  await editor.getByLabel('日程标题', { exact: true }).fill(eventTitle)
  await editor.getByRole('button', { name: '保存日程', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  const createdEvent = await waitForCalendarEvent(page, eventTitle, (entry) => entry.time.kind === 'fixed')
  assert.equal(Date.parse(createdEvent.time.endAt) - Date.parse(createdEvent.time.startAt), 3_600_000)
  assert.equal(await calendar.getByRole('button', { name: `完成 ${eventTitle}`, exact: true }).count(), 0)

  const learningTitle = '日历学习证据验收'
  await calendar.getByRole('button', { name: '学习任务', exact: true }).click()
  await calendar.getByRole('textbox', { name: '新建任务', exact: true }).fill(learningTitle)
  await calendar.getByRole('button', { name: '添加', exact: true }).click()
  await taskDetail.waitFor()
  await taskDetail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
  await calendar.getByRole('button', { name: `完成 ${learningTitle}`, exact: true }).click()
  const evidence = page.getByRole('dialog', { name: '把时间变成证据', exact: true })
  await evidence.waitFor()
  const learning = (await readCalendarWorkspace(page)).tasks.find((entry) => entry.title === learningTitle)
  assert.equal(learning.mode, 'learning')
  assert.notEqual(learning.status, 'completed', 'Learning completion must wait for evidence')
  await evidence.getByRole('button', { name: '关闭', exact: true }).click()

  // Move the UI-created event into the past to test outcomes at any real clock time.
  await page.evaluate((eventId) => new Promise((resolveSeed, rejectSeed) => {
    const request = indexedDB.open('meow-study', 2)
    request.onerror = () => rejectSeed(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('studyState', 'readwrite')
      const store = transaction.objectStore('studyState'); const get = store.get('current')
      get.onsuccess = () => {
        const state = get.result.state
        const event = state.calendarEvents.find((entry) => entry.id === eventId)
        event.time.startAt = new Date(Date.now() - 7_200_000).toISOString(); event.time.endAt = new Date(Date.now() - 3_600_000).toISOString(); event.revision++
        state.revision++; store.put({ key: 'current', state })
      }
      transaction.onerror = () => rejectSeed(transaction.error)
      transaction.oncomplete = () => { database.close(); resolveSeed() }
    }
  }), createdEvent.id)
  await page.reload({ waitUntil: 'networkidle' }); await openCalendar(page)
  await calendar.getByRole('button', { name: '月', exact: true }).click()
  await calendar.getByRole('button', { name: /^筛选/ }).click()
  await page.getByLabel('搜索日历任务', { exact: true }).fill(eventTitle)
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await page.locator('.month-grid__fact').filter({ hasText: eventTitle }).first().click()
  const panel = detail.getByRole('region', { name: '日程后续', exact: true })
  await chooseEventOption(page, panel, '选择后续处理', '创建跟进任务')
  await panel.getByLabel('跟进任务标题', { exact: true }).fill('会后跟进任务验收')
  await panel.getByRole('button', { name: '跟进任务目标清单', exact: true }).click()
  await page.getByRole('option').first().click()
  await panel.getByRole('button', { name: '创建跟进任务', exact: true }).click()
  await panel.getByText('已记录：跟进任务', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: '创建跟进任务', exact: true }).isDisabled(), true)
  await chooseEventOption(page, panel, '选择后续处理', '记录纪要')
  await panel.getByRole('textbox', { name: '纪要内容', exact: true }).fill('确认下一步行动及验收方式。')
  await panel.getByRole('button', { name: '保存纪要', exact: true }).click()
  await panel.getByText('已记录：纪要', { exact: true }).waitFor()
  await chooseEventOption(page, panel, '选择后续处理', '无需跟进')
  await panel.getByRole('button', { name: '确认无需跟进', exact: true }).click()
  await panel.getByText('已记录：无需跟进', { exact: true }).waitFor()
  const state = await readCalendarWorkspace(page)
  const outcomes = state.eventOutcomes.filter((entry) => entry.eventId === createdEvent.id)
  assert.equal(outcomes.length, 3)
  const followupId = outcomes.find((entry) => entry.action === 'followup').taskId
  await panel.getByRole('button', { name: '取消关联 会后跟进任务验收', exact: true }).click()
  await panel.getByRole('button', { name: '取消关联 会后跟进任务验收', exact: true }).waitFor({ state: 'hidden' })
  const afterUnlink = await readCalendarWorkspace(page)
  assert.ok(afterUnlink.tasks.some((entry) => entry.id === followupId && entry.deletedAt === null))
  assert.ok(afterUnlink.calendarEvents.some((entry) => entry.id === createdEvent.id && entry.deletedAt === null))
  assert.equal(afterUnlink.eventOutcomes.filter((entry) => entry.eventId === createdEvent.id).length, 3)
  await detail.getByRole('button', { name: '关闭', exact: true }).click()
  await clearCalendarFilters(page)
  await page.setViewportSize({ width: 320, height: 700 })
  await calendar.getByRole('button', { name: '今天', exact: true }).click()
  await calendar.getByRole('button', { name: '日', exact: true }).click()
  const cdp = await page.context().newCDPSession(page)
  await page.locator('.time-grid__scroll').evaluate((element) => { element.scrollTop = 1000 })
  await page.locator('.time-grid__scroll').scrollIntoViewIfNeeded()
  const viewport = await page.locator('.time-grid__scroll').boundingBox()
  assert.ok(viewport.height >= 120, 'The mobile timeline must retain enough height for a complete task card')
  const touch = { x: Math.round(viewport.x + viewport.width - 18), y: Math.round(viewport.y + Math.min(80, viewport.height / 2)) }
  const touchBefore = await factCounts()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touch, y: touch.y - 45 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert.equal(await chooser.isVisible(), false, 'Touch scrolling must not open a creator')
  assert.deepEqual(await factCounts(), touchBefore)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await chooser.waitFor()
  await assertVisualState(page, false)
  await page.screenshot({ path: resolve(artifactRoot, 'calendar-mobile-slot-320x700.png') })
  await chooser.getByRole('button', { name: '取消', exact: true }).click()
  await cdp.detach()
  await page.setViewportSize({ width: 1440, height: 960 })
  console.log('Calendar stage 3 flows passed: blank cancellation, timed creation, task actions, outcomes, unlink, touch')
}

async function chooseCalendarFilter(page, label, option) {
  await page.locator('.calendar-workspace').getByRole('button', { name: /^筛选/ }).click()
  await page.locator('.calendar-workspace__filters').getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
}

async function clearCalendarFilters(page) {
  await page.locator('.calendar-workspace').getByRole('button', { name: /^筛选/ }).click()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
}

async function assertCalendarActionsReachable(page) {
  const calendar = page.locator('.calendar-workspace')
  const input = calendar.getByRole('textbox', { name: '新建任务', exact: true })
  await input.scrollIntoViewIfNeeded()
  await input.focus()
  assert.equal(await input.evaluate((element) => document.activeElement === element), true)
  await chooseCalendarFilter(page, '优先级', '高优先级')
  await clearCalendarFilters(page)
  await calendar.getByRole('button', { name: '日', exact: true }).click()
  await calendar.getByRole('button', { name: '今天', exact: true }).click()
  await page.getByRole('button', { name: `打开 ${seededTitles.overlapA}`, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '任务详情', exact: true })
  const action = detail.getByRole('button', { name: '开始学习', exact: true })
  await action.scrollIntoViewIfNeeded()
  const box = await action.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'Detail primary action must be reachable within the viewport')
  await detail.getByRole('button', { name: '关闭任务详情', exact: true }).click()
  await calendar.getByRole('button', { name: '新建日程', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '新建日程', exact: true })
  await editor.getByLabel('日程标题', { exact: true }).fill('窄屏可达验收')
  const save = editor.getByRole('button', { name: '保存日程', exact: true })
  await save.scrollIntoViewIfNeeded()
  const saveBox = await save.boundingBox()
  assert.ok(saveBox && saveBox.height >= 44 && saveBox.x >= 0 && saveBox.y >= 0 && saveBox.x + saveBox.width <= viewport.width + 1 && saveBox.y + saveBox.height <= viewport.height + 1, 'Event save action must be reachable within the viewport')
  await assertVisualState(page, false)
  await editor.getByRole('button', { name: '取消', exact: true }).click()
}

async function assertDateGrid(page, minimumCellHeight = 0) {
  const grids = page.locator('[role="grid"]:visible')
  assert.equal(await grids.count(), 1, 'Expected exactly one visible themed date grid.')
  const cells = grids.getByRole('gridcell')
  const boxes = await cells.evaluateAll((elements) => elements
    .filter((element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    })
    .map((element) => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }))
  assert.equal(boxes.length, 42, 'The visible date grid must expose exactly 42 visible gridcells.')
  if (minimumCellHeight) {
    assert.ok(boxes.every(({ width, height }) => width >= minimumCellHeight && height >= minimumCellHeight), `Every date gridcell must be at least ${minimumCellHeight}px in both dimensions.`)
  }
}

async function assertModalSheet(sheet, expectedName) {
  assert.equal(await sheet.getAttribute('aria-modal'), 'true', `${expectedName} must be modal on mobile.`)
  assert.equal(await sheet.getAttribute('aria-label'), expectedName, `${expectedName} must name the mobile Sheet panel.`)
}

async function assertFocusTrap(page, sheet) {
  const focusable = sheet.locator('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
  const count = await focusable.count()
  assert.ok(count > 1, 'The date Sheet must have multiple focusable controls.')
  assert.equal(await sheet.evaluate((element) => element.contains(document.activeElement)), true, 'Opening a mobile Sheet must move focus inside it.')
  await focusable.first().focus()
  await page.keyboard.press('Shift+Tab')
  assert.equal(await sheet.evaluate((element) => element.contains(document.activeElement)), true, 'Shift+Tab must not escape the Sheet.')
  await focusable.last().focus()
  await page.keyboard.press('Tab')
  assert.equal(await sheet.evaluate((element) => element.contains(document.activeElement)), true, 'Tab must not escape the Sheet.')
}

async function assertIconSidebarBreakpoint(page) {
  const sidebar = page.locator('.sidebar')
  await sidebar.waitFor({ state: 'visible' })
  const sidebarBox = await sidebar.boundingBox()
  assert.ok(sidebarBox && Math.abs(sidebarBox.width - 72) <= 1, `The 820px breakpoint must render the 72px icon sidebar; received ${sidebarBox?.width ?? 'no box'}px.`)
  assert.equal(await page.getByRole('navigation', { name: '移动端主导航' }).isVisible(), false, 'The 820px breakpoint must not render mobile bottom navigation.')
  const labelsHidden = await sidebar.locator('.nav-label').evaluateAll((elements) => elements.every((element) => {
    const style = getComputedStyle(element)
    return Number.parseFloat(style.opacity) === 0 && Number.parseFloat(style.maxWidth) === 0
  }))
  assert.equal(labelsHidden, true, 'The 820px breakpoint must hide sidebar labels and keep icons.')
}

async function assertVisualState(page, requireOverlay) {
  const result = await page.evaluate((nativeControlSelector) => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const nativeControls = Array.from(document.querySelectorAll(nativeControlSelector)).filter(visible)
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
  }, UNADAPTED_NATIVE_CONTROL_SELECTOR)
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
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  })
}
