import type { RecurrenceCadence, RecurrenceSeries } from '../workspace/types.ts'

export function nextFixedOccurrence(series: RecurrenceSeries, after: string): string | null {
  return nextOccurrence(series, after, false)
}

export function nextAfterCompletion(series: RecurrenceSeries, completedAt: string): string | null {
  return nextOccurrence(series, completedAt, true)
}

function nextOccurrence(series: RecurrenceSeries, thresholdIso: string, strictAfter: boolean): string | null {
  const threshold = new Date(thresholdIso)
  if (Number.isNaN(threshold.getTime())) throw new Error(`Invalid datetime: ${thresholdIso}`)
  const anchor = parseZonedDateTime(series.anchorAt, series.timezone)
  const limit = series.end.kind === 'after' ? series.end.count : MAX_SEARCH_STEPS

  if (series.cadence.kind === 'daily') {
    for (let occurrence = 1; occurrence <= limit; occurrence += 1) {
      const date = addCalendarDays(anchor.date, (occurrence - 1) * series.cadence.interval)
      if (series.end.kind === 'on' && date > series.end.date) break
      const instant = zonedDateTimeToInstant(date, anchor.time, series.timezone)
      if (strictAfter ? instant > threshold : instant.getTime() >= threshold.getTime()) return instant.toISOString()
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
      const instant = zonedDateTimeToInstant(date, anchor.time, series.timezone)
      if (strictAfter ? instant > threshold : instant.getTime() >= threshold.getTime()) return instant.toISOString()
    }
    return null
  }

  for (let occurrence = 1; occurrence <= limit; occurrence += 1) {
    const date =
      series.cadence.kind === 'monthly'
        ? addCalendarMonths(anchor.date, (occurrence - 1) * series.cadence.interval, series.cadence.dayOfMonth)
        : addCalendarYears(anchor.date, (occurrence - 1) * series.cadence.interval, series.cadence.month, series.cadence.dayOfMonth)
    if (series.end.kind === 'on' && date > series.end.date) break
    const instant = zonedDateTimeToInstant(date, anchor.time, series.timezone)
    if (strictAfter ? instant > threshold : instant.getTime() >= threshold.getTime()) return instant.toISOString()
  }
  return null
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

function parseZonedDateTime(value: string, timezone: string): { date: string; time: string } {
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid datetime: ${value}`)
  return formatInTimeZone(instant, timezone)
}

function formatInTimeZone(instant: Date, timezone: string): { date: string; time: string } {
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
    const parts = formatInTimeZone(utc, timezone)
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

export const OCCURRENCE_HORIZON_DAYS = 90
export const MAX_PENDING_OCCURRENCES = 50
const MAX_SEARCH_STEPS = 500
