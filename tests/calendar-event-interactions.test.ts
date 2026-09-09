import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarItem } from '../src/domain/calendar/project.ts'
import { calendarCommandForPreview, calendarItemInteractive, calendarKeyboardCommand, calendarMenuMoveCommand, calendarPointerMovePreview, createCalendarDragController } from '../src/components/calendar/use-calendar-drag.ts'

const clock = { kind: 'timezone', timezone: 'Asia/Shanghai' } as const
function item(): Extract<CalendarItem, { eventId: string }> {
  const time = { kind: 'fixed' as const, startAt: '2026-09-09T01:00:00.000Z', endAt: '2026-09-09T02:00:00.000Z', timezone: 'UTC' }
  const event = { id: 'event:one', revision: 4, sourceId: 'calendar:local', title: 'Event', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy' as const, status: 'confirmed' as const, time, recurrence: null, createdAt: time.startAt, updatedAt: time.startAt, deletedAt: null }
  return { key: 'event:one:segment', occurrenceId: null, eventId: event.id, originalStart: time.startAt, kind: 'timed', start: time.startAt, end: time.endAt, displayDate: '2026-09-09', displayMinute: 540, calendar: { title: 'Local', color: '#668575', readOnly: false, event, time } }
}

test('pointer, menu and keyboard move events through event commands in display timezone', () => {
  const value = item()
  const preview = calendarPointerMovePreview(value, '2026-09-09', 555, 60, clock)
  const pointer = calendarCommandForPreview(value, 'move', preview, false, clock)
  assert.deepEqual(pointer, calendarMenuMoveCommand(value, '2026-09-09', 555, 60, clock))
  assert.deepEqual(pointer, calendarKeyboardCommand(value, 'ArrowDown', false, clock))
  assert.equal(pointer.type, 'event.update')
  if (pointer.type === 'event.update') {
    assert.equal(pointer.expectedRevision, 4)
    assert.deepEqual(pointer.patch.time, { kind: 'fixed', startAt: '2026-09-09T01:15:00.000Z', endAt: '2026-09-09T02:15:00.000Z', timezone: 'UTC' })
  }
  const resized = calendarKeyboardCommand(value, 'ArrowDown', true, clock)
  assert.equal(resized?.type === 'event.update' && resized.patch.time?.kind === 'fixed' && resized.patch.time.endAt, '2026-09-09T02:05:00.000Z')
})

test('readonly and cross-day segments cannot move the underlying full event accidentally', () => {
  const value = item()
  value.calendar.readOnly = true
  assert.equal(calendarItemInteractive(value, clock), false)
  assert.equal(calendarKeyboardCommand(value, 'ArrowDown', false, clock), null)
  assert.throws(() => calendarMenuMoveCommand(value, '2026-09-09', 555, 60, clock), /details/)
  value.calendar.readOnly = false
  value.calendar.time = { kind: 'floating', startLocal: '2026-09-08T23:00', endLocal: '2026-09-09T10:00' }
  assert.equal(calendarItemInteractive(value, clock), false)
  value.calendar.time = { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-11' }
  assert.equal(calendarItemInteractive(value, clock), false)
})

test('recurring events emit one exception and pointer release rejects another occurrence identity', async () => {
  const value = item()
  value.calendar.event.recurrence = { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' }, exceptions: [] }
  const preview = calendarPointerMovePreview(value, '2026-09-10', 540, 60, clock)
  const command = calendarCommandForPreview(value, 'move', preview, false, clock)
  assert.equal(command.type, 'event.exception.set')
  if (command.type !== 'event.exception.set') return
  assert.equal(command.originalStart, value.originalStart)
  let writes = 0
  const controller = createCalendarDragController(async () => { writes++ })
  const pointer = { pointerId: 1, currentTarget: {}, clientX: 0, clientY: 0 }
  const session = { itemKey: value.key, item: value, action: 'move' as const, sourceStart: value.start, sourceDuration: 60 }
  controller.begin(pointer, session)
  value.calendar.event.revision = 5
  assert.equal(controller.session.value?.item.eventId !== undefined && controller.session.value.item.calendar.event.revision, 4, 'An external refresh cannot upgrade the captured revision before release')
  controller.update({ ...pointer, clientY: 20 }, preview)
  await controller.release(pointer, { ...command, originalStart: '2026-09-10T01:00:00.000Z' }, value.key)
  assert.equal(writes, 0)
  value.calendar.event.revision = 4
  controller.begin(pointer, session)
  controller.update({ ...pointer, clientY: 20 }, preview)
  await controller.release(pointer, command, value.key)
  assert.equal(writes, 1)
})
