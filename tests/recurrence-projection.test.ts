import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { projectTaskItems } from '../src/lib/study-task-query.ts'
import type { Task, TaskOccurrence, WorkspaceStateV3 } from '../src/domain/workspace/types.ts'

const todayRange = { from: '2026-09-05', to: '2026-09-05' } as const

test('one occurrence with planned and due-today reasons renders once', () => {
  const workspace = fixture({
    task: task({
      schedule: { startAt: null, startOn: '2026-09-05', estimateMinutes: 30 },
      deadline: { dueAt: null, dueOn: '2026-09-05' },
    }),
    occurrences: [
      occurrence({ id: 'occ:today', scheduledAt: '2026-09-05T09:00:00+08:00' }),
      occurrence({ id: 'occ:tomorrow', ordinal: 2, scheduledAt: '2026-09-06T09:00:00+08:00' }),
    ],
  })

  const rows = projectTaskItems(workspace, todayRange)

  assert.equal(rows.length, 1)
  assert.equal(rows.filter((row) => row.occurrenceId === 'occ:today').length, 1)
  assert.equal(rows[0]?.key, 'occurrence:occ:today')
  assert.deepEqual(rows[0]?.reasons, ['planned', 'due'])
  assert.equal(rows[0]?.scheduledAt, '2026-09-05T09:00:00+08:00')
  assert.equal(rows[0]?.dueOn, '2026-09-05')
})

test('range projection keeps task reasons stable and excludes unrelated dates', () => {
  const workspace = fixture({
    task: task({ id: 'task:once', recurrenceSeriesId: null }),
    tasks: [
      task({ id: 'task:once', recurrenceSeriesId: null, schedule: { startAt: null, startOn: '2026-09-05', estimateMinutes: null } }),
      task({ id: 'task:overdue', recurrenceSeriesId: null, deadline: { dueAt: null, dueOn: '2026-09-04' } }),
      task({ id: 'task:later', recurrenceSeriesId: null, schedule: { startAt: null, startOn: '2026-09-06', estimateMinutes: null } }),
    ],
    recurrenceSeries: [],
    occurrences: [],
  })

  assert.deepEqual(projectTaskItems(workspace, todayRange).map(({ key, reasons }) => [key, reasons]), [
    ['task:task:once', ['planned']],
    ['task:task:overdue', ['overdue']],
  ])
})

test('completed occurrence remains projected as history without advancing task dates', () => {
  const completed = occurrence({
    id: 'occ:done',
    scheduledAt: '2026-09-05T09:00:00+08:00',
    status: 'completed',
    completedAt: '2026-09-05T09:30:00+08:00',
  })
  const parent = task({
    schedule: { startAt: null, startOn: null, estimateMinutes: 30 },
    deadline: { dueAt: '2026-09-05T18:00:00+08:00', dueOn: null },
  })
  const workspace = fixture({ task: parent, occurrences: [completed] })

  const [row] = projectTaskItems(workspace, todayRange)

  assert.equal(row?.occurrence?.status, 'completed')
  assert.equal(row?.scheduledAt, completed.scheduledAt)
  assert.equal(row?.dueAt, parent.deadline.dueAt)
  assert.equal(workspace.tasks[0]?.schedule.startOn, null)
})

test('occurrence UI exposes occurrence intent actions and separate schedule/deadline labels', () => {
  const today = readFileSync(new URL('../src/components/study/TodayView.vue', import.meta.url), 'utf8')
  const detail = readFileSync(new URL('../src/components/study/TaskDetailDrawer.vue', import.meta.url), 'utf8')
  for (const source of [today, detail]) {
    assert.match(source, /occurrenceComplete/)
    assert.match(source, /occurrenceSkip/)
    assert.match(source, /occurrenceReschedule/)
    assert.match(source, /occurrenceScheduleLabel/)
    assert.match(source, /deadlineLabel/)
  }
})

test('the live Today route uses occurrence projection and opens occurrence detail actions', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const tasks = readFileSync(new URL('../src/components/study/TasksView.vue', import.meta.url), 'utf8')

  assert.match(app, /projectTaskItems\(recurrenceWorkspace\.value, \{ from: today\.value, to: today\.value \}\)/)
  assert.match(app, /@occurrence-open="openOccurrence"/)
  assert.match(app, /:occurrence-id="selectedOccurrence\?\.id"/)
  assert.match(app, /@occurrence-complete="executeOccurrence\(\$event, 'recurrence\.complete'\)"/)
  assert.match(tasks, /@open="emit\('occurrenceOpen', \$event\)"/)
})

function fixture(input: {
  task?: Task
  tasks?: Task[]
  recurrenceSeries?: WorkspaceStateV3['recurrenceSeries']
  occurrences?: TaskOccurrence[]
} = {}): WorkspaceStateV3 {
  const selectedTask = input.task ?? task()
  return {
    version: 3,
    revision: 1,
    listGroups: [],
    lists: [],
    sections: [],
    tags: [],
    tasks: input.tasks ?? [selectedTask],
    recurrenceSeries: input.recurrenceSeries ?? [{
      id: 'series:1', taskId: selectedTask.id, revision: 1,
      cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
      anchorAt: '2026-09-05T09:00:00+08:00', anchorOn: null, end: { kind: 'never' }, timezone: 'Asia/Shanghai',
      createdThrough: '2026-09-05T09:00:00+08:00', createdCount: 1,
    }],
    occurrences: input.occurrences ?? [],
    reminderRules: [],
    reminderDeliveries: [],
    studySessions: [],
    taskEvents: [],
    completionRecords: [],
    reviewTaskLinks: [],
    commandReceipts: [],
    previewReceipts: [],
    updatedAt: '2026-09-05T00:00:00+08:00',
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task:1', revision: 1, mode: 'general', listId: 'list:1', sectionId: null, tagIds: [],
    title: 'Daily review', notes: '', status: 'planned',
    schedule: { startAt: null, startOn: null, estimateMinutes: null },
    deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [], learning: null,
    recurrenceSeriesId: 'series:1', createdAt: '2026-09-01T00:00:00+08:00', updatedAt: '2026-09-01T00:00:00+08:00', deletedAt: null,
    ...overrides,
  }
}

function occurrence(overrides: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return {
    id: 'occ:1', seriesId: 'series:1', ordinal: 1, scheduledAt: '2026-09-05T09:00:00+08:00', scheduledOn: null,
    status: 'pending', override: null, completedAt: null, revision: 1, ...overrides,
  }
}
