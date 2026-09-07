import assert from 'node:assert/strict'
import test from 'node:test'
import { selectLearningRhythms } from '../src/domain/views/learning-rhythm.ts'
import type {
  CompletionRecord,
  RecurrenceSeries,
  Task,
  TaskEvent,
  TaskOccurrence,
  WorkspaceStateV3,
} from '../src/domain/workspace/types.ts'

const AT = '2026-09-09T12:00:00.000Z'

function workspace(): WorkspaceStateV3 {
  return {
    version: 3,
    revision: 1,
    listGroups: [],
    lists: [],
    sections: [],
    tags: [],
    tasks: [],
    recurrenceSeries: [],
    occurrences: [],
    reminderRules: [],
    reminderDeliveries: [],
    studySessions: [],
    taskEvents: [],
    completionRecords: [],
    reviewTaskLinks: [],
    commandReceipts: [],
    updatedAt: AT,
  }
}

function learningTask(id = 'task:english'): Task {
  return {
    id,
    revision: 1,
    mode: 'learning',
    listId: 'topic:english',
    sectionId: null,
    tagIds: [],
    title: '英语跟读',
    notes: '',
    status: 'planned',
    schedule: { startAt: null, startOn: null, estimateMinutes: 15 },
    deadline: { dueAt: null, dueOn: null },
    priority: 'none',
    checklist: [],
    learning: { acceptanceCriteria: ['留下一段录音'], blockedReason: null },
    recurrenceSeriesId: 'series:english',
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
  }
}

function weeklySeries(overrides: Partial<RecurrenceSeries> = {}): RecurrenceSeries {
  return {
    id: 'series:english',
    taskId: 'task:english',
    revision: 1,
    cadence: { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] },
    basis: 'fixed_schedule',
    anchorAt: null,
    anchorOn: '2026-09-07',
    end: { kind: 'never' },
    timezone: 'Asia/Shanghai',
    createdThrough: '2026-12-01',
    createdCount: 3,
    ...overrides,
  }
}

function occurrence(
  id: string,
  ordinal: number,
  scheduledOn: string,
  status: TaskOccurrence['status'],
  overrides: Partial<TaskOccurrence> = {},
): TaskOccurrence {
  return {
    id,
    seriesId: 'series:english',
    ordinal,
    scheduledAt: null,
    scheduledOn,
    status,
    override: null,
    completedAt: status === 'completed' ? `${scheduledOn}T10:00:00.000Z` : null,
    revision: 1,
    ...overrides,
  }
}

function record(id: string, completedAt: string, deletedAt: string | null = null): CompletionRecord {
  return {
    id,
    taskId: 'task:english',
    topicId: 'topic:english',
    sessionIds: [],
    tagIdsSnapshot: [],
    taskTitleSnapshot: '英语跟读',
    learned: `收获 ${id}`,
    evidence: `证据 ${id}`,
    blocker: '',
    nextAction: '继续',
    mastery: 3,
    completedAt,
    reviewStage: 0,
    nextReviewOn: null,
    lastReviewResult: null,
    lastReviewedAt: null,
    createdAt: completedAt,
    updatedAt: completedAt,
    deletedAt,
  }
}

function completionEvent(id: string, occurrenceId: string, completionRecordId: string): TaskEvent {
  return {
    id,
    sequence: Number(id.slice(-1)),
    taskId: 'task:english',
    occurrenceId,
    type: 'completed',
    occurredAt: AT,
    fromStatus: null,
    toStatus: null,
    reason: null,
    completionRecordId,
  }
}

test('weekly rhythm counts only evidence-backed occurrence completion', () => {
  const state = workspace()
  state.tasks.push(learningTask())
  state.recurrenceSeries.push(weeklySeries())
  state.occurrences.push(
    occurrence('occurrence:monday', 1, '2026-09-07', 'completed'),
    occurrence('occurrence:wednesday', 2, '2026-09-09', 'completed'),
    occurrence('occurrence:friday', 3, '2026-09-11', 'pending'),
  )
  state.completionRecords.push(record('record:1', '2026-09-07T02:00:00.000Z'))
  state.taskEvents.push(completionEvent('event:1', 'occurrence:monday', 'record:1'))

  const result = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 })

  assert.deepEqual(result.totals, {
    planned: 3,
    completedWithEvidence: 1,
    completedMissingEvidence: 1,
    skipped: 0,
    cancelled: 0,
  })
  assert.equal(result.items.length, 1)
  assert.deepEqual(result.items[0], {
    seriesId: 'series:english',
    taskId: 'task:english',
    listId: 'topic:english',
    cadence: { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] },
    basis: 'fixed_schedule',
    timezone: 'Asia/Shanghai',
    rangeStart: '2026-09-07',
    rangeEnd: '2026-09-14',
    plannedCount: 3,
    completedWithEvidenceCount: 1,
    completedMissingEvidenceCount: 1,
    skippedCount: 0,
    cancelledCount: 0,
    streakCount: 0,
    nextOccurrenceId: 'occurrence:friday',
    nextScheduled: '2026-09-11',
    nextState: 'upcoming',
    recentRecordId: 'record:1',
    recentLearned: '收获 record:1',
  })
})

test('today pending does not break a previous evidence streak, but an earlier skip does', () => {
  const state = workspace()
  state.tasks.push(learningTask())
  state.recurrenceSeries.push(weeklySeries({ cadence: { kind: 'daily', interval: 1 } }))
  state.occurrences.push(
    occurrence('occurrence:old', 1, '2026-09-06', 'skipped'),
    occurrence('occurrence:monday', 2, '2026-09-07', 'completed'),
    occurrence('occurrence:tuesday', 3, '2026-09-08', 'completed'),
    occurrence('occurrence:today', 4, '2026-09-09', 'pending'),
  )
  state.completionRecords.push(
    record('record:1', '2026-09-07T02:00:00.000Z'),
    record('record:2', '2026-09-08T02:00:00.000Z'),
  )
  state.taskEvents.push(
    completionEvent('event:1', 'occurrence:monday', 'record:1'),
    completionEvent('event:2', 'occurrence:tuesday', 'record:2'),
  )

  const [item] = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 }).items
  assert.equal(item?.streakCount, 2)
  assert.equal(item?.nextState, 'today')
})

for (const terminal of ['skipped', 'cancelled'] as const) {
  test(`today ${terminal} ends the evidence streak immediately`, () => {
    const state = workspace()
    state.tasks.push(learningTask())
    state.recurrenceSeries.push(weeklySeries({ cadence: { kind: 'daily', interval: 1 } }))
    state.occurrences.push(
      occurrence('occurrence:yesterday', 1, '2026-09-08', 'completed'),
      occurrence('occurrence:today', 2, '2026-09-09', terminal),
    )
    state.completionRecords.push(record('record:1', '2026-09-08T02:00:00.000Z'))
    state.taskEvents.push(completionEvent('event:1', 'occurrence:yesterday', 'record:1'))

    const [item] = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 }).items
    assert.equal(item?.streakCount, 0)
  })
}

test('overrides and recurrence timezone own week placement across an instant boundary', () => {
  const state = workspace()
  state.tasks.push(learningTask())
  state.recurrenceSeries.push(weeklySeries({ timezone: 'America/Los_Angeles' }))
  state.occurrences.push(occurrence('occurrence:late', 1, '2026-09-07', 'pending', {
    override: { scheduledOn: null, scheduledAt: '2026-09-14T06:30:00.000Z', estimateMinutes: 15 },
  }))

  const [item] = selectLearningRhythms(state, {
    asOf: '2026-09-14T06:45:00.000Z',
    weekStartsOn: 1,
  }).items

  assert.equal(item?.rangeStart, '2026-09-07')
  assert.equal(item?.rangeEnd, '2026-09-14')
  assert.equal(item?.plannedCount, 1)
  assert.equal(item?.nextScheduled, '2026-09-14T06:30:00.000Z')
  assert.equal(item?.nextState, 'today')
})

test('an estimate-only occurrence override keeps the generated schedule', () => {
  const state = workspace()
  state.tasks.push(learningTask())
  state.recurrenceSeries.push(weeklySeries())
  state.occurrences.push(occurrence('occurrence:estimate', 1, '2026-09-08', 'pending', {
    override: { scheduledOn: null, scheduledAt: null, estimateMinutes: 25 },
  }))

  const [item] = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 }).items
  assert.equal(item?.plannedCount, 1)
  assert.equal(item?.nextScheduled, '2026-09-08')
  assert.equal(item?.nextState, 'overdue')
})

test('a future rule split stays one rhythm and keeps completed evidence from the closed predecessor', () => {
  const state = workspace()
  state.tasks.push({ ...learningTask(), recurrenceSeriesId: 'series:new' })
  state.recurrenceSeries.push(
    weeklySeries({ id: 'series:old', end: { kind: 'on', date: '2026-09-08' } }),
    weeklySeries({ id: 'series:new', anchorOn: '2026-09-09', cadence: { kind: 'daily', interval: 1 } }),
  )
  state.occurrences.push(
    occurrence('occurrence:old-complete', 1, '2026-09-08', 'completed', { seriesId: 'series:old' }),
    occurrence('occurrence:old-cancelled', 2, '2026-09-09', 'cancelled', { seriesId: 'series:old' }),
    occurrence('occurrence:new-today', 1, '2026-09-09', 'pending', { seriesId: 'series:new' }),
  )
  state.completionRecords.push(record('record:1', '2026-09-08T02:00:00.000Z'))
  state.taskEvents.push(completionEvent('event:1', 'occurrence:old-complete', 'record:1'))

  const result = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 })
  assert.equal(result.items.length, 1)
  assert.deepEqual(result.items[0]?.cadence, { kind: 'daily', interval: 1 })
  assert.equal(result.items[0]?.plannedCount, 2)
  assert.equal(result.items[0]?.completedWithEvidenceCount, 1)
  assert.equal(result.items[0]?.cancelledCount, 0)
  assert.equal(result.items[0]?.streakCount, 1)
  assert.equal(result.items[0]?.nextOccurrenceId, 'occurrence:new-today')
})

test('an occurrence override beyond the current series end remains actionable', () => {
  const state = workspace()
  state.tasks.push(learningTask())
  state.recurrenceSeries.push(weeklySeries({ end: { kind: 'on', date: '2026-09-08' } }))
  state.occurrences.push(occurrence('occurrence:moved', 1, '2026-09-08', 'pending', {
    override: { scheduledOn: '2026-09-10', scheduledAt: null, estimateMinutes: null },
  }))

  const [item] = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 }).items
  assert.equal(item?.plannedCount, 1)
  assert.equal(item?.nextOccurrenceId, 'occurrence:moved')
  assert.equal(item?.nextScheduled, '2026-09-10')
  assert.equal(item?.nextState, 'upcoming')
})

test('deleted evidence stops counting while inactive and general recurring tasks stay absent', () => {
  const state = workspace()
  state.tasks.push(
    learningTask(),
    { ...learningTask('task:deleted'), recurrenceSeriesId: 'series:deleted', deletedAt: AT },
    { ...learningTask('task:general'), recurrenceSeriesId: 'series:general', mode: 'general', learning: null },
  )
  state.recurrenceSeries.push(
    weeklySeries(),
    weeklySeries({ id: 'series:deleted', taskId: 'task:deleted' }),
    weeklySeries({ id: 'series:general', taskId: 'task:general' }),
  )
  state.occurrences.push(occurrence('occurrence:one', 1, '2026-09-08', 'completed'))
  state.completionRecords.push(record('record:1', '2026-09-08T02:00:00.000Z', AT))
  state.taskEvents.push(completionEvent('event:1', 'occurrence:one', 'record:1'))

  const result = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 })
  assert.deepEqual(result.items.map(({ seriesId }) => seriesId), ['series:english'])
  assert.equal(result.items[0]?.completedWithEvidenceCount, 0)
  assert.equal(result.items[0]?.completedMissingEvidenceCount, 1)
})

test('ambiguous occurrence-to-record evidence links fail loud instead of inflating progress', () => {
  const state = workspace()
  state.tasks.push(learningTask())
  state.recurrenceSeries.push(weeklySeries())
  state.occurrences.push(
    occurrence('occurrence:one', 1, '2026-09-08', 'completed'),
    occurrence('occurrence:two', 2, '2026-09-09', 'completed'),
  )
  state.completionRecords.push(
    record('record:1', '2026-09-08T02:00:00.000Z'),
    record('record:2', '2026-09-09T02:00:00.000Z'),
  )
  state.taskEvents.push(
    completionEvent('event:1', 'occurrence:one', 'record:1'),
    completionEvent('event:2', 'occurrence:one', 'record:2'),
  )
  assert.throws(
    () => selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 }),
    /Ambiguous completion evidence for occurrence/,
  )

  state.taskEvents = [
    completionEvent('event:1', 'occurrence:one', 'record:1'),
    completionEvent('event:2', 'occurrence:two', 'record:1'),
  ]
  assert.throws(
    () => selectLearningRhythms(state, { asOf: AT, weekStartsOn: 1 }),
    /linked to multiple occurrences/,
  )
})

test('selection is deterministic and never mutates source workspace order', () => {
  const state = workspace()
  state.tasks.push(learningTask('task:z'), learningTask('task:a'))
  state.tasks[0]!.recurrenceSeriesId = 'series:z'
  state.tasks[1]!.recurrenceSeriesId = 'series:a'
  state.recurrenceSeries.push(
    weeklySeries({ id: 'series:z', taskId: 'task:z', basis: 'after_completion' }),
    weeklySeries({ id: 'series:a', taskId: 'task:a', basis: 'after_completion' }),
  )
  const before = structuredClone(state)

  const first = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 0 })
  const second = selectLearningRhythms(state, { asOf: AT, weekStartsOn: 0 })

  assert.deepEqual(first, second)
  assert.deepEqual(first.items.map(({ seriesId }) => seriesId), ['series:a', 'series:z'])
  assert.deepEqual(state, before)
  assert.throws(() => selectLearningRhythms(state, { asOf: 'invalid', weekStartsOn: 1 }), /Invalid datetime/)
  assert.throws(() => selectLearningRhythms(state, { asOf: AT, weekStartsOn: 2 as 0 }), /Invalid week start/)
})
