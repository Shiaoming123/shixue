import { formatInTimeZone, zonedDateTimeToInstant } from '../recurrence/timezone.ts'

export type CalendarTargetClock =
  | { kind: 'offset'; offset: string }
  | { kind: 'timezone'; timezone: string }

export interface CalendarTimedTarget {
  startAt: string
  displayDate: string
  displayMinute: number
}

export function calendarTimedTarget(
  displayDate: string,
  displayMinute: number,
  clock: CalendarTargetClock,
): CalendarTimedTarget {
  assertDate(displayDate)
  if (!Number.isInteger(displayMinute) || displayMinute < 0 || displayMinute >= 1440) {
    throw new TypeError(`Invalid calendar display minute: ${displayMinute}`)
  }
  const time = formatMinute(displayMinute)
  if (clock.kind === 'offset') {
    assertOffset(clock.offset)
    const startAt = `${displayDate}T${time}:00${clock.offset}`
    if (!Number.isFinite(Date.parse(startAt))) throw new TypeError(`Invalid calendar target: ${startAt}`)
    return { startAt, displayDate, displayMinute }
  }

  const instant = zonedDateTimeToInstant(displayDate, time, clock.timezone)
  const resolved = formatInTimeZone(instant, clock.timezone)
  return {
    startAt: instant.toISOString(),
    displayDate: resolved.date,
    displayMinute: minuteForTime(resolved.time),
  }
}

export function timestampOffset(value: string): string | null {
  return /(Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? null
}

export function offsetForInstant(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new TypeError('Invalid calendar offset instant')
  const minutes = -instant.getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '-'
  const absolute = Math.abs(minutes)
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

function assertDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`Invalid calendar display date: ${value}`)
  }
}

function assertOffset(value: string) {
  const match = /^(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) throw new TypeError(`Invalid calendar target offset: ${value}`)
  if (value === 'Z') return
  const hour = Number(match[3])
  const minute = Number(match[4])
  if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0)) throw new TypeError(`Invalid calendar target offset: ${value}`)
}

function formatMinute(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function minuteForTime(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return (hour === 24 ? 0 : hour) * 60 + minute
}
