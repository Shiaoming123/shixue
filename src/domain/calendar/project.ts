import { createTimeZoneFormatter } from '../recurrence/timezone.ts'
import type { Task, TaskOccurrence, WorkspaceStateV3 } from '../workspace/types.ts'
import type { CalendarRange } from './range.ts'

export interface CalendarItem {
  key: string
  taskId: string
  occurrenceId: string | null
  kind: 'timed' | 'all-day' | 'deadline-marker'
  start: string
  end: string | null
}

export function projectCalendarItems(state: WorkspaceStateV3, range: CalendarRange): CalendarItem[] {
  if (range.start >= range.end) throw new Error('Calendar range must start before it ends.')

  const seriesById = new Map(state.recurrenceSeries.map((series) => [series.id, series]))
  const occurrencesByTask = new Map<string, TaskOccurrence[]>()
  for (const occurrence of state.occurrences) {
    const taskId = seriesById.get(occurrence.seriesId)?.taskId
    if (!taskId) continue
    const occurrences = occurrencesByTask.get(taskId) ?? []
    occurrences.push(occurrence)
    occurrencesByTask.set(taskId, occurrences)
  }

  const items: CalendarItem[] = []
  for (const task of state.tasks) {
    if (task.deletedAt !== null || task.status === 'cancelled') continue
    const series = task.recurrenceSeriesId === null ? undefined : seriesById.get(task.recurrenceSeriesId)
    const dateForInstant = series ? createTimeZoneFormatter(series.timezone) : undefined

    const deadline = deadlineItem(task, range, dateForInstant ? (value) => dateForInstant(new Date(value)).date : datePart)
    if (deadline) items.push(deadline)

    const occurrences = occurrencesByTask.get(task.id)
    if (occurrences?.length) {
      for (const occurrence of occurrences) {
        const item = occurrenceItem(task, occurrence, range, dateForInstant ? (value) => dateForInstant(new Date(value)).date : datePart)
        if (item) items.push(item)
      }
    } else if (task.recurrenceSeriesId === null) {
      const item = scheduledItem(`task:${task.id}`, null, task.schedule.startAt, task.schedule.startOn, task.schedule.estimateMinutes, range, datePart, task.id)
      if (item) items.push(item)
    }
  }
  return items.sort(compareItems)
}

function occurrenceItem(
  task: Task,
  occurrence: TaskOccurrence,
  range: CalendarRange,
  dateForInstant: (value: string) => string,
): CalendarItem | null {
  if (occurrence.status === 'cancelled') return null
  return scheduledItem(
    `occurrence:${occurrence.id}`,
    occurrence.id,
    occurrence.override?.scheduledAt ?? occurrence.scheduledAt,
    occurrence.override?.scheduledOn ?? occurrence.scheduledOn,
    occurrence.override?.estimateMinutes ?? task.schedule.estimateMinutes,
    range,
    dateForInstant,
    task.id,
  )
}

function scheduledItem(
  key: string,
  occurrenceId: string | null,
  startAt: string | null,
  startOn: string | null,
  estimateMinutes: number | null,
  range: CalendarRange,
  dateForInstant: (value: string) => string,
  taskId = key.slice('task:'.length),
): CalendarItem | null {
  if (startOn !== null && inRange(startOn, range)) {
    return { key, taskId, occurrenceId, kind: 'all-day', start: startOn, end: null }
  }
  if (startAt === null || estimateMinutes === null || !inRange(dateForInstant(startAt), range)) return null
  const end = new Date(Date.parse(startAt) + estimateMinutes * 60_000)
  if (Number.isNaN(end.getTime())) throw new Error(`Invalid calendar datetime: ${startAt}`)
  return { key, taskId, occurrenceId, kind: 'timed', start: startAt, end: end.toISOString() }
}

function deadlineItem(task: Task, range: CalendarRange, dateForInstant: (value: string) => string): CalendarItem | null {
  const start = task.deadline.dueOn ?? task.deadline.dueAt
  if (start === null) return null
  const date = task.deadline.dueOn ?? dateForInstant(task.deadline.dueAt!)
  if (!inRange(date, range)) return null
  return { key: `deadline:${task.id}`, taskId: task.id, occurrenceId: null, kind: 'deadline-marker', start, end: null }
}

function datePart(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new Error(`Invalid calendar datetime: ${value}`)
  return value.slice(0, 10)
}

function inRange(date: string, range: CalendarRange): boolean {
  return date >= range.start && date < range.end
}

function compareItems(left: CalendarItem, right: CalendarItem): number {
  const byStart = left.start.localeCompare(right.start)
  if (byStart !== 0) return byStart
  const leftDuration = duration(left)
  const rightDuration = duration(right)
  return rightDuration - leftDuration || left.key.localeCompare(right.key)
}

function duration(item: CalendarItem): number {
  if (item.end === null) return 0
  return Date.parse(item.end) - Date.parse(item.start)
}
