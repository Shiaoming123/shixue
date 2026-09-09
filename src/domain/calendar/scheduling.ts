import type { BusyResult } from '../../calendar-connections/types.ts'
import { addCalendarDays, MAX_PENDING_OCCURRENCES, OCCURRENCE_HORIZON_DAYS, nextFixedOccurrence } from '../recurrence/calculate.ts'
import { materializeOccurrenceWindow } from '../recurrence/materialize.ts'
import { assertIanaTimezone, parseZonedDateTime, zonedDateTimeToInstant } from '../recurrence/timezone.ts'
import type { Task, WorkspaceStateV4 } from '../workspace/types.ts'
import { expandCalendarEventOccurrences } from './event-occurrences.ts'
import type { CalendarRange } from './range.ts'

export interface TimeInterval { startAt: string; endAt: string }
export interface WorkingHours { weekdays: number[]; startMinute: number; endMinute: number }
export interface ScheduleQuery {
  taskId: string
  range: CalendarRange
  timezone: string
  now: string
  workingHours: WorkingHours[]
  lockedIntervals: TimeInterval[]
  externalBusy?: BusyResult[]
  requiredExternalCalendarIds?: string[]
  maxCandidates?: number
}
export type ScheduleReason = 'task-unavailable' | 'already-scheduled' | 'recurring-task' | 'missing-estimate' | 'invalid-estimate' | 'deadline-passed' | 'outside-working-hours' | 'insufficient-capacity' | 'availability-unknown'
export interface ScheduleSuggestion {
  taskId: string; taskRevision: number | null; workspaceRevision: number; availabilityFingerprint: string
  candidates: Array<TimeInterval & { estimateMinutes: number }>
  reason: ScheduleReason | null
}

/** Current plan facts only; no generated/persisted task occurrences. */
export function calendarTaskPlans(state: WorkspaceStateV4) {
  return state.tasks.filter((task) => task.deletedAt === null && task.status !== 'cancelled').flatMap((task) => {
    if (!task.recurrenceSeriesId) return [{ task, occurrenceId: null as string | null, startAt: task.schedule.startAt, startOn: task.schedule.startOn, estimateMinutes: task.schedule.estimateMinutes, status: task.status as string, completedAt: null as string | null }]
    return state.occurrences.filter((item) => item.seriesId === task.recurrenceSeriesId && item.status !== 'cancelled').map((item) => ({ task, occurrenceId: item.id, startAt: item.override?.scheduledAt ?? (item.override ? null : item.scheduledAt), startOn: item.override?.scheduledOn ?? (item.override ? null : item.scheduledOn), estimateMinutes: item.override ? item.override.estimateMinutes : task.schedule.estimateMinutes, status: item.status as string, completedAt: item.completedAt }))
  })
}

export function collectSchedulingBusyIntervals(state: WorkspaceStateV4, range: CalendarRange, timezone: string, excludeTaskId?: string) {
  const bounds = schedulingRangeBounds(range, timezone)
  const intervals: TimeInterval[] = []
  const unknownTaskIds: string[] = []
  let projected = state
  const threshold = new Date(bounds.start - 86_400_000 - 1).toISOString()
  for (const task of state.tasks) {
    if (!task.recurrenceSeriesId || task.deletedAt || task.status === 'cancelled' || task.id === excludeTaskId) continue
    const series = state.recurrenceSeries.find(({ id }) => id === task.recurrenceSeriesId)
    if (!series) { unknownTaskIds.push(task.id); continue }
    if (!series.anchorAt) continue
    const materialized = materializeOccurrenceWindow(projected, series.id, threshold)
    projected = materialized.state
    if (series.basis === 'after_completion') continue
    const horizon = addCalendarDays(parseZonedDateTime(threshold, series.timezone).date, OCCURRENCE_HORIZON_DAYS)
    const endDate = parseZonedDateTime(new Date(bounds.end).toISOString(), series.timezone).date
    const endedBefore = series.end.kind === 'on' && series.end.date < parseZonedDateTime(threshold, series.timezone).date
    const createdThrough = Math.max(...materialized.created.map((item) => Date.parse(item.scheduledAt!)), -Infinity)
    const cappedBeforeEnd = materialized.pendingCount >= MAX_PENDING_OCCURRENCES && createdThrough < bounds.end
    if (!endedBefore && (endDate > horizon || cappedBeforeEnd || nextFixedOccurrence(series, new Date(bounds.end).toISOString()) === null)) unknownTaskIds.push(task.id)
  }
  for (const plan of calendarTaskPlans(projected)) {
    if (plan.task.id === excludeTaskId || !plan.startAt || plan.status === 'skipped') continue
    if (plan.estimateMinutes === null) {
      // The domain duration ceiling is one day; an unestimated prior-day box may overlap.
      if (Date.parse(plan.startAt) < bounds.end && Date.parse(plan.startAt) + 86_400_000 > bounds.start) unknownTaskIds.push(plan.task.id)
      continue
    }
    intervals.push({ startAt: plan.startAt, endAt: new Date(Date.parse(plan.startAt) + plan.estimateMinutes * 60_000).toISOString() })
  }
  const activeSources = new Set(state.calendarSources.filter((source) => source.archivedAt === null).map(({ id }) => id))
  for (const event of state.calendarEvents) {
    if (!activeSources.has(event.sourceId) || event.availability === 'free') continue
    for (const occurrence of expandCalendarEventOccurrences(event, range, timezone)) {
      const time = occurrence.time
      if (time.kind === 'fixed') intervals.push({ startAt: time.startAt, endAt: time.endAt })
      else if (time.kind === 'all-day') intervals.push({ startAt: zonedDateTimeToInstant(time.startOn, '00:00', timezone).toISOString(), endAt: zonedDateTimeToInstant(time.endOnExclusive, '00:00', timezone).toISOString() })
      else intervals.push({ startAt: zonedDateTimeToInstant(time.startLocal.slice(0, 10), time.startLocal.slice(11), timezone).toISOString(), endAt: zonedDateTimeToInstant(time.endLocal.slice(0, 10), time.endLocal.slice(11), timezone).toISOString() })
    }
  }
  return { intervals: intervals.filter((entry) => Date.parse(entry.startAt) < bounds.end && Date.parse(entry.endAt) > bounds.start), unknownTaskIds: [...new Set(unknownTaskIds)].sort() }
}

export async function suggestTaskSchedule(state: WorkspaceStateV4, query: ScheduleQuery): Promise<ScheduleSuggestion> {
  const bounds = schedulingRangeBounds(query.range, query.timezone)
  const now = instant(query.now)
  const max = query.maxCandidates ?? 5
  if (query.lockedIntervals.length > 10_000 || (query.externalBusy?.length ?? 0) > 1000 || (query.externalBusy ?? []).reduce((total, entry) => total + entry.intervals.length, 0) > 10_000) throw new Error('Too many availability intervals')
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error('Schedule candidate limit must be 1–20')
  if (query.workingHours.length > 50) throw new Error('Too many working hour intervals')
  const hours = query.workingHours.map((entry) => {
    if (!Number.isInteger(entry.startMinute) || !Number.isInteger(entry.endMinute) || entry.startMinute < 0 || entry.endMinute > 1440 || entry.startMinute >= entry.endMinute || !entry.weekdays.length || entry.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Invalid working hours')
    return { weekdays: [...new Set(entry.weekdays)].sort(), startMinute: entry.startMinute, endMinute: entry.endMinute }
  }).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.weekdays.join().localeCompare(b.weekdays.join()))
  const local = collectSchedulingBusyIntervals(state, query.range, query.timezone, query.taskId)
  const external = [...(query.externalBusy ?? [])].sort((a, b) => a.calendarId.localeCompare(b.calendarId))
  const required = [...new Set([...(query.requiredExternalCalendarIds ?? []), ...state.calendarSources.filter((source) => source.archivedAt === null && source.provider !== 'local').map(({ id }) => id)])].sort()
  const externalIdentity = (entry: BusyResult) => entry.sourceId ?? entry.calendarId
  let unknown = local.unknownTaskIds.length > 0 || new Set(external.map(externalIdentity)).size !== external.length || required.some((id) => !external.some((entry) => externalIdentity(entry) === id || entry.calendarId === id))
  const externalFacts = external.map((entry) => {
    let fresh = false
    try { fresh = entry.error === null && instant(entry.startAt) <= bounds.start && instant(entry.endAt) >= bounds.end && instant(entry.fetchedAt) <= now && now < instant(entry.expiresAt) } catch { /* Invalid coverage is unknown, never free. */ }
    if (!fresh) unknown = true
    return { calendarId: entry.calendarId, sourceId: entry.sourceId ?? null, startAt: entry.startAt, endAt: entry.endAt, fetchedAt: entry.fetchedAt, expiresAt: entry.expiresAt, error: entry.error, fresh }
  })
  const busy = [...local.intervals, ...query.lockedIntervals, ...external.flatMap((entry) => entry.intervals)].map((entry) => {
    const start = instant(entry.startAt), end = instant(entry.endAt)
    if (end <= start) throw new Error('Busy interval end must follow start')
    return [start, end] as const
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const task = state.tasks.find(({ id }) => id === query.taskId)
  const locked = query.lockedIntervals.map((entry) => [instant(entry.startAt), instant(entry.endAt)]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!)
  const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ range: { start: query.range.start, end: query.range.end }, timezone: query.timezone, hours, busy, locked, externalFacts, required, unknownTaskIds: local.unknownTaskIds, task: task ? [task.id, task.revision, task.priority, task.schedule, task.deadline] : null })))
  const result: ScheduleSuggestion = { taskId: query.taskId, taskRevision: task?.revision ?? null, workspaceRevision: state.revision, availabilityFingerprint: [...new Uint8Array(fingerprint)].map((value) => value.toString(16).padStart(2, '0')).join(''), candidates: [], reason: null }
  const reject = (reason: ScheduleReason) => ({ ...result, candidates: [], reason })
  if (!task || task.deletedAt || ['completed', 'cancelled', 'blocked', 'in_progress'].includes(task.status)) return reject('task-unavailable')
  if (task.recurrenceSeriesId) return reject('recurring-task')
  if (task.schedule.startAt) return reject('already-scheduled')
  const minutes = task.schedule.estimateMinutes
  if (minutes === null) return reject('missing-estimate')
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440 || minutes % 5 !== 0) return reject('invalid-estimate')
  if (unknown) return reject('availability-unknown')
  const deadline = taskDeadline(task, query.timezone)
  if (deadline <= Math.max(now, bounds.start)) return reject('deadline-passed')
  const seen = new Set<number>()
  let hasWorkingWindow = false
  for (let date = query.range.start; date < query.range.end; date = addCalendarDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    for (const hoursOnDay of hours.filter((entry) => entry.weekdays.includes(weekday))) {
      hasWorkingWindow = true
      const finish = wallInstant(date, hoursOnDay.endMinute, query.timezone)
      if (finish === null) return reject('availability-unknown')
      for (let minute = Math.ceil(hoursOnDay.startMinute / 15) * 15; minute < hoursOnDay.endMinute; minute += 15) {
        const start = wallInstant(date, minute, query.timezone)
        if (start === null || start < now || seen.has(start)) continue
        const end = start + minutes * 60_000
        if (end > finish || end > deadline || end > bounds.end || busy.some(([a, b]) => start < b && end > a)) continue
        seen.add(start)
        result.candidates.push({ startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), estimateMinutes: minutes })
      }
    }
  }
  result.candidates.sort((a, b) => a.startAt.localeCompare(b.startAt))
  result.candidates = result.candidates.slice(0, max)
  if (!result.candidates.length) result.reason = hasWorkingWindow ? 'insufficient-capacity' : 'outside-working-hours'
  return result
}

export function schedulingRangeBounds(range: CalendarRange, timezone: string) {
  assertIanaTimezone(timezone)
  for (const date of [range.start, range.end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid schedule range date')
  }
  const days = (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000
  if (days <= 0 || days > 366) throw new Error('Schedule range must span 1–366 days')
  return { start: zonedDateTimeToInstant(range.start, '00:00', timezone).getTime(), end: zonedDateTimeToInstant(range.end, '00:00', timezone).getTime() }
}
function wallInstant(date: string, minute: number, timezone: string) {
  if (minute === 1440) return zonedDateTimeToInstant(addCalendarDays(date, 1), '00:00', timezone).getTime()
  const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const instant = zonedDateTimeToInstant(date, time, timezone)
  const actual = parseZonedDateTime(instant.toISOString(), timezone)
  return actual.date === date && actual.time === time ? instant.getTime() : null
}
function instant(value: string) {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid schedule instant')
  return Date.parse(value)
}
function taskDeadline(task: Task, timezone: string) {
  return task.deadline.dueAt ? instant(task.deadline.dueAt) : task.deadline.dueOn ? zonedDateTimeToInstant(addCalendarDays(task.deadline.dueOn, 1), '00:00', timezone).getTime() : Infinity
}
