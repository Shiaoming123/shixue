import type { WorkspaceStateV3, RecurrenceSeries, TaskOccurrence } from '../workspace/types.ts'
import { MAX_PENDING_OCCURRENCES, OCCURRENCE_HORIZON_DAYS, nextAfterCompletion } from './calculate.ts'
import { parseZonedDateTime, zonedDateTimeToInstant } from './timezone.ts'

export interface MaterializeResult {
  state: WorkspaceStateV3
  created: TaskOccurrence[]
  pendingCount: number
}

export function materializeOccurrenceWindow(
  state: WorkspaceStateV3,
  seriesId: string,
  now: string,
): MaterializeResult {
  const series = state.recurrenceSeries.find((entry) => entry.id === seriesId)
  if (!series) throw new Error(`Unknown recurrence series: ${seriesId}`)
  const threshold = new Date(now)
  if (Number.isNaN(threshold.getTime())) throw new Error(`Invalid datetime: ${now}`)

  const existing = state.occurrences.filter((occurrence) => occurrence.seriesId === seriesId)
  if (series.basis === 'after_completion') return materializeAfterCompletion(state, series, existing, now)

  const timed = series.anchorAt !== null
  const anchor = timed ? parseZonedDateTime(series.anchorAt!, series.timezone) : { date: series.anchorOn!, time: '' }
  const thresholdDate = parseZonedDateTime(now, series.timezone).date
  const horizonDate = addCalendarDays(parseZonedDateTime(now, series.timezone).date, OCCURRENCE_HORIZON_DAYS)
  const existingById = new Map(existing.map((occurrence) => [occurrence.id, occurrence]))
  const pending = existing.filter((occurrence) => occurrence.status === 'pending')
  const created: TaskOccurrence[] = []
  let pendingCount = pending.length
  let ordinal = 1

  while (ordinal <= MAX_SEARCH_STEPS && pendingCount < MAX_PENDING_OCCURRENCES) {
    if (series.end.kind === 'after' && ordinal > series.end.count) break
    const date = occurrenceDate(series, anchor.date, ordinal)
    if (!date || date > horizonDate) break
    if (series.end.kind === 'on' && date > series.end.date) break
    const scheduledAt = timed ? zonedDateTimeToInstant(date, anchor.time, series.timezone).toISOString() : null
    const scheduledOn = timed ? null : date
    if (timed ? new Date(scheduledAt!).getTime() <= threshold.getTime() : date <= thresholdDate) {
      ordinal += 1
      continue
    }

    const id = occurrenceId(seriesId, ordinal)
    if (existingById.has(id)) {
      ordinal += 1
      continue
    }

    const occurrence: TaskOccurrence = {
      id,
      seriesId,
      ordinal,
      scheduledAt,
      scheduledOn,
      status: 'pending',
      override: null,
      completedAt: null,
      revision: series.revision,
    }
    created.push(occurrence)
    pendingCount += 1
    ordinal += 1
  }

  if (created.length === 0) return { state, created, pendingCount }

  const nextState: WorkspaceStateV3 = {
    ...state,
    revision: state.revision + 1,
    occurrences: [...state.occurrences, ...created].sort((left, right) => left.seriesId.localeCompare(right.seriesId) || left.ordinal - right.ordinal || left.id.localeCompare(right.id)),
    updatedAt: now,
  }

  return { state: nextState, created, pendingCount }
}

function materializeAfterCompletion(
  state: WorkspaceStateV3,
  series: RecurrenceSeries,
  existing: TaskOccurrence[],
  now: string,
): MaterializeResult {
  const pendingCount = existing.filter((occurrence) => occurrence.status === 'pending').length
  if (pendingCount >= MAX_PENDING_OCCURRENCES) return { state, created: [], pendingCount }
  const latest = [...existing].sort((left, right) => right.ordinal - left.ordinal)[0]
  let schedule: { scheduledAt: string | null; scheduledOn: string | null }
  let ordinal: number
  if (!latest) {
    schedule = { scheduledAt: series.anchorAt, scheduledOn: series.anchorOn }
    ordinal = 1
  } else if (latest.status === 'completed' && latest.completedAt) {
    const next = nextAfterCompletion(series, latest.completedAt)
    schedule = /^\d{4}-\d{2}-\d{2}$/.test(next ?? '')
      ? { scheduledAt: null, scheduledOn: next }
      : { scheduledAt: next, scheduledOn: null }
    ordinal = latest.ordinal + 1
  } else {
    return { state, created: [], pendingCount: existing.filter((occurrence) => occurrence.status === 'pending').length }
  }
  const scheduled = schedule.scheduledOn ?? schedule.scheduledAt
  if (!scheduled || (series.end.kind === 'after' && ordinal > series.end.count)) {
    return { state, created: [], pendingCount }
  }
  const scheduledDate = schedule.scheduledOn ?? parseZonedDateTime(schedule.scheduledAt!, series.timezone).date
  if (series.end.kind === 'on' && scheduledDate > series.end.date) {
    return { state, created: [], pendingCount }
  }
  const occurrence: TaskOccurrence = {
    id: occurrenceId(series.id, ordinal), seriesId: series.id, ordinal, ...schedule,
    status: 'pending', override: null, completedAt: null, revision: series.revision,
  }
  const nextState: WorkspaceStateV3 = {
    ...state, revision: state.revision + 1, occurrences: [...state.occurrences, occurrence], updatedAt: now,
  }
  return { state: nextState, created: [occurrence], pendingCount: pendingCount + 1 }
}

function occurrenceDate(series: RecurrenceSeries, anchorDate: string, ordinal: number): string | null {
  const offset = ordinal - 1
  if (series.cadence.kind === 'daily') return addCalendarDays(anchorDate, offset * series.cadence.interval)
  if (series.cadence.kind === 'weekly') return weeklyDate(anchorDate, series.cadence.interval, series.cadence.weekdays, offset)
  if (series.cadence.kind === 'monthly') return addCalendarMonths(anchorDate, offset * series.cadence.interval, series.cadence.dayOfMonth)
  return addCalendarYears(anchorDate, offset * series.cadence.interval, series.cadence.month, series.cadence.dayOfMonth)
}

function weeklyDate(anchorDate: string, interval: number, weekdays: readonly number[], offset: number): string | null {
  let seen = 0
  for (let dayOffset = 0; dayOffset <= MAX_SEARCH_STEPS * 7; dayOffset += 1) {
    const date = addCalendarDays(anchorDate, dayOffset)
    if (Math.floor(dayOffset / 7) % interval !== 0) continue
    if (!weekdays.includes(weekdayOf(date))) continue
    if (seen === offset) return date
    seen += 1
  }
  return null
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function addCalendarMonths(date: string, months: number, dayOfMonth: number): string {
  const [year, month] = date.split('-').map(Number)
  const totalMonths = year * 12 + (month - 1) + months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = (totalMonths % 12) + 1
  return formatDate(targetYear, targetMonth, Math.min(dayOfMonth, daysInMonth(targetYear, targetMonth)))
}

function addCalendarYears(date: string, years: number, month: number, dayOfMonth: number): string {
  const [year] = date.split('-').map(Number)
  const targetYear = year + years
  return formatDate(targetYear, month, Math.min(dayOfMonth, daysInMonth(targetYear, month)))
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function occurrenceId(seriesId: string, ordinal: number): string {
  return `occurrence:${seriesId}:${ordinal}`
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const MAX_SEARCH_STEPS = 500
