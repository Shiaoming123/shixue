import { array, record, string } from './types.ts'
import { parseCalendarEventTime } from '../domain/workspace/parse.ts'
import { writePreviewHash } from './write-outbox.ts'
import { createGoogleFutureReader } from './google-future.ts'
import type { CalendarWriter, WriteFields, WriteIntent, WritePreview, WriteResponse, WriteSession } from './write-outbox.ts'

export interface GoogleWriteRequest { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; headers: Record<string, string>; query: Record<string, string>; body?: Record<string, unknown> }
export interface GoogleWriteTransport {
  kind: 'fake'
  session(connectionId: string): WriteSession
  request(connectionId: string, request: GoogleWriteRequest): Promise<{ status: number; body?: unknown }>
}
const unknown = (): WriteResponse => ({ kind: 'unknown' })
const invalid = (): never => { throw new Error('GOOGLE_WRITE_UNSUPPORTED') }
function single(value: Record<string, unknown>) { if (value.recurrence !== undefined || value.recurringEventId !== undefined || (value.eventType !== undefined && value.eventType !== 'default')) invalid() }
function eventId(intent: WriteIntent) { return intent.kind === 'recurring.single' ? intent.instance.eventId : intent.kind === 'recurring.series' ? intent.parent.eventId : 'eventId' in intent ? intent.eventId : null }
function etag(intent: WriteIntent) { return intent.kind === 'recurring.single' ? intent.instance.etag : intent.kind === 'recurring.series' ? intent.parent.etag : 'etag' in intent ? intent.etag : null }
function recurring(value: Record<string, unknown>, intent: WriteIntent) {
  if (intent.kind === 'recurring.single') { const original = record(value.originalStartTime), start = original.dateTime ?? original.date; const expected = /^\d{4}-\d{2}-\d{2}$/.test(intent.originalStart) ? intent.originalStart : new Date(intent.originalStart).toISOString(); if (value.recurringEventId !== intent.parent.eventId || start !== expected) invalid(); return }
  if (intent.kind === 'recurring.series') { if (!Array.isArray(value.recurrence) || value.recurringEventId !== undefined) invalid(); return }
  single(value)
}
function bodyFields(fields: WriteFields): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (Object.keys(fields).some((key) => !['title', 'time', 'attendees'].includes(key))) invalid()
  if (fields.title !== undefined) body.summary = string(fields.title)
  if (fields.time) {
    const time = parseCalendarEventTime(fields.time)
    if (time.kind === 'all-day') { body.start = { date: time.startOn }; body.end = { date: time.endOnExclusive } }
    else if (time.kind === 'fixed') { body.start = { dateTime: time.startAt, timeZone: time.timezone }; body.end = { dateTime: time.endAt, timeZone: time.timezone } }
    else invalid()
  }
  if (fields.attendees) body.attendees = fields.attendees.map(({ email, optional }) => ({ email, optional, responseStatus: 'needsAction' }))
  return body
}
function proof(preview: WritePreview, value: Record<string, unknown>): WriteResponse {
  const marker = value.extendedProperties === undefined ? null : record(record(value.extendedProperties).private ?? {})
  if (value.id !== preview.eventId || typeof value.etag !== 'string' || !value.etag || !marker || marker.meowOperationId !== preview.operationId || marker.meowOperationHash !== preview.hash) return unknown()
  const intent = preview.intent
  if (intent.kind === 'delete') return unknown()
  if (intent.kind === 'cancel' && value.status !== 'cancelled') return unknown()
  if (intent.kind === 'create' || intent.kind === 'update') {
    const desired = bodyFields(intent.fields)
    if (desired.summary !== undefined && desired.summary !== value.summary) return unknown()
    for (const field of ['start', 'end']) if (desired[field] !== undefined) {
      const expected = record(desired[field]); const actual = record(value[field])
      if (expected.date !== undefined ? expected.date !== actual.date : Date.parse(string(expected.dateTime)) !== Date.parse(string(actual.dateTime)) || expected.timeZone !== actual.timeZone) return unknown()
    }
    if (intent.fields.attendees) {
      const desiredAttendees = intent.fields.attendees.map(({ email, optional }) => `${email.toLowerCase()}:${optional}`).sort()
      const actual = array(value.attendees ?? []).map((entry) => { const item = record(entry); return `${string(item.email).toLowerCase()}:${item.optional === true}` }).sort()
      if (JSON.stringify(desiredAttendees) !== JSON.stringify(actual)) return unknown()
    }
  }
  if (intent.kind === 'recurring.single' && intent.action === 'update') {
    const desired = bodyFields(intent.fields)
    for (const field of ['start', 'end']) if (JSON.stringify(desired[field]) !== JSON.stringify(value[field])) return unknown()
  }
  if (intent.kind === 'recurring.series' && intent.action === 'update') {
    const desired = bodyFields(intent.fields)
    if (desired.summary !== undefined && desired.summary !== value.summary) return unknown()
    for (const field of ['start', 'end']) if (desired[field] !== undefined && JSON.stringify(desired[field]) !== JSON.stringify(value[field])) return unknown()
    if (intent.recurrence !== undefined && JSON.stringify(intent.recurrence) !== JSON.stringify(value.recurrence)) return unknown()
  }
  if ((intent.kind === 'recurring.single' || intent.kind === 'recurring.series') && intent.action === 'cancel' && value.status !== 'cancelled') return unknown()
  if (intent.kind === 'rsvp' && !array(value.attendees ?? []).some((raw) => { const item = record(raw); return item.self === true && item.email === intent.selfEmail && item.responseStatus === intent.response })) return unknown()
  return { kind: 'applied', result: { operationId: preview.operationId, connectionId: preview.connectionId, calendarId: preview.calendarId, eventId: preview.eventId, etag: value.etag } }
}

/** Request-level contract only. There is no fetch/native sender; only an explicitly injected fake transport. */
export function createGoogleCalendarWriter(transport?: GoogleWriteTransport, loadWorkspace?: () => Promise<unknown>): CalendarWriter {
  const check = (preview: WritePreview, epoch?: number) => {
    if (!transport || transport.kind !== 'fake') throw new Error('WRITE_UNAVAILABLE')
    const session = transport.session(preview.connectionId)
    if (!session.connected || !session.canWrite || (epoch !== undefined && session.generation !== epoch)) throw new Error('WRITE_DISCONNECTED')
    if (!['all', 'externalOnly', 'none'].includes(preview.sendUpdates) || preview.intent.kind === 'recurring.future') invalid()
    if (eventId(preview.intent) !== null && eventId(preview.intent) !== preview.eventId) invalid()
    return session.generation
  }
  const path = (preview: WritePreview) => `/calendar/v3/calendars/${encodeURIComponent(preview.calendarId)}/events`
  const verify = async (preview: WritePreview) => { const { hash, ...content } = preview; if (await writePreviewHash(content) !== hash) throw new Error('WRITE_PREVIEW_CHANGED') }
  const read = async (preview: WritePreview) => {
    await verify(preview)
    const epoch = check(preview)
    const response = await transport!.request(preview.connectionId, { method: 'GET', path: `${path(preview)}/${encodeURIComponent(preview.eventId)}`, headers: {}, query: {} })
    check(preview, epoch); return response
  }
  const inspect = async (preview: WritePreview) => {
    preview = structuredClone(preview)
    await verify(preview)
    const epoch = check(preview)
    const calendar = await transport!.request(preview.connectionId, { method: 'GET', path: `/calendar/v3/users/me/calendarList/${encodeURIComponent(preview.calendarId)}`, headers: {}, query: {} })
    check(preview, epoch)
    const descriptor = record(calendar.body)
    if (calendar.status !== 200 || descriptor.id !== preview.calendarId || !['owner', 'writer'].includes(String(descriptor.accessRole))) throw new Error('WRITE_PERMISSION')
    let response = await read(preview); check(preview, epoch)
    if (preview.intent.kind === 'recurring.single') {
      let pageToken: string | undefined; const seen = new Set<string>(); let found: Record<string, unknown> | null = null
      for (let page = 0; page < 100; page++) {
        const listed = await transport!.request(preview.connectionId, { method: 'GET', path: `${path(preview)}/${encodeURIComponent(preview.intent.parent.eventId)}/instances`, headers: {}, query: { showDeleted: 'true', maxResults: '250', ...(pageToken ? { pageToken } : {}) } })
        check(preview, epoch); if (listed.status !== 200) throw new Error('WRITE_READ_FAILED')
        const body = record(listed.body)
        for (const raw of array(body.items ?? [])) { const item = record(raw); if (item.id === preview.intent.instance.eventId) found = item }
        if (body.nextPageToken === undefined) break
        pageToken = string(body.nextPageToken); if (seen.has(pageToken)) invalid(); seen.add(pageToken)
      }
      if (!found) throw new Error('WRITE_READ_FAILED')
      response = { status: 200, body: found }
    }
    if (response.status === 404 && preview.intent.kind === 'create') return { connectionId: preview.connectionId, calendarId: preview.calendarId, eventId: preview.eventId, canWrite: true, etag: null, selfEmail: null }
    if (response.status !== 200) throw new Error('WRITE_READ_FAILED')
    const value = record(response.body); recurring(value, preview.intent)
    if (value.id !== preview.eventId) invalid()
    return { connectionId: preview.connectionId, calendarId: preview.calendarId, eventId: preview.eventId, canWrite: value.locked !== true, etag: string(value.etag), selfEmail: array(value.attendees ?? []).map(record).find((item) => item.self === true)?.email as string | undefined ?? null }
  }
  return {
    ...(transport && loadWorkspace ? { readFuture: createGoogleFutureReader(transport, loadWorkspace) } : {}),
    mode: transport ? 'fake' : 'native',
    session: (connectionId) => transport?.session(connectionId) ?? { connected: false, generation: 0, canWrite: false },
    inspect,
    async execute(preview) {
      preview = structuredClone(preview)
      const epoch = check(preview); const remote = await inspect(preview); check(preview, epoch)
      const intent = preview.intent
      if (!remote.canWrite) return { kind: 'rejected', code: 'permission' }
      if (intent.kind === 'create' ? remote.etag !== null : remote.etag !== etag(intent)) return { kind: 'conflict' }
      if (intent.kind === 'rsvp' && remote.selfEmail !== intent.selfEmail) return { kind: 'rejected', code: 'permission' }
      const marker = { extendedProperties: { private: { meowOperationId: preview.operationId, meowOperationHash: preview.hash } } }
      let body: Record<string, unknown> | undefined
      if (intent.kind === 'create') { if (!/^[a-v0-9]{5,1024}$/.test(preview.eventId)) invalid(); body = { id: preview.eventId, ...bodyFields(intent.fields), ...marker } }
      else if (intent.kind === 'update') {
        if (intent.fields.attendees) invalid() // Full attendee edits need a complete authoritative read/merge contract.
        body = { ...bodyFields(intent.fields), ...marker }
      } else if (intent.kind === 'cancel') body = { status: 'cancelled', ...marker }
      else if (intent.kind === 'recurring.single') body = intent.action === 'cancel' ? { status: 'cancelled', ...marker } : { ...bodyFields(intent.fields), ...marker }
      else if (intent.kind === 'recurring.series') body = intent.action === 'cancel' ? { status: 'cancelled', ...marker } : { ...bodyFields(intent.fields), ...(intent.recurrence === undefined ? {} : { recurrence: intent.recurrence }), ...marker }
      else if (intent.kind === 'rsvp') body = { attendeesOmitted: true, attendees: [{ email: intent.selfEmail, responseStatus: intent.response }], ...marker }
      else if (intent.kind !== 'delete') invalid()
      const request: GoogleWriteRequest = { method: intent.kind === 'create' ? 'POST' : intent.kind === 'delete' ? 'DELETE' : 'PATCH', path: `${path(preview)}${intent.kind === 'create' ? '' : `/${encodeURIComponent(preview.eventId)}`}`, headers: intent.kind === 'create' ? {} : { 'If-Match': etag(intent)! }, query: { sendUpdates: preview.sendUpdates }, ...(body ? { body } : {}) }
      check(preview, epoch)
      let response: { status: number; body?: unknown }
      try { response = await transport!.request(preview.connectionId, request); check(preview, epoch) } catch { return unknown() }
      if (response.status === 412 || response.status === 409) return { kind: 'conflict' }
      if (response.status === 401 || response.status === 403) return { kind: 'rejected', code: 'permission' }
      if (response.status === 429) return { kind: 'rejected', code: 'quota' }
      if (response.status === 204 && intent.kind === 'delete') return { kind: 'applied', result: { operationId: preview.operationId, connectionId: preview.connectionId, calendarId: preview.calendarId, eventId: preview.eventId, etag: null } }
      if (response.status !== 200 && response.status !== 201) return unknown()
      try { return proof(preview, record(response.body)) } catch { return unknown() }
    },
    async reconcile(preview) {
      preview = structuredClone(preview)
      try { const response = await read(preview); if (response.status !== 200) return unknown(); const value = record(response.body); recurring(value, preview.intent); return proof(preview, value) } catch { return unknown() }
    },
  }
}
