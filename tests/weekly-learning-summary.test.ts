import assert from 'node:assert/strict'
import test from 'node:test'
import { selectWeeklyLearningSummary } from '../src/domain/views/weekly-learning-summary.ts'
import type { CompletionRecord, StudySession, TaskList, WorkspaceStateV3 } from '../src/domain/workspace/types.ts'

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
