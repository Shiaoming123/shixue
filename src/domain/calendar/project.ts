import { createTimeZoneFormatter, zonedDateTimeToInstant } from '../recurrence/timezone.ts'
import type { Task, TaskOccurrence, WorkspaceStateV3 } from '../workspace/types.ts'
import type { CalendarRange } from './range.ts'

export interface CalendarItem {
  key: string
  taskId: string
  occurrenceId: string | null
  kind: 'timed' | 'all-day' | 'deadline-marker'
  start: string
  end: string | null
  displayDate: string
  displayMinute: number | null
}

interface ZonedProjectionContext {
  displayForInstant: ReturnType<typeof createTimeZoneFormatter>
  rangeStartMs: number
  rangeEndExclusiveMs: number
}

export function projectCalendarItems(state: WorkspaceStateV3, range: CalendarRange): CalendarItem[] {
  if (range.start >= range.end) throw new Error('Calendar range must start before it ends.')

  const seriesById = new Map(state.recurrenceSeries.map((series) => [series.id, series]))
  const contextByTimezone = new Map<string, ZonedProjectionContext>()
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
    let seriesContext = series ? contextByTimezone.get(series.timezone) : undefined
    if (series && !seriesContext) {
      seriesContext = {
        displayForInstant: createTimeZoneFormatter(series.timezone),
        rangeStartMs: zonedDateTimeToInstant(range.start, '00:00', series.timezone).getTime(),
        rangeEndExclusiveMs: zonedDateTimeToInstant(range.end, '00:00', series.timezone).getTime(),
      }
      contextByTimezone.set(series.timezone, seriesContext)
    }
    const displayForInstant = seriesContext
      ? (value: string) => seriesContext.displayForInstant(new Date(value))
      : wallClockForTimestamp

    const deadline = deadlineItem(task, range, wallClockForTimestamp)
    if (deadline) items.push(deadline)

    const occurrences = occurrencesByTask.get(task.id)
    if (occurrences?.length) {
      for (const occurrence of occurrences) {
        const item = occurrenceItem(task, occurrence, range, displayForInstant, seriesContext)
        if (item) items.push(item)
      }
    } else if (task.recurrenceSeriesId === null) {
      const item = scheduledItem(`task:${task.id}`, null, task.schedule.startAt, task.schedule.startOn, task.schedule.estimateMinutes, range, wallClockForTimestamp, task.id)
      if (item) items.push(item)
    }
  }
  return items.map((item) => {
    const start = Date.parse(item.start)
    return { item, start, duration: item.end === null ? 0 : Date.parse(item.end) - start }
  }).sort(compareItems).map(({ item }) => item)
}

function occurrenceItem(
  task: Task,
  occurrence: TaskOccurrence,
  range: CalendarRange,
  displayForInstant: (value: string) => { date: string; time: string },
  context: ZonedProjectionContext | undefined,
): CalendarItem | null {
  if (occurrence.status === 'cancelled') return null
  const schedule = occurrence.override ?? {
    scheduledAt: occurrence.scheduledAt,
    scheduledOn: occurrence.scheduledOn,
    estimateMinutes: task.schedule.estimateMinutes,
  }
  if (schedule.scheduledOn === null && schedule.scheduledAt !== null && schedule.estimateMinutes !== null && context) {
    const scheduledMs = Date.parse(schedule.scheduledAt)
    if (!Number.isNaN(scheduledMs) && (scheduledMs < context.rangeStartMs || scheduledMs >= context.rangeEndExclusiveMs)) return null
  }
  return scheduledItem(
    `occurrence:${occurrence.id}`,
    occurrence.id,
    schedule.scheduledAt,
    schedule.scheduledOn,
    schedule.estimateMinutes,
    range,
    displayForInstant,
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
  displayForInstant: (value: string) => { date: string; time: string },
  taskId = key.slice('task:'.length),
): CalendarItem | null {
  if (startOn !== null && inRange(startOn, range)) {
    return { key, taskId, occurrenceId, kind: 'all-day', start: startOn, end: null, displayDate: startOn, displayMinute: null }
  }
  if (startAt === null || estimateMinutes === null) return null
  const display = displayForInstant(startAt)
  if (!inRange(display.date, range)) return null
  const end = new Date(Date.parse(startAt) + estimateMinutes * 60_000)
  if (Number.isNaN(end.getTime())) throw new Error(`Invalid calendar datetime: ${startAt}`)
  return { key, taskId, occurrenceId, kind: 'timed', start: startAt, end: end.toISOString(), displayDate: display.date, displayMinute: minuteForTime(display.time) }
}

function deadlineItem(task: Task, range: CalendarRange, displayForInstant: (value: string) => { date: string; time: string }): CalendarItem | null {
  const start = task.deadline.dueOn ?? task.deadline.dueAt
  if (start === null) return null
  const display = task.deadline.dueOn === null ? displayForInstant(task.deadline.dueAt!) : null
  const displayDate = task.deadline.dueOn ?? display!.date
  if (!inRange(displayDate, range)) return null
  return {
    key: `deadline:${task.id}`, taskId: task.id, occurrenceId: null,
    kind: 'deadline-marker', start, end: null,
    displayDate, displayMinute: display ? minuteForTime(display.time) : null,
  }
}

function wallClockForTimestamp(value: string): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match || Number.isNaN(Date.parse(value))) throw new Error(`Invalid calendar datetime: ${value}`)
  return { date: match[1]!, time: `${match[2]}:${match[3]}` }
}

function minuteForTime(value: string): number {
  const hour = (value.charCodeAt(0) - 48) * 10 + value.charCodeAt(1) - 48
  const minute = (value.charCodeAt(3) - 48) * 10 + value.charCodeAt(4) - 48
  return (hour === 24 ? 0 : hour) * 60 + minute
}

function inRange(date: string, range: CalendarRange): boolean {
  return date >= range.start && date < range.end
}

function compareItems(
  left: { item: CalendarItem; start: number; duration: number },
  right: { item: CalendarItem; start: number; duration: number },
): number {
  const byStart = left.start - right.start
  if (byStart !== 0) return byStart
  return right.duration - left.duration || left.item.key.localeCompare(right.item.key)
}
