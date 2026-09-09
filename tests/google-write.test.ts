import test from 'node:test'
import assert from 'node:assert/strict'
import { createGoogleCalendarWriter, type GoogleWriteRequest, type GoogleWriteTransport } from '../src/calendar-connections/google-write.ts'
import { CalendarWriteOutbox, type WriteIntent, type WriteOutboxStore } from '../src/calendar-connections/write-outbox.ts'
const prepare = async (intent: WriteIntent) => new CalendarWriteOutbox({} as WriteOutboxStore, createGoogleCalendarWriter(), async () => {}).prepare('c', 'a@b', intent, 'all')
const create: WriteIntent = { kind: 'create', fields: { title: 'Meeting', time: { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-10' }, attendees: [{ email: 'guest@example.com', optional: true }] } }
function fake() {
  const calls: GoogleWriteRequest[] = []; let event: Record<string, unknown> | null = null; let status = 200; let lose = false
  const transport: GoogleWriteTransport = { kind: 'fake', session: () => ({ connected: true, canWrite: true, generation: 1 }), async request(_connection, request) {
    calls.push(structuredClone(request))
    if (request.path.includes('/calendarList/')) return { status: 200, body: { id: 'a@b', accessRole: 'owner' } }
    if (request.path.endsWith('/instances')) return { status: 200, body: { items: event ? [structuredClone(event)] : [] } }
    if (request.method === 'GET') return event ? { status: 200, body: structuredClone(event) } : { status: 404 }
    if (status !== 200) return { status }
    if (request.method === 'DELETE') { event = null; if (lose) throw new Error('lost'); return { status: 204 } }
    const body = request.body!
    event = { ...(event ?? {}), ...body, etag: 'v2' }
    if (body.attendeesOmitted) event.attendees = [{ email: 'me@example.com', self: true, responseStatus: (body.attendees as Array<Record<string, unknown>>)[0]!.responseStatus }, { email: 'other@example.com', responseStatus: 'accepted' }]
    if (lose) throw new Error('lost'); return { status: 200, body: structuredClone(event) }
  } }
  return { writer: createGoogleCalendarWriter(transport), calls, event: () => event, setEvent: (value: Record<string, unknown> | null) => { event = value }, setStatus: (value: number) => { status = value }, lose: () => { lose = true } }
}
test('create payload uses persistent ID, explicit sendUpdates, private operation proof and exclusive end', async () => {
  const preview = await prepare(create); const f = fake(); f.lose()
  assert.deepEqual(await f.writer.execute(preview), { kind: 'unknown' })
  const request = f.calls.find((call) => call.method === 'POST')!
  assert.equal(request.path, '/calendar/v3/calendars/a%40b/events'); assert.deepEqual(request.query, { sendUpdates: 'all' })
  assert.equal(request.body!.id, preview.eventId); assert.deepEqual(request.body!.end, { date: '2026-09-10' })
  assert.deepEqual(request.body!.attendees, [{ email: 'guest@example.com', optional: true, responseStatus: 'needsAction' }])
  assert.equal((await f.writer.reconcile(preview)).kind, 'applied'); assert.equal(f.calls.filter((call) => call.method !== 'GET').length, 1)
  const wrong = structuredClone(f.event()!); (wrong.extendedProperties as { private: Record<string, string> }).private.meowOperationHash = 'wrong'; f.setEvent(wrong)
  assert.equal((await f.writer.reconcile(preview)).kind, 'unknown')
})
test('update/cancel/delete carry If-Match and separate actual HTTP semantics; 412 stops', async () => {
  for (const kind of ['update', 'cancel', 'delete'] as const) {
    const f = fake(); f.setEvent({ id: 'e', etag: 'v1', summary: 'Before' })
    const preview = await prepare(kind === 'update' ? { kind, eventId: 'e', etag: 'v1', fields: { title: 'After' } } : { kind, eventId: 'e', etag: 'v1' })
    assert.equal((await f.writer.execute(preview)).kind, 'applied')
    const request = f.calls.find((call) => call.method !== 'GET')!; assert.deepEqual(request.headers, { 'If-Match': 'v1' }); assert.equal(request.method, kind === 'delete' ? 'DELETE' : 'PATCH')
    if (kind === 'cancel') assert.equal(request.body!.status, 'cancelled')
    const conflict = fake(); conflict.setEvent({ id: 'e', etag: 'v1' }); conflict.setStatus(412)
    assert.equal((await conflict.writer.execute(preview)).kind, 'conflict'); assert.equal(conflict.calls.filter((call) => call.method !== 'GET').length, 1)
  }
})
test('RSVP writes only authenticated self with attendeesOmitted, preserving other attendees', async () => {
  const preview = await prepare({ kind: 'rsvp', eventId: 'e', etag: 'v1', selfEmail: 'me@example.com', response: 'declined' })
  const f = fake(); f.setEvent({ id: 'e', etag: 'v1', attendees: [{ self: true, email: 'me@example.com' }, { email: 'other@example.com', responseStatus: 'accepted' }] })
  assert.equal((await f.writer.execute(preview)).kind, 'applied')
  const request = f.calls.find((call) => call.method === 'PATCH')!
  assert.equal(request.body!.attendeesOmitted, true); assert.deepEqual(request.body!.attendees, [{ email: 'me@example.com', responseStatus: 'declined' }])
  assert.equal((f.event()!.attendees as Array<Record<string, unknown>>)[1]!.responseStatus, 'accepted')
})
test('missing delete response remains unknown on 404; changed preview and all recurrence scopes never send', async () => {
  const preview = await prepare({ kind: 'delete', eventId: 'e', etag: 'v1' }); const f = fake(); f.setEvent({ id: 'e', etag: 'v1' }); f.lose()
  assert.equal((await f.writer.execute(preview)).kind, 'unknown'); assert.equal((await f.writer.reconcile(preview)).kind, 'unknown')
  for (const recurrence of [{ recurrence: ['RRULE:FREQ=DAILY'] }, { recurringEventId: 'parent' }]) { const series = fake(); series.setEvent({ id: 'e', etag: 'v1', ...recurrence }); await assert.rejects(series.writer.execute(preview), /UNSUPPORTED/); assert.ok(series.calls.every((call) => call.method === 'GET')) }
  const changed = fake(); await assert.rejects(changed.writer.execute({ ...preview, sendUpdates: 'none' }), /WRITE_PREVIEW_CHANGED/); assert.equal(changed.calls.length, 0)
  await assert.rejects(createGoogleCalendarWriter().execute(preview), /WRITE_UNAVAILABLE/)
})
test('recurring future remains disabled before it can send', async () => {
  await assert.rejects(prepare({ kind: 'recurring.future' } as WriteIntent), /WRITE_UNSUPPORTED/)
})
test('recurring single freezes the parent, original instance and instance ETag', async () => {
  const f = fake(); f.setEvent({ id: 'instance', etag: 'v1', recurringEventId: 'parent', originalStartTime: { dateTime: '2026-09-09T09:00:00.000Z' }, start: { dateTime: '2026-09-09T09:00:00.000Z', timeZone: 'UTC' }, end: { dateTime: '2026-09-09T10:00:00.000Z', timeZone: 'UTC' } })
  const preview = await prepare({ kind: 'recurring.single', parent: { eventId: 'parent', etag: 'parent-v1' }, originalStart: '2026-09-09T09:00:00.000Z', instance: { eventId: 'instance', etag: 'v1' }, action: 'update', fields: { time: { kind: 'fixed', startAt: '2026-09-09T11:00:00.000Z', endAt: '2026-09-09T12:00:00.000Z', timezone: 'UTC' } } })
  assert.equal((await f.writer.execute(preview)).kind, 'applied')
  const request = f.calls.find((call) => call.method === 'PATCH')!
  assert.equal(request.path.endsWith('/events/instance'), true); assert.deepEqual(request.headers, { 'If-Match': 'v1' })
  assert.ok(f.calls.some((call) => call.path.endsWith('/events/parent/instances') && call.query.maxResults === '250'))
})
test('recurring series rejects complex RRULE before sending', async () => {
  for (const recurrence of ['RRULE:FREQ=MONTHLY;BYSETPOS=-1', 'RRULE:FREQ=DAILY;INTERVAL=0', 'RRULE:FREQ=DAILY;COUNT=not-a-number', 'RRULE:FREQ=DAILY;UNTIL=20261340', 'RRULE:FREQ=DAILY;UNTIL=20260909T256060Z']) await assert.rejects(prepare({ kind: 'recurring.series', parent: { eventId: 'parent', etag: 'v1' }, action: 'update', fields: { title: 'New' }, recurrence: [recurrence] }), /WRITE_UNSUPPORTED/)
})
