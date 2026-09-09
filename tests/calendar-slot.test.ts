import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarSlot } from '../src/components/calendar/calendar-slot.ts'

test('empty grid clicks and selections snap to fifteen minutes without leaving the selected day', () => {
  assert.deepEqual(calendarSlot('2026-09-09', 543), { date: '2026-09-09', minute: 540, duration: 30 })
  assert.deepEqual(calendarSlot('2026-09-09', 543, 604), { date: '2026-09-09', minute: 540, duration: 60 })
  assert.deepEqual(calendarSlot('2026-09-09', 604, 543), calendarSlot('2026-09-09', 543, 604))
  assert.deepEqual(calendarSlot('2026-09-09', 1439), { date: '2026-09-09', minute: 1425, duration: 15 })
  assert.deepEqual(calendarSlot('2026-09-09', 30, -20), { date: '2026-09-09', minute: 0, duration: 30 })
  assert.throws(() => calendarSlot('2026-02-30', 540), /date/)
  assert.throws(() => calendarSlot('2026-09-09', Number.NaN), /minute/)
})
