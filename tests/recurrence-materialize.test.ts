import test from 'node:test'
import assert from 'node:assert/strict'
import { materializeOccurrenceWindow } from '../src/domain/recurrence/materialize.ts'
import type { WorkspaceStateV3 } from '../src/domain/workspace/types.ts'

function state(): WorkspaceStateV3 {
  return {
    version: 3,
    revision: 1,
    listGroups: [],
    lists: [],
    sections: [],
    tags: [],
    tasks: [{
      id: 'task-1',
      revision: 1,
      mode: 'general',
      listId: 'list-1',
      sectionId: null,
      tagIds: [],
      title: 'Task',
      notes: '',
      status: 'planned',
      schedule: { startAt: null, startOn: null, estimateMinutes: null },
      deadline: { dueAt: null, dueOn: null },
      priority: 'none',
      checklist: [],
      learning: null,
      recurrenceSeriesId: 'series-1',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      deletedAt: null,
    }],
    recurrenceSeries: [{
      id: 'series-1',
      taskId: 'task-1',
      revision: 7,
      cadence: { kind: 'daily', interval: 1 },
      basis: 'fixed_schedule',
      anchorAt: '2026-09-04T09:00:00-04:00',
      end: { kind: 'never' },
      timezone: 'America/New_York',
      createdThrough: null,
      createdCount: 0,
    }],
    occurrences: [{
      id: 'occurrence:series-1:1',
      seriesId: 'series-1',
      ordinal: 1,
      scheduledAt: '2026-09-04T13:00:00.000Z',
      status: 'completed',
      override: null,
      completedAt: '2026-09-04T14:00:00.000Z',
      revision: 7,
    }],
    reminderRules: [],
    reminderDeliveries: [],
    studySessions: [],
    taskEvents: [],
    completionRecords: [],
    reviewTaskLinks: [],
    commandReceipts: [],
    updatedAt: '2026-09-04T00:00:00Z',
  }
}

test('materialization creates deterministic ids and preserves history', () => {
  const first = materializeOccurrenceWindow(state(), 'series-1', '2026-09-04T12:00:00Z')
  assert.equal(first.created[0]?.id, 'occurrence:series-1:2')
  assert.equal(first.created[0]?.scheduledAt, '2026-09-05T13:00:00.000Z')
  assert.equal(first.pendingCount, 50)
  assert.equal(first.state.occurrences[0]?.status, 'completed')

  const second = materializeOccurrenceWindow(first.state, 'series-1', '2026-09-04T12:00:00Z')
  assert.equal(second.created.length, 0)
  assert.equal(second.pendingCount, 50)
})

test('materialization caps pending occurrences at fifty and within the 90-day window', () => {
  const base = state()
  base.occurrences = []
  const result = materializeOccurrenceWindow(base, 'series-1', '2026-09-01T00:00:00Z')
  assert.equal(result.created.length, 50)
  assert.equal(result.created.at(-1)?.ordinal, 50)
  assert.ok(new Date(result.created.at(-1)!.scheduledAt).getTime() <= new Date('2026-11-30T00:00:00Z').getTime())
})

test('materialization uses now local date for the ninety-calendar-day horizon', () => {
  const base = state()
  base.occurrences = []
  base.recurrenceSeries[0]!.cadence = { kind: 'weekly', interval: 1, weekdays: [5] }
  base.recurrenceSeries[0]!.anchorAt = '2026-09-04T09:00:00-04:00'
  const result = materializeOccurrenceWindow(base, 'series-1', '2026-09-04T12:00:00Z')
  assert.equal(result.created.length, 13)
  assert.equal(result.created.at(-1)?.scheduledAt, '2026-11-27T14:00:00.000Z')
})

test('after-completion creates only the first item, then one item after completion', () => {
  const base = state()
  base.recurrenceSeries[0]!.basis = 'after_completion'
  base.occurrences = []
  const first = materializeOccurrenceWindow(base, 'series-1', '2026-09-01T00:00:00Z')
  assert.deepEqual(first.created.map((item) => item.ordinal), [1])
  const waiting = materializeOccurrenceWindow(first.state, 'series-1', '2026-09-01T00:00:00Z')
  assert.equal(waiting.created.length, 0)
  const completedState = { ...first.state, occurrences: first.state.occurrences.map((item) => ({ ...item, status: 'completed' as const, completedAt: '2026-09-05T14:00:00.000Z' })) }
  const next = materializeOccurrenceWindow(completedState, 'series-1', '2026-09-05T15:00:00.000Z')
  assert.deepEqual(next.created.map((item) => item.ordinal), [2])
  const idem = materializeOccurrenceWindow(next.state, 'series-1', '2026-09-05T15:00:00.000Z')
  assert.equal(idem.created.length, 0)
})

test('after-completion respects end-on and the fifty pending cap', () => {
  const base = state()
  base.recurrenceSeries[0]!.basis = 'after_completion'
  base.recurrenceSeries[0]!.end = { kind: 'on', date: '2026-09-05' }
  base.occurrences = [{
    id: 'occurrence:series-1:1', seriesId: 'series-1', ordinal: 1,
    scheduledAt: '2026-09-04T13:00:00.000Z', status: 'completed', override: null,
    completedAt: '2026-09-05T14:00:00.000Z', revision: 7,
  }]
  const end = materializeOccurrenceWindow(base, 'series-1', '2026-09-05T15:00:00.000Z')
  assert.equal(end.created.length, 0)

  base.occurrences = Array.from({ length: 50 }, (_, index) => ({
    id: `occurrence:series-1:${index + 1}`, seriesId: 'series-1', ordinal: index + 1,
    scheduledAt: '2026-09-04T13:00:00.000Z', status: 'pending' as const, override: null,
    completedAt: null, revision: 7,
  }))
  base.occurrences.push({
    id: 'occurrence:series-1:51', seriesId: 'series-1', ordinal: 51,
    scheduledAt: '2026-09-04T13:00:00.000Z', status: 'completed', override: null,
    completedAt: '2026-09-05T14:00:00.000Z', revision: 7,
  })
  const capped = materializeOccurrenceWindow(base, 'series-1', '2026-09-05T15:00:00.000Z')
  assert.equal(capped.created.length, 0)
  assert.equal(capped.pendingCount, 50)
})
