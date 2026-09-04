import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStudyReminderNotificationCopy,
  selectStudyReminders,
  selectTaskReminderTriggers,
} from '../src/lib/study-reminders.ts'

test('selects tasks and completion reviews due on the injected date', () => {
  const result = selectStudyReminders(
    {
      tasks: [
        { id: 'task-1', status: 'planned', dueOn: '2026-09-04', deletedAt: null },
      ],
      completionRecords: [
        { id: 'review-1', nextReviewOn: '2026-09-04', deletedAt: null },
      ],
    },
    '2026-09-04',
  )

  assert.deepEqual(result.tasks.map(({ id }) => id), ['task-1'])
  assert.deepEqual(result.reviews.map(({ id }) => id), ['review-1'])
})

test('keeps overdue actionable work and excludes completed, cancelled, deleted, and future items', () => {
  const result = selectStudyReminders(
    {
      tasks: [
        { id: 'overdue', status: 'in_progress', dueOn: '2026-09-03', deletedAt: null },
        { id: 'completed', status: 'completed', dueOn: '2026-09-04', deletedAt: null },
        { id: 'cancelled', status: 'cancelled', dueOn: '2026-09-04', deletedAt: null },
        { id: 'deleted', status: 'planned', dueOn: '2026-09-04', deletedAt: '2026-09-04T01:00:00.000Z' },
        { id: 'future', status: 'planned', dueOn: '2026-09-05', deletedAt: null },
        { id: 'unscheduled', status: 'planned', dueOn: null, deletedAt: null },
      ],
      completionRecords: [
        { id: 'overdue-review', nextReviewOn: '2026-09-02', deletedAt: null },
        { id: 'deleted-review', nextReviewOn: '2026-09-04', deletedAt: '2026-09-04T01:00:00.000Z' },
        { id: 'future-review', nextReviewOn: '2026-09-05', deletedAt: null },
        { id: 'finished-review', nextReviewOn: null, deletedAt: null },
      ],
    },
    '2026-09-04',
  )

  assert.deepEqual(result.tasks.map(({ id }) => id), ['overdue'])
  assert.deepEqual(result.reviews.map(({ id }) => id), ['overdue-review'])
})

test('sorts reminders by due date and then stable id without relying on input order', () => {
  const result = selectStudyReminders(
    {
      tasks: [
        { id: 'task-ä', status: 'planned', dueOn: '2026-09-04', deletedAt: null },
        { id: 'task-b', status: 'planned', dueOn: '2026-09-04', deletedAt: null },
        { id: 'task-c', status: 'planned', dueOn: '2026-09-03', deletedAt: null },
        { id: 'task-a', status: 'planned', dueOn: '2026-09-04', deletedAt: null },
        { id: 'task-z', status: 'planned', dueOn: '2026-09-04', deletedAt: null },
      ],
      completionRecords: [
        { id: 'review-b', nextReviewOn: '2026-09-04', deletedAt: null },
        { id: 'review-c', nextReviewOn: '2026-09-02', deletedAt: null },
        { id: 'review-a', nextReviewOn: '2026-09-04', deletedAt: null },
      ],
    },
    '2026-09-04',
  )

  assert.deepEqual(result.tasks.map(({ id }) => id), [
    'task-c',
    'task-a',
    'task-b',
    'task-z',
    'task-ä',
  ])
  assert.deepEqual(result.reviews.map(({ id }) => id), ['review-c', 'review-a', 'review-b'])
})

test('builds privacy-safe notification copy from counts only', () => {
  assert.deepEqual(
    createStudyReminderNotificationCopy({
      dueTaskCount: 2,
      dueReviewCount: 1,
    }),
    {
      title: '拾学提醒',
      body: '2 个到期任务，1 个待复习',
    },
  )
})

test('selects exact task reminders due by an injected instant and excludes delivered or inactive tasks', () => {
  const tasks = [
    { id: 'due', status: 'planned' as const, reminderAt: '2026-09-04T08:00:00.000Z', deletedAt: null },
    { id: 'delivered', status: 'inbox' as const, reminderAt: '2026-09-04T07:00:00.000Z', deletedAt: null },
    { id: 'future', status: 'planned' as const, reminderAt: '2026-09-04T08:00:01.000Z', deletedAt: null },
    { id: 'completed', status: 'completed' as const, reminderAt: '2026-09-04T07:00:00.000Z', deletedAt: null },
    { id: 'cancelled', status: 'cancelled' as const, reminderAt: '2026-09-04T07:00:00.000Z', deletedAt: null },
    { id: 'deleted', status: 'planned' as const, reminderAt: '2026-09-04T07:00:00.000Z', deletedAt: '2026-09-04T07:30:00.000Z' },
    { id: 'unset', status: 'planned' as const, reminderAt: null, deletedAt: null },
  ]

  assert.deepEqual(
    selectTaskReminderTriggers(tasks, '2026-09-04T08:00:00.000Z', ['delivered']).map(({ id }) => id),
    ['due'],
  )
})

test('compares exact reminder instants chronologically across ISO offsets', () => {
  const tasks = [
    { id: 'same-instant', status: 'planned' as const, reminderAt: '2026-09-04T16:00:00+08:00', deletedAt: null },
    { id: 'future', status: 'planned' as const, reminderAt: '2026-09-04T08:00:01.000Z', deletedAt: null },
  ]
  assert.deepEqual(
    selectTaskReminderTriggers(tasks, '2026-09-04T08:00:00.000Z').map(({ id }) => id),
    ['same-instant'],
  )
})
