import { addCalendarDays } from '../recurrence/calculate.ts'
import { parseZonedDateTime, zonedDateTimeToInstant } from '../recurrence/timezone.ts'
import { parseCalendarEventTime } from '../workspace/parse.ts'
import type { CalendarEventTime } from './types.ts'

export interface EventTimeDraft {
  kind: CalendarEventTime['kind']
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  timezone: string
}

export function eventTimeDraft(time: CalendarEventTime, timezone = 'UTC'): EventTimeDraft {
  if (time.kind === 'all-day') return { kind: time.kind, startDate: time.startOn, endDate: addCalendarDays(time.endOnExclusive, -1), startTime: '09:00', endTime: '10:00', timezone }
  const start = time.kind === 'fixed' ? parseZonedDateTime(time.startAt, time.timezone) : { date: time.startLocal.slice(0, 10), time: time.startLocal.slice(11) }
  const end = time.kind === 'fixed' ? parseZonedDateTime(time.endAt, time.timezone) : { date: time.endLocal.slice(0, 10), time: time.endLocal.slice(11) }
  return { kind: time.kind, startDate: start.date, endDate: end.date, startTime: start.time, endTime: end.time, timezone: time.kind === 'fixed' ? time.timezone : timezone }
}

export function eventTimeFromDraft(draft: EventTimeDraft, original?: CalendarEventTime): CalendarEventTime {
  if (draft.kind === 'all-day') {
    parseCalendarEventTime({ kind: 'all-day', startOn: draft.startDate, endOnExclusive: addCalendarDays(draft.startDate, 1) })
    parseCalendarEventTime({ kind: 'all-day', startOn: draft.endDate, endOnExclusive: addCalendarDays(draft.endDate, 1) })
    return parseCalendarEventTime({ kind: 'all-day', startOn: draft.startDate, endOnExclusive: addCalendarDays(draft.endDate, 1) })
  }
  const startLocal = `${draft.startDate}T${draft.startTime}`
  const endLocal = `${draft.endDate}T${draft.endTime}`
  if (draft.kind === 'floating') return parseCalendarEventTime({ kind: 'floating', startLocal, endLocal })
  function resolve(date: string, time: string, previous?: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请输入有效日期和时间。')
    if (previous && original?.kind === 'fixed' && original.timezone === draft.timezone) {
      const parts = parseZonedDateTime(previous, draft.timezone)
      if (parts.date === date && parts.time === time) return previous
    }
    const instant = zonedDateTimeToInstant(date, time, draft.timezone).toISOString()
    const resolved = parseZonedDateTime(instant, draft.timezone)
    if (resolved.date !== date || resolved.time !== time) throw new Error('该时区不存在这个时间（夏令时跳时）；请选择有效时间。')
    return instant
  }
  return parseCalendarEventTime({ kind: 'fixed', startAt: resolve(draft.startDate, draft.startTime, original?.kind === 'fixed' ? original.startAt : undefined), endAt: resolve(draft.endDate, draft.endTime, original?.kind === 'fixed' ? original.endAt : undefined), timezone: draft.timezone })
}
