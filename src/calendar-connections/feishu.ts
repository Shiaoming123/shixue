import { parseCalendarEventTime } from '../domain/workspace/parse.ts'
import { assertIanaTimezone } from '../domain/recurrence/timezone.ts'
import { access, instant, array, CalendarProviderError, checkHttp, record, safeSourceUrl, safeNormalize, stableId, string, type CalendarDescriptor, type FeishuBusyTarget, type FeishuBusyResult, type CalendarProviderPort, type ProviderEvent, type ProviderReadTransport, type PullRequest } from './types.ts'

export function normalizeFeishuEvent(raw: unknown, request: PullRequest): ProviderEvent {
  return safeNormalize(() => {
  const value = record(raw); const remoteId = string(value.event_id)
  if ((value.recurrence !== undefined && value.recurrence !== '') || value.recurring_event_id !== undefined) throw new CalendarProviderError('unsupported-recurrence')
  const start = record(value.start_time); const end = record(value.end_time)
  const epoch = (value: unknown) => { const number = Number(string(value)); if (!Number.isFinite(number)) throw new CalendarProviderError('invalid-response'); return new Date(number * 1000).toISOString() }
  const time = start.date ? parseCalendarEventTime({ kind: 'all-day', startOn: start.date, endOnExclusive: end.date }) : parseCalendarEventTime({ kind: 'fixed', startAt: epoch(start.timestamp), endAt: epoch(end.timestamp), timezone: start.timezone ?? request.timezone })
  return { remoteId, sourceUrl: safeSourceUrl(value.app_link, 'feishu'), event: { id: stableId('feishu', request.connectionId, request.calendarId, remoteId), sourceId: stableId('feishu', request.connectionId, request.calendarId), revision: 1, title: typeof value.summary === 'string' && value.summary ? value.summary : '日程', notes: typeof value.description === 'string' ? value.description : '', location: value.location && typeof record(value.location).name === 'string' ? String(record(value.location).name) : '', meetingUrl: null, organizer: null, attendees: [], availability: value.free_busy_status === 'free' ? 'free' : 'busy', status: value.status === 'tentative' ? 'tentative' : 'confirmed', time, recurrence: null, createdAt: request.now, updatedAt: request.now, deletedAt: null } }
  })
}
export function createFeishuCalendarProvider(read: ProviderReadTransport, options: { fallbackTimezone?: string } = {}): CalendarProviderPort<FeishuBusyTarget, FeishuBusyResult> {
  const get = async (request: Parameters<ProviderReadTransport>[0]) => {
    const response = await read(request)
    if (response.status === 429 || response.status >= 500) checkHttp(response)
    const body = record(response.body)
    if (body.code === 190008) throw new CalendarProviderError('cursor-expired')
    if (body.code === 190009) throw new CalendarProviderError('invalid-request')
    if ([191002, 191003].includes(Number(body.code))) throw new CalendarProviderError('permission')
    if ([190004, 190005, 190010].includes(Number(body.code))) throw new CalendarProviderError('retryable', response.retryAfterSeconds)
    checkHttp(response); if (body.code !== 0) throw new CalendarProviderError('invalid-response')
    return record(body.data)
  }
  return {
    async listCalendars(connectionId) {
      if (!options.fallbackTimezone) throw new CalendarProviderError('invalid-request')
      const fallbackTimezone = options.fallbackTimezone
      safeNormalize(() => assertIanaTimezone(fallbackTimezone))
      const calendars = new Map<string, CalendarDescriptor>(); const seen = new Set<string>(); let pageToken: string | undefined; let count = 0
      for (let page = 0; page < 100; page++) {
        const data = await get({ operation: 'feishu.calendars', connectionId, pageSize: 500, ...(pageToken ? { pageToken } : {}) })
        for (const raw of array(data.calendar_list ?? [])) {
          if (++count > 50_000) throw new CalendarProviderError('incomplete')
          const entry = record(raw); const remoteId = string(entry.calendar_id)
          const color = typeof entry.color === 'number' && Number.isInteger(entry.color) && entry.color >= 0 && entry.color <= 0xffffff ? `#${entry.color.toString(16).padStart(6, '0')}` : '#668575'
          calendars.set(remoteId, { id: stableId('feishu', connectionId, remoteId), remoteId, title: typeof entry.summary_alias === 'string' && entry.summary_alias ? entry.summary_alias : typeof entry.summary === 'string' && entry.summary ? entry.summary : remoteId, timezone: fallbackTimezone, timezoneSource: 'fallback', color, access: entry.is_deleted === true ? 'none' : access(entry.role), eventsSupported: ['primary', 'shared', 'resource'].includes(String(entry.type)) })
        }
        if (data.has_more === false) return [...calendars.values()]
        if (data.has_more !== true) throw new CalendarProviderError('invalid-response')
        pageToken = string(data.page_token); if (seen.has(pageToken)) throw new CalendarProviderError('incomplete'); seen.add(pageToken)
      } throw new CalendarProviderError('incomplete')
    },
    async queryFreeBusy(connectionId, targets, startAt, endAt, now) {
      const start = instant(startAt); const end = instant(endAt); const fetchedAt = instant(now)
      if (start >= end || targets.length > 100) throw new CalendarProviderError('invalid-request')
      for (const target of targets) {
        if (!target || typeof target !== 'object' || (target.kind !== 'user' && target.kind !== 'room')) throw new CalendarProviderError('invalid-request')
        const keys = target.kind === 'user' ? ['kind', 'userId', 'userIdType'] : ['kind', 'roomId']
        if (Object.keys(target).some((key) => !keys.includes(key))) throw new CalendarProviderError('invalid-request')
        if (target.kind === 'user') { string(target.userId); if (!['open_id', 'union_id', 'user_id'].includes(target.userIdType)) throw new CalendarProviderError('invalid-request') } else string(target.roomId)
      }
      const result: FeishuBusyResult[] = []
      for (const target of targets) {
        const base = { target: structuredClone(target), startAt: start, endAt: end, fetchedAt, expiresAt: new Date(Date.parse(fetchedAt) + 300_000).toISOString() }
        try {
          const data = await get({ operation: 'feishu.freebusy', connectionId, busyTarget: target, startAt: start, endAt: end })
          const intervals = array(data.freebusy_list ?? []).map((raw) => { const entry = record(raw); const startAt = instant(entry.start_time); const endAt = instant(entry.end_time); if (startAt >= endAt) throw new CalendarProviderError('invalid-response'); return { startAt, endAt } })
          result.push({ ...base, intervals, error: null })
        } catch (error) { result.push({ ...base, intervals: [], error: error instanceof CalendarProviderError ? error.code : 'unknown' }) }
      }
      return result
    },
    async pullChanges(request) {
      if (!request.cursor && !request.anchorTime) throw new CalendarProviderError('invalid-request')
      const upserts = new Map<string, ProviderEvent>(); const deleted = new Set<string>(); const seen = new Set<string>(); let pageToken: string | undefined; let count = 0; let bytes = 0
      for (let page = 0; page < 100; page++) {
        const response = await read({ operation: 'feishu.events', connectionId: request.connectionId, calendarId: request.calendarId, ...(request.cursor ? { syncToken: request.cursor } : { anchorTime: request.anchorTime }), ...(pageToken ? { pageToken } : {}) })
        if (response.status === 429 || response.status >= 500) checkHttp(response)
        const body = record(response.body)
        if (body.code === 190008) throw new CalendarProviderError('cursor-expired')
        if (body.code === 190009) throw new CalendarProviderError('invalid-request')
        if ([191002, 191003].includes(Number(body.code))) throw new CalendarProviderError('permission')
        if ([190004, 190005, 190010].includes(Number(body.code))) throw new CalendarProviderError('retryable', response.retryAfterSeconds)
        checkHttp(response); if (body.code !== 0) throw new CalendarProviderError('invalid-response')
        const data = record(body.data)
        for (const raw of array(data.items ?? [])) { if (++count > 50_000) throw new CalendarProviderError('incomplete'); const value = record(raw); const id = string(value.event_id); if (value.is_deleted === true || value.status === 'cancelled') { upserts.delete(id); deleted.add(id) } else { const event = normalizeFeishuEvent(value, request); bytes += new TextEncoder().encode(JSON.stringify(event)).length; if (bytes > 32 * 1024 * 1024) throw new CalendarProviderError('incomplete'); upserts.set(id, event); deleted.delete(id) } }
        if (data.has_more === false) return { delta: { upserts: [...upserts.values()], deletedRemoteIds: [...deleted], access: 'details' }, full: request.cursor === null, nextCursor: string(data.sync_token) }
        if (data.has_more !== true) throw new CalendarProviderError('invalid-response')
        pageToken = string(data.page_token); if (seen.has(pageToken)) throw new CalendarProviderError('incomplete'); seen.add(pageToken)
      } throw new CalendarProviderError('incomplete')
    },
  }
}
