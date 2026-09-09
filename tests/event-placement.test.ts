import assert from 'node:assert/strict'
import test from 'node:test'
import { eventPlacementCommand, moveCalendarEventTime, resizeCalendarEventTime } from '../src/domain/calendar/event-placement.ts'
import type { CalendarEvent, CalendarEventTime } from '../src/domain/calendar/types.ts'

const allDay: CalendarEventTime = { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-12' }
const fixed: CalendarEventTime = { kind: 'fixed', startAt: '2026-11-01T01:30:00-08:00', endAt: '2026-11-01T02:30:00-08:00', timezone: 'America/Los_Angeles' }
const floating: CalendarEventTime = { kind: 'floating', startLocal: '2026-03-07T23:30', endLocal: '2026-03-08T03:30' }

test('placements preserve date spans, elapsed durations and floating wall clocks without mutating their input', () => {
  assert.deepEqual(moveCalendarEventTime(allDay, '2026-12-30', null, 'UTC'), { kind: 'all-day', startOn: '2026-12-30', endOnExclusive: '2027-01-02' })
  assert.deepEqual(moveCalendarEventTime(fixed, '2026-11-01', 90, 'America/Los_Angeles'), fixed, 'A no-op must keep the second fall-back instant')
  assert.deepEqual(moveCalendarEventTime(fixed, '2026-11-02', null, 'America/Los_Angeles'), { ...fixed, startAt: '2026-11-02T09:30:00.000Z', endAt: '2026-11-02T10:30:00.000Z' })
  assert.deepEqual(moveCalendarEventTime(fixed, '2026-11-03', 9 * 60, 'Asia/Shanghai'), { ...fixed, startAt: '2026-11-03T01:00:00.000Z', endAt: '2026-11-03T02:00:00.000Z' }, 'Display timezone controls placement; event timezone remains its authored zone')
  const before = structuredClone(floating)
  const expected = { kind: 'floating', startLocal: '2026-03-08T23:30', endLocal: '2026-03-09T03:30' }
  assert.deepEqual(moveCalendarEventTime(floating, '2026-03-08', null, 'America/Los_Angeles'), expected)
  assert.deepEqual(moveCalendarEventTime(floating, '2026-03-08', null, 'Asia/Shanghai'), expected)
  assert.deepEqual(floating, before)
})

test('invalid dates, DST gaps and silent kind conversions are rejected', () => {
  assert.throws(() => moveCalendarEventTime(allDay, '2026-02-30', null, 'UTC'))
  assert.throws(() => moveCalendarEventTime(allDay, '2026-09-10', 540, 'UTC'), /All-day/)
  assert.throws(() => moveCalendarEventTime(fixed, '2026-03-08', 150, 'America/Los_Angeles'), /DST gap/)
  assert.throws(() => moveCalendarEventTime(floating, '2026-03-09', 1440, 'UTC'), /minute/)
  assert.throws(() => moveCalendarEventTime(floating, '2026-02-30', 540, 'UTC'))
})

test('timed resize keeps its start and uses five-minute increments across midnight and DST', () => {
  assert.deepEqual(resizeCalendarEventTime(fixed, 90), { ...fixed, endAt: '2026-11-01T11:00:00.000Z' })
  assert.deepEqual(resizeCalendarEventTime(floating, 90), { ...floating, endLocal: '2026-03-08T01:00' })
  for (const minutes of [0, -5, 12, 5.5, NaN, Infinity]) assert.throws(() => resizeCalendarEventTime(fixed, minutes), /five-minute/)
  assert.throws(() => resizeCalendarEventTime(allDay, 60), /All-day/)
})

test('pointer, menu and keyboard placements share exact event versus original occurrence commands', () => {
  const event: CalendarEvent = { id: 'event:one', revision: 7, sourceId: 'source:one', title: 'Event', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time: allDay, recurrence: null, createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', deletedAt: null }
  const time = moveCalendarEventTime(allDay, '2026-09-10', null, 'UTC')
  assert.deepEqual(eventPlacementCommand(event, '2026-09-09', time), { type: 'event.update', eventId: event.id, expectedRevision: 7, scope: 'single', patch: { time } })
  event.recurrence = { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' }, exceptions: [] }
  assert.deepEqual(eventPlacementCommand(event, '2026-09-09', time), { type: 'event.exception.set', eventId: event.id, expectedRevision: 7, originalStart: '2026-09-09', time })
  assert.throws(() => eventPlacementCommand(event, '2026-09-09', fixed), /time kind/)
  assert.throws(() => eventPlacementCommand(event, '2026-09-09', { ...allDay, endOnExclusive: allDay.startOn }), /after start/)
})
