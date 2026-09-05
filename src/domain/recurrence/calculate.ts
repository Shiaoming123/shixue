import type { RecurrenceSeries } from '../workspace/types.ts'
import { assertIanaTimezone, parseZonedDateTime, zonedDateTimeToInstant } from './timezone.ts'

export function nextFixedOccurrence(series: RecurrenceSeries, after: string): string | null {
  return nextOccurrence(series, after, false)
}

export function nextAfterCompletion(series: RecurrenceSeries, completedAt: string): string | null {
  assertIanaTimezone(series.timezone)
  const completion = parseZonedDateTime(completedAt, series.timezone)
  const date = afterCompletionDate(series, completion.date)
  if (series.end.kind === 'on' && date > series.end.date) return null
  if (series.anchorOn != null) return date
  return zonedDateTimeToInstant(date, completion.time, series.timezone).toISOString()
}

function nextOccurrence(series: RecurrenceSeries, thresholdIso: string, strictAfter: boolean): string | null {
  assertIanaTimezone(series.timezone)
  const dateOnly = series.anchorOn != null
  const threshold = dateOnly ? null : new Date(thresholdIso)
  if (!dateOnly && Number.isNaN(threshold!.getTime())) throw new Error(`Invalid datetime: ${thresholdIso}`)
  const thresholdDate = /^\d{4}-\d{2}-\d{2}$/.test(thresholdIso)
    ? thresholdIso
    : parseZonedDateTime(thresholdIso, series.timezone).date
  const timedAnchor = dateOnly ? null : parseZonedDateTime(series.anchorAt!, series.timezone)
  const anchor: { date: string; time: string | null } = dateOnly
    ? { date: series.anchorOn!, time: null }
    : timedAnchor!
  const limit = series.end.kind === 'after' ? series.end.count : MAX_SEARCH_STEPS

  if (series.cadence.kind === 'daily') {
    for (let occurrence = 1; occurrence <= limit; occurrence += 1) {
      const date = addCalendarDays(anchor.date, (occurrence - 1) * series.cadence.interval)
      if (series.end.kind === 'on' && date > series.end.date) break
      const candidate = resolveCandidate(date, anchor.time, series.timezone)
      if (candidateMatches(candidate, date, threshold, thresholdDate, strictAfter)) return candidate
    }
    return null
  }

  if (series.cadence.kind === 'weekly') {
    let matched = 0
    for (let dayOffset = 0; dayOffset <= MAX_SEARCH_STEPS * 7; dayOffset += 1) {
      const date = addCalendarDays(anchor.date, dayOffset)
      if (series.end.kind === 'on' && date > series.end.date) break
      const weekOffset = Math.floor(dayOffset / 7)
      if (weekOffset % series.cadence.interval !== 0) continue
      if (!series.cadence.weekdays.includes(weekdayOf(date))) continue
      matched += 1
      if (matched > limit) break
      const candidate = resolveCandidate(date, anchor.time, series.timezone)
      if (candidateMatches(candidate, date, threshold, thresholdDate, strictAfter)) return candidate
    }
    return null
  }

  for (let occurrence = 1; occurrence <= limit; occurrence += 1) {
    const date =
      series.cadence.kind === 'monthly'
        ? addCalendarMonths(anchor.date, (occurrence - 1) * series.cadence.interval, series.cadence.dayOfMonth)
        : addCalendarYears(anchor.date, (occurrence - 1) * series.cadence.interval, series.cadence.month, series.cadence.dayOfMonth)
    if (series.end.kind === 'on' && date > series.end.date) break
    const candidate = resolveCandidate(date, anchor.time, series.timezone)
    if (candidateMatches(candidate, date, threshold, thresholdDate, strictAfter)) return candidate
  }
  return null
}

function afterCompletionDate(series: RecurrenceSeries, completedOn: string): string {
  if (series.cadence.kind === 'daily') return addCalendarDays(completedOn, series.cadence.interval)
  if (series.cadence.kind === 'weekly') {
    let date = addCalendarDays(completedOn, series.cadence.interval * 7)
    while (!series.cadence.weekdays.includes(weekdayOf(date))) date = addCalendarDays(date, 1)
    return date
  }
  if (series.cadence.kind === 'monthly') return addCalendarMonths(completedOn, series.cadence.interval, series.cadence.dayOfMonth)
  return addCalendarYears(completedOn, series.cadence.interval, series.cadence.month, series.cadence.dayOfMonth)
}

function resolveCandidate(date: string, time: string | null, timezone: string): string {
  return time === null ? date : zonedDateTimeToInstant(date, time, timezone).toISOString()
}

function candidateMatches(
  candidate: string,
  candidateDate: string,
  threshold: Date | null,
  thresholdDate: string,
  strictAfter: boolean,
): boolean {
  if (threshold === null) return strictAfter ? candidateDate > thresholdDate : candidateDate >= thresholdDate
  const instant = new Date(candidate)
  return strictAfter ? instant > threshold : instant.getTime() >= threshold.getTime()
}

function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = parseDateOnly(date)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function addCalendarMonths(date: string, months: number, dayOfMonth: number): string {
  const { year, month } = parseDateOnly(date)
  const totalMonths = (year * 12 + (month - 1)) + months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = (totalMonths % 12) + 1
  return formatDate(targetYear, targetMonth, Math.min(dayOfMonth, daysInMonth(targetYear, targetMonth)))
}

function addCalendarYears(date: string, years: number, month: number, dayOfMonth: number): string {
  const { year } = parseDateOnly(date)
  const targetYear = year + years
  return formatDate(targetYear, month, Math.min(dayOfMonth, daysInMonth(targetYear, month)))
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function weekdayOf(date: string): number {
  const { year, month, day } = parseDateOnly(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid date: ${value}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export const OCCURRENCE_HORIZON_DAYS = 90
export const MAX_PENDING_OCCURRENCES = 50
const MAX_SEARCH_STEPS = 500
