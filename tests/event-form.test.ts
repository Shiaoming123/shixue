import assert from 'node:assert/strict'
import test from 'node:test'
import { eventTimeDraft, eventTimeFromDraft } from '../src/domain/calendar/event-form.ts'

test('all-day editor presents an inclusive final date and stores an exclusive end', () => {
  const time = { kind: 'all-day' as const, startOn: '2026-09-09', endOnExclusive: '2026-09-12' }
  const draft = eventTimeDraft(time)
  assert.equal(draft.endDate, '2026-09-11')
  assert.deepEqual(eventTimeFromDraft(draft), time)
  assert.equal((eventTimeFromDraft({ ...draft, endDate: draft.startDate }) as typeof time).endOnExclusive, '2026-09-10')
  assert.throws(() => eventTimeFromDraft({ ...draft, endDate: '2026-02-30' }))
  assert.throws(() => eventTimeFromDraft({ ...draft, endDate: '2026-09-08' }), /after start/)
})

test('fixed editor resolves IANA clocks, rejects DST gaps and preserves an existing fold instant and seconds', () => {
  const time = { kind: 'fixed' as const, startAt: '2026-11-01T01:30:17-08:00', endAt: '2026-11-01T02:30:17-08:00', timezone: 'America/Los_Angeles' }
  const draft = eventTimeDraft(time)
  assert.equal(draft.startTime, '01:30')
  assert.deepEqual(eventTimeFromDraft(draft, time), time)
  const changed = eventTimeFromDraft({ ...draft, endTime: '03:30' }, time)
  assert.equal(changed.kind === 'fixed' && changed.startAt, time.startAt)
  assert.equal(changed.kind === 'fixed' && changed.endAt, '2026-11-01T11:30:00.000Z')
  assert.throws(() => eventTimeFromDraft({ ...draft, startDate: '2026-03-08', endDate: '2026-03-08', startTime: '02:30', endTime: '04:30' }), /夏令时/)
  assert.throws(() => eventTimeFromDraft({ ...draft, timezone: 'invalid-zone' }), /timezone/)
})

test('floating clocks stay unresolved even during a local DST gap', () => {
  const time = { kind: 'floating' as const, startLocal: '2026-03-08T02:30', endLocal: '2026-03-09T03:30' }
  assert.deepEqual(eventTimeFromDraft(eventTimeDraft(time, 'America/Los_Angeles')), time)
  assert.deepEqual(eventTimeFromDraft(eventTimeDraft(time, 'Asia/Shanghai')), time)
  assert.throws(() => eventTimeFromDraft({ ...eventTimeDraft(time), startTime: '24:00' }), /without offset/)
})
