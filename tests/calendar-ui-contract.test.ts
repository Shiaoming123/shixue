import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calendarKeyboardCommand,
  calendarCommandForPreview,
  calendarMoveCommand,
  calendarResizeCommand,
  createCalendarDragController,
  filterUnscheduledTasks,
  snapCalendarMinutes,
  type CalendarDragPreview,
} from '../src/components/calendar/use-calendar-drag.ts'
import type { CalendarItem } from '../src/domain/calendar/project.ts'
import type { Task } from '../src/domain/workspace/types.ts'
import { currentSidebarDestination } from '../src/lib/sidebar-navigation.ts'
import { calendarDeadlineConflict, calendarOverlapMessage } from '../src/components/calendar/calendar-conflicts.ts'
import { layoutTimedItems } from '../src/domain/calendar/layout.ts'
import type { WorkspaceStateV3 } from '../src/domain/workspace/types.ts'

const source = (name: string) => readFileSync(new URL(`../src/components/calendar/${name}`, import.meta.url), 'utf8')
const appSource = () => readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const navigationSource = () => readFileSync(new URL('../src/lib/sidebar-navigation.ts', import.meta.url), 'utf8')

test('pointer movement is preview-only and a valid release executes exactly once', async () => {
  const executed: unknown[] = []
  const captured: number[] = []
  const released: number[] = []
  const controller = createCalendarDragController(async (command) => { executed.push(command) })
  const target = {
    setPointerCapture: (pointerId: number) => captured.push(pointerId),
    releasePointerCapture: (pointerId: number) => released.push(pointerId),
  }
  const event = { pointerId: 7, currentTarget: target, clientX: 10, clientY: 10 }

  controller.begin(event, { itemKey: 'task:one', item: timedItem({ key: 'task:one', taskId: 'one' }), action: 'move', sourceStart: null, sourceDuration: 45 })
  const preview: CalendarDragPreview = {
    itemKey: 'task:one', proposedStart: '2026-09-07T09:15:00.000Z', proposedDuration: 45,
    valid: true, conflict: null,
  }
  controller.update({ ...event, clientX: 24 }, preview)
  assert.deepEqual(controller.preview.value, preview)
  assert.deepEqual(executed, [])

  const command = { type: 'calendar.move', taskId: 'one', startAt: preview.proposedStart, scope: 'task' } as const
  await Promise.all([controller.release(event, command, 'task:one'), controller.release(event, command, 'task:one')])

  assert.deepEqual(executed, [command])
  assert.equal(controller.preview.value, null)
  assert.deepEqual(captured, [7])
  assert.deepEqual(released, [7])
})

test('pointer cancellation clears preview without executing a command', async () => {
  let executions = 0
  const controller = createCalendarDragController(async () => { executions += 1 })
  const target = { setPointerCapture() {}, releasePointerCapture() {} }
  const event = { pointerId: 4, currentTarget: target, clientX: 0, clientY: 0 }
  controller.begin(event, { itemKey: 'task:cancel', item: timedItem({ key: 'task:cancel', taskId: 'cancel' }), action: 'move', sourceStart: null, sourceDuration: 30 })
  controller.update({ ...event, clientY: 10 }, {
    itemKey: 'task:cancel', proposedStart: '2026-09-07', proposedDuration: 30,
    valid: true, conflict: null,
  })

  controller.cancel(event)
  await controller.release(event, { type: 'calendar.move', taskId: 'cancel', startOn: '2026-09-07', scope: 'task' }, 'task:cancel')

  assert.equal(executions, 0)
  assert.equal(controller.preview.value, null)
})

test('drag threshold, foreign pointers, second begins and active cancellation cannot submit', async () => {
  let executions = 0
  const controller = createCalendarDragController(async () => { executions += 1 })
  const target = { setPointerCapture() {}, releasePointerCapture() {} }
  const event = { pointerId: 1, currentTarget: target, clientX: 10, clientY: 10 }
  const source = { itemKey: 'task:one', item: timedItem({ key: 'task:one', taskId: 'one' }), action: 'move' as const, sourceStart: null, sourceDuration: 30 }
  controller.begin(event, source)
  source.sourceDuration = 90
  source.item.taskId = 'mutated-after-begin'
  controller.begin({ ...event, pointerId: 2 }, { itemKey: 'task:two', item: timedItem({ key: 'task:two', taskId: 'two' }), action: 'move', sourceStart: null, sourceDuration: 45 })
  controller.update({ ...event, clientX: 12 }, {
    itemKey: 'task:one', proposedStart: '2026-09-07T09:00:00.000Z', proposedDuration: 30, valid: true, conflict: null,
  })
  controller.update({ ...event, pointerId: 2, clientX: 30 }, {
    itemKey: 'task:two', proposedStart: '2026-09-07T09:00:00.000Z', proposedDuration: 45, valid: true, conflict: null,
  })
  assert.equal(controller.preview.value, null)
  assert.equal(controller.session.value?.itemKey, 'task:one')
  assert.equal(controller.session.value?.item.taskId, 'one')
  assert.equal(controller.session.value?.sourceDuration, 30)
  await controller.release(event, { type: 'calendar.move', taskId: 'one', startAt: '2026-09-07T09:00:00.000Z', scope: 'task' }, 'task:one')
  assert.equal(executions, 0)

  controller.begin(event, source)
  controller.update({ ...event, clientX: 20 }, {
    itemKey: 'task:one', proposedStart: '2026-09-07T09:00:00.000Z', proposedDuration: 30, valid: false, conflict: '超出有效范围',
  })
  await controller.release(event, { type: 'calendar.move', taskId: 'one', startAt: '2026-09-07T09:00:00.000Z', scope: 'task' }, 'task:one')
  assert.equal(executions, 0)

  controller.begin(event, source)
  controller.update({ ...event, clientY: 20 }, {
    itemKey: 'task:one', proposedStart: '2026-09-07T09:00:00.000Z', proposedDuration: 30, valid: true, conflict: null,
  })
  controller.cancelActive()
  await controller.release(event, { type: 'calendar.move', taskId: 'one', startAt: '2026-09-07T09:00:00.000Z', scope: 'task' }, 'task:one')
  assert.equal(executions, 0)
})

test('a rejected second pointer cannot replace the accepted item or command target', async () => {
  const executed: unknown[] = []
  const controller = createCalendarDragController(async (command) => { executed.push(command) })
  const target = { setPointerCapture() {}, releasePointerCapture() {} }
  const first = { pointerId: 1, currentTarget: target, clientX: 0, clientY: 0 }
  const second = { pointerId: 2, currentTarget: target, clientX: 20, clientY: 20 }
  assert.equal(controller.begin(first, { itemKey: 'task:a', item: timedItem({ key: 'task:a', taskId: 'a' }), action: 'move', sourceStart: null, sourceDuration: 30 }), true)
  controller.update({ ...first, clientX: 10 }, { itemKey: 'task:a', proposedStart: '2026-09-07', proposedDuration: 30, valid: true, conflict: null })
  assert.equal(controller.begin(second, { itemKey: 'task:b', item: timedItem({ key: 'task:b', taskId: 'b' }), action: 'move', sourceStart: null, sourceDuration: 30 }), false)
  assert.equal(controller.session.value?.item.taskId, 'a')
  await Promise.all([
    controller.release(first, { type: 'calendar.move', taskId: 'a', startOn: '2026-09-07', scope: 'task' }, 'task:a'),
    controller.release(first, { type: 'calendar.move', taskId: 'a', startOn: '2026-09-07', scope: 'task' }, 'task:a'),
  ])
  assert.deepEqual(executed, [{ type: 'calendar.move', taskId: 'a', startOn: '2026-09-07', scope: 'task' }])

  assert.equal(controller.begin(first, { itemKey: 'task:a', item: timedItem({ key: 'task:a', taskId: 'a' }), action: 'move', sourceStart: null, sourceDuration: 30 }), true)
  controller.update({ ...first, clientX: 10 }, { itemKey: 'task:a', proposedStart: '2026-09-07', proposedDuration: 30, valid: true, conflict: null })
  await controller.release(first, { type: 'calendar.move', taskId: 'b', startOn: '2026-09-07', scope: 'task' }, 'task:a')
  assert.deepEqual(executed, [{ type: 'calendar.move', taskId: 'a', startOn: '2026-09-07', scope: 'task' }])
})

test('calendar keyboard commands preserve target scope and step sizes', () => {
  const task = timedItem({ taskId: 'task:plain', occurrenceId: null })
  const occurrence = timedItem({ taskId: 'task:repeat', occurrenceId: 'occ:2' })
  const allDay = { ...timedItem({ taskId: 'task:day' }), kind: 'all-day' as const, start: '2026-09-04', end: null }

  assert.deepEqual(calendarKeyboardCommand(task, 'ArrowDown', false), {
    type: 'calendar.move', taskId: 'task:plain', startAt: '2026-09-04T01:15:00.000Z', scope: 'task',
  })
  assert.deepEqual(calendarKeyboardCommand(occurrence, 'ArrowRight', false), {
    type: 'calendar.move', taskId: 'task:repeat', occurrenceId: 'occ:2', startAt: '2026-09-05T01:00:00.000Z', scope: 'occurrence',
  })
  assert.deepEqual(calendarKeyboardCommand(occurrence, 'ArrowUp', true), {
    type: 'calendar.resize', taskId: 'task:repeat', occurrenceId: 'occ:2', estimateMinutes: 55, scope: 'occurrence',
  })
  assert.equal(calendarKeyboardCommand(allDay, 'ArrowUp', false), null)
  assert.equal(calendarKeyboardCommand(allDay, 'ArrowDown', true), null)
  assert.equal(snapCalendarMinutes(68), 75)
})

test('pointer, keyboard and visible actions share command construction', () => {
  const task = timedItem({ taskId: 'task:drop', occurrenceId: null })
  const occurrence = timedItem({ taskId: 'task:repeat', occurrenceId: 'occ:3' })
  assert.deepEqual(calendarMoveCommand(task, { startAt: '2026-09-07T01:30:00.000Z' }, 30), {
    type: 'calendar.move', taskId: 'task:drop', startAt: '2026-09-07T01:30:00.000Z',
    estimateMinutes: 30, scope: 'task',
  })
  assert.deepEqual(calendarResizeCommand(occurrence, 45), {
    type: 'calendar.resize', taskId: 'task:repeat', occurrenceId: 'occ:3', estimateMinutes: 45, scope: 'occurrence',
  })
  const allDay = { ...timedItem({ key: 'task:day', taskId: 'day' }), kind: 'all-day' as const, start: '2026-09-06', end: null }
  assert.deepEqual(calendarCommandForPreview(allDay, 'move', {
    itemKey: 'task:day', proposedStart: '2026-09-06T02:00:00.000Z', proposedDuration: 30, valid: true, conflict: null,
  }), { type: 'calendar.move', taskId: 'day', startAt: '2026-09-06T02:00:00.000Z', estimateMinutes: 30, scope: 'task' })
  const allDayOccurrence = { ...allDay, key: 'occurrence:day', taskId: 'repeat', occurrenceId: 'occurrence:day' }
  assert.deepEqual(calendarCommandForPreview(allDayOccurrence, 'move', {
    itemKey: 'occurrence:day', proposedStart: '2026-09-06T03:00:00.000Z', proposedDuration: 45, valid: true, conflict: null,
  }), { type: 'calendar.move', taskId: 'repeat', occurrenceId: 'occurrence:day', startAt: '2026-09-06T03:00:00.000Z', estimateMinutes: 45, scope: 'occurrence' })
  assert.deepEqual(calendarMoveCommand(allDayOccurrence, { startAt: '2026-09-06T04:00:00.000Z' }, 30), {
    type: 'calendar.move', taskId: 'repeat', occurrenceId: 'occurrence:day', startAt: '2026-09-06T04:00:00.000Z', estimateMinutes: 30, scope: 'occurrence',
  })
})

test('unscheduled tray includes only active tasks with no start date or time', () => {
  const unscheduled = task({ id: 'task:inbox', status: 'inbox' })
  const scheduledOn = task({ id: 'task:day', schedule: { startAt: null, startOn: '2026-09-07', estimateMinutes: 30 } })
  const scheduledAt = task({ id: 'task:time', schedule: { startAt: '2026-09-07T09:00:00.000Z', startOn: null, estimateMinutes: 30 } })
  const completed = task({ id: 'task:done', status: 'completed' })
  const recurringParent = task({ id: 'task:series', recurrenceSeriesId: 'series:one' })

  assert.deepEqual(filterUnscheduledTasks([scheduledOn, completed, recurringParent, unscheduled, scheduledAt]).map(({ id }) => id), ['task:inbox'])
})

test('overlap warns without invalidating and deadline confirmation is pure', () => {
  const overlapping = layoutTimedItems([
    timedItem({ key: 'task:a', taskId: 'a', start: '2026-09-06T09:00:00+08:00', end: '2026-09-06T10:00:00+08:00' }),
    timedItem({ key: 'task:b', taskId: 'b', start: '2026-09-06T09:30:00+08:00', end: '2026-09-06T10:30:00+08:00' }),
  ])
  assert.equal(calendarOverlapMessage(overlapping, 'task:new', '2026-09-06', 9 * 60 + 45, 30), '与 2 个任务重叠')
  const workspace = { tasks: [task({ id: 'deadline', deadline: { dueAt: null, dueOn: '2026-09-06' } })] } as WorkspaceStateV3
  const before = structuredClone(workspace)
  assert.equal(calendarDeadlineConflict(workspace, { type: 'calendar.move', taskId: 'deadline', startOn: '2026-09-07' }), '安排时间晚于截止时间，请确认仍然安排。')
  assert.deepEqual(workspace, before)
})

test('calendar components expose the locked pointer, keyboard, menu, grid and navigation contracts', () => {
  const drag = source('use-calendar-drag.ts')
  const workspace = source('CalendarWorkspace.vue')
  const grid = source('TimeGrid.vue')
  const item = source('CalendarItem.vue')
  const tray = source('UnscheduledTray.vue')
  const toolbar = source('CalendarToolbar.vue')
  const app = appSource()
  const navigation = navigationSource()
  const sidebar = readFileSync(new URL('../src/components/study/AppSidebar.vue', import.meta.url), 'utf8')
  const bottomTabs = readFileSync(new URL('../src/components/study/BottomTabs.vue', import.meta.url), 'utf8')

  assert.match(drag, /pointerId/)
  assert.match(drag, /setPointerCapture/)
  assert.match(drag, /releasePointerCapture/)
  assert.match(workspace, /calendarRange/)
  assert.match(workspace, /projectCalendarItems/)
  assert.match(workspace, /layoutTimedItems/)
  assert.doesNotMatch(workspace, /draggable=["']true["']/)
  assert.match(grid, /15-minute|HALF_HOUR|current-time-line/)
  assert.match(item, /aria-keyshortcuts/)
  assert.match(item, /Alt\+Arrow/)
  assert.match(item, /:aria-keyshortcuts="interactive \? keyboardShortcuts/)
  assert.match(item, /DatePicker/)
  assert.match(item, /TimePicker/)
  assert.doesNotMatch(item, /calendarResizeCommand/)
  assert.match(item, /calendarMoveCommand\(props\.item, target, .*duration\.value/)
  assert.doesNotMatch(item, /<input[^>]+type=["'](?:date|time)["']/)
  assert.match(tray, /filterUnscheduledTasks/)
  assert.match(tray, /calendarMoveCommand/)
  assert.doesNotMatch(tray, /type:\s*'calendar.resize'/)
  assert.match(workspace, /defaultEstimateMinutes \?\? 30/)
  assert.match(toolbar, /CalendarView/)
  assert.match(toolbar, />日</)
  assert.match(toolbar, />周</)
  assert.match(toolbar, />月</)
  assert.match(toolbar, />议程</)
  assert.match(navigation, /StudyPage = [^\n]*'calendar'/)
  assert.equal(currentSidebarDestination('calendar'), 'page:calendar')
  assert.match(sidebar, /orderKey: 'page:calendar'/)
  assert.match(bottomTabs, /key: 'calendar'/)
  assert.match(bottomTabs, /repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(app, /<CalendarWorkspace\b/)
  assert.match(app, /'smart:next7', 'page:calendar', 'smart:all'/)
  assert.match(app, /:workspace="recurrenceWorkspace"/)
  assert.match(app, /:execute-command="executeCalendarCommand"/)
  assert.match(app, /loadLastDesktopCalendarView/)
  assert.match(app, /saveLastDesktopCalendarView/)
  assert.match(app, /@desktop-mode-selected="persistDesktopCalendarMode"/)
  assert.doesNotMatch(app, /defaultCalendarView === 'week'/)
  assert.match(app, /result\.undoToken/)
  assert.match(app, /await refreshState\(\)/)
  assert.doesNotMatch([workspace, grid, item, tray, toolbar].join('\n'), /getWorkspaceStore|createTaskCapabilityService/)
})

function timedItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  const start = overrides.start ?? '2026-09-04T01:00:00.000Z'
  const time = /T(\d{2}):(\d{2})/.exec(start)
  return {
    key: 'task:plain', taskId: 'task:plain', occurrenceId: null, kind: 'timed',
    start, end: '2026-09-04T02:00:00.000Z',
    displayDate: overrides.displayDate ?? start.slice(0, 10),
    displayMinute: overrides.displayMinute ?? (Number(time?.[1] ?? 0) * 60 + Number(time?.[2] ?? 0)),
    ...overrides,
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task:one', revision: 1, mode: 'general', listId: 'list:one', sectionId: null,
    tagIds: [], title: 'Task', notes: '', status: 'planned',
    schedule: { startAt: null, startOn: null, estimateMinutes: null },
    deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [], learning: null,
    recurrenceSeriesId: null, createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null, ...overrides,
  }
}
