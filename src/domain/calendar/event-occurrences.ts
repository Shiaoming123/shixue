import { addCalendarDays, addCalendarMonths, addCalendarYears, weekdayOf } from '../recurrence/calculate.ts'
import { assertIanaTimezone, parseZonedDateTime, zonedDateTimeToInstant } from '../recurrence/timezone.ts'
import type { CalendarRange } from './range.ts'
import type { CalendarEvent, CalendarEventTime } from './types.ts'

export interface CalendarEventOccurrence {
  id: string
  eventId: string
  originalStart: string
  time: CalendarEventTime
}

export function expandCalendarEventOccurrences(event: CalendarEvent, range: CalendarRange, displayTimezone: string): CalendarEventOccurrence[] {
  assertDate(range.start)
  assertDate(range.end)
  if (range.start >= range.end) throw new Error('Calendar range end must be after start')
  assertIanaTimezone(displayTimezone)
  validateCalendarEventRecurrence(event)
  if (event.deletedAt !== null || event.status === 'cancelled') return []
  const rangeStart = zonedDateTimeToInstant(range.start, '00:00', displayTimezone).getTime()
  const rangeEnd = zonedDateTimeToInstant(range.end, '00:00', displayTimezone).getTime()
  const overlaps = (time: CalendarEventTime) => time.kind === 'fixed'
    ? Date.parse(time.startAt) < rangeEnd && Date.parse(time.endAt) > rangeStart
    : time.kind === 'all-day'
      ? time.startOn < range.end && time.endOnExclusive > range.start
      : time.startLocal < `${range.end}T00:00` && time.endLocal > `${range.start}T00:00`
  const result: CalendarEventOccurrence[] = []
  const append = (originalStart: string, time: CalendarEventTime) => {
    if (overlaps(time)) result.push({ id: `event-occurrence:${event.id}:${originalStart}`, eventId: event.id, originalStart, time })
  }
  const exceptions = new Map(event.recurrence?.exceptions.map((entry) => [canonicalStart(event, entry.originalStart), entry.time]))
  const until = event.time.kind === 'fixed'
    ? parseZonedDateTime(new Date(rangeEnd).toISOString(), event.time.timezone).date
    : range.end
  for (const time of originalTimes(event, until)) {
    const originalStart = startOf(time)
    if (!exceptions.has(originalStart)) append(originalStart, time)
  }
  // Overrides can move occurrences into the range from either side of it.
  for (const [originalStart, time] of exceptions) if (time !== null) append(originalStart, time)
  return result.sort((a, b) => startOf(a.time).localeCompare(startOf(b.time)) || a.id.localeCompare(b.id))
}

export function isCalendarEventOccurrenceStart(event: CalendarEvent, originalStart: string): boolean {
  const target = canonicalStart(event, originalStart)
  const date = startDate(event, target)
  for (const time of originalTimes(event, date)) if (startOf(time) === target) return true
  return false
}

export function resolveCalendarEventOccurrence(event: CalendarEvent, originalStart: string): CalendarEventOccurrence | null {
  if (event.deletedAt !== null || event.status === 'cancelled') return null
  let target: string
  try { target = canonicalStart(event, originalStart) } catch { return null }
  for (const original of originalTimes(event, startDate(event, target))) {
    if (startOf(original) !== target) continue
    const exception = event.recurrence?.exceptions.find((entry) => canonicalStart(event, entry.originalStart) === target)
    const time = exception ? exception.time : original
    return time === null ? null : { id: `event-occurrence:${event.id}:${target}`, eventId: event.id, originalStart: target, time }
  }
  return null
}

/** Validate identities even on deleted/cancelled events; those facts may later be restored. */
export function validateCalendarEventRecurrence(event: CalendarEvent): void {
  const exceptions = event.recurrence?.exceptions ?? []
  if (exceptions.length === 0) return
  const pending = new Set(exceptions.map((entry) => canonicalStart(event, entry.originalStart)))
  if (pending.size !== exceptions.length) throw new Error('Duplicate event recurrence exception')
  const dates = [...pending].map((value) => startDate(event, value)).sort()
  const until = dates[dates.length - 1]!
  for (const time of originalTimes(event, until)) pending.delete(startOf(time))
  if (pending.size > 0) throw new Error(`Event exception originalStart is not a series occurrence: ${[...pending][0]}`)
  for (const entry of exceptions) {
    if (entry.time !== null && entry.time.kind !== event.time.kind) throw new Error('Event exception must retain time kind')
  }
}

function* originalTimes(event: CalendarEvent, until: string): Generator<CalendarEventTime> {
  if (!event.recurrence) { yield canonicalTime(event.time); return }
  const { cadence, end } = event.recurrence
  const anchor = startDate(event, startOf(event.time))
  const weekdays = cadence.kind === 'weekly'
    ? cadence.weekdays.map((day) => (day - weekdayOf(anchor) + 7) % 7).sort((a, b) => a - b)
    : []
  let count = 0
  // ponytail: bounded scans from the anchor; add indexed seeking if >10,000 occurrences are needed.
  for (let offset = 0; ; offset += 1) {
    if (end.kind === 'after' && count >= end.count) return
    const date = cadence.kind === 'daily' ? addCalendarDays(anchor, offset * cadence.interval)
      : cadence.kind === 'weekly' ? addCalendarDays(anchor, Math.floor(offset / weekdays.length) * cadence.interval * 7 + weekdays[offset % weekdays.length]!)
        : cadence.kind === 'monthly' ? addCalendarMonths(anchor, offset * cadence.interval, cadence.dayOfMonth)
          : addCalendarYears(anchor, offset * cadence.interval, cadence.month, cadence.dayOfMonth)
    if (date > until || (end.kind === 'on' && date > end.date)) return
    if (offset >= 10_000) throw new Error('Event recurrence expansion exceeds 10000 candidates; narrow the series or use indexed seeking')
    if (date < anchor) continue
    count += 1
    yield timeOnDate(event.time, date)
  }
}

function timeOnDate(time: CalendarEventTime, date: string): CalendarEventTime {
  if (time.kind === 'fixed') {
    const anchor = parseZonedDateTime(time.startAt, time.timezone)
    const start = date === anchor.date ? Date.parse(time.startAt)
      : zonedDateTimeToInstant(date, anchor.time, time.timezone).getTime() + Date.parse(time.startAt) % 60_000
    return { ...time, startAt: new Date(start).toISOString(), endAt: new Date(start + Date.parse(time.endAt) - Date.parse(time.startAt)).toISOString() }
  }
  if (time.kind === 'all-day') {
    return { ...time, startOn: date, endOnExclusive: addCalendarDays(date, (Date.parse(time.endOnExclusive) - Date.parse(time.startOn)) / 86_400_000) }
  }
  const startLocal = `${date}${time.startLocal.slice(10)}`
  const duration = Date.parse(`${time.endLocal}Z`) - Date.parse(`${time.startLocal}Z`)
  return { ...time, startLocal, endLocal: new Date(Date.parse(`${startLocal}Z`) + duration).toISOString().slice(0, 16) }
}

function canonicalTime(time: CalendarEventTime): CalendarEventTime {
  return time.kind === 'fixed' ? { ...time, startAt: new Date(time.startAt).toISOString(), endAt: new Date(time.endAt).toISOString() } : { ...time }
}

function startOf(time: CalendarEventTime): string {
  return time.kind === 'all-day' ? time.startOn : time.kind === 'floating' ? time.startLocal : new Date(time.startAt).toISOString()
}

function startDate(event: CalendarEvent, value: string): string {
  return event.time.kind === 'fixed' ? parseZonedDateTime(value, event.time.timezone).date : value.slice(0, 10)
}

function canonicalStart(event: CalendarEvent, value: string): string {
  if (event.time.kind === 'fixed') {
    if (!/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid event occurrence instant')
    return new Date(value).toISOString()
  }
  assertDate(value.slice(0, 10))
  if (event.time.kind === 'all-day' ? value.length !== 10 : !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Invalid event occurrence start')
  return value
}

function assertDate(value: string): void {
  const date = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date: ${value}`)
}
