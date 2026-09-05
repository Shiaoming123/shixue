import type { WorkspaceStateV3, RecurrenceSeries, TaskOccurrence } from '../workspace/types.ts'
import { MAX_PENDING_OCCURRENCES, OCCURRENCE_HORIZON_DAYS, nextAfterCompletion } from './calculate.ts'

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

  const anchor = parseZonedDateTime(series.anchorAt, series.timezone)
  const horizonDate = addCalendarDays(parseZonedDateTime(now, series.timezone).date, OCCURRENCE_HORIZON_DAYS)
  const existingById = new Map(existing.map((occurrence) => [occurrence.id, occurrence]))
  const pending = existing.filter((occurrence) => occurrence.status === 'pending')
  const created: TaskOccurrence[] = []
  let pendingCount = pending.length
  let ordinal = 1

  while (ordinal <= MAX_SEARCH_STEPS && pendingCount < MAX_PENDING_OCCURRENCES) {
    const date = occurrenceDate(series, anchor.date, ordinal)
    if (!date || date > horizonDate) break
    if (series.end.kind === 'on' && date > series.end.date) break
    const scheduledAt = zonedDateTimeToInstant(date, anchor.time, series.timezone).toISOString()
    if (new Date(scheduledAt).getTime() <= threshold.getTime()) {
      ordinal += 1
      continue
    }

    const id = occurrenceId(seriesId, ordinal)
    if (existingById.has(id)) {
      if (existingById.get(id)?.status === 'pending') pendingCount += 1
      ordinal += 1
      continue
    }

    const occurrence: TaskOccurrence = {
      id,
      seriesId,
      ordinal,
      scheduledAt,
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
  let scheduledAt: string | null
  let ordinal: number
  if (!latest) {
    scheduledAt = series.anchorAt
    ordinal = 1
  } else if (latest.status === 'completed' && latest.completedAt) {
    scheduledAt = nextAfterCompletion(series, latest.completedAt)
    ordinal = latest.ordinal + 1
  } else {
    return { state, created: [], pendingCount: existing.filter((occurrence) => occurrence.status === 'pending').length }
  }
  if (!scheduledAt || (series.end.kind === 'after' && ordinal > series.end.count)) {
    return { state, created: [], pendingCount }
  }
  if (series.end.kind === 'on' && parseZonedDateTime(scheduledAt, series.timezone).date > series.end.date) {
    return { state, created: [], pendingCount }
  }
  const occurrence: TaskOccurrence = {
    id: occurrenceId(series.id, ordinal), seriesId: series.id, ordinal, scheduledAt,
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

function parseZonedDateTime(value: string, timezone: string): { date: string; time: string } {
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid datetime: ${value}`)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function zonedDateTimeToInstant(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute))
  for (let i = 0; i < 8; i += 1) {
    const parts = parseZonedDateTime(utc.toISOString(), timezone)
    if (parts.date === date && parts.time === time) return utc
    const localMinutes = toMinuteNumber(parts.date, parts.time)
    const targetMinutes = toMinuteNumber(date, time)
    utc = new Date(utc.getTime() + (targetMinutes - localMinutes) * 60_000)
  }
  throw new Error(`Unable to resolve ${date}T${time} in ${timezone}`)
}

function toMinuteNumber(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return (((year * 12 + month) * 31 + day) * 24 * 60) + hour * 60 + minute
}

function occurrenceId(seriesId: string, ordinal: number): string {
  return `occurrence:${seriesId}:${ordinal}`
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const MAX_SEARCH_STEPS = 500
