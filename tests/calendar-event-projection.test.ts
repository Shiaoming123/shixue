import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorkspaceStateOrMigrate } from '../src/domain/workspace/migrate.ts'
import { createSeedStudyState } from '../src/storage/study/types.ts'
import { queryCalendar } from '../src/domain/calendar/query.ts'
import type { CalendarEvent } from '../src/domain/calendar/types.ts'

test('mixed calendar splits event days without duplicating tasks and respects source visibility', () => {
  const state = parseWorkspaceStateOrMigrate(createSeedStudyState('2026-09-09T00:00:00Z'))
  const event: CalendarEvent = { id: 'event:cross-day', revision: 1, sourceId: state.calendarSources[0]!.id,
    title: '夜间部署', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [],
    availability: 'busy', status: 'confirmed', recurrence: null, deletedAt: null,
    createdAt: state.updatedAt, updatedAt: state.updatedAt,
    time: { kind: 'fixed', startAt: '2026-09-09T15:30:00Z', endAt: '2026-09-09T17:30:00Z', timezone: 'Asia/Shanghai' } }
  state.calendarEvents.push(event)
  const before = structuredClone(state)
  const range = { start: '2026-09-09', end: '2026-09-12' }
  const items = queryCalendar(state, range, { text: '夜间' }, 'Asia/Shanghai').items
  assert.deepEqual(items.map(({ displayDate, displayMinute }) => [displayDate, displayMinute]), [['2026-09-09', 1410], ['2026-09-10', 0]])
  assert.ok(items.every((item) => item.eventId === event.id && item.taskId === undefined && item.originalStart === '2026-09-09T15:30:00.000Z'))
  assert.equal(new Set(items.map(({ key }) => key)).size, 2)
  assert.deepEqual(state, before)
  state.calendarSources[0]!.hidden = true
  assert.equal(queryCalendar(state, range, { text: '夜间' }, 'Asia/Shanghai').items.length, 0)
  state.calendarSources[0]!.hidden = false
  state.calendarSources[0]!.permission = 'read'
  assert.ok(queryCalendar(state, range, { text: '夜间' }, 'Asia/Shanghai').items.every((item) => item.eventId !== undefined && item.calendar.readOnly))
  event.time = { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-11' }
  assert.deepEqual(queryCalendar(state, range, { text: '夜间' }).items.map(({ displayDate }) => displayDate), ['2026-09-09', '2026-09-10'])
  event.time = { kind: 'floating', startLocal: '2026-09-09T23:30', endLocal: '2026-09-10T01:30' }
  assert.deepEqual(queryCalendar(state, range, { text: '夜间' }, 'America/New_York').items.map(({ displayDate, displayMinute }) => [displayDate, displayMinute]), [['2026-09-09', 1410], ['2026-09-10', 0]])
})
