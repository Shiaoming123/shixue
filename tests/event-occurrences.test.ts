import assert from 'node:assert/strict'
import test from 'node:test'
import { expandCalendarEventOccurrences as expand, isCalendarEventOccurrenceStart as belongs, validateCalendarEventRecurrence as validate, resolveCalendarEventOccurrence as resolve } from '../src/domain/calendar/event-occurrences.ts'
import type { CalendarEvent, CalendarEventTime } from '../src/domain/calendar/types.ts'

function event(time: CalendarEventTime, recurrence: CalendarEvent['recurrence'] = null): CalendarEvent {
  return { id: 'event:one', revision: 1, sourceId: 'calendar:local', title: 'Calendar fact', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time, recurrence, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null }
}
const daily = { cadence: { kind: 'daily' as const, interval: 1 }, end: { kind: 'after' as const, count: 3 }, exceptions: [] }
const day = (startOn: string, endOnExclusive: string): CalendarEventTime => ({ kind: 'all-day', startOn, endOnExclusive })

test('all-day spans overlap the window and use an exclusive end without mutating events', () => {
  const value = event(day('2026-09-01', '2026-09-12'))
  const before = structuredClone(value)
  assert.equal(expand(value, { start: '2026-09-09', end: '2026-09-10' }, 'Asia/Shanghai').length, 1)
  assert.equal(expand(value, { start: '2026-09-12', end: '2026-09-13' }, 'Asia/Shanghai').length, 0)
  assert.equal(expand(event(day('2026-09-10', '2026-09-11')), { start: '2026-09-09', end: '2026-09-10' }, 'UTC').length, 0)
  assert.deepEqual(value, before)
})

test('fixed recurrences follow their IANA wall clock over DST and retain elapsed duration and seconds', () => {
  const value = event({ kind: 'fixed', startAt: '2026-03-07T09:00:12-08:00', endAt: '2026-03-07T10:00:12-08:00', timezone: 'America/Los_Angeles' }, daily)
  const items = expand(value, { start: '2026-03-07', end: '2026-03-10' }, 'America/Los_Angeles')
  assert.deepEqual(items.map((item) => item.originalStart), ['2026-03-07T17:00:12.000Z', '2026-03-08T16:00:12.000Z', '2026-03-09T16:00:12.000Z'])
  for (const item of items) {
    assert.equal(item.time.kind, 'fixed')
    if (item.time.kind === 'fixed') assert.equal(Date.parse(item.time.endAt) - Date.parse(item.time.startAt), 3_600_000)
  }
  const gap = event({ kind: 'fixed', startAt: '2026-03-07T02:30:00-08:00', endAt: '2026-03-07T03:30:00-08:00', timezone: 'America/Los_Angeles' }, daily)
  assert.equal(expand(gap, { start: '2026-03-08', end: '2026-03-09' }, 'America/Los_Angeles')[0]!.originalStart, '2026-03-08T10:30:00.000Z')
  const fold = event({ kind: 'fixed', startAt: '2026-11-01T01:30:00-08:00', endAt: '2026-11-01T02:30:00-08:00', timezone: 'America/Los_Angeles' }, daily)
  assert.equal(expand(fold, { start: '2026-11-01', end: '2026-11-02' }, 'UTC')[0]!.originalStart, '2026-11-01T09:30:00.000Z', 'The explicit later fold anchor must not be rewritten')
  assert.equal(belongs(value, '2026-03-08T09:00:12-07:00'), true)
  assert.equal(belongs(value, '2026-03-08T09:01:12-07:00'), false)
})

test('floating recurrence retains wall clocks including nonexistent local times and cross-day durations', () => {
  const value = event({ kind: 'floating', startLocal: '2026-03-07T02:30', endLocal: '2026-03-08T04:30' }, daily)
  const range = { start: '2026-03-08', end: '2026-03-09' }
  const items = expand(value, range, 'America/Los_Angeles')
  assert.deepEqual(items, expand(value, range, 'Asia/Shanghai'))
  assert.equal(items.length, 2)
  assert.deepEqual(items[1]!.time, { kind: 'floating', startLocal: '2026-03-08T02:30', endLocal: '2026-03-09T04:30' })
})

test('cadence and end constraints determine true identities, including clamped month/year dates', () => {
  const value = event(day('2026-01-31', '2026-02-01'), { ...daily, cadence: { kind: 'monthly', interval: 1, dayOfMonth: 31 } })
  assert.deepEqual(expand(value, { start: '2026-01-01', end: '2026-05-01' }, 'UTC').map((item) => item.originalStart), ['2026-01-31', '2026-02-28', '2026-03-31'])
  assert.equal(belongs(value, '2026-04-30'), false)
  const weekly = event(day('2026-09-09', '2026-09-10'), { ...daily, cadence: { kind: 'weekly', interval: 2, weekdays: [1, 3] }, end: { kind: 'on', date: '2026-09-23' } })
  assert.deepEqual(expand(weekly, { start: '2026-09-01', end: '2026-10-01' }, 'UTC').map((item) => item.originalStart), ['2026-09-09', '2026-09-14', '2026-09-23'])
  const yearly = event(day('2024-02-29', '2024-03-01'), { ...daily, cadence: { kind: 'yearly', interval: 1, month: 2, dayOfMonth: 29 } })
  assert.equal(belongs(yearly, '2025-02-28'), true)
})

test('exceptions cancel or move a single occurrence across either window boundary while keeping identity', () => {
  const value = event(day('2026-09-01', '2026-09-02'), { ...daily, end: { kind: 'after', count: 20 }, exceptions: [
    { originalStart: '2026-09-01', time: day('2026-09-10', '2026-09-11') },
    { originalStart: '2026-09-10', time: null },
    { originalStart: '2026-09-11', time: day('2026-10-01', '2026-10-02') },
    { originalStart: '2026-09-20', time: day('2026-09-10', '2026-09-11') },
  ] })
  const items = expand(value, { start: '2026-09-10', end: '2026-09-12' }, 'UTC')
  assert.deepEqual(items.map((item) => item.originalStart), ['2026-09-01', '2026-09-20'])
  assert.equal(items[0]!.id, expand(value, { start: '2026-09-09', end: '2026-09-13' }, 'UTC')[1]!.id)
  assert.equal(belongs(value, '2026-09-10'), true, 'Cancellation does not erase an original identity')
  assert.equal(resolve(value, '2026-09-10'), null)
  assert.deepEqual(resolve(value, '2026-09-11')?.time, day('2026-10-01', '2026-10-02'))
  assert.equal(resolve(value, '2026-09-21'), null)
  assert.equal(resolve(value, 'invalid'), null)
  value.recurrence!.exceptions.push({ originalStart: '2026-09-21', time: null })
  value.status = 'cancelled'
  assert.throws(() => validate(value), /not a series occurrence/)
  assert.throws(() => expand(value, { start: '2026-09-10', end: '2026-09-12' }, 'UTC'), /not a series occurrence/)
})

test('range/timezone are checked and long series fail explicitly rather than returning an incomplete calendar', () => {
  const value = event(day('1900-01-01', '1900-01-02'), { ...daily, end: { kind: 'never' } })
  assert.throws(() => expand(value, { start: '2026-09-09', end: '2026-09-10' }, 'UTC'), /exceeds 10000/)
  assert.throws(() => expand(value, { start: '2026-02-30', end: '2026-03-02' }, 'UTC'), /Invalid calendar date/)
  assert.throws(() => expand(value, { start: '2026-09-10', end: '2026-09-09' }, 'UTC'), /after start/)
  assert.throws(() => expand(value, { start: '2026-09-09', end: '2026-09-10' }, 'invalid-zone'), /timezone/)
})
