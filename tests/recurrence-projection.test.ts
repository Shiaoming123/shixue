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

  const rows = projectTaskItems(workspace, todayRange, 'Asia/Shanghai')

  assert.equal(rows.length, 1)
  assert.equal(rows.filter((row) => row.occurrenceId === 'occ:today').length, 1)
  assert.equal(rows[0]?.key, 'occurrence:occ:today')
  assert.deepEqual(rows[0]?.reasons, ['planned', 'due', 'recurring'])
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

  assert.deepEqual(projectTaskItems(workspace, todayRange, 'Asia/Shanghai').map(({ key, reasons }) => [key, reasons]), [
    ['task:task:once', ['planned']],
    ['task:task:overdue', ['overdue']],
  ])
})

test('precise task instants use the injected device timezone for local-day projection', () => {
  const workspace = fixture({
    tasks: [task({
      id: 'task:boundary',
      recurrenceSeriesId: null,
      schedule: { startAt: '2026-09-05T16:30:00.000Z', startOn: null, estimateMinutes: null },
      deadline: { dueAt: '2026-09-05T16:30:00.000Z', dueOn: null },
    })],
    recurrenceSeries: [],
    occurrences: [],
  })

  assert.deepEqual(projectTaskItems(workspace, { from: '2026-09-05', to: '2026-09-05' }, 'Asia/Shanghai'), [])
  const [dueToday] = projectTaskItems(workspace, { from: '2026-09-06', to: '2026-09-06' }, 'Asia/Shanghai')
  assert.equal(dueToday?.scheduledOn, '2026-09-06')
  assert.equal(dueToday?.dueOn, '2026-09-06')
  assert.deepEqual(dueToday?.reasons, ['planned', 'due'])
  assert.deepEqual(
    projectTaskItems(workspace, { from: '2026-09-07', to: '2026-09-07' }, 'Asia/Shanghai')[0]?.reasons,
    ['overdue'],
  )
})

test('precise occurrence range boundaries follow 23-hour and 25-hour DST days', () => {
  for (const scenario of [
    {
      date: '2026-03-08',
      instants: [
        ['occ:before', '2026-03-08T04:59:59.000Z'],
        ['occ:start', '2026-03-08T05:00:00.000Z'],
        ['occ:end', '2026-03-09T03:59:59.000Z'],
        ['occ:after', '2026-03-09T04:00:00.000Z'],
      ],
    },
    {
      date: '2026-11-01',
      instants: [
        ['occ:before', '2026-11-01T03:59:59.000Z'],
        ['occ:start', '2026-11-01T04:00:00.000Z'],
        ['occ:end', '2026-11-02T04:59:59.000Z'],
        ['occ:after', '2026-11-02T05:00:00.000Z'],
      ],
    },
  ] as const) {
    const occurrences = scenario.instants.map(([id, scheduledAt], index) => occurrence({ id, ordinal: index + 1, scheduledAt }))
    const rows = projectTaskItems(
      fixture({ occurrences }),
      { from: scenario.date, to: scenario.date },
      'America/New_York',
    )

    assert.deepEqual(rows.map(({ occurrenceId }) => occurrenceId), ['occ:before', 'occ:start', 'occ:end'])
    assert.deepEqual(rows.map(({ scheduledOn }) => scheduledOn), [
      scenario.date === '2026-03-08' ? '2026-03-07' : '2026-10-31',
      scenario.date,
      scenario.date,
    ])
    assert.deepEqual(rows.map(({ reasons }) => reasons), [['overdue', 'recurring'], ['recurring'], ['recurring']])
  }
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

  const [row] = projectTaskItems(workspace, todayRange, 'Asia/Shanghai')

  assert.equal(row?.occurrence?.status, 'completed')
  assert.equal(row?.scheduledAt, completed.scheduledAt)
  assert.equal(row?.dueAt, parent.deadline.dueAt)
  assert.equal(workspace.tasks[0]?.schedule.startOn, null)
})

test('Today retains the next occurrence when only its independent parent deadline is today', () => {
  const parent = task({ deadline: { dueAt: null, dueOn: '2026-09-05' } })
  const future = occurrence({ scheduledAt: null, scheduledOn: '2026-09-08' })
  const [row] = projectTaskItems(fixture({ task: parent, occurrences: [future] }), todayRange, 'Asia/Shanghai')

  assert.equal(row?.occurrenceId, future.id)
  assert.equal(row?.scheduledOn, '2026-09-08')
  assert.equal(row?.dueOn, '2026-09-05')
  assert.deepEqual(row?.reasons, ['due', 'recurring'])
})

test('deadline fallback selects the earliest pending occurrence without relying on input order', () => {
  const parent = task({ deadline: { dueAt: null, dueOn: '2026-09-05' } })
  const later = occurrence({ id: 'occ:later', ordinal: 2, scheduledAt: null, scheduledOn: '2026-09-10' })
  const earlier = occurrence({ id: 'occ:earlier', ordinal: 1, scheduledAt: null, scheduledOn: '2026-09-08' })

  const [row] = projectTaskItems(fixture({ task: parent, occurrences: [later, earlier] }), todayRange, 'Asia/Shanghai')

  assert.equal(row?.occurrenceId, earlier.id)
  assert.equal(row?.scheduledOn, '2026-09-08')
  assert.deepEqual(row?.reasons, ['due', 'recurring'])
})

test('Today retains a pending deadline row when a completed occurrence is already projected', () => {
  const parent = task({ deadline: { dueAt: null, dueOn: '2026-09-05' } })
  const completed = occurrence({
    id: 'occ:done',
    scheduledAt: null,
    scheduledOn: '2026-09-05',
    status: 'completed',
    completedAt: '2026-09-05T09:30:00+08:00',
  })
  const future = occurrence({ id: 'occ:future', ordinal: 2, scheduledAt: null, scheduledOn: '2026-09-08' })

  const rows = projectTaskItems(fixture({ task: parent, occurrences: [completed, future] }), todayRange, 'Asia/Shanghai')
  const pending = rows.find(({ occurrenceId }) => occurrenceId === future.id)

  assert.equal(pending?.occurrence?.status, 'pending')
  assert.equal(pending?.scheduledOn, '2026-09-08')
  assert.deepEqual(pending?.reasons, ['due', 'recurring'])
})

test('Today falls back to the parent deadline row when no pending occurrence remains', () => {
  const parent = task({ deadline: { dueAt: null, dueOn: '2026-09-05' } })
  const completed = occurrence({
    id: 'occ:done',
    scheduledAt: null,
    scheduledOn: '2026-09-05',
    status: 'completed',
    completedAt: '2026-09-05T09:30:00+08:00',
  })

  const rows = projectTaskItems(fixture({ task: parent, occurrences: [completed] }), todayRange, 'Asia/Shanghai')
  const fallback = rows.find(({ key }) => key === `task:${parent.id}`)

  assert.equal(fallback?.occurrenceId, null)
  assert.equal(fallback?.dueOn, '2026-09-05')
  assert.deepEqual(fallback?.reasons, ['due'])
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

  assert.match(app, /selectToday\(recurrenceWorkspace\.value, today\.value, timezone\)/)
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
