import assert from 'node:assert/strict'
import test from 'node:test'
import { selectWeeklyLearningSummary } from '../src/domain/views/weekly-learning-summary.ts'
import type { CompletionRecord, RecurrenceSeries, StudySession, Task, TaskEvent, TaskList, TaskOccurrence, WorkspaceStateV3 } from '../src/domain/workspace/types.ts'

const AT = '2026-09-16T12:00:00.000Z'

function state(): WorkspaceStateV3 {
  return {
    version: 3,
    revision: 1,
    listGroups: [],
    lists: [list('topic:a', 'Agent 系统', 0), list('topic:archived', '旧主题', 1, AT)],
    sections: [], tags: [], tasks: [], recurrenceSeries: [], occurrences: [], reminderRules: [], reminderDeliveries: [],
    studySessions: [], taskEvents: [], completionRecords: [], reviewTaskLinks: [], commandReceipts: [], updatedAt: AT,
  }
}

function list(id: string, title: string, position: number, archivedAt: string | null = null): TaskList {
  return { id, groupId: null, title, position, goal: '', successCriteria: [], weeklyTargetMinutes: null, createdAt: AT, updatedAt: AT, archivedAt }
}

function record(id: string, completedAt: string, overrides: Partial<CompletionRecord> = {}): CompletionRecord {
  return {
    id, taskId: `task:${id}`, topicId: 'topic:a', sessionIds: [], tagIdsSnapshot: [], taskTitleSnapshot: id,
    learned: `learned ${id}`, evidence: `evidence ${id}`, blocker: '', nextAction: 'next', mastery: 3,
    completedAt, reviewStage: 0, nextReviewOn: null, lastReviewResult: null, lastReviewedAt: null,
    createdAt: completedAt, updatedAt: completedAt, deletedAt: null, ...overrides,
  }
}

function session(id: string, taskId: string, elapsedSeconds: number, deletedAt: string | null = null): StudySession {
  return { id, taskId, state: 'finished', startedAt: AT, activeSince: null, elapsedSeconds, scratchpad: '', createdAt: AT, updatedAt: AT, deletedAt }
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, revision: 1, mode: 'learning', listId: 'topic:a', sectionId: null, tagIds: [], title: id, notes: '',
    status: 'planned', schedule: { startAt: null, startOn: '2026-09-14', estimateMinutes: 30 },
    deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [],
    learning: { acceptanceCriteria: [], blockedReason: null }, recurrenceSeriesId: null,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: AT, deletedAt: null, ...overrides,
  }
}

function series(id: string, taskId: string, overrides: Partial<RecurrenceSeries> = {}): RecurrenceSeries {
  return {
    id, taskId, revision: 1, cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
    anchorAt: null, anchorOn: '2026-09-14', end: { kind: 'never' }, timezone: 'UTC',
    createdThrough: '2026-09-20', createdCount: 7, ...overrides,
  }
}

function occurrence(id: string, seriesId: string, scheduledOn: string, overrides: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return {
    id, seriesId, ordinal: 1, scheduledAt: null, scheduledOn, status: 'pending', override: null,
    completedAt: null, revision: 1, ...overrides,
  }
}

function event(id: string, taskId: string, type: TaskEvent['type'], occurredAt: string, overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id, sequence: 1, taskId, type, occurredAt, fromStatus: 'planned',
    toStatus: type === 'completed' ? 'completed' : type === 'cancelled' ? 'cancelled' : 'planned',
    reason: null, completionRecordId: null, ...overrides,
  }
}

function plans(result: ReturnType<typeof selectWeeklyLearningSummary>, topicId: string) {
  const topic = result.topics.find((item) => item.topicId === topicId)
  assert.ok(topic, `missing weekly topic ${topicId}`)
  return (topic as typeof topic & { currentPlans: unknown }).currentPlans as any
}

function zeroCurrentPlans() {
  return {
    planned: { value: 0, facts: [] }, completed: { value: 0, facts: [] }, cancelled: { value: 0, facts: [] },
    skipped: { value: 0, facts: [] }, estimatedMinutes: { value: 0, facts: [] }, unestimatedCount: 0,
  }
}

test('uses the injected timezone and Sunday boundary for evidence-backed weekly metrics', () => {
  const workspace = state()
  workspace.completionRecords.push(
    record('record:early', '2026-09-13T08:00:00.000Z', { sessionIds: ['session:shared', 'session:shared'] }),
    record('record:late', '2026-09-14T06:30:00.000Z', { sessionIds: ['session:zero', 'session:deleted'] }),
    record('record:outside', '2026-09-13T06:59:59.000Z'),
    record('record:deleted', '2026-09-14T05:00:00.000Z', { deletedAt: AT }),
  )
  workspace.studySessions.push(
    session('session:shared', 'task:record:early', 125),
    session('session:zero', 'task:record:late', 0),
    session('session:deleted', 'task:record:late', 600, AT),
  )
  workspace.reviewTaskLinks.push(
    { id: 'review:done', completionRecordId: 'record:early', reviewTaskId: 'review-task:1', occurrenceId: null, reviewStage: 0, dueOn: '2026-09-13', completedAt: '2026-09-14T05:00:00.000Z', completion: { result: 'clear', reviewedOn: '2026-09-13' }, createdAt: AT, updatedAt: AT },
    { id: 'review:pending', completionRecordId: 'record:late', reviewTaskId: 'review-task:2', occurrenceId: null, reviewStage: 0, dueOn: '2026-09-13', completedAt: null, completion: null, createdAt: AT, updatedAt: AT },
    { id: 'review:deleted-source', completionRecordId: 'record:deleted', reviewTaskId: 'review-task:3', occurrenceId: null, reviewStage: 0, dueOn: '2026-09-13', completedAt: '2026-09-14T05:00:00.000Z', completion: { result: 'clear', reviewedOn: '2026-09-13' }, createdAt: AT, updatedAt: AT },
  )

  const result = selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'America/Los_Angeles', weekStartsOn: 0 })

  assert.equal(result.rangeStart, '2026-09-13')
  assert.equal(result.rangeEnd, '2026-09-20')
  assert.deepEqual(result.totals, {
    evidenceCompletions: { value: 2, recordIds: ['record:early', 'record:late'] },
    evidenceMinutes: { value: 2, recordIds: ['record:early'] },
    completedReviews: { value: 1, recordIds: ['record:early'] },
  })
  assert.deepEqual(result.topics[0], {
    topicId: 'topic:a', topicTitle: 'Agent 系统',
    evidenceCompletions: { value: 2, recordIds: ['record:early', 'record:late'] },
    evidenceMinutes: { value: 2, recordIds: ['record:early'] },
    completedReviews: { value: 1, recordIds: ['record:early'] },
    completedReviewFacts: [{ id: 'review:done', recordId: 'record:early', completedAt: '2026-09-14T05:00:00.000Z', reviewedOn: '2026-09-13', result: 'clear' }],
    currentPlans: zeroCurrentPlans(),
  })
})

test('keeps archived topic history and groups missing snapshots under one stable fallback', () => {
  const workspace = state()
  workspace.completionRecords.push(
    record('record:archived', '2026-09-14T08:00:00.000Z', { topicId: 'topic:archived' }),
    record('record:missing', '2026-09-14T09:00:00.000Z', { topicId: 'topic:missing' }),
    record('record:none', '2026-09-14T10:00:00.000Z', { topicId: null }),
  )

  const result = selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 })

  assert.deepEqual(result.topics.map(({ topicId, topicTitle, evidenceCompletions }) => ({ topicId, topicTitle, ids: evidenceCompletions.recordIds })), [
    { topicId: 'topic:archived', topicTitle: '旧主题', ids: ['record:archived'] },
    { topicId: null, topicTitle: '未归类', ids: ['record:missing', 'record:none'] },
  ])
})

test('counts every completed review but exposes unique source records for drilldown', () => {
  const workspace = state()
  workspace.completionRecords.push(record('record:source', '2026-09-01T08:00:00.000Z'))
  workspace.reviewTaskLinks.push(
    { id: 'review:1', completionRecordId: 'record:source', reviewTaskId: 'review-task:1', occurrenceId: null, reviewStage: 0, dueOn: '2026-09-14', completedAt: '2026-09-14T08:00:00.000Z', completion: { result: 'clear', reviewedOn: '2026-09-14' }, createdAt: AT, updatedAt: AT },
    { id: 'review:2', completionRecordId: 'record:source', reviewTaskId: 'review-task:2', occurrenceId: null, reviewStage: 1, dueOn: '2026-09-15', completedAt: '2026-09-15T08:00:00.000Z', completion: { result: 'fuzzy', reviewedOn: '2026-09-15' }, createdAt: AT, updatedAt: AT },
  )

  const result = selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 })
  assert.deepEqual(result.totals.completedReviews, { value: 2, recordIds: ['record:source'] })
  assert.deepEqual(result.topics[0]?.completedReviews, result.totals.completedReviews)
  assert.deepEqual(result.topics[0]?.completedReviewFacts, [
    { id: 'review:1', recordId: 'record:source', completedAt: '2026-09-14T08:00:00.000Z', reviewedOn: '2026-09-14', result: 'clear' },
    { id: 'review:2', recordId: 'record:source', completedAt: '2026-09-15T08:00:00.000Z', reviewedOn: '2026-09-15', result: 'fuzzy' },
  ])
  assert.equal(result.totals.evidenceCompletions.value, 0)
})

test('rounds total seconds once and allocates whole minutes by deterministic largest remainder', () => {
  const workspace = state()
  workspace.lists.push(list('topic:b', '数据库', 2))
  workspace.completionRecords.push(
    record('record:a', '2026-09-14T08:00:00.000Z', { sessionIds: ['session:a'] }),
    record('record:b', '2026-09-14T09:00:00.000Z', { topicId: 'topic:b', sessionIds: ['session:b'] }),
  )
  workspace.studySessions.push(
    session('session:a', 'task:record:a', 30),
    session('session:b', 'task:record:b', 30),
  )

  const result = selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 })
  assert.equal(result.totals.evidenceMinutes.value, 1)
  assert.equal(result.totals.evidenceMinutes.value, result.topics.reduce((sum, topic) => sum + topic.evidenceMinutes.value, 0))
  assert.deepEqual(result.topics.map(({ topicId, evidenceMinutes }) => ({ topicId, ...evidenceMinutes })), [
    { topicId: 'topic:a', value: 1, recordIds: ['record:a'] },
    { topicId: 'topic:b', value: 0, recordIds: ['record:b'] },
  ])
})

test('rejects one live session claimed by multiple live completion records across the workspace', () => {
  const workspace = state()
  workspace.completionRecords.push(
    record('record:inside', '2026-09-14T08:00:00.000Z', { taskId: 'task:shared', sessionIds: ['session:shared'] }),
    record('record:historic', '2026-08-01T08:00:00.000Z', { taskId: 'task:shared', sessionIds: ['session:shared', 'session:shared'] }),
  )
  workspace.studySessions.push(session('session:shared', 'task:shared', 600))

  assert.throws(
    () => selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 }),
    /session:shared.*record:historic.*record:inside|session:shared.*record:inside.*record:historic/,
  )
})

test('deduplicates a session repeated within one record and omits zero-second records from minute drilldown', () => {
  const workspace = state()
  workspace.completionRecords.push(
    record('record:positive', '2026-09-14T08:00:00.000Z', { sessionIds: ['session:positive', 'session:positive'] }),
    record('record:zero', '2026-09-14T09:00:00.000Z', { sessionIds: ['session:zero'] }),
  )
  workspace.studySessions.push(
    session('session:positive', 'task:record:positive', 90),
    session('session:zero', 'task:record:zero', 0),
  )

  const result = selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 })
  assert.deepEqual(result.totals.evidenceMinutes, { value: 2, recordIds: ['record:positive'] })
})

test('excludes completion and review facts later than the injected asOf instant', () => {
  const workspace = state()
  workspace.completionRecords.push(
    record('record:past', '2026-09-14T05:00:00.000Z'),
    record('record:future', '2026-09-14T07:00:00.000Z'),
  )
  workspace.reviewTaskLinks.push(
    { id: 'review:past', completionRecordId: 'record:past', reviewTaskId: 'review-task:past', occurrenceId: null, reviewStage: 0, dueOn: '2026-09-14', completedAt: '2026-09-14T05:30:00.000Z', completion: { result: 'fuzzy', reviewedOn: '2026-09-14' }, createdAt: AT, updatedAt: AT },
    { id: 'review:future', completionRecordId: 'record:past', reviewTaskId: 'review-task:future', occurrenceId: null, reviewStage: 1, dueOn: '2026-09-14', completedAt: '2026-09-14T06:30:00.000Z', completion: { result: 'clear', reviewedOn: '2026-09-14' }, createdAt: AT, updatedAt: AT },
  )

  const result = selectWeeklyLearningSummary(workspace, { asOf: '2026-09-14T06:00:00.000Z', timezone: 'UTC', weekStartsOn: 1 })
  assert.deepEqual(result.totals.evidenceCompletions.recordIds, ['record:past'])
  assert.deepEqual(result.totals.completedReviews, { value: 1, recordIds: ['record:past'] })
  assert.deepEqual(result.topics[0]?.completedReviewFacts, [
    { id: 'review:past', recordId: 'record:past', completedAt: '2026-09-14T05:30:00.000Z', reviewedOn: '2026-09-14', result: 'fuzzy' },
  ])
})

test('fails loud when a completed review cannot explain its result', () => {
  const workspace = state()
  workspace.completionRecords.push(record('record:source', '2026-09-14T05:00:00.000Z'))
  workspace.reviewTaskLinks.push(
    { id: 'review:broken', completionRecordId: 'record:source', reviewTaskId: 'review-task:broken', occurrenceId: null, reviewStage: 0, dueOn: '2026-09-14', completedAt: '2026-09-14T05:30:00.000Z', completion: null, createdAt: AT, updatedAt: AT },
  )

  assert.throws(
    () => selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 }),
    /review:broken.*missing its completion fact/,
  )
})

test('derives current weekly plans from tasks or occurrences once and keeps estimate override intent', () => {
  const workspace = state()
  const recurring = task('task:recurring', {
    title: '重复学习', recurrenceSeriesId: 'series:current',
    schedule: { startAt: null, startOn: '2026-09-14', estimateMinutes: 60 },
  })
  workspace.tasks.push(
    recurring,
    task('task:archived', { title: '归档计划', listId: 'topic:archived', schedule: { startAt: null, startOn: '2026-09-18', estimateMinutes: 40 } }),
    task('task:deleted', { deletedAt: '2026-09-15T00:00:00.000Z' }),
    task('task:review', { title: '系统复习', schedule: { startAt: null, startOn: '2026-09-16', estimateMinutes: 15 } }),
  )
  workspace.recurrenceSeries.push(series('series:current', recurring.id))
  workspace.occurrences.push(
    occurrence('occurrence:one', 'series:current', '2026-09-14'),
    occurrence('occurrence:estimate-only', 'series:current', '2026-09-15', {
      ordinal: 2, override: { scheduledAt: null, scheduledOn: null, estimateMinutes: 25 },
    }),
    occurrence('occurrence:null-estimate', 'series:current', '2026-09-18', {
      ordinal: 3, override: { scheduledAt: null, scheduledOn: '2026-09-17', estimateMinutes: null },
    }),
  )
  workspace.completionRecords.push(record('record:source', '2026-09-01T08:00:00.000Z'))
  workspace.reviewTaskLinks.push({
    id: 'review:helper', completionRecordId: 'record:source', reviewTaskId: 'task:review', occurrenceId: null,
    reviewStage: 0, dueOn: '2026-09-16', completedAt: null, completion: null, createdAt: AT, updatedAt: AT,
  })
  const before = structuredClone(workspace)

  const result = selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 })
  const topic = plans(result, 'topic:a')
  assert.deepEqual(topic.planned, {
    value: 3,
    facts: [
      { id: 'occurrence:occurrence:one', taskId: 'task:recurring', occurrenceId: 'occurrence:one', title: '重复学习', scheduledAt: null, scheduledOn: '2026-09-14', scheduledDate: '2026-09-14', scheduledTime: null, estimateMinutes: 60, status: 'pending', outcomeEventId: null },
      { id: 'occurrence:occurrence:estimate-only', taskId: 'task:recurring', occurrenceId: 'occurrence:estimate-only', title: '重复学习', scheduledAt: null, scheduledOn: '2026-09-15', scheduledDate: '2026-09-15', scheduledTime: null, estimateMinutes: 25, status: 'pending', outcomeEventId: null },
      { id: 'occurrence:occurrence:null-estimate', taskId: 'task:recurring', occurrenceId: 'occurrence:null-estimate', title: '重复学习', scheduledAt: null, scheduledOn: '2026-09-17', scheduledDate: '2026-09-17', scheduledTime: null, estimateMinutes: null, status: 'pending', outcomeEventId: null },
    ],
  })
  assert.deepEqual(topic.estimatedMinutes, { value: 85, facts: topic.planned.facts.slice(0, 2) })
  assert.equal(topic.unestimatedCount, 1)
  assert.deepEqual(topic.completed, { value: 0, facts: [] })
  assert.deepEqual(topic.cancelled, { value: 0, facts: [] })
  assert.deepEqual(topic.skipped, { value: 0, facts: [] })

  const archived = plans(result, 'topic:archived')
  assert.equal(result.topics.find(({ topicId }) => topicId === 'topic:archived')?.topicTitle, '旧主题')
  assert.equal(archived.planned.value, 1)
  assert.equal(archived.estimatedMinutes.value, 40)
  assert.deepEqual(archived.planned.facts.map(({ id, taskId, occurrenceId }: any) => [id, taskId, occurrenceId]), [
    ['task:task:archived', 'task:archived', null],
  ])
  assert.equal(result.topics.some(({ topicId }) => topicId === null), false, 'review helper and soft-deleted task stay excluded')

  topic.planned.facts[0].title = 'mutated result'
  assert.equal(plans(selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 }), 'topic:a').planned.facts[0].title, '重复学习')
  assert.deepEqual(workspace, before)
})

test('uses the injected timezone across a DST week and includes future plans but not future outcomes', () => {
  const workspace = state()
  workspace.tasks.push(
    task('task:before', { schedule: { startAt: '2026-03-08T07:59:59.000Z', startOn: null, estimateMinutes: 10 } }),
    task('task:sunday', { schedule: { startAt: '2026-03-08T08:00:00.000Z', startOn: null, estimateMinutes: 10 } }),
    task('task:monday', { schedule: { startAt: '2026-03-09T07:00:00.000Z', startOn: null, estimateMinutes: 10 } }),
    task('task:future', { status: 'completed', schedule: { startAt: '2026-03-14T19:00:00.000Z', startOn: null, estimateMinutes: 20 } }),
    task('task:end', { schedule: { startAt: '2026-03-15T07:00:00.000Z', startOn: null, estimateMinutes: 10 } }),
  )
  workspace.taskEvents.push(
    event('event:future:planned', 'task:future', 'planned', '2026-03-01T10:00:00.000Z', { sequence: 1, fromStatus: 'inbox', toStatus: 'planned' }),
    event('event:future:complete', 'task:future', 'completed', '2026-03-12T10:00:00.000Z', { sequence: 2 }),
  )
  const query = { asOf: '2026-03-11T18:00:00.000Z', timezone: 'America/Los_Angeles', weekStartsOn: 0 as const }

  const sundayWeek = selectWeeklyLearningSummary(workspace, query)
  assert.deepEqual([sundayWeek.rangeStart, sundayWeek.rangeEnd], ['2026-03-08', '2026-03-15'])
  assert.deepEqual(plans(sundayWeek, 'topic:a').planned.facts.map(({ id, scheduledDate }: any) => [id, scheduledDate]), [
    ['task:task:sunday', '2026-03-08'],
    ['task:task:monday', '2026-03-09'],
    ['task:task:future', '2026-03-14'],
  ])
  assert.equal(plans(sundayWeek, 'topic:a').completed.value, 0)
  assert.equal(plans(sundayWeek, 'topic:a').planned.facts.find(({ id }: any) => id === 'task:task:future').status, 'pending')

  const mondayWeek = selectWeeklyLearningSummary(workspace, { ...query, weekStartsOn: 1 })
  assert.deepEqual([mondayWeek.rangeStart, mondayWeek.rangeEnd], ['2026-03-09', '2026-03-16'])
  assert.deepEqual(plans(mondayWeek, 'topic:a').planned.facts.map(({ id }: any) => id), ['task:task:monday', 'task:task:future', 'task:task:end'])
})

test('uses final as-of events for task outcomes and classifies occurrence skips separately', () => {
  const workspace = state()
  workspace.tasks.push(
    task('task:complete', { status: 'completed' }),
    task('task:early-cancel', { status: 'cancelled' }),
    task('task:reopened-complete'),
    task('task:reopened-cancel'),
    task('task:future', { status: 'completed' }),
    task('task:repeat', { recurrenceSeriesId: 'series:repeat' }),
  )
  workspace.recurrenceSeries.push(series('series:repeat', 'task:repeat'))
  workspace.occurrences.push(
    occurrence('occurrence:completed', 'series:repeat', '2026-09-14', { status: 'completed', completedAt: '2026-09-13T07:00:00.000Z' }),
    occurrence('occurrence:skipped', 'series:repeat', '2026-09-15', { ordinal: 2, status: 'skipped' }),
  )
  workspace.taskEvents.push(
    event('event:complete', 'task:complete', 'completed', '2026-09-13T08:00:00.000Z', { sequence: 1 }),
    event('event:early-cancel', 'task:early-cancel', 'cancelled', '2026-09-13T08:30:00.000Z', { sequence: 2 }),
    event('event:old-complete', 'task:reopened-complete', 'completed', '2026-09-14T10:00:00.000Z', { sequence: 3 }),
    event('event:reopen-complete', 'task:reopened-complete', 'reopened', '2026-09-14T09:00:00.000Z', { sequence: 4, fromStatus: 'completed', toStatus: 'planned' }),
    event('event:old-cancel', 'task:reopened-cancel', 'cancelled', '2026-09-15T10:00:00.000Z', { sequence: 5 }),
    event('event:reopen-cancel', 'task:reopened-cancel', 'reopened', '2026-09-15T09:00:00.000Z', { sequence: 6, fromStatus: 'cancelled', toStatus: 'planned' }),
    event('event:future', 'task:future', 'completed', '2026-09-17T08:00:00.000Z', { sequence: 7 }),
    event('event:occurrence-complete', 'task:repeat', 'completed', '2026-09-13T07:00:00.000Z', { sequence: 8, occurrenceId: 'occurrence:completed', fromStatus: 'planned', toStatus: 'planned' }),
    event('event:skip', 'task:repeat', 'cancelled', '2026-09-13T07:30:00.000Z', { sequence: 9, occurrenceId: 'occurrence:skipped', fromStatus: 'planned', toStatus: 'planned', reason: 'Occurrence skipped.' }),
  )

  const current = plans(selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 }), 'topic:a')
  assert.deepEqual(current.completed.facts.map(({ id, outcomeEventId, status }: any) => [id, outcomeEventId, status]), [
    ['task:task:complete', 'event:complete', 'completed'],
    ['occurrence:occurrence:completed', 'event:occurrence-complete', 'completed'],
  ])
  assert.deepEqual(current.cancelled.facts.map(({ id, outcomeEventId, status }: any) => [id, outcomeEventId, status]), [
    ['task:task:early-cancel', 'event:early-cancel', 'cancelled'],
  ])
  assert.deepEqual(current.skipped.facts.map(({ id, occurrenceId, outcomeEventId, status }: any) => [id, occurrenceId, outcomeEventId, status]), [
    ['occurrence:occurrence:skipped', 'occurrence:skipped', 'event:skip', 'skipped'],
  ])
  assert.equal(current.planned.facts.find(({ id }: any) => id === 'task:task:future').status, 'pending')
})

test('excludes structural recurrence cancellations and honors current occurrence state after undo', () => {
  const workspace = state()
  workspace.tasks.push(task('task:split', { recurrenceSeriesId: 'series:new' }))
  workspace.recurrenceSeries.push(
    series('series:old', 'task:split', { end: { kind: 'on', date: '2026-09-15' } }),
    series('series:new', 'task:split'),
  )
  workspace.occurrences.push(
    occurrence('occurrence:old-structural', 'series:old', '2026-09-16', { status: 'cancelled' }),
    occurrence('occurrence:new', 'series:new', '2026-09-16'),
    occurrence('occurrence:current-structural', 'series:new', '2026-09-17', { ordinal: 2, status: 'cancelled' }),
    occurrence('occurrence:redone', 'series:new', '2026-09-18', { ordinal: 3, status: 'completed', completedAt: '2026-09-16T11:00:00.000Z' }),
    occurrence('occurrence:undone', 'series:new', '2026-09-19', { ordinal: 4 }),
  )
  workspace.taskEvents.push(
    event('event:undone', 'task:split', 'completed', '2026-09-16T08:00:00.000Z', { sequence: 1, occurrenceId: 'occurrence:undone', fromStatus: 'planned', toStatus: 'planned' }),
    event('event:redone:first', 'task:split', 'completed', '2026-09-16T10:00:00.000Z', { sequence: 2, occurrenceId: 'occurrence:redone', fromStatus: 'planned', toStatus: 'planned' }),
    event('event:redone:latest', 'task:split', 'completed', '2026-09-16T11:00:00.000Z', { sequence: 3, occurrenceId: 'occurrence:redone', fromStatus: 'planned', toStatus: 'planned' }),
  )
  const result = selectWeeklyLearningSummary(workspace, { asOf: AT, timezone: 'UTC', weekStartsOn: 1 })
  const current = plans(result, 'topic:a')
  assert.deepEqual(current.planned.facts.map(({ id }: any) => id), [
    'occurrence:occurrence:new',
    'occurrence:occurrence:redone',
    'occurrence:occurrence:undone',
  ])
  assert.deepEqual(current.completed.facts.map(({ id, outcomeEventId }: any) => [id, outcomeEventId]), [
    ['occurrence:occurrence:redone', 'event:redone:latest'],
  ])
  assert.equal(current.planned.facts.find(({ id }: any) => id === 'occurrence:occurrence:undone').status, 'pending')
  assert.equal(current.cancelled.value, 0)
})

test('returns stable cloned results without mutating workspace order and rejects invalid query values', () => {
  const workspace = state()
  workspace.completionRecords.push(
    record('record:z', '2026-09-15T08:00:00.000Z', { topicId: null }),
    record('record:a', '2026-09-14T08:00:00.000Z'),
  )
  const before = structuredClone(workspace)
  const query = { asOf: AT, timezone: 'UTC', weekStartsOn: 1 as const }

  const first = selectWeeklyLearningSummary(workspace, query)
  first.totals.evidenceCompletions.recordIds.push('mutated')
  const second = selectWeeklyLearningSummary(workspace, query)

  assert.deepEqual(workspace, before)
  assert.doesNotMatch(second.totals.evidenceCompletions.recordIds.join(','), /mutated/)
  assert.throws(() => selectWeeklyLearningSummary(workspace, { ...query, asOf: 'invalid' }), /Invalid datetime/)
  assert.throws(() => selectWeeklyLearningSummary(workspace, { ...query, timezone: 'Invalid\/Zone' }), /timezone|Invalid/i)
  assert.throws(() => selectWeeklyLearningSummary(workspace, { ...query, weekStartsOn: 2 as 0 }), /Invalid week start/)
})
