import { parseCalendarEventTime } from '../workspace/parse.ts'
import { addCalendarDays } from '../recurrence/calculate.ts'
import { parseZonedDateTime } from '../recurrence/timezone.ts'
import type { EventCapabilityCommand } from '../capabilities/event-commands.ts'
import { calendarTimedTarget } from './target.ts'
import type { CalendarEvent, CalendarEventTime } from './types.ts'

export function eventPlacementCommand(event: CalendarEvent, originalStart: string, time: CalendarEventTime): EventCapabilityCommand {
  const parsed = parseCalendarEventTime(time)
  if (parsed.kind !== event.time.kind) throw new Error('Event placement must preserve its time kind.')
  return event.recurrence
    ? { type: 'event.exception.set', eventId: event.id, expectedRevision: event.revision, originalStart, time: parsed }
    : { type: 'event.update', eventId: event.id, expectedRevision: event.revision, scope: 'single', patch: { time: parsed } }
}

export function moveCalendarEventTime(time: CalendarEventTime, displayDate: string, displayMinute: number | null, displayTimezone: string): CalendarEventTime {
  const original = parseCalendarEventTime(time)
  if (original.kind === 'all-day') {
    if (displayMinute !== null) throw new Error('All-day events must be moved to a date, not a timed slot.')
    const days = (Date.parse(original.endOnExclusive) - Date.parse(original.startOn)) / 86_400_000
    return parseCalendarEventTime({ ...original, startOn: displayDate, endOnExclusive: addCalendarDays(displayDate, days) })
  }
  const start = original.kind === 'fixed'
    ? parseZonedDateTime(original.startAt, displayTimezone)
    : { date: original.startLocal.slice(0, 10), time: original.startLocal.slice(11, 16) }
  const priorMinute = Number(start.time.slice(0, 2)) * 60 + Number(start.time.slice(3, 5))
  const minute = displayMinute ?? priorMinute
  if (!Number.isInteger(minute) || minute < 0 || minute >= 1440) throw new Error('Event display minute must be between 0 and 1439.')
  if (displayDate === start.date && minute === priorMinute) return original
  if (original.kind === 'floating') {
    const startLocal = `${displayDate}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
    const duration = Date.parse(`${original.endLocal}Z`) - Date.parse(`${original.startLocal}Z`)
    return parseCalendarEventTime({ ...original, startLocal, endLocal: new Date(Date.parse(`${startLocal}Z`) + duration).toISOString().slice(0, 16) })
  }
  const target = calendarTimedTarget(displayDate, minute, { kind: 'timezone', timezone: displayTimezone })
  if (target.displayDate !== displayDate || target.displayMinute !== minute) throw new Error('The selected time does not exist in this timezone (DST gap).')
  const instant = Date.parse(target.startAt) + (displayMinute === null ? Date.parse(original.startAt) % 60_000 : 0)
  return parseCalendarEventTime({ ...original, startAt: new Date(instant).toISOString(), endAt: new Date(instant + Date.parse(original.endAt) - Date.parse(original.startAt)).toISOString() })
}

export function resizeCalendarEventTime(time: CalendarEventTime, minutes: number): CalendarEventTime {
  const original = parseCalendarEventTime(time)
  if (original.kind === 'all-day') throw new Error('All-day events cannot use timed resize.')
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes % 5 !== 0) throw new Error('Event duration must be positive five-minute increments.')
  return original.kind === 'fixed'
    ? parseCalendarEventTime({ ...original, endAt: new Date(Date.parse(original.startAt) + minutes * 60_000).toISOString() })
    : parseCalendarEventTime({ ...original, endLocal: new Date(Date.parse(`${original.startLocal}Z`) + minutes * 60_000).toISOString().slice(0, 16) })
}
