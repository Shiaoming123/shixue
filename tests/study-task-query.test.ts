import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterStudyTasks,
  filterStudyTasksByTopic,
  queryStudyTasks,
  searchStudyTasks,
  selectStudyTaskSmartView,
  sortStudyTasks,
} from '../src/lib/study-task-query.ts'
import type { StudyTask, StudyTopic } from '../src/storage/study/types.ts'

const topics: StudyTopic[] = [
  {
    id: 'topic-agent', title: 'Agent Workflows', goal: 'Ship a workflow',
    successCriteria: ['restart resumes'], weeklyTargetMinutes: 120,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', archivedAt: null,
  },
  {
    id: 'topic-english', title: 'Technical English', goal: 'Follow talks',
    successCriteria: ['summarize talks'], weeklyTargetMinutes: 60,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', archivedAt: null,
  },
]

function task(overrides: Partial<StudyTask> & Pick<StudyTask, 'id' | 'title'>): StudyTask {
  return {
    id: overrides.id, revision: 1, topicId: null, title: overrides.title,
    notes: '', status: 'inbox', plannedOn: null, dueOn: null, reminderAt: null,
    priority: 'none', estimateMinutes: null,
    acceptanceCriteria: [], checklist: [], blockedReason: null,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null,
    ...overrides,
  }
}

const tasks: StudyTask[] = [
  task({ id: 'manual-1', title: 'Zulu', topicId: 'topic-agent', notes: 'Durable checkpoint', dueOn: null, updatedAt: '2026-09-02T00:00:00.000Z' }),
  task({ id: 'manual-2', title: 'alpha', topicId: 'topic-english', status: 'blocked', blockedReason: 'Need captions', dueOn: '2026-09-08', updatedAt: '2026-09-04T00:00:00.000Z' }),
  task({ id: 'manual-3', title: 'Beta', acceptanceCriteria: ['Restart resumes'], checklist: [{ id: 'check-1', text: 'Run rejection path', checked: false, checkedAt: null, position: 0 }], dueOn: '2026-09-06', updatedAt: '2026-09-03T00:00:00.000Z' }),
  task({ id: 'deleted', title: 'Deleted checkpoint', notes: 'Historical only', deletedAt: '2026-09-04T00:00:00.000Z' }),
]

test('task search covers task text and topic titles case-insensitively while excluding deleted tasks', () => {
  assert.deepEqual(searchStudyTasks(tasks, topics, 'checkpoint').map(({ id }) => id), ['manual-1'])
  assert.deepEqual(searchStudyTasks(tasks, topics, 'technical english').map(({ id }) => id), ['manual-2'])
  assert.deepEqual(searchStudyTasks(tasks, topics, 'RESTART RESUMES').map(({ id }) => id), ['manual-3'])
  assert.deepEqual(searchStudyTasks(tasks, topics, 'rejection path').map(({ id }) => id), ['manual-3'])
  assert.deepEqual(searchStudyTasks(tasks, topics, 'need captions').map(({ id }) => id), ['manual-2'])
})

test('task filters compose status and topic without mutating source order', () => {
  const before = structuredClone(tasks)
  assert.deepEqual(
    filterStudyTasks(tasks, { statuses: ['blocked'], topicId: 'topic-english' }).map(({ id }) => id),
    ['manual-2'],
  )
  assert.deepEqual(tasks, before)
  assert.deepEqual(filterStudyTasksByTopic(tasks, 'topic-agent').map(({ id }) => id), ['manual-1'])
})

test('task sorting is deterministic for manual order, updated time, due date, and title', () => {
  assert.deepEqual(sortStudyTasks(tasks, 'manual').map(({ id }) => id), ['manual-1', 'manual-2', 'manual-3'])
  assert.deepEqual(sortStudyTasks(tasks, 'updatedAt').map(({ id }) => id), ['manual-2', 'manual-3', 'manual-1'])
  assert.deepEqual(sortStudyTasks(tasks, 'dueOn').map(({ id }) => id), ['manual-3', 'manual-2', 'manual-1'])
  assert.deepEqual(sortStudyTasks(tasks, 'title').map(({ id }) => id), ['manual-2', 'manual-3', 'manual-1'])
})

test('combined query applies search, filters, topic, and sort as a pure operation', () => {
  const before = structuredClone(tasks)
  const result = queryStudyTasks(tasks, topics, {
    search: 'a', statuses: ['inbox', 'blocked'], topicId: 'topic-agent', sort: 'title',
  })
  assert.deepEqual(result.map(({ id }) => id), ['manual-1'])
  assert.deepEqual(tasks, before)
})

test('smart views select actionable date windows and completed history', () => {
  const smartTasks = [
    task({ id: 'inbox', title: 'Inbox' }),
    task({ id: 'overdue', title: 'Overdue', status: 'planned', plannedOn: '2026-09-03' }),
    task({ id: 'today', title: 'Today', status: 'planned', dueOn: '2026-09-04' }),
    task({ id: 'next', title: 'Next', status: 'planned', plannedOn: '2026-09-10' }),
    task({ id: 'later', title: 'Later', status: 'planned', plannedOn: '2026-09-11' }),
    task({ id: 'done', title: 'Done', status: 'completed' }),
    task({ id: 'cancelled', title: 'Cancelled', status: 'cancelled' }),
  ]

  assert.deepEqual(selectStudyTaskSmartView(smartTasks, 'inbox', '2026-09-04').map(({ id }) => id), ['inbox'])
  assert.deepEqual(selectStudyTaskSmartView(smartTasks, 'today', '2026-09-04').map(({ id }) => id), ['overdue', 'today'])
  assert.deepEqual(selectStudyTaskSmartView(smartTasks, 'next7', '2026-09-04').map(({ id }) => id), ['today', 'next'])
  assert.deepEqual(selectStudyTaskSmartView(smartTasks, 'all', '2026-09-04').map(({ id }) => id), ['inbox', 'overdue', 'today', 'next', 'later'])
  assert.deepEqual(selectStudyTaskSmartView(smartTasks, 'completed', '2026-09-04').map(({ id }) => id), ['done'])
})

test('priority sorting puts high priority first and remains stable within a level', () => {
  const prioritized = [
    task({ id: 'none', title: 'None' }),
    task({ id: 'high-1', title: 'High 1', priority: 'high' }),
    task({ id: 'low', title: 'Low', priority: 'low' }),
    task({ id: 'high-2', title: 'High 2', priority: 'high' }),
  ]
  assert.deepEqual(sortStudyTasks(prioritized, 'priority').map(({ id }) => id), ['high-1', 'high-2', 'low', 'none'])
})

test('combined query composes a smart view with search, topic, and sorting', () => {
  const smartTasks = [
    task({ id: 'agent-low', title: 'Agent notes', topicId: 'topic-agent', status: 'planned', dueOn: '2026-09-05', priority: 'low' }),
    task({ id: 'agent-high', title: 'Agent demo', topicId: 'topic-agent', status: 'planned', plannedOn: '2026-09-06', priority: 'high' }),
    task({ id: 'english', title: 'English demo', topicId: 'topic-english', status: 'planned', plannedOn: '2026-09-06', priority: 'high' }),
    task({ id: 'later', title: 'Agent later', topicId: 'topic-agent', status: 'planned', plannedOn: '2026-09-12', priority: 'high' }),
  ]
  assert.deepEqual(queryStudyTasks(smartTasks, topics, {
    smartView: 'next7', today: '2026-09-04', search: 'agent',
    topicId: 'topic-agent', sort: 'priority',
  }).map(({ id }) => id), ['agent-high', 'agent-low'])
})
