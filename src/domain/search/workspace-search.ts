import { createTimeZoneFormatter } from '../recurrence/timezone.ts'
import { SYSTEM_LEARNING_LIST_ID } from '../workspace/migrate.ts'
import type { CompletionRecord, Task, TaskStatus, WorkspaceStateV3 } from '../workspace/types.ts'
import { compareText } from '../../lib/text-order.ts'

export type WorkspaceSearchKind = 'task' | 'completion_record'
export type WorkspaceSearchStatus = TaskStatus | 'recorded'
export type WorkspaceSearchField =
  | 'title'
  | 'notes'
  | 'acceptance_criteria'
  | 'checklist'
  | 'blocker'
  | 'topic'
  | 'tag'
  | 'learned'
  | 'evidence'
  | 'next_action'
export type WorkspaceSearchDateField = 'scheduled' | 'due' | 'completed'

export interface WorkspaceSearchQuery {
  text?: string
  kinds?: readonly WorkspaceSearchKind[]
  topicIds?: readonly (string | null)[]
  tagIds?: readonly string[]
  statuses?: readonly WorkspaceSearchStatus[]
  date?: {
    /** Inclusive local calendar date. */
    from?: string
    /** Inclusive local calendar date. */
    to?: string
    timezone: string
  }
  includeDeleted?: boolean
}

export interface WorkspaceTaskSearchHit {
  kind: 'task'
  id: string
  topicId: string | null
  tagIds: string[]
  matchedFields: WorkspaceSearchField[]
  matchedDates: WorkspaceSearchDateField[]
  task: Task
}

export interface WorkspaceCompletionSearchHit {
  kind: 'completion_record'
  id: string
  topicId: string | null
  tagIds: string[]
  matchedFields: WorkspaceSearchField[]
  matchedDates: WorkspaceSearchDateField[]
  record: CompletionRecord
}

export interface WorkspaceSearchResult {
  tasks: WorkspaceTaskSearchHit[]
  completionRecords: WorkspaceCompletionSearchHit[]
}

/**
 * Searches canonical workspace facts without mutating or reordering source data.
 * Text is deterministic NFKC case-folded substring matching; facet values within
 * one dimension use OR, while topic, tag, status, date, and text compose with AND.
 */
export function searchWorkspace(
  state: WorkspaceStateV3,
  query: WorkspaceSearchQuery,
): WorkspaceSearchResult {
  const text = normalize(query.text ?? '')
  const kinds = nonEmptySet(query.kinds)
  const topics = nonEmptySet(query.topicIds)
  const tags = nonEmptySet(query.tagIds)
  const statuses = nonEmptySet(query.statuses)
  const date = createDateMatcher(query.date)
  const listTitles = new Map(state.lists.map(({ id, title }) => [id, title]))
  const tagTitles = new Map(state.tags.map(({ id, title }) => [id, title]))

  const tasks: WorkspaceTaskSearchHit[] = []
  if (!kinds || kinds.has('task')) {
    for (const task of state.tasks) {
      if (!query.includeDeleted && task.deletedAt !== null) continue
      const topicId = task.listId === SYSTEM_LEARNING_LIST_ID ? null : task.listId
      if (topics && !topics.has(topicId)) continue
      if (statuses && !statuses.has(task.status)) continue
      if (tags && !containsEvery(task.tagIds, tags)) continue
      const matchedDates = date ? taskDateMatches(task, date) : []
      if (date && matchedDates.length === 0) continue
      const matchedFields = matchFields(text, [
        ['title', [task.title]],
        ['notes', [task.notes]],
        ['acceptance_criteria', task.learning?.acceptanceCriteria ?? []],
        ['checklist', task.checklist.map(({ text }) => text)],
        ['blocker', [task.learning?.blockedReason ?? '']],
        ['topic', [listTitles.get(task.listId) ?? '']],
        ['tag', task.tagIds.map((tagId) => tagTitles.get(tagId) ?? '')],
      ])
      if (text && matchedFields.length === 0) continue
      tasks.push({
        kind: 'task', id: task.id, topicId, tagIds: [...task.tagIds],
        matchedFields, matchedDates, task,
      })
    }
  }

  const completionRecords: WorkspaceCompletionSearchHit[] = []
  if (!kinds || kinds.has('completion_record')) {
    for (const record of state.completionRecords) {
      if (!query.includeDeleted && record.deletedAt !== null) continue
      const tagIds = recordTagIds(record)
      if (topics && !topics.has(record.topicId)) continue
      if (statuses && !statuses.has('recorded')) continue
      if (tags && !containsEvery(tagIds, tags)) continue
      const matchedDates = date?.matches(record.completedAt) ? ['completed' as const] : []
      if (date && matchedDates.length === 0) continue
      const matchedFields = matchFields(text, [
        ['title', [record.taskTitleSnapshot]],
        ['learned', [record.learned]],
        ['evidence', [record.evidence]],
        ['blocker', [record.blocker]],
        ['next_action', [record.nextAction]],
        ['topic', [listTitles.get(record.topicId ?? SYSTEM_LEARNING_LIST_ID) ?? '']],
        ['tag', tagIds.map((tagId) => tagTitles.get(tagId) ?? '')],
      ])
      if (text && matchedFields.length === 0) continue
      completionRecords.push({
        kind: 'completion_record', id: record.id, topicId: record.topicId,
        tagIds, matchedFields, matchedDates, record,
      })
    }
    completionRecords.sort((left, right) =>
      Date.parse(right.record.completedAt) - Date.parse(left.record.completedAt) ||
      compareText(left.id, right.id))
  }

  return { tasks, completionRecords }
}

type FieldValues = readonly [WorkspaceSearchField, readonly string[]]

function matchFields(query: string, fields: readonly FieldValues[]): WorkspaceSearchField[] {
  if (!query) return []
  return fields
    .filter(([, values]) => values.some((value) => normalize(value).includes(query)))
    .map(([field]) => field)
}

function taskDateMatches(task: Task, date: DateMatcher): WorkspaceSearchDateField[] {
  const matched: WorkspaceSearchDateField[] = []
  const scheduled = task.schedule.startOn ?? date.localDate(task.schedule.startAt)
  const due = task.deadline.dueOn ?? date.localDate(task.deadline.dueAt)
  if (scheduled && date.matchesDate(scheduled)) matched.push('scheduled')
  if (due && date.matchesDate(due)) matched.push('due')
  return matched
}

interface DateMatcher {
  localDate(value: string | null): string | null
  matches(value: string): boolean
  matchesDate(value: string): boolean
}

function createDateMatcher(range: WorkspaceSearchQuery['date']): DateMatcher | null {
  if (!range) return null
  if (range.from === undefined && range.to === undefined) {
    throw new Error('Workspace search date requires at least one bound.')
  }
  if (range.from !== undefined) assertDateOnly(range.from, 'from')
  if (range.to !== undefined) assertDateOnly(range.to, 'to')
  if (range.from !== undefined && range.to !== undefined && range.from > range.to) {
    throw new Error('Workspace search date must start on or before it ends.')
  }
  const format = createTimeZoneFormatter(range.timezone)
  const localDate = (value: string | null): string | null => {
    if (value === null) return null
    const instant = new Date(value)
    if (Number.isNaN(instant.getTime())) throw new Error(`Invalid datetime: ${value}`)
    return format(instant).date
  }
  const matchesDate = (value: string) =>
    (range.from === undefined || value >= range.from) &&
    (range.to === undefined || value <= range.to)
  return { localDate, matches: (value) => matchesDate(localDate(value)!), matchesDate }
}

function recordTagIds(record: CompletionRecord): string[] {
  return [...record.tagIdsSnapshot]
}

function containsEvery(values: readonly string[], required: ReadonlySet<string>): boolean {
  const available = new Set(values)
  return [...required].every((value) => available.has(value))
}

function nonEmptySet<T>(values: readonly T[] | undefined): Set<T> | null {
  return values && values.length > 0 ? new Set(values) : null
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

function assertDateOnly(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Workspace search ${label} must use YYYY-MM-DD.`)
  const [year, month, day] = value.split('-').map(Number)
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value) {
    throw new Error(`Workspace search ${label} must use YYYY-MM-DD.`)
  }
}
