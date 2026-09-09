import { parseCalendarEvent, parseCalendarEventTime } from '../domain/workspace/parse.ts'
import { assertIanaTimezone } from '../domain/recurrence/timezone.ts'
export { normalizeGoogleBatch } from './google-recurrence.ts'
import { access, array, CalendarProviderError, checkHttp, instant, record, safeSourceUrl, safeNormalize, stableId, string, type CalendarDescriptor, type CalendarProviderPort, type ProviderEvent, type ProviderReadTransport, type PullRequest, type BusyResult } from './types.ts'

export function normalizeGoogleEvent(raw: unknown, request: PullRequest): ProviderEvent {
  return safeNormalize(() => {
  const value = record(raw); const remoteId = string(value.id)
  if (value.recurrence !== undefined || value.recurringEventId !== undefined) throw new CalendarProviderError('unsupported-recurrence')
  if (value.attendeesOmitted === true) throw new CalendarProviderError('incomplete')
  if (value.attendeesOmitted !== undefined && typeof value.attendeesOmitted !== 'boolean') throw new CalendarProviderError('invalid-response')
  const person = (raw: unknown) => { const item = record(raw); return { email: string(item.email), name: typeof item.displayName === 'string' ? item.displayName : '' } }
  const organizer = value.organizer === undefined ? null : person(value.organizer)
  const attendees = array(value.attendees === undefined ? [] : value.attendees).map((raw) => {
    const item = record(raw)
    if (item.resource === true || (typeof item.additionalGuests === 'number' && item.additionalGuests > 0)) throw new CalendarProviderError('unsupported-operation')
    if ((item.resource !== undefined && typeof item.resource !== 'boolean') || (item.optional !== undefined && typeof item.optional !== 'boolean') || (item.additionalGuests !== undefined && item.additionalGuests !== 0)) throw new CalendarProviderError('invalid-response')
    return { ...person(item), role: item.optional === true ? 'optional' : 'required', response: item.responseStatus === 'needsAction' || item.responseStatus === undefined ? 'unknown' : item.responseStatus }
  }).sort((a, b) => a.email.localeCompare(b.email))
  const start = record(value.start); const end = record(value.end)
  const time = start.date !== undefined ? parseCalendarEventTime({ kind: 'all-day', startOn: start.date, endOnExclusive: end.date }) : parseCalendarEventTime({ kind: 'fixed', startAt: instant(start.dateTime), endAt: instant(end.dateTime), timezone: start.timeZone ?? request.timezone })
  return { remoteId, sourceUrl: safeSourceUrl(value.htmlLink, 'google'), event: parseCalendarEvent({ id: stableId('google', request.connectionId, request.calendarId, remoteId), sourceId: stableId('google', request.connectionId, request.calendarId), revision: 1, title: typeof value.summary === 'string' && value.summary ? value.summary : '日程', notes: typeof value.description === 'string' ? value.description : '', location: typeof value.location === 'string' ? value.location : '', meetingUrl: null, organizer, attendees, availability: value.transparency === 'transparent' ? 'free' : 'busy', status: value.status === 'tentative' ? 'tentative' : 'confirmed', time, recurrence: null, createdAt: value.created === undefined ? request.now : instant(value.created), updatedAt: value.updated === undefined ? request.now : instant(value.updated), deletedAt: null }) }
  })
}
export function createGoogleCalendarProvider(read: ProviderReadTransport): CalendarProviderPort {
  const get = async (request: Parameters<ProviderReadTransport>[0]) => {
    const response = await read(request)
    if (response.status === 403) { const body = record(response.body); const error = body.error === undefined ? null : record(body.error); const reasons = error !== null && Array.isArray(error.errors) ? error.errors.map((value) => record(value).reason) : []; if (reasons.some((reason) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(String(reason)))) throw new CalendarProviderError('retryable', response.retryAfterSeconds) }
    checkHttp(response); return record(response.body)
  }
  return {
    async listCalendars(connectionId) {
      const result = new Map<string, CalendarDescriptor>(); const seen = new Set<string>(); let pageToken: string | undefined
      for (let page = 0; page < 100; page++) {
        const body = await get({ operation: 'google.calendars', connectionId, ...(pageToken ? { pageToken } : {}) })
        for (const raw of array(body.items ?? [])) { const item = record(raw); const id = string(item.id); const timezone = item.timeZone === undefined ? 'UTC' : string(item.timeZone); assertIanaTimezone(timezone); result.set(id, { id: stableId('google', connectionId, id), remoteId: id, title: typeof item.summary === 'string' ? item.summary : id, timezone, color: typeof item.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(item.backgroundColor) ? item.backgroundColor : '#668575', access: item.deleted ? 'none' : access(item.accessRole) }) }
        if (!body.nextPageToken) return [...result.values()]
        pageToken = string(body.nextPageToken); if (seen.has(pageToken)) throw new CalendarProviderError('incomplete'); seen.add(pageToken)
      } throw new CalendarProviderError('incomplete')
    },
    async pullChanges(request) {
      const upserts = new Map<string, ProviderEvent>(); const deleted = new Set<string>(); const seen = new Set<string>(); let pageToken: string | undefined; let count = 0; let bytes = 0
      for (let page = 0; page < 100; page++) {
        const body = await get({ operation: 'google.events', connectionId: request.connectionId, calendarId: request.calendarId, ...(request.cursor ? { syncToken: request.cursor } : {}), ...(pageToken ? { pageToken } : {}) })
        const permission = access(body.accessRole)
        if (permission !== 'details') return { delta: { upserts: [], deletedRemoteIds: [], access: permission }, full: true, nextCursor: null }
        for (const raw of array(body.items ?? [])) { if (++count > 50_000) throw new CalendarProviderError('incomplete'); const value = record(raw); const id = string(value.id); if (value.status === 'cancelled') { upserts.delete(id); deleted.add(id) } else { const item = normalizeGoogleEvent(value, request); bytes += new TextEncoder().encode(JSON.stringify(item)).length; if (bytes > 32 * 1024 * 1024) throw new CalendarProviderError('incomplete'); upserts.set(id, item); deleted.delete(id) } }
        if (!body.nextPageToken) return { delta: { upserts: [...upserts.values()], deletedRemoteIds: [...deleted], access: permission }, nextCursor: string(body.nextSyncToken), full: request.cursor === null }
        pageToken = string(body.nextPageToken); if (seen.has(pageToken)) throw new CalendarProviderError('incomplete'); seen.add(pageToken)
      } throw new CalendarProviderError('incomplete')
    },
    async queryFreeBusy(connectionId, calendarIds, startAt, endAt, now) {
      const start = instant(startAt); const end = instant(endAt); if (start >= end) throw new CalendarProviderError('invalid-request')
      const result: BusyResult[] = []
      for (let offset = 0; offset < calendarIds.length; offset += 50) {
        const chunk = calendarIds.slice(offset, offset + 50); const body = await get({ operation: 'google.freebusy', connectionId, calendarIds: chunk, startAt: start, endAt: end }); const calendars = record(body.calendars)
        for (const calendarId of chunk) { const item = calendars[calendarId] === undefined ? null : record(calendars[calendarId]); const error = !item || (Array.isArray(item.errors) && item.errors.length) ? 'unknown' : null
          const intervals = error ? [] : array(item!.busy).map((raw) => { const entry = record(raw); const startAt = instant(entry.start); const endAt = instant(entry.end); if (startAt >= endAt) throw new CalendarProviderError('invalid-response'); return { startAt, endAt } })
          result.push({ calendarId, startAt: start, endAt: end, fetchedAt: instant(now), expiresAt: new Date(Date.parse(now) + 300_000).toISOString(), intervals, error }) }
      } return result
    },
  }
}
