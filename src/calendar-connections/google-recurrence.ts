import type { CalendarEvent } from '../domain/calendar/types.ts'
import { addCalendarDays, weekdayOf } from '../domain/recurrence/calculate.ts'
import { parseZonedDateTime } from '../domain/recurrence/timezone.ts'
import { isCalendarEventOccurrenceStart, validateCalendarEventRecurrence } from '../domain/calendar/event-occurrences.ts'
import { normalizeGoogleEvent } from './google.ts'
import { array, CalendarProviderError, instant, record, safeNormalize, stableId, string, type ProviderEvent, type PullRequest } from './types.ts'

function unsupported(): never { throw new CalendarProviderError('unsupported-recurrence') }
function recurrence(raw: unknown, event: CalendarEvent): NonNullable<CalendarEvent['recurrence']> {
  const lines = array(raw)
  if (lines.length !== 1 || !string(lines[0]).startsWith('RRULE:')) unsupported()
  const parts = string(lines[0]).slice(6).split(';').map((part) => part.split('='))
  if (parts.some((part) => part.length !== 2) || new Set(parts.map(([key]) => key)).size !== parts.length) unsupported()
  const rule = Object.fromEntries(parts) as Record<string, string>
  if (Object.keys(rule).some((key) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST'].includes(key))) unsupported()
  const number = (value: string) => { if (!/^[1-9]\d*$/.test(value) || Number(value) > 10_000) unsupported(); return Number(value) }
  const interval = number(rule.INTERVAL ?? '1')
  const time = event.time
  if (time.kind === 'floating') unsupported()
  const anchor = time.kind === 'all-day' ? { date: time.startOn, time: '00:00' } : parseZonedDateTime(time.startAt, time.timezone)
  if (time.kind === 'fixed' && !(['UTC', 'Etc/UTC', 'Etc/GMT'].includes(time.timezone) || /^Etc\/GMT[+-]\d{1,2}$/.test(time.timezone) || (time.timezone === 'Asia/Shanghai' && anchor.date >= '1992-01-01'))) unsupported()
  const day = Number(anchor.date.slice(8)); const month = Number(anchor.date.slice(5, 7))
  let cadence: NonNullable<CalendarEvent['recurrence']>['cadence']
  if (rule.FREQ === 'DAILY' && !rule.BYDAY && !rule.BYMONTH && !rule.BYMONTHDAY && !rule.WKST) cadence = { kind: 'daily', interval }
  else if (rule.FREQ === 'WEEKLY' && !rule.BYMONTH && !rule.BYMONTHDAY) {
    const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
    const weekdays = (rule.BYDAY ?? names[weekdayOf(anchor.date)]!).split(',').map((name) => names.indexOf(name)).sort((a, b) => a - b)
    if (weekdays.includes(-1) || new Set(weekdays).size !== weekdays.length || !weekdays.includes(weekdayOf(anchor.date)) || (rule.WKST && !names.includes(rule.WKST)) || (interval !== 1 && (weekdays.length !== 1 || weekdays[0] !== weekdayOf(anchor.date)))) unsupported()
    cadence = { kind: 'weekly', interval, weekdays }
  } else if (rule.FREQ === 'MONTHLY' && !rule.BYDAY && !rule.BYMONTH && !rule.WKST && day <= 28 && (!rule.BYMONTHDAY || number(rule.BYMONTHDAY) === day)) cadence = { kind: 'monthly', interval, dayOfMonth: day }
  else if (rule.FREQ === 'YEARLY' && !rule.BYDAY && !rule.WKST && !(month === 2 && day === 29) && (!rule.BYMONTHDAY || number(rule.BYMONTHDAY) === day) && (!rule.BYMONTH || number(rule.BYMONTH) === month)) cadence = { kind: 'yearly', interval, month, dayOfMonth: day }
  else unsupported()
  let end: NonNullable<CalendarEvent['recurrence']>['end'] = { kind: 'never' }
  if (rule.COUNT && rule.UNTIL) unsupported()
  if (rule.COUNT) end = { kind: 'after', count: number(rule.COUNT) }
  if (rule.UNTIL) {
    let date: string
    if (time.kind === 'all-day') { if (!/^\d{8}$/.test(rule.UNTIL)) unsupported(); date = rule.UNTIL.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') }
    else {
      if (!/^\d{8}T\d{6}Z$/.test(rule.UNTIL)) unsupported()
      const until = instant(rule.UNTIL.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))
      const wall = parseZonedDateTime(until, time.timezone); date = wall.date
      const anchorSeconds = Date.parse(time.startAt) % 60_000
      if (anchor.time > wall.time || (anchor.time === wall.time && anchorSeconds > Date.parse(until) % 60_000)) date = addCalendarDays(date, -1)
    }
    if (date < anchor.date || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) unsupported()
    end = { kind: 'on', date }
  }
  return { cadence, end, exceptions: [] }
}

function metadata(value: Record<string, unknown>): void {
  if (value.unsupportedRecurrenceFields === true || value.conferenceData !== undefined || value.attachments !== undefined || value.extendedProperties !== undefined) unsupported()
}

/** Fold provider exceptions into their parent facts only; never create task/instance entities. */
export function normalizeGoogleBatch(items: unknown[], request: PullRequest, existingParents: readonly CalendarEvent[], mode: 'full' | 'incremental'): { upserts: ProviderEvent[]; deletedRemoteIds: string[] } {
  return safeNormalize(() => {
    if (items.length > 50_000 || new TextEncoder().encode(JSON.stringify(items)).length > 32 * 1024 * 1024) throw new CalendarProviderError('incomplete')
    const raws = new Map<string, Record<string, unknown>>()
    for (const raw of items) {
      const value = record(raw), id = string(value.id), previous = raws.get(id)
      if (previous && canonicalJson(previous) !== canonicalJson(value)) throw new CalendarProviderError('incomplete')
      raws.set(id, value)
    }
    const upserts = new Map<string, ProviderEvent>(); const deleted = new Set<string>()
    const prior = (remoteId: string) => existingParents.find((event) => event.id === stableId('google', request.connectionId, request.calendarId, remoteId) && event.sourceId === stableId('google', request.connectionId, request.calendarId) && event.deletedAt === null)
    for (const [id, value] of raws) {
      if (value.recurringEventId !== undefined) continue
      if (value.status === 'cancelled') { deleted.add(id); continue }
      const { recurrence: rules, ...plain } = value
      const normalized = normalizeGoogleEvent(plain, request)
      if (rules !== undefined) { metadata(value); normalized.event.recurrence = recurrence(rules, normalized.event) }
      const old = mode === 'incremental' ? prior(id) : undefined
      if (old?.recurrence?.exceptions.length) {
        if (!normalized.event.recurrence) throw new CalendarProviderError('cursor-expired')
        normalized.event.recurrence.exceptions = structuredClone(old.recurrence.exceptions)
        try { validateCalendarEventRecurrence(normalized.event) } catch { throw new CalendarProviderError('cursor-expired') }
      }
      upserts.set(id, normalized)
    }
    for (const value of raws.values()) {
      if (value.recurringEventId === undefined) continue
      const parentId = string(value.recurringEventId)
      if (deleted.has(parentId)) continue
      let parent = upserts.get(parentId)
      if (!parent && mode === 'incremental') { const old = prior(parentId); if (old) parent = { remoteId: parentId, event: structuredClone(old), sourceUrl: old.sourceUrl ?? null } }
      if (!parent?.event.recurrence) throw new CalendarProviderError('incomplete')
      const start = record(value.originalStartTime)
      const originalStart = parent.event.time.kind === 'all-day' ? string(start.date) : instant(start.dateTime)
      if (!isCalendarEventOccurrenceStart(parent.event, originalStart)) unsupported()
      let time: CalendarEvent['time'] | null = null
      if (value.status !== 'cancelled') {
        const { recurringEventId: _parent, originalStartTime: _original, ...plain } = value
        const exception = normalizeGoogleEvent(plain, { ...request, timezone: parent.event.time.kind === 'fixed' ? parent.event.time.timezone : request.timezone }).event; metadata(value)
        for (const key of ['title', 'notes', 'location', 'status', 'availability', 'organizer', 'attendees'] as const) if (JSON.stringify(exception[key]) !== JSON.stringify(parent.event[key])) unsupported()
        time = exception.time
      }
      parent.event.recurrence.exceptions = parent.event.recurrence.exceptions.filter((entry) => entry.originalStart !== originalStart)
      parent.event.recurrence.exceptions.push({ originalStart, time })
      if (parent.event.recurrence.exceptions.length > 10_000) throw new CalendarProviderError('incomplete')
      validateCalendarEventRecurrence(parent.event)
      upserts.set(parentId, parent)
    }
    return { upserts: [...upserts.values()], deletedRemoteIds: [...deleted] }
  })
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
