import type {
  CompletionRecord,
  StudyTask,
} from '../storage/study/types.ts'

export type ReminderTask = Pick<
  StudyTask,
  'id' | 'status' | 'dueOn' | 'deletedAt'
> & Partial<Pick<StudyTask, 'reminderAt'>>

export type ExactReminderTask = Pick<
  StudyTask,
  'id' | 'title' | 'status' | 'reminderAt' | 'deletedAt'
>

export type ReminderReview = Pick<
  CompletionRecord,
  'id' | 'nextReviewOn' | 'deletedAt'
>

export interface StudyReminderSource {
  tasks: readonly ReminderTask[]
  completionRecords: readonly ReminderReview[]
}

export interface StudyReminders {
  tasks: ReminderTask[]
  reviews: ReminderReview[]
}

export interface StudyReminderCounts {
  dueTaskCount: number
  dueReviewCount: number
}

export interface StudyReminderNotificationCopy {
  title: string
  body: string
}

export function selectStudyReminders(
  source: StudyReminderSource,
  date: string,
): StudyReminders {
  return {
    tasks: source.tasks.filter(
      ({ status, dueOn, deletedAt }) =>
        deletedAt === null &&
        status !== 'completed' &&
        status !== 'cancelled' &&
        dueOn !== null &&
        dueOn <= date,
    ).sort((left, right) =>
      compareDateAndId(left.dueOn, left.id, right.dueOn, right.id),
    ),
    reviews: source.completionRecords.filter(
      ({ nextReviewOn, deletedAt }) =>
        deletedAt === null && nextReviewOn !== null && nextReviewOn <= date,
    ).sort((left, right) =>
      compareDateAndId(
        left.nextReviewOn,
        left.id,
        right.nextReviewOn,
        right.id,
      ),
    ),
  }
}

export function selectTaskReminderTriggers(
  tasks: readonly ExactReminderTask[],
  instant: string,
  deliveredIds: readonly string[] = [],
): ExactReminderTask[] {
  const delivered = new Set(deliveredIds)
  const instantMilliseconds = parseIsoInstant(instant, 'Reminder selection instant')
  return tasks.filter(({ id, status, reminderAt, deletedAt }) =>
    deletedAt === null &&
    status !== 'completed' &&
    status !== 'cancelled' &&
    reminderAt !== null &&
    parseIsoInstant(reminderAt, `Task ${id} reminderAt`) <= instantMilliseconds &&
    !delivered.has(id),
  ).sort((left, right) => {
    const instantOrder = parseIsoInstant(left.reminderAt, `Task ${left.id} reminderAt`) -
      parseIsoInstant(right.reminderAt, `Task ${right.id} reminderAt`)
    return instantOrder || compareStrings(left.id, right.id)
  })
}

function parseIsoInstant(value: string | null, label: string): number {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(milliseconds)) {
    throw new Error(`${label} must use an ISO datetime.`)
  }
  return milliseconds
}

function compareDateAndId(
  leftDate: string | null,
  leftId: string,
  rightDate: string | null,
  rightId: string,
): number {
  const dateOrder = compareStrings(leftDate ?? '', rightDate ?? '')
  return dateOrder || compareStrings(leftId, rightId)
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function createStudyReminderNotificationCopy(
  counts: StudyReminderCounts,
): StudyReminderNotificationCopy {
  return {
    title: '拾学提醒',
    body: `${counts.dueTaskCount} 个到期任务，${counts.dueReviewCount} 个待复习`,
  }
}
