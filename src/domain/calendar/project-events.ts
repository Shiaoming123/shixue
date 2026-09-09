import { addCalendarDays } from '../recurrence/calculate.ts'
import { parseZonedDateTime, zonedDateTimeToInstant } from '../recurrence/timezone.ts'
import type { WorkspaceStateV4 } from '../workspace/types.ts'
import { expandCalendarEventOccurrences } from './event-occurrences.ts'
import type { CalendarItem } from './project.ts'
import type { CalendarRange } from './range.ts'

/** Split display segments without changing event or occurrence identity. */
export function projectCalendarEvents(state: WorkspaceStateV4, range: CalendarRange, timezone: string): CalendarItem[] {
  const sources = new Map(state.calendarSources.map((source) => [source.id, source]))
  const items: CalendarItem[] = []
  for (const event of state.calendarEvents) {
    const source = sources.get(event.sourceId)
    if (!source || source.archivedAt || !source.selected || source.hidden) continue
    for (const occurrence of expandCalendarEventOccurrences(event, range, timezone)) {
      const time = occurrence.time
      for (let date = range.start; date < range.end; date = addCalendarDays(date, 1)) {
        const next = addCalendarDays(date, 1)
        const base = { key: `${occurrence.id}:${date}`, eventId: event.id, originalStart: occurrence.originalStart,
          occurrenceId: null, displayDate: date,
          calendar: { title: source.title, color: source.color, readOnly: source.permission !== 'write' || source.provider !== 'local', event, time } }
        if (time.kind === 'all-day') {
          if (date >= time.startOn && date < time.endOnExclusive) items.push({ ...base, kind: 'all-day', start: date, end: next, displayMinute: null })
          continue
        }
        const dayStart = time.kind === 'fixed' ? zonedDateTimeToInstant(date, '00:00', timezone).getTime() : Date.parse(`${date}T00:00:00Z`)
        const dayEnd = time.kind === 'fixed' ? zonedDateTimeToInstant(next, '00:00', timezone).getTime() : Date.parse(`${next}T00:00:00Z`)
        const start = Math.max(dayStart, Date.parse(time.kind === 'fixed' ? time.startAt : `${time.startLocal}:00Z`))
        const end = Math.min(dayEnd, Date.parse(time.kind === 'fixed' ? time.endAt : `${time.endLocal}:00Z`))
        if (end <= start) continue
        const wall = time.kind === 'fixed' ? parseZonedDateTime(new Date(start).toISOString(), timezone).time : new Date(start).toISOString().slice(11, 16)
        items.push({ ...base, kind: 'timed', start: new Date(start).toISOString(), end: new Date(end).toISOString(), displayMinute: Number(wall.slice(0, 2)) * 60 + Number(wall.slice(3, 5)) })
      }
    }
  }
  return items
}
