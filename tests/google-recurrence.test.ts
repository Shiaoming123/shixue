import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGoogleBatch } from '../src/calendar-connections/google.ts'
import { CalendarProviderError } from '../src/calendar-connections/types.ts'

const request = { connectionId: 'a', calendarId: 'b', timezone: 'Asia/Shanghai', now: '2026-09-09T00:00:00Z', cursor: null }
const master = { id: 'parent', summary: 'Meeting', start: { dateTime: '2026-09-09T09:00:00+08:00', timeZone: 'Asia/Shanghai' }, end: { dateTime: '2026-09-09T10:00:00+08:00' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'] }
const exception = { id: 'exception', recurringEventId: 'parent', summary: 'Meeting', originalStartTime: { dateTime: '2026-09-16T09:00:00+08:00' }, start: { dateTime: '2026-09-17T09:00:00+08:00' }, end: { dateTime: '2026-09-17T10:00:00+08:00' } }
const rejects = (operation: () => unknown, code = 'unsupported-recurrence') => assert.throws(operation, (error) => error instanceof CalendarProviderError && error.code === code)

test('ordinary, recurring parents and moved exceptions share participant normalization on full and incremental batches', () => {
  const metadata = { organizer: { email: 'owner@example.invalid', displayName: 'Owner' }, attendees: [{ email: 'optional@example.invalid', optional: true, responseStatus: 'tentative' }, { email: 'required@example.invalid', responseStatus: 'accepted' }] }
  const ordinary = { ...master, id: 'ordinary', recurrence: undefined, ...metadata }
  const full = normalizeGoogleBatch([ordinary, { ...master, ...metadata }, { ...exception, ...metadata }], request, [], 'full')
  const ordinaryFact = full.upserts.find(({ remoteId }) => remoteId === 'ordinary')!.event
  const parentFact = full.upserts.find(({ remoteId }) => remoteId === 'parent')!.event
  assert.equal(parentFact.attendees.length, 2)
  assert.deepEqual(parentFact.attendees, ordinaryFact.attendees)
  assert.deepEqual(parentFact.organizer, ordinaryFact.organizer)
  const ordinaryUpdate = normalizeGoogleBatch([{ ...ordinary, attendees: metadata.attendees.map((attendee) => ({ ...attendee, responseStatus: 'declined' })) }], request, [ordinaryFact], 'incremental').upserts[0]!.event
  assert.deepEqual(ordinaryUpdate.organizer, ordinaryFact.organizer)
  assert.deepEqual(ordinaryUpdate.attendees.map(({ response }) => response), ['declined', 'declined'])
  assert.deepEqual(ordinaryFact.attendees.map(({ response }) => response), ['tentative', 'accepted'], 'Normalizing an incremental update must not mutate the prior mirror')
  const incremental = normalizeGoogleBatch([{ ...exception, ...metadata }], request, [parentFact], 'incremental')
  assert.deepEqual(incremental.upserts[0]!.event.organizer, parentFact.organizer)
  assert.deepEqual(incremental.upserts[0]!.event.attendees, parentFact.attendees)
  const refreshed = normalizeGoogleBatch([ordinary, { ...master, ...metadata }, { ...exception, ...metadata }], request, incremental.upserts.map(({ event }) => event), 'full')
  assert.deepEqual(refreshed.upserts.map(({ event }) => [event.organizer, event.attendees]), full.upserts.map(({ event }) => [event.organizer, event.attendees]))
  rejects(() => normalizeGoogleBatch([{ ...master, ...metadata, attendeesOmitted: true }], request, [], 'full'), 'incomplete')
  rejects(() => normalizeGoogleBatch([{ ...master, ...metadata, attachments: [] }], request, [], 'full'))
})

test('identical duplicate facts dedupe but conflicting pages cannot silently rewind events', () => {
  const reordered = Object.fromEntries(Object.entries(master).reverse())
  assert.equal(normalizeGoogleBatch([master, reordered], request, [], 'full').upserts.length, 1)
  for (const mode of ['full', 'incremental'] as const) {
    for (const conflict of [{ ...master, summary: 'Older page' }, { id: master.id, status: 'cancelled' }]) {
      rejects(() => normalizeGoogleBatch([master, conflict], request, [], mode), 'incomplete')
      rejects(() => normalizeGoogleBatch([conflict, master], request, [], mode), 'incomplete')
    }
  }
})

test('reverse-page order folds time-only exceptions into one parent without instance entities', () => {
  const result = normalizeGoogleBatch([exception, master], request, [], 'full')
  assert.equal(result.upserts.length, 1); assert.equal(result.upserts[0]!.remoteId, 'parent')
  const event = result.upserts[0]!.event
  assert.deepEqual(event.recurrence?.cadence, { kind: 'weekly', interval: 1, weekdays: [3] })
  assert.equal(event.recurrence?.exceptions[0]?.originalStart, '2026-09-16T01:00:00.000Z')
  assert.equal(event.recurrence?.exceptions[0]?.time?.kind, 'fixed')
})
test('sparse cancellation and restoration merge existing parent in incremental mode', () => {
  const parent = normalizeGoogleBatch([master], request, [], 'full').upserts[0]!.event
  const cancelled = { id: exception.id, recurringEventId: exception.recurringEventId, originalStartTime: exception.originalStartTime, status: 'cancelled' }
  const result = normalizeGoogleBatch([cancelled], request, [parent], 'incremental')
  assert.deepEqual(result.deletedRemoteIds, []); assert.equal(result.upserts[0]!.event.recurrence?.exceptions[0]?.time, null)
  assert.deepEqual(parent.recurrence?.exceptions, [])
  const restored = normalizeGoogleBatch([{ ...exception, start: { dateTime: '2026-09-16T09:00:00+08:00' }, end: { dateTime: '2026-09-16T10:00:00+08:00' } }], request, result.upserts.map((item) => item.event), 'incremental')
  assert.equal(restored.upserts[0]!.event.recurrence?.exceptions.length, 1)
  assert.equal(restored.upserts[0]!.event.recurrence?.exceptions[0]?.time?.kind, 'fixed')
  rejects(() => normalizeGoogleBatch([cancelled], request, [parent], 'full'), 'incomplete')
  assert.deepEqual(normalizeGoogleBatch([{ id: 'parent', status: 'cancelled' }, cancelled], request, [parent], 'incremental').deletedRemoteIds, ['parent'])
})
test('supported cadences and UNTIL remain bounded and complex/lossy rules refuse', () => {
  for (const rule of ['FREQ=DAILY;COUNT=3', 'FREQ=MONTHLY;BYMONTHDAY=9', 'FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=9', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE']) assert.ok(normalizeGoogleBatch([{ ...master, recurrence: [`RRULE:${rule}`] }], request, [], 'full').upserts[0]!.event.recurrence)
  const until = normalizeGoogleBatch([{ ...master, recurrence: ['RRULE:FREQ=DAILY;UNTIL=20260916T005959Z'] }], request, [], 'full').upserts[0]!.event.recurrence
  assert.deepEqual(until?.end, { kind: 'on', date: '2026-09-15' })
  for (const rule of ['FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,FR', 'FREQ=MONTHLY;BYSETPOS=-1', 'FREQ=DAILY;COUNT=2;UNTIL=20261001', 'FREQ=DAILY;INTERVAL=0']) rejects(() => normalizeGoogleBatch([{ ...master, recurrence: [`RRULE:${rule}`] }], request, [], 'full'))
  rejects(() => normalizeGoogleBatch([{ ...master, start: { dateTime: '2026-09-09T09:00:00-04:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-09-09T10:00:00-04:00' } }], request, [], 'full'))
})
test('non-time edits, fake keys and orphaned old exceptions never silently overwrite facts', () => {
  rejects(() => normalizeGoogleBatch([master, { ...exception, summary: 'Changed' }], request, [], 'full'))
  rejects(() => normalizeGoogleBatch([master, { ...exception, originalStartTime: { dateTime: '2026-09-15T09:00:00+08:00' } }], request, [], 'full'))
  rejects(() => normalizeGoogleBatch([{ ...master, unsupportedRecurrenceFields: true }], request, [], 'full'))
  const parent = normalizeGoogleBatch([master, exception], request, [], 'full').upserts[0]!.event
  rejects(() => normalizeGoogleBatch([{ ...master, recurrence: ['RRULE:FREQ=WEEKLY;COUNT=1'] }], request, [parent], 'incremental'), 'cursor-expired')
  assert.equal(parent.recurrence?.exceptions.length, 1)
})
test('reader accepts only the recurrence write marker it can prove', () => {
  const marker = { extendedProperties: { private: { meowOperationId: 'operation', meowOperationHash: `sha256:${'a'.repeat(64)}` } } }
  assert.ok(normalizeGoogleBatch([{ ...master, ...marker }], request, [], 'full').upserts[0]!.event.recurrence)
  rejects(() => normalizeGoogleBatch([{ ...master, extendedProperties: { private: { unrelated: 'value' } } }], request, [], 'full'))
})
test('all-day spans remain exclusive; month-end and leap recurrence cannot clamp dates', () => {
  const event = { id: 'all-day', summary: 'Days', start: { date: '2026-09-09' }, end: { date: '2026-09-11' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=3'] }
  const result = normalizeGoogleBatch([event], request, [], 'full').upserts[0]!.event
  assert.deepEqual(result.time, { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-11' })
  rejects(() => normalizeGoogleBatch([{ ...event, start: { date: '2026-01-31' }, end: { date: '2026-02-01' }, recurrence: ['RRULE:FREQ=MONTHLY'] }], request, [], 'full'))
  rejects(() => normalizeGoogleBatch([{ ...event, start: { date: '2028-02-29' }, end: { date: '2028-03-01' }, recurrence: ['RRULE:FREQ=YEARLY'] }], request, [], 'full'))
})
