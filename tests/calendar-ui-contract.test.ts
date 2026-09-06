import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calendarKeyboardCommand,
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

  controller.begin(event, { itemKey: 'task:one', action: 'move', sourceStart: null, sourceDuration: 45 })
  const preview: CalendarDragPreview = {
    itemKey: 'task:one', proposedStart: '2026-09-07T09:15:00.000Z', proposedDuration: 45,
    valid: true, conflict: null,
  }
  controller.update({ ...event, clientX: 24 }, preview)
  assert.deepEqual(controller.preview.value, preview)
  assert.deepEqual(executed, [])

  const command = { type: 'calendar.move', taskId: 'one', startAt: preview.proposedStart, scope: 'task' } as const
  await Promise.all([controller.release(event, command), controller.release(event, command)])

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
  controller.begin(event, { itemKey: 'task:cancel', action: 'move', sourceStart: null, sourceDuration: 30 })
  controller.update({ ...event, clientY: 10 }, {
    itemKey: 'task:cancel', proposedStart: '2026-09-07', proposedDuration: 30,
    valid: true, conflict: null,
  })

  controller.cancel(event)
  await controller.release(event, { type: 'calendar.move', taskId: 'cancel', startOn: '2026-09-07', scope: 'task' })

  assert.equal(executions, 0)
  assert.equal(controller.preview.value, null)
})

test('drag threshold, foreign pointers, second begins and active cancellation cannot submit', async () => {
  let executions = 0
  const controller = createCalendarDragController(async () => { executions += 1 })
  const target = { setPointerCapture() {}, releasePointerCapture() {} }
  const event = { pointerId: 1, currentTarget: target, clientX: 10, clientY: 10 }
  const source = { itemKey: 'task:one', action: 'move' as const, sourceStart: null, sourceDuration: 30 }
  controller.begin(event, source)
  source.sourceDuration = 90
  controller.begin({ ...event, pointerId: 2 }, { itemKey: 'task:two', action: 'move', sourceStart: null, sourceDuration: 45 })
  controller.update({ ...event, clientX: 12 }, {
    itemKey: 'task:one', proposedStart: '2026-09-07T09:00:00.000Z', proposedDuration: 30, valid: true, conflict: null,
  })
  controller.update({ ...event, pointerId: 2, clientX: 30 }, {
    itemKey: 'task:two', proposedStart: '2026-09-07T09:00:00.000Z', proposedDuration: 45, valid: true, conflict: null,
  })
  assert.equal(controller.preview.value, null)
  assert.equal(controller.session.value?.itemKey, 'task:one')
  assert.equal(controller.session.value?.sourceDuration, 30)
  await controller.release(event, { type: 'calendar.move', taskId: 'one', startAt: '2026-09-07T09:00:00.000Z', scope: 'task' })
  assert.equal(executions, 0)

  controller.begin(event, source)
  controller.update({ ...event, clientX: 20 }, {
    itemKey: 'task:one', proposedStart: '2026-09-07T09:00:00.000Z', proposedDuration: 30, valid: false, conflict: '超出有效范围',
  })
  await controller.release(event, { type: 'calendar.move', taskId: 'one', startAt: '2026-09-07T09:00:00.000Z', scope: 'task' })
  assert.equal(executions, 0)

  controller.begin(event, source)
  controller.update({ ...event, clientY: 20 }, {
    itemKey: 'task:one', proposedStart: '2026-09-07T09:00:00.000Z', proposedDuration: 30, valid: true, conflict: null,
  })
  controller.cancelActive()
  await controller.release(event, { type: 'calendar.move', taskId: 'one', startAt: '2026-09-07T09:00:00.000Z', scope: 'task' })
  assert.equal(executions, 0)
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
})

test('unscheduled tray includes only active tasks with no start date or time', () => {
  const unscheduled = task({ id: 'task:inbox', status: 'inbox' })
  const scheduledOn = task({ id: 'task:day', schedule: { startAt: null, startOn: '2026-09-07', estimateMinutes: 30 } })
  const scheduledAt = task({ id: 'task:time', schedule: { startAt: '2026-09-07T09:00:00.000Z', startOn: null, estimateMinutes: 30 } })
  const completed = task({ id: 'task:done', status: 'completed' })
  const recurringParent = task({ id: 'task:series', recurrenceSeriesId: 'series:one' })

  assert.deepEqual(filterUnscheduledTasks([scheduledOn, completed, recurringParent, unscheduled, scheduledAt]).map(({ id }) => id), ['task:inbox'])
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
  assert.match(toolbar, /'day' \| 'week'/)
  assert.match(navigation, /StudyPage = [^\n]*'calendar'/)
  assert.equal(currentSidebarDestination('calendar'), 'page:calendar')
  assert.match(sidebar, /orderKey: 'page:calendar'/)
  assert.match(bottomTabs, /key: 'calendar'/)
  assert.match(bottomTabs, /repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(app, /<CalendarWorkspace\b/)
  assert.match(app, /'smart:next7', 'page:calendar', 'smart:all'/)
  assert.match(app, /:workspace="recurrenceWorkspace"/)
  assert.match(app, /:execute-command="executeCalendarCommand"/)
  assert.match(app, /result\.undoToken/)
  assert.match(app, /await refreshState\(\)/)
  assert.doesNotMatch([workspace, grid, item, tray, toolbar].join('\n'), /getWorkspaceStore|createTaskCapabilityService/)
})

function timedItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    key: 'task:plain', taskId: 'task:plain', occurrenceId: null, kind: 'timed',
    start: '2026-09-04T01:00:00.000Z', end: '2026-09-04T02:00:00.000Z', ...overrides,
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
