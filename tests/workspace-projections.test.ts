import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { selectToday } from '../src/domain/views/today.ts'
import { selectUpcoming } from '../src/domain/views/upcoming.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { Task, TaskOccurrence, WorkspaceStateV3 } from '../src/domain/workspace/types.ts'
import { parseWorkspaceStateOrMigrate } from '../src/domain/workspace/migrate.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createSeedStudyState } from '../src/storage/study/types.ts'

test('Today keeps four canonical groups and one row with every applicable reason', () => {
  const state = workspace({
    tasks: [
      task({ id: 'overdue', deadline: { dueAt: null, dueOn: '2026-09-04' } }),
      task({ id: 'both', schedule: { startAt: null, startOn: '2026-09-05', estimateMinutes: null }, deadline: { dueAt: null, dueOn: '2026-09-05' }, recurrenceSeriesId: 'series:both' }),
      task({ id: 'done', status: 'completed', schedule: { startAt: null, startOn: '2026-09-05', estimateMinutes: null } }),
    ],
    recurrenceSeries: [series('series:both', 'both')],
    occurrences: [occurrence({ id: 'occ:both', seriesId: 'series:both', scheduledOn: '2026-09-05' })],
  })

  const groups = selectToday(state, '2026-09-05T06:00:00.000Z', 'Asia/Shanghai')

  assert.deepEqual(groups.map(({ kind }) => kind), ['overdue', 'planned', 'due', 'recurring'])
  assert.deepEqual(groups.map(({ items }) => items.map(({ key }) => key)), [
    ['task:overdue'], ['occurrence:occ:both'], [], [],
  ])
  assert.deepEqual(groups[1]!.items[0]!.reasons, ['planned', 'due', 'recurring'])
  assert.equal(groups.flatMap(({ items }) => items).filter(({ key }) => key === 'occurrence:occ:both').length, 1)
})

test('Today excludes completed, skipped and cancelled entities and sorts by schedule, priority, task order and occurrence ordinal', () => {
  const state = workspace({
    tasks: [
      task({ id: 'late-high', priority: 'high', schedule: { startAt: '2026-09-05T03:00:00.000Z', startOn: null, estimateMinutes: null } }),
      task({ id: 'early-low', priority: 'low', schedule: { startAt: '2026-09-05T01:00:00.000Z', startOn: null, estimateMinutes: null } }),
      task({ id: 'series', recurrenceSeriesId: 'series:sort' }),
      task({ id: 'cancelled', status: 'cancelled', schedule: { startAt: null, startOn: '2026-09-05', estimateMinutes: null } }),
    ],
    recurrenceSeries: [series('series:sort', 'series')],
    occurrences: [
      occurrence({ id: 'occ:2', seriesId: 'series:sort', ordinal: 2, scheduledOn: '2026-09-05' }),
      occurrence({ id: 'occ:1', seriesId: 'series:sort', ordinal: 1, scheduledOn: '2026-09-05' }),
      occurrence({ id: 'occ:skip', seriesId: 'series:sort', ordinal: 3, scheduledOn: '2026-09-05', status: 'skipped' }),
    ],
  })

  const rows = selectToday(state, '2026-09-05', 'Asia/Shanghai').flatMap(({ items }) => items)
  assert.deepEqual(rows.map(({ key }) => key), ['task:early-low', 'task:late-high', 'occurrence:occ:1', 'occurrence:occ:2'])
})

test('Today treats a past ordinary plan without a deadline as overdue without retaining planned', () => {
  const state = workspace({ tasks: [task({ id: 'past-plan', schedule: { startAt: null, startOn: '2026-09-04', estimateMinutes: null } })] })

  const groups = selectToday(state, '2026-09-05', 'Asia/Shanghai')

  assert.deepEqual(groups[0]!.items.map(({ key, reasons }) => [key, reasons]), [['task:past-plan', ['overdue']]])
  assert.equal(groups[1]!.items.length, 0)
})

test('Upcoming is start-inclusive and end-exclusive and assigns a multi-reason task to its earliest date once', () => {
  const state = workspace({ tasks: [
    task({ id: 'before', schedule: { startAt: null, startOn: '2026-09-04', estimateMinutes: null } }),
    task({ id: 'multi', schedule: { startAt: null, startOn: '2026-09-06', estimateMinutes: null }, deadline: { dueAt: null, dueOn: '2026-09-08' } }),
    task({ id: 'last', deadline: { dueAt: null, dueOn: '2026-09-11' } }),
    task({ id: 'end', schedule: { startAt: null, startOn: '2026-09-12', estimateMinutes: null } }),
  ] })

  const groups = selectUpcoming(state, '2026-09-05', 7, 'Asia/Shanghai')

  assert.deepEqual(groups.map(({ date }) => date), ['2026-09-06', '2026-09-11'])
  assert.deepEqual(groups.flatMap(({ items }) => items).map(({ key }) => key), ['task:multi', 'task:last'])
  assert.deepEqual(groups[0]!.items[0]!.reasons, ['planned', 'due'])
})

test('Upcoming resolves timed values, DST boundaries and occurrence overrides in the requested timezone', () => {
  const state = workspace({
    tasks: [task({ id: 'series', recurrenceSeriesId: 'series:dst' })],
    recurrenceSeries: [series('series:dst', 'series', 'America/New_York')],
    occurrences: [
      occurrence({ id: 'at-start', seriesId: 'series:dst', scheduledAt: '2026-03-08T05:00:00.000Z' }),
      occurrence({ id: 'overridden', seriesId: 'series:dst', scheduledAt: '2026-03-09T04:00:00.000Z', override: { scheduledAt: '2026-03-09T03:59:59.000Z', scheduledOn: null, estimateMinutes: null } }),
      occurrence({ id: 'at-end', seriesId: 'series:dst', scheduledAt: '2026-03-09T04:00:00.000Z' }),
    ],
  })

  const groups = selectUpcoming(state, '2026-03-08', 1, 'America/New_York')

  assert.deepEqual(groups.map(({ date }) => date), ['2026-03-08'])
  assert.deepEqual(groups[0]!.items.map(({ key }) => key), ['occurrence:at-start', 'occurrence:overridden'])
  assert.deepEqual(groups[0]!.items.map(({ reasons }) => reasons), [['recurring'], ['recurring']])
})

test('occurrence overrides replace the whole schedule across date-only and timed DST forms', () => {
  const state = workspace({
    tasks: [task({ id: 'series', recurrenceSeriesId: 'series:override' })],
    recurrenceSeries: [series('series:override', 'series', 'America/New_York')],
    occurrences: [
      occurrence({
        id: 'all-to-timed', seriesId: 'series:override', ordinal: 1, scheduledOn: '2026-03-07',
        override: { scheduledAt: '2026-03-08T07:30:00.000Z', scheduledOn: null, estimateMinutes: null },
      }),
      occurrence({
        id: 'timed-to-all', seriesId: 'series:override', ordinal: 2, scheduledAt: '2026-03-08T06:30:00.000Z',
        override: { scheduledAt: null, scheduledOn: '2026-03-09', estimateMinutes: null },
      }),
    ],
  })

  const rows = selectUpcoming(state, '2026-03-08', 2, 'America/New_York').flatMap(({ items }) => items)

  assert.deepEqual(rows.map(({ key, scheduledAt, scheduledOn }) => [key, scheduledAt, scheduledOn]), [
    ['occurrence:all-to-timed', '2026-03-08T07:30:00.000Z', '2026-03-08'],
    ['occurrence:timed-to-all', null, '2026-03-09'],
  ])
})

test('one parent deadline attaches to one stable same-day occurrence without regrouping later occurrences', () => {
  const state = workspace({
    tasks: [task({ id: 'series', recurrenceSeriesId: 'series:deadline', deadline: { dueAt: null, dueOn: '2026-09-08' } })],
    recurrenceSeries: [series('series:deadline', 'series')],
    occurrences: [
      ...Array.from({ length: 7 }, (_, index) => occurrence({
        id: `occ:${index + 5}`, seriesId: 'series:deadline', ordinal: index + 1, scheduledOn: `2026-09-${String(index + 5).padStart(2, '0')}`,
      })),
      occurrence({ id: 'occ:8-second', seriesId: 'series:deadline', ordinal: 99, scheduledOn: '2026-09-08' }),
    ],
  })

  const groups = selectUpcoming(state, '2026-09-05', 7, 'Asia/Shanghai')
  const rows = groups.flatMap(({ date, items }) => items.map((item) => ({ date, ...item })))

  assert.deepEqual(groups.map(({ date }) => date), [
    '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
  ])
  assert.equal(rows.length, 8)
  assert.deepEqual(rows.filter(({ reasons }) => reasons.includes('due')).map(({ key, date }) => [key, date]), [
    ['occurrence:occ:8', '2026-09-08'],
  ])
  assert.deepEqual(rows.filter(({ key }) => key === 'occurrence:occ:9').map(({ date, dueOn, reasons }) => [date, dueOn, reasons]), [
    ['2026-09-09', null, ['recurring']],
  ])
})

test('a parent deadline without a same-day pending occurrence uses one independent task row', () => {
  const state = workspace({
    tasks: [task({ id: 'series', recurrenceSeriesId: 'series:deadline', deadline: { dueAt: null, dueOn: '2026-09-08' } })],
    recurrenceSeries: [series('series:deadline', 'series')],
    occurrences: [
      occurrence({ id: 'occ:9', seriesId: 'series:deadline', ordinal: 1, scheduledOn: '2026-09-09' }),
      occurrence({ id: 'occ:10', seriesId: 'series:deadline', ordinal: 2, scheduledOn: '2026-09-10' }),
    ],
  })

  const groups = selectUpcoming(state, '2026-09-08', 3, 'Asia/Shanghai')

  assert.deepEqual(groups.map(({ date, items }) => [date, items.map(({ key, reasons }) => [key, reasons])]), [
    ['2026-09-08', [['task:series', ['due']]]],
    ['2026-09-09', [['occurrence:occ:9', ['recurring']]]],
    ['2026-09-10', [['occurrence:occ:10', ['recurring']]]],
  ])
})

test('same-day timed projections sort by target-timezone minute instead of source offset text', () => {
  const state = workspace({ tasks: [
    task({ id: 'late', schedule: { startAt: '2026-09-05T01:00:00-04:00', startOn: null, estimateMinutes: null } }),
    task({ id: 'early', schedule: { startAt: '2026-09-05T08:00:00+08:00', startOn: null, estimateMinutes: null } }),
  ] })

  const rows = selectToday(state, '2026-09-05', 'Asia/Shanghai').flatMap(({ items }) => items)

  assert.deepEqual(rows.map(({ key }) => key), ['task:early', 'task:late'])
})

test('ambiguous DST minutes use the real instant as the stable timed tie-breaker', () => {
  const state = workspace({ tasks: [
    task({ id: 'second-0130', priority: 'high', schedule: { startAt: '2026-11-01T06:30:00.000Z', startOn: null, estimateMinutes: null } }),
    task({ id: 'first-0130', priority: 'low', schedule: { startAt: '2026-11-01T05:30:00.000Z', startOn: null, estimateMinutes: null } }),
  ] })

  const rows = selectToday(state, '2026-11-01', 'America/New_York').flatMap(({ items }) => items)

  assert.deepEqual(rows.map(({ key }) => key), ['task:first-0130', 'task:second-0130'])
})

test('projection selectors reject invalid ranges without mutating deadlines', () => {
  const state = workspace({ tasks: [task({ id: 'overdue', schedule: { startAt: null, startOn: '2026-09-01', estimateMinutes: null }, deadline: { dueAt: null, dueOn: '2026-09-02' } })] })
  const before = structuredClone(state.tasks[0]!.deadline)

  assert.throws(() => selectUpcoming(state, '2026-09-05', 0, 'Asia/Shanghai'), /positive integer/)
  selectToday(state, '2026-09-05', 'Asia/Shanghai')
  assert.deepEqual(state.tasks[0]!.deadline, before)
})

test('live Today and Upcoming consume workspace selectors and Tasks renders canonical reason groups', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const tasks = readFileSync(new URL('../src/components/study/TasksView.vue', import.meta.url), 'utf8')

  assert.match(app, /selectToday\(recurrenceWorkspace\.value, today\.value, timezone\)/)
  assert.match(app, /selectUpcoming\(recurrenceWorkspace\.value, today\.value, 7, timezone\)/)
  assert.doesNotMatch(app, /const todayProjections/)
  assert.match(app, /const filteredProjectionItems/)
  assert.match(app, /taskSort\.value !== 'manual'/)
  assert.match(tasks, /\['overdue', 'planned', 'due', 'recurring'\]/)
  for (const label of ['已过期', '已计划', '今日截止', '重复']) assert.match(tasks, new RegExp(label))
  assert.match(tasks, /props\.smartView === 'next7' \? '截止' : '今日截止'/)
})

test('the overdue command bar previews one atomic ordinary-task batch through the singleton service', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const tasks = readFileSync(new URL('../src/components/study/TasksView.vue', import.meta.url), 'utf8')
  const handler = readFileSync(new URL('../src/lib/overdue-batch-command.ts', import.meta.url), 'utf8')

  assert.match(tasks, /overdueMoveToToday/)
  assert.match(tasks, /emit\('defer', task\.id\)/)
  assert.match(tasks, /emit\('cancel', task\.id\)/)
  assert.match(app, /runOverdueBatchMove\(taskIds, today\.value/)
  assert.match(handler, /type: 'task\.batch_reschedule'/)
  assert.match(handler, /runtime\.preview\(envelope\)/)
  assert.match(handler, /runCalendarCommand/)
  assert.doesNotMatch(app, /bulkRescheduleStudyTasks\(/)
})

test('previewing an overdue move changes neither its original plan nor deadline', async () => {
  const state = parseWorkspaceStateOrMigrate(createSeedStudyState('2026-09-05T00:00:00.000Z'))
  const task = state.tasks.find(({ recurrenceSeriesId, status }) => recurrenceSeriesId === null && status !== 'completed' && status !== 'cancelled')!
  task.schedule = { startAt: null, startOn: '2026-09-03', estimateMinutes: task.schedule.estimateMinutes }
  task.deadline = { dueAt: null, dueOn: '2026-09-04' }
  const store = createInMemoryWorkspaceStore(state)
  const service = createTaskCapabilityService(store, () => '2026-09-05T01:00:00.000Z', (kind) => `${kind}:preview`)

  const preview = await service.preview({
    protocolVersion: 1, idempotencyKey: 'preview-overdue', source: 'human-ui', expectedWorkspaceRevision: state.revision,
    command: { type: 'task.batch_reschedule', taskIds: [task.id], startOn: '2026-09-05', expectedRevisions: { [task.id]: task.revision } },
  })
  const stored = (await store.load()).tasks.find(({ id }) => id === task.id)!

  assert.equal(preview.accepted, true)
  assert.deepEqual(stored.schedule, task.schedule)
  assert.deepEqual(stored.deadline, task.deadline)
})

function workspace(input: Partial<WorkspaceStateV3> = {}): WorkspaceStateV3 {
  return {
    version: 3, revision: 1, listGroups: [], lists: [], sections: [], tags: [], tasks: [], recurrenceSeries: [], occurrences: [],
    reminderRules: [], reminderDeliveries: [], studySessions: [], taskEvents: [], completionRecords: [], reviewTaskLinks: [], commandReceipts: [],
    updatedAt: '2026-09-05T00:00:00.000Z', ...input,
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task', revision: 1, mode: 'general', listId: 'list:system:learning', sectionId: null, tagIds: [], title: 'Task', notes: '', status: 'planned',
    schedule: { startAt: null, startOn: null, estimateMinutes: null }, deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [], learning: null,
    recurrenceSeriesId: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null, ...overrides,
  }
}

function series(id: string, taskId: string, timezone = 'Asia/Shanghai'): WorkspaceStateV3['recurrenceSeries'][number] {
  return { id, revision: 1, taskId, cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorAt: '2026-09-05T00:00:00.000Z', anchorOn: null, end: { kind: 'never' }, timezone, createdThrough: null, createdCount: 0 }
}

function occurrence(overrides: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return { id: 'occ', seriesId: 'series', ordinal: 1, scheduledAt: null, scheduledOn: null, status: 'pending', override: null, completedAt: null, revision: 1, ...overrides }
}
