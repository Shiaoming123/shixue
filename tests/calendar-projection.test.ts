import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarRange } from '../src/domain/calendar/range.ts'
import { projectCalendarItems } from '../src/domain/calendar/project.ts'
import type { Task, TaskOccurrence, WorkspaceStateV3 } from '../src/domain/workspace/types.ts'

const dayRange = { start: '2026-09-04', end: '2026-09-05' } as const

test('calendar ranges use a start-inclusive, end-exclusive boundary', () => {
  assert.deepEqual(calendarRange('day', '2026-09-04', 1), dayRange)
  assert.deepEqual(calendarRange('week', '2026-09-04', 1), { start: '2026-08-31', end: '2026-09-07' })
  assert.deepEqual(calendarRange('month', '2026-09-04', 1), { start: '2026-08-31', end: '2026-10-05' })
})

test('calendar ranges reject invalid calendar dates instead of normalizing them', () => {
  assert.throws(() => calendarRange('day', '2026-02-30', 1), /Invalid calendar date/)
})

test('projects date-only tasks as all-day items without synthesizing a timestamp', () => {
  const state = fixture({ schedule: { startAt: null, startOn: '2026-09-04', estimateMinutes: 30 } })

  assert.deepEqual(projectCalendarItems(state, dayRange), [{
    key: 'task:task:1', taskId: 'task:1', occurrenceId: null,
    kind: 'all-day', start: '2026-09-04', end: null,
  }])
})

test('projects timed tasks only when a start and duration are both present', () => {
  const state = fixture({ schedule: { startAt: '2026-09-04T09:00:00+08:00', startOn: null, estimateMinutes: 45 } })
  const startOnly = fixture({ schedule: { startAt: '2026-09-04T09:00:00+08:00', startOn: null, estimateMinutes: null } })

  assert.deepEqual(projectCalendarItems(state, dayRange), [{
    key: 'task:task:1', taskId: 'task:1', occurrenceId: null,
    kind: 'timed', start: '2026-09-04T09:00:00+08:00', end: '2026-09-04T01:45:00.000Z',
  }])
  assert.deepEqual(projectCalendarItems(startOnly, dayRange), [])
})

test('deadline-only task is a marker rather than a timed block', () => {
  const state = fixture({ deadline: { dueAt: '2026-09-04T16:00:00+08:00', dueOn: null } })

  assert.deepEqual(projectCalendarItems(state, dayRange), [{
    key: 'deadline:task:1', taskId: 'task:1', occurrenceId: null,
    kind: 'deadline-marker', start: '2026-09-04T16:00:00+08:00', end: null,
  }])
})

test('uses occurrence overrides for date, time, and duration without mutating state', () => {
  const state = fixture({
    schedule: { startAt: '2026-09-04T09:00:00+08:00', startOn: null, estimateMinutes: 30 },
    recurrenceSeriesId: 'series:1',
    occurrences: [occurrence({
      override: { scheduledAt: '2026-09-04T11:00:00+08:00', scheduledOn: null, estimateMinutes: 75 },
    })],
  })
  const before = structuredClone(state)

  assert.deepEqual(projectCalendarItems(state, dayRange), [{
    key: 'occurrence:occ:1', taskId: 'task:1', occurrenceId: 'occ:1',
    kind: 'timed', start: '2026-09-04T11:00:00+08:00', end: '2026-09-04T04:15:00.000Z',
  }])
  assert.deepEqual(state, before)
})

test('an occurrence override can change a date-only occurrence into a timed block', () => {
  const state = fixture({
    schedule: { startAt: null, startOn: '2026-09-04', estimateMinutes: 30 },
    recurrenceSeriesId: 'series:1',
    occurrences: [occurrence({
      scheduledAt: null,
      scheduledOn: '2026-09-04',
      override: { scheduledAt: '2026-09-04T11:00:00+08:00', scheduledOn: null, estimateMinutes: 75 },
    })],
  })

  assert.deepEqual(projectCalendarItems(state, dayRange), [{
    key: 'occurrence:occ:1', taskId: 'task:1', occurrenceId: 'occ:1',
    kind: 'timed', start: '2026-09-04T11:00:00+08:00', end: '2026-09-04T04:15:00.000Z',
  }])
})

test('an occurrence override can change a timed occurrence into an all-day item', () => {
  const state = fixture({
    schedule: { startAt: '2026-09-04T09:00:00+08:00', startOn: null, estimateMinutes: 30 },
    recurrenceSeriesId: 'series:1',
    occurrences: [occurrence({
      override: { scheduledAt: null, scheduledOn: '2026-09-04', estimateMinutes: null },
    })],
  })

  assert.deepEqual(projectCalendarItems(state, dayRange), [{
    key: 'occurrence:occ:1', taskId: 'task:1', occurrenceId: 'occ:1',
    kind: 'all-day', start: '2026-09-04', end: null,
  }])
})

test('sorts timed items by their instant, duration, then stable key across ISO offsets', () => {
  const state = fixture()
  state.tasks = [
    { ...state.tasks[0]!, id: 'task:late', schedule: { startAt: '2026-09-04T09:30:00+08:00', startOn: null, estimateMinutes: 30 } },
    { ...state.tasks[0]!, id: 'task:early-short', schedule: { startAt: '2026-09-04T01:00:00Z', startOn: null, estimateMinutes: 30 } },
    { ...state.tasks[0]!, id: 'task:early-long-z', schedule: { startAt: '2026-09-04T09:00:00+08:00', startOn: null, estimateMinutes: 60 } },
    { ...state.tasks[0]!, id: 'task:early-long-a', schedule: { startAt: '2026-09-04T01:00:00Z', startOn: null, estimateMinutes: 60 } },
  ]

  assert.deepEqual(projectCalendarItems(state, dayRange).map(({ key }) => key), [
    'task:task:early-long-a',
    'task:task:early-long-z',
    'task:task:early-short',
    'task:task:late',
  ])
})

test('uses the recurrence timezone at DST boundaries instead of the process timezone', () => {
  const state = fixture({
    schedule: { startAt: null, startOn: null, estimateMinutes: 30 },
    recurrenceSeriesId: 'series:1',
    seriesTimezone: 'America/New_York',
    occurrences: [occurrence({ scheduledAt: '2026-03-08T04:30:00.000Z' })],
  })

  assert.deepEqual(projectCalendarItems(state, { start: '2026-03-07', end: '2026-03-08' }), [{
    key: 'occurrence:occ:1', taskId: 'task:1', occurrenceId: 'occ:1',
    kind: 'timed', start: '2026-03-08T04:30:00.000Z', end: '2026-03-08T05:00:00.000Z',
  }])
  assert.deepEqual(projectCalendarItems(state, { start: '2026-03-08', end: '2026-03-09' }), [])
})

function fixture(input: {
  schedule?: Task['schedule']
  deadline?: Task['deadline']
  recurrenceSeriesId?: string | null
  occurrences?: TaskOccurrence[]
  seriesTimezone?: string
} = {}): WorkspaceStateV3 {
  const task = createTask(input)
  return {
    version: 3, revision: 1, listGroups: [], lists: [], sections: [], tags: [], tasks: [task],
    recurrenceSeries: input.recurrenceSeriesId ? [{
      id: input.recurrenceSeriesId, taskId: task.id, revision: 1,
      cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
      anchorAt: '2026-09-04T09:00:00+08:00', anchorOn: null, end: { kind: 'never' },
      timezone: input.seriesTimezone ?? 'Asia/Shanghai', createdThrough: null, createdCount: 0,
    }] : [],
    occurrences: input.occurrences ?? [], reminderRules: [], reminderDeliveries: [],
    studySessions: [], taskEvents: [], completionRecords: [], reviewTaskLinks: [], commandReceipts: [],
    updatedAt: '2026-09-04T00:00:00+08:00',
  }
}

function createTask(input: Parameters<typeof fixture>[0]): Task {
  return {
    id: 'task:1', revision: 1, mode: 'general', listId: 'list:1', sectionId: null, tagIds: [],
    title: 'Calendar task', notes: '', status: 'planned',
    schedule: input?.schedule ?? { startAt: null, startOn: null, estimateMinutes: null },
    deadline: input?.deadline ?? { dueAt: null, dueOn: null }, priority: 'none', checklist: [], learning: null,
    recurrenceSeriesId: input?.recurrenceSeriesId ?? null,
    createdAt: '2026-09-01T00:00:00+08:00', updatedAt: '2026-09-01T00:00:00+08:00', deletedAt: null,
  }
}

function occurrence(overrides: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return {
    id: 'occ:1', seriesId: 'series:1', ordinal: 1, scheduledAt: '2026-09-04T09:00:00+08:00', scheduledOn: null,
    status: 'pending', override: null, completedAt: null, revision: 1, ...overrides,
  }
}
