import assert from 'node:assert/strict'
import test from 'node:test'
import { createGoogleCalendarProvider, normalizeGoogleEvent } from '../src/calendar-connections/google.ts'
import { createFeishuCalendarProvider } from '../src/calendar-connections/feishu.ts'
import { CalendarProviderError, type ProviderReadRequest, type PullRequest } from '../src/calendar-connections/types.ts'
import { reconcileCalendar, type ConnectorBatch, type ConnectorCheckpoint, type ConnectorStore } from '../src/calendar-connections/reconcile.ts'
const request: PullRequest = { connectionId: 'a', calendarId: 'same', timezone: 'UTC', now: '2026-09-09T12:00:00Z', cursor: null }
const event = { id: 'one', summary: 'Meeting', start: { date: '2026-09-09' }, end: { date: '2026-09-11' }, htmlLink: 'javascript:alert(1)', access_token: 'SECRET_SENTINEL' }
const code = (code: string) => (error: unknown) => error instanceof CalendarProviderError && error.code === code

test('Google ordinary full and incremental pulls preserve organizer, roles and every RSVP state', async () => {
  const raw = { ...event, organizer: { email: 'owner@example.invalid', displayName: 'Organizer' }, attendees: ['needsAction', 'accepted', 'declined', 'tentative'].map((responseStatus, index) => ({ email: `person${index}@example.invalid`, displayName: `Person ${index}`, optional: index % 2 === 1, responseStatus })) }
  const expected = normalizeGoogleEvent(raw, request).event
  assert.deepEqual(expected.organizer, { email: 'owner@example.invalid', name: 'Organizer' })
  assert.deepEqual(expected.attendees.map(({ role, response }) => [role, response]), [['required', 'unknown'], ['optional', 'accepted'], ['required', 'declined'], ['optional', 'tentative']])
  for (const cursor of [null, 'current']) {
    const provider = createGoogleCalendarProvider(async () => ({ status: 200, body: { accessRole: 'reader', items: [raw], nextSyncToken: 'next' } }))
    const result = await provider.pullChanges({ ...request, cursor })
    assert.deepEqual(result.delta.upserts[0]!.event, expected)
    assert.equal(result.full, cursor === null)
  }
})

test('Google refuses incomplete or unrepresentable participant lists instead of clearing them', () => {
  assert.throws(() => normalizeGoogleEvent({ ...event, attendeesOmitted: true }, request), code('incomplete'))
  for (const patch of [{ resource: true }, { additionalGuests: 2 }]) assert.throws(() => normalizeGoogleEvent({ ...event, attendees: [{ email: 'room@example.invalid', ...patch }] }, request), code('unsupported-operation'))
  for (const attendees of [[{ email: 'bad' }], [{ email: 'a@example.invalid', responseStatus: 'custom' }], [{ email: 'a@example.invalid' }, { email: 'A@example.invalid' }]]) assert.throws(() => normalizeGoogleEvent({ ...event, attendees }, request), code('invalid-response'))
})

test('Google pagination keeps the base cursor, handles empty intermediate pages, dedupes and accepts sparse tombstones', async () => {
  const calls: ProviderReadRequest[] = []
  const pages = [{ items: [event], nextPageToken: 'p2' }, { items: [], nextPageToken: 'p3' }, { items: [event, { id: 'gone', status: 'cancelled' }], nextSyncToken: 'next' }]
  const provider = createGoogleCalendarProvider(async (value) => { calls.push(value); return { status: 200, body: { accessRole: 'reader', ...pages[calls.length - 1] } } })
  const result = await provider.pullChanges({ ...request, cursor: 'old' })
  assert.equal(calls.length, 3); assert.ok(calls.every((item) => item.syncToken === 'old'))
  assert.equal(result.full, false); assert.equal(result.nextCursor, 'next')
  assert.equal(result.delta.upserts.length, 1); assert.deepEqual(result.delta.deletedRemoteIds, ['gone'])
  assert.equal(result.delta.upserts[0]!.sourceUrl, null)
  assert.equal(JSON.stringify(result).includes('SECRET_SENTINEL'), false)
  assert.notEqual(normalizeGoogleEvent(event, request).event.id, normalizeGoogleEvent(event, { ...request, connectionId: 'b' }).event.id)
  assert.deepEqual(result.delta.upserts[0]!.event.time, { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-11' })
})

test('errors, recurring resources and page cycles fail loudly instead of reporting a complete mirror', async () => {
  for (const [status, expected] of [[429, 'retryable'], [503, 'retryable'], [410, 'cursor-expired']] as const) await assert.rejects(createGoogleCalendarProvider(async () => ({ status, body: {} })).pullChanges(request), code(expected))
  await assert.rejects(createGoogleCalendarProvider(async () => ({ status: 403, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } })).pullChanges(request), code('retryable'))
  await assert.rejects(createGoogleCalendarProvider(async () => ({ status: 200, body: { accessRole: 'reader', items: [event], nextPageToken: 'loop' } })).pullChanges(request), code('incomplete'))
  for (const recurrence of [['RRULE:FREQ=MONTHLY;BYSETPOS=-1'], ['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY']]) assert.throws(() => normalizeGoogleEvent({ ...event, recurrence }, request), code('unsupported-recurrence'))
  const result = await createGoogleCalendarProvider(async () => ({ status: 200, body: { accessRole: 'freeBusyReader', items: [event] } })).pullChanges(request)
  assert.deepEqual(result.delta, { access: 'freebusy', upserts: [], deletedRemoteIds: [] }); assert.equal(result.full, true)
})

test('freebusy is independent, chunks fifty calendars, excludes titles and preserves per-calendar unknown', async () => {
  const calls: ProviderReadRequest[] = []
  const provider = createGoogleCalendarProvider(async (value) => { calls.push(value); return { status: 200, body: { calendars: Object.fromEntries(value.calendarIds!.map((id) => [id, id === '0' ? { errors: [{ reason: 'forbidden' }], summary: 'PRIVATE' } : { busy: [{ start: '2026-09-09T13:00:00Z', end: '2026-09-09T14:00:00Z' }] }])) } } })
  const busy = await provider.queryFreeBusy('a', Array.from({ length: 51 }, (_, i) => String(i)), '2026-09-09T12:00:00Z', '2026-09-09T15:00:00Z', request.now)
  assert.deepEqual(calls.map((item) => item.calendarIds!.length), [50, 1]); assert.equal(busy[0]!.error, 'unknown'); assert.deepEqual(busy[0]!.intervals, [])
  assert.equal(JSON.stringify(busy).includes('PRIVATE'), false); assert.equal(busy[1]!.expiresAt, '2026-09-09T12:05:00.000Z')
})

test('Feishu checks JSON error codes and uses fixed anchor pagination without pretending unsupported endpoints succeeded', async () => {
  for (const [value, expected] of [[190008, 'cursor-expired'], [190009, 'invalid-request'], [191002, 'permission'], [190004, 'retryable']] as const) await assert.rejects(createFeishuCalendarProvider(async () => ({ status: 400, body: { code: value } })).pullChanges({ ...request, anchorTime: '1' }), code(expected))
  let calls = 0
  const provider = createFeishuCalendarProvider(async (value) => { assert.equal(value.anchorTime, '1'); return { status: 200, body: { code: 0, data: ++calls === 1 ? { items: [], has_more: true, page_token: 'p2' } : { items: [{ event_id: 'gone', is_deleted: true }], has_more: false, sync_token: 'fresh' } } } })
  const result = await provider.pullChanges({ ...request, anchorTime: '1' })
  assert.equal(calls, 2); assert.deepEqual(result.delta.deletedRemoteIds, ['gone']); assert.equal(result.nextCursor, 'fresh')
  await assert.rejects(provider.listCalendars('a'), code('invalid-request'))
})

test('device staging resumes the same batch after ack failure and never advances on partial-page or apply failure', async () => {
  let checkpoint: ConnectorCheckpoint = { generation: 1, cursor: 'old', pending: null }
  let failAck = true; let pulls = 0; const applied: string[] = []
  const store: ConnectorStore = {
    async load() { return structuredClone(checkpoint) },
    async stage(batch, expected) { assert.equal(expected.cursor, checkpoint.cursor); checkpoint.pending = structuredClone(batch) },
    async acknowledge(id) { if (failAck) { failAck = false; throw new Error('crash before cursor commit') } assert.equal(id, checkpoint.pending!.id); checkpoint.cursor = checkpoint.pending!.result.nextCursor; checkpoint.pending = null },
    async invalidate() { checkpoint = { generation: checkpoint.generation + 1, cursor: null, pending: null } },
  }
  const port = createGoogleCalendarProvider(async () => { pulls++; return { status: 200, body: { accessRole: 'reader', items: [event], nextSyncToken: 'next' } } })
  const input = { provider: 'google' as const, port, store, request, id: () => 'batch:one', apply: async (batch: ConnectorBatch) => { applied.push(batch.id); return { batchId: batch.id, applied: true as const } } }
  await assert.rejects(reconcileCalendar(input), /crash/); assert.equal(checkpoint.cursor, 'old')
  await reconcileCalendar(input); assert.equal(checkpoint.cursor, 'next'); assert.deepEqual(applied, ['batch:one', 'batch:one']); assert.equal(pulls, 1)
  checkpoint.pending = null
  await assert.rejects(reconcileCalendar({ ...input, apply: async () => { throw new Error('CAS failed') } }), /CAS/)
  assert.equal(checkpoint.cursor, 'next'); assert.ok(checkpoint.pending)
  checkpoint.pending = null; let pages = 0
  const broken = createGoogleCalendarProvider(async () => ++pages === 1 ? { status: 200, body: { accessRole: 'reader', items: [event], nextPageToken: 'p2' } } : { status: 503, body: {} })
  await assert.rejects(reconcileCalendar({ ...input, port: broken }), code('retryable')); assert.equal(checkpoint.pending, null); assert.equal(checkpoint.cursor, 'next')
})

test('cursor expiry resets only the affected calendar and applies a full replacement only after its terminal page', async () => {
  const states = new Map<string, ConnectorCheckpoint>([['same', { generation: 4, cursor: 'expired', pending: null }], ['other', { generation: 2, cursor: 'untouched', pending: null }]])
  const store: ConnectorStore = {
    async load(_connection, calendar) { return structuredClone(states.get(calendar)!) },
    async stage(batch) { states.get(batch.calendarId)!.pending = batch },
    async invalidate(_connection, calendar, generation) { assert.equal(states.get(calendar)!.generation, generation); states.set(calendar, { generation: generation + 1, cursor: null, pending: null }) },
    async acknowledge(_id, _connection, calendar) { const state = states.get(calendar)!; state.cursor = state.pending!.result.nextCursor; state.pending = null },
  }
  let pages = 0; let applications = 0
  const port = createGoogleCalendarProvider(async (input) => { pages++; if (input.syncToken) return { status: 410, body: {} }; return { status: 200, body: input.pageToken ? { accessRole: 'reader', items: [], nextSyncToken: 'full-next' } : { accessRole: 'reader', items: [event], nextPageToken: 'last' } } })
  await reconcileCalendar({ provider: 'google', port, store, request, id: () => 'full', apply: async (batch) => { applications++; assert.equal(pages, 3); assert.equal(batch.result.full, true); assert.equal(batch.generation, 5); return { batchId: batch.id, applied: true } } })
  assert.equal(applications, 1); assert.equal(states.get('same')!.cursor, 'full-next'); assert.equal(states.get('other')!.cursor, 'untouched')
})

test('calendar directory pagination exposes permission downgrade, and invalid provider dates cannot leak raw fields', async () => {
  let page = 0
  const provider = createGoogleCalendarProvider(async () => ({ status: 200, body: ++page === 1 ? { items: [{ id: 'same', summary: 'Shared', accessRole: 'reader' }], nextPageToken: 'next' } : { items: [{ id: 'same', summary: 'Shared', accessRole: 'freeBusyReader' }, { id: 'removed', deleted: true }] } }))
  const calendars = await provider.listCalendars('a')
  assert.equal(calendars.length, 2); assert.equal(calendars[0]!.access, 'freebusy'); assert.equal(calendars[1]!.access, 'none')
  assert.throws(() => normalizeGoogleEvent({ ...event, start: { date: 'SECRET_SENTINEL' } }, request), (error: unknown) => error instanceof CalendarProviderError && !error.message.includes('SECRET_SENTINEL'))
})

test('Feishu directory uses calendar_list pages, numeric colors and explicit fallback timezone without confusing visibility with role', async () => {
  const calls: ProviderReadRequest[] = []
  const provider = createFeishuCalendarProvider(async (input) => { calls.push(input); return { status: 200, body: { code: 0, data: calls.length === 1 ? { calendar_list: [{ calendar_id: 'shared', summary: 'Public name', permissions: 'public', role: 'free_busy_reader', color: 255, type: 'shared' }], has_more: true, page_token: 'last' } : { calendar_list: [{ calendar_id: 'gone', is_deleted: true }, { calendar_id: 'external', role: 'reader', type: 'google' }], has_more: false } } } }, { fallbackTimezone: 'Asia/Shanghai' })
  const calendars = await provider.listCalendars('a')
  assert.equal(calls[1]!.pageToken, 'last'); assert.equal(calls[0]!.pageSize, 500)
  assert.equal(calendars[0]!.access, 'freebusy'); assert.equal(calendars[0]!.color, '#0000ff')
  assert.equal(calendars[0]!.timezone, 'Asia/Shanghai'); assert.equal(calendars[0]!.timezoneSource, 'fallback')
  assert.equal(calendars[1]!.access, 'none'); assert.equal(calendars[2]!.eventsSupported, false)
  const incomplete = createFeishuCalendarProvider(async () => ({ status: 200, body: { code: 0, data: { calendar_list: [], has_more: true, page_token: 'loop' } } }), { fallbackTimezone: 'UTC' })
  await assert.rejects(incomplete.listCalendars('a'), code('incomplete'))
})

test('Feishu freebusy uses exclusive explicit user or room identities and keeps partial failure unknown', async () => {
  const calls: ProviderReadRequest[] = []
  const provider = createFeishuCalendarProvider(async (input) => { calls.push(input); return input.busyTarget?.kind === 'room' ? { status: 403, body: { code: 191002, msg: 'SECRET' } } : { status: 200, body: { code: 0, data: { freebusy_list: [{ start_time: '2026-09-09T13:00:00+00:00', end_time: '2026-09-09T14:00:00+00:00', title: 'SECRET', user_id: 'PRIVATE' }] } } } })
  const targets = [{ kind: 'user', userId: 'ou_user', userIdType: 'open_id' }, { kind: 'room', roomId: 'omm_room' }] as const
  const result = await provider.queryFreeBusy('a', [...targets], '2026-09-09T12:00:00Z', '2026-09-09T15:00:00Z', request.now)
  assert.deepEqual(calls.map((call) => call.busyTarget), targets)
  assert.ok(calls.every((call) => call.calendarId === undefined && call.calendarIds === undefined))
  assert.equal(result[0]!.intervals.length, 1); assert.equal(result[1]!.error, 'permission'); assert.deepEqual(result[1]!.intervals, [])
  assert.ok(result.every((value) => !('calendarId' in value))); assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE/)
  for (const target of ['calendar-id', { kind: 'calendar', calendarId: 'id' }, { ...targets[0], roomId: 'omm_room' }, { kind: 'user', userId: 'ou_user', userIdType: 'calendar_id' }]) {
    await assert.rejects(provider.queryFreeBusy('a', [target as any], '2026-09-09T12:00:00Z', '2026-09-09T15:00:00Z', request.now), code('invalid-request'))
  }
  assert.equal(calls.length, 2, 'Invalid targets must be rejected before any provider request')
})
