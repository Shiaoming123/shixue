import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { groupCalendarPlanningTasks } from '../src/domain/calendar/plan.ts'
import { filterUnscheduledTasks } from '../src/components/calendar/use-calendar-drag.ts'
import { parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'

test('planning groups retain strict unscheduled eligibility and add only visible incomplete time slots', (context) => {
  const previousTimezone = process.env.TZ
  context.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone })
  process.env.TZ = 'UTC'
  const { state } = parseWorkspaceExport(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8'))
  const base = state.tasks.find(({ id }) => id === 'unscheduled')!
  const tasks = [...state.tasks,
    { ...base, id: 'overdue', deadline: { dueOn: '2026-09-08', dueAt: null } },
    { ...base, id: 'due-today', deadline: { dueOn: '2026-09-09', dueAt: null } },
    { ...base, id: 'past-instant', deadline: { dueOn: null, dueAt: '2026-09-09T11:00:00Z' } },
    { ...base, id: 'missing-duration', schedule: { startOn: null, startAt: '2026-09-09T23:00:00-07:00', estimateMinutes: null } },
    { ...base, id: 'outside-range', schedule: { startOn: '2026-09-11', startAt: null, estimateMinutes: null } },
    { ...base, id: 'completed', status: 'completed' as const, schedule: { startOn: '2026-09-09', startAt: null, estimateMinutes: null } },
    { ...base, id: 'cancelled', status: 'cancelled' as const, schedule: { startOn: '2026-09-09', startAt: null, estimateMinutes: null } },
    { ...base, id: 'deleted', deletedAt: '2026-09-09T00:00:00Z', schedule: { startOn: '2026-09-09', startAt: null, estimateMinutes: null } },
    { ...base, id: 'recurring-parent', recurrenceSeriesId: 'synthetic-series', schedule: { startOn: '2026-09-09', startAt: null, estimateMinutes: null } },
  ]
  const before = structuredClone(tasks)
  const unscheduled = filterUnscheduledTasks(tasks)
  const groups = groupCalendarPlanningTasks(tasks, unscheduled, { start: '2026-09-09', end: '2026-09-11' }, '2026-09-09T12:00:00Z')
  assert.deepEqual(groups.map(({ id, tasks }) => [id, tasks.map(({ id }) => id)]), [
    ['overdue', ['overdue', 'past-instant']],
    ['deadline', ['deadline', 'due-today']],
    ['undated', ['unscheduled']],
    ['all-day', ['all-day']],
    ['duration', ['missing-duration']],
  ])
  const future = groupCalendarPlanningTasks(tasks, unscheduled, { start: '2026-10-01', end: '2026-11-01' }, '2026-09-09T12:00:00Z')
  assert.deepEqual(future.slice(0, 3), groups.slice(0, 3), 'Navigating to next month must not turn future deadlines overdue')
  assert.equal(future.length, 3, 'Scheduled groups follow the visible range')
  assert.deepEqual(tasks, before, 'Grouping cannot schedule or otherwise change task facts')
})

test('planning tray retains themed disclosure, keyboard click and drag suppression seams', () => {
  const source = readFileSync(new URL('../src/components/calendar/UnscheduledTray.vue', import.meta.url), 'utf8')
  assert.match(source, /filterUnscheduledTasks\(props.tasks\)/)
  assert.match(source, /<Button[^>]+:aria-expanded=/)
  assert.match(source, /Math.hypot\(event.clientX - pointerStart.x, event.clientY - pointerStart.y\) >= 4/)
  assert.match(source, /event.detail === 0 \|\| !moved/)
  assert.match(source, /@click="openTask\(\$event, task.id\)"/)
  assert.match(source, /calendarMenuMoveCommand\(/)
})
