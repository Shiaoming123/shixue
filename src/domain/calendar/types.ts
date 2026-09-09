import type { RecurrenceCadence, RecurrenceSeries } from '../workspace/types.ts'

export type CalendarEventTime =
  | { kind: 'all-day'; startOn: string; endOnExclusive: string }
  | { kind: 'fixed'; startAt: string; endAt: string; timezone: string }
  | { kind: 'floating'; startLocal: string; endLocal: string }

export interface CalendarSource {
  id: string
  revision: number
  provider: 'local' | 'google' | 'feishu' | 'ics'
  title: string
  color: string
  group: string | null
  permission: 'read' | 'write'
  selected: boolean
  hidden: boolean
  timezone: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface CalendarEvent {
  id: string
  revision: number
  sourceId: string
  title: string
  notes: string
  location: string
  meetingUrl: string | null
  sourceUrl?: string | null
  organizer: { name: string; email: string } | null
  attendees: Array<{
    name: string
    email: string
    role: 'required' | 'optional'
    response: 'unknown' | 'accepted' | 'declined' | 'tentative'
  }>
  availability: 'busy' | 'free'
  status: 'confirmed' | 'tentative' | 'cancelled'
  time: CalendarEventTime
  recurrence: null | {
    cadence: RecurrenceCadence
    end: RecurrenceSeries['end']
    exceptions: Array<{ originalStart: string; time: CalendarEventTime | null }>
  }
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CalendarEventLink {
  id: string
  eventId: string
  taskId: string
}

export interface EventOutcome {
  id: string
  eventId: string
  occurrenceId: string | null
  action: 'followup' | 'note' | 'dismiss'
  taskId: string | null
  note: string
  createdAt: string
}
