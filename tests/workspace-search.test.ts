import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import { searchWorkspace } from '../src/domain/search/workspace-search.ts'
import type { CompletionRecord, Task, WorkspaceStateV3 } from '../src/domain/workspace/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'

const AT = '2026-09-07T00:00:00.000Z'

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title' | 'listId'>): Task {
  return {
    id: overrides.id, revision: 1, mode: 'learning', listId: overrides.listId,
    sectionId: null, tagIds: [], title: overrides.title, notes: '', status: 'planned',
    schedule: { startAt: null, startOn: null, estimateMinutes: null },
    deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [],
    learning: { acceptanceCriteria: [], blockedReason: null }, recurrenceSeriesId: null,
    createdAt: AT, updatedAt: AT, deletedAt: null,
    ...overrides,
  }
}

function record(
  overrides: Partial<CompletionRecord> & Pick<CompletionRecord, 'id' | 'taskId' | 'taskTitleSnapshot'>,
): CompletionRecord {
  return {
    id: overrides.id, taskId: overrides.taskId, topicId: null, sessionIds: [],
    tagIdsSnapshot: [], taskTitleSnapshot: overrides.taskTitleSnapshot,
    learned: 'Learned fact', evidence: 'Evidence fact', blocker: '', nextAction: 'Next fact',
    mastery: null, completedAt: AT, reviewStage: 0, nextReviewOn: null,
    lastReviewResult: null, lastReviewedAt: null, createdAt: AT, updatedAt: AT,
    deletedAt: null, ...overrides,
  }
}

function workspace(): WorkspaceStateV3 {
  return {
    version: 3, revision: 1, listGroups: [],
    lists: [
      { id: 'topic:systems', groupId: null, title: 'Systems Thinking', position: 0, goal: '', successCriteria: [], weeklyTargetMinutes: null, createdAt: AT, updatedAt: AT, archivedAt: null },
      { id: 'topic:language', groupId: null, title: 'Technical English', position: 1, goal: '', successCriteria: [], weeklyTargetMinutes: null, createdAt: AT, updatedAt: AT, archivedAt: null },
    ],
    sections: [],
    tags: [
      { id: 'tag:reading', title: 'Reading', position: 0, createdAt: AT, updatedAt: AT, archivedAt: null },
      { id: 'tag:low-energy', title: 'Low Energy', position: 1, createdAt: AT, updatedAt: AT, archivedAt: null },
    ],
    tasks: [
      task({
        id: 'task:systems', listId: 'topic:systems', title: 'Ａｇｅｎｔ checkpoint',
        notes: 'Durable state', tagIds: ['tag:reading', 'tag:low-energy'], status: 'blocked',
        schedule: { startAt: '2026-09-06T16:30:00.000Z', startOn: null, estimateMinutes: 30 },
        deadline: { dueAt: null, dueOn: '2026-09-08' },
        checklist: [{ id: 'check:1', text: 'Run rejection path', checked: false, checkedAt: null, position: 0 }],
        learning: { acceptanceCriteria: ['Restart resumes'], blockedReason: 'Need captions' },
      }),
      task({
        id: 'task:language', listId: 'topic:language', title: 'Shadow a talk',
        tagIds: ['tag:reading'], status: 'planned',
        schedule: { startAt: null, startOn: '2026-09-07', estimateMinutes: 20 },
      }),
      task({ id: 'task:deleted', listId: 'topic:systems', title: 'Deleted needle', deletedAt: AT }),
    ],
    recurrenceSeries: [], occurrences: [], reminderRules: [], reminderDeliveries: [],
    studySessions: [], taskEvents: [],
    completionRecords: [
      record({
        id: 'record:b', taskId: 'task:systems', topicId: 'topic:systems',
        tagIdsSnapshot: ['tag:reading', 'tag:low-energy'], taskTitleSnapshot: 'Finish workflow',
        learned: 'State restore is deterministic', evidence: 'Six tests passed',
        blocker: 'Auth fixture missing', nextAction: 'Record the demo',
        completedAt: '2026-09-06T16:30:00.000Z',
      }),
      record({
        id: 'record:a', taskId: 'task:systems', topicId: 'topic:systems',
        taskTitleSnapshot: 'Earlier same instant', completedAt: '2026-09-06T16:30:00.000Z',
      }),
      record({
        id: 'record:newer', taskId: 'task:language', topicId: 'topic:language',
        taskTitleSnapshot: 'Newest fact', completedAt: '2026-09-07T01:00:00.000Z',
      }),
      record({
        id: 'record:deleted', taskId: 'task:deleted', topicId: 'topic:systems',
        taskTitleSnapshot: 'Deleted record needle', deletedAt: AT,
      }),
    ],
    reviewTaskLinks: [], commandReceipts: [], updatedAt: AT,
  }
}

test('search covers task and completion facts with deterministic Unicode normalization', () => {
  const state = workspace()
  const taskCases = [
    ['agent', 'title'], ['durable', 'notes'], ['restart resumes', 'acceptance_criteria'],
    ['rejection path', 'checklist'], ['need captions', 'blocker'],
  ] as const
  for (const [text, field] of taskCases) {
    const result = searchWorkspace(state, { text })
    assert.deepEqual(result.tasks.map(({ id }) => id), ['task:systems'])
    assert.deepEqual(result.tasks[0]?.matchedFields, [field])
  }

  const recordCases = [
    ['finish workflow', 'title'], ['state restore', 'learned'], ['six tests', 'evidence'],
    ['auth fixture', 'blocker'], ['record the demo', 'next_action'],
  ] as const
  for (const [text, field] of recordCases) {
    const result = searchWorkspace(state, { text, kinds: ['completion_record'] })
    assert.deepEqual(result.completionRecords.map(({ id }) => id), ['record:b'])
    assert.deepEqual(result.completionRecords[0]?.matchedFields, [field])
  }

  const byTopic = searchWorkspace(state, { text: 'systems thinking' })
  assert.deepEqual(byTopic.tasks.map(({ id }) => id), ['task:systems'])
  assert.deepEqual(byTopic.completionRecords.map(({ id }) => id), ['record:a', 'record:b'])
  const byTag = searchWorkspace(state, { text: 'low energy' })
  assert.deepEqual(byTag.tasks.map(({ id }) => id), ['task:systems'])
  assert.deepEqual(byTag.completionRecords.map(({ id }) => id), ['record:b'])
})

test('topic and status values use OR while dimensions and requested tags compose with AND', () => {
  const topicsOnly = searchWorkspace(workspace(), {
    kinds: ['task'], topicIds: ['topic:systems', 'topic:language'],
  })
  assert.deepEqual(topicsOnly.tasks.map(({ id }) => id), ['task:systems', 'task:language'])

  const result = searchWorkspace(workspace(), {
    topicIds: ['topic:systems', 'topic:language'],
    statuses: ['blocked', 'recorded'],
    tagIds: ['tag:reading', 'tag:low-energy'],
    date: { from: '2026-09-07', to: '2026-09-07', timezone: 'Asia/Shanghai' },
  })
  assert.deepEqual(result.tasks.map(({ id, matchedDates }) => ({ id, matchedDates })), [
    { id: 'task:systems', matchedDates: ['scheduled'] },
  ])
  assert.deepEqual(result.completionRecords.map(({ id, matchedDates }) => ({ id, matchedDates })), [
    { id: 'record:b', matchedDates: ['completed'] },
  ])

  const oneMissingTag = searchWorkspace(workspace(), { tagIds: ['tag:reading', 'tag:missing'] })
  assert.deepEqual(oneMissingTag, { tasks: [], completionRecords: [] })
})

test('task order stays canonical, completion order is newest then stable id, and deleted facts are opt-in', () => {
  const state = workspace()
  const visible = searchWorkspace(state, {})
  assert.deepEqual(visible.tasks.map(({ id }) => id), ['task:systems', 'task:language'])
  assert.deepEqual(visible.completionRecords.map(({ id }) => id), ['record:newer', 'record:a', 'record:b'])
  assert.equal(JSON.stringify(state), JSON.stringify(workspace()))

  const all = searchWorkspace(state, { text: 'deleted', includeDeleted: true })
  assert.deepEqual(all.tasks.map(({ id }) => id), ['task:deleted'])
  assert.deepEqual(all.completionRecords.map(({ id }) => id), ['record:deleted'])
})

test('date filtering fails loudly for invalid bounds, order, and timezone', () => {
  const state = workspace()
  assert.throws(() => searchWorkspace(state, { date: { timezone: 'Asia/Shanghai' } }), /at least one bound/)
  assert.throws(() => searchWorkspace(state, { date: { from: '2026-02-30', timezone: 'Asia/Shanghai' } }), /YYYY-MM-DD/)
  assert.throws(() => searchWorkspace(state, { date: { from: '2026-09-08', to: '2026-09-07', timezone: 'Asia/Shanghai' } }), /start on or before/)
  assert.throws(() => searchWorkspace(state, { date: { from: '2026-09-07', timezone: 'Mars/Olympus' } }), /Invalid IANA timezone/)
})

test('workspace.search and legacy task.search delegate to the same cloned search projection', async () => {
  const service = createTaskCapabilityService(
    createInMemoryWorkspaceStore(),
    () => AT,
    (kind) => `${kind}:search-test`,
  )
  const records = await service.query({ type: 'workspace.search', text: 'thread_id', kinds: ['completion_record'] })
  assert.ok(records.completionRecords.length > 0)
  records.completionRecords[0]!.record.learned = 'mutated result'
  const repeated = await service.query({ type: 'workspace.search', text: 'thread_id', kinds: ['completion_record'] })
  assert.notEqual(repeated.completionRecords[0]?.record.learned, 'mutated result')

  const modern = await service.query({ type: 'workspace.search', text: 'LANGGRAPH', kinds: ['task'] })
  const legacy = await service.query({ type: 'task.search', text: 'LANGGRAPH' })
  assert.deepEqual(legacy.map(({ id }) => id), modern.tasks.map(({ id }) => id))
  assert.ok(legacy.length > 0)
})
