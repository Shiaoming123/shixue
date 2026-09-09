import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { migrateWorkspaceV4 } from '../src/domain/workspace/migrate.ts'
import { parseCalendarEventTime, parseWorkspaceStateV4 } from '../src/domain/workspace/parse.ts'
import type { CalendarEvent } from '../src/domain/calendar/types.ts'

const legacy = JSON.parse(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')).state

test('V4 migration preserves all V3 facts and is deterministic, idempotent and collision-safe', () => {
  const before = structuredClone(legacy)
  const migrated = migrateWorkspaceV4(legacy)
  const { calendarSources, calendarEvents, calendarEventLinks, eventOutcomes, ...taskState } = migrated
  assert.deepEqual({ ...taskState, version: 3 }, before)
  assert.deepEqual([calendarEvents, calendarEventLinks, eventOutcomes], [[], [], []], 'Internal tasks must never be cloned into events')
  assert.equal(calendarSources.length, 1)
  assert.deepEqual(migrateWorkspaceV4(migrated), migrated)
  assert.deepEqual(migrateWorkspaceV4(legacy), migrated)
  assert.deepEqual(legacy, before)
  const collision = structuredClone(legacy)
  collision.tags.push({ id: 'calendar:local', title: 'Existing user ID', position: 0, createdAt: legacy.updatedAt, updatedAt: legacy.updatedAt, archivedAt: null })
  assert.equal(migrateWorkspaceV4(collision).calendarSources[0]!.id, 'calendar:local:1')
})

test('event times distinguish calendar dates, elapsed instants and floating wall clocks', () => {
  const allDay = { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-12' }
  assert.deepEqual(parseCalendarEventTime(allDay), allDay)
  assert.throws(() => parseCalendarEventTime({ ...allDay, endOnExclusive: allDay.startOn }), /after start/)
  assert.throws(() => parseCalendarEventTime({ ...allDay, startOn: '2026-02-30' }), /YYYY-MM-DD/)
  const fixed = { kind: 'fixed', startAt: '2026-11-01T01:30:00-07:00', endAt: '2026-11-01T01:15:00-08:00', timezone: 'America/Los_Angeles' }
  assert.deepEqual(parseCalendarEventTime(fixed), fixed, 'DST fall-back is ordered by instant, not clock text')
  assert.throws(() => parseCalendarEventTime({ ...fixed, endAt: '2026-11-01T01:15:00-07:00' }), /after start/)
  assert.throws(() => parseCalendarEventTime({ ...fixed, timezone: 'invalid-zone' }), /timezone/)
  const floating = { kind: 'floating', startLocal: '2026-03-08T02:30', endLocal: '2026-03-08T03:30' }
  assert.deepEqual(parseCalendarEventTime(floating), floating, 'Floating clocks remain unresolved until a display timezone is supplied')
  assert.throws(() => parseCalendarEventTime({ ...floating, startLocal: '2026-03-08T02:30Z' }), /without offset/)
  assert.throws(() => parseCalendarEventTime({ ...floating, endLocal: '2026-03-08T24:00' }), /without offset/)
})

test('V4 parses only calendar facts and rejects dangling references and unsafe fields', () => {
  const state = migrateWorkspaceV4(legacy)
  state.calendarEvents.push(event(state.calendarSources[0]!.id))
  const raw = { ...state, token: 'secret-token', calendarSources: state.calendarSources.map((source) => ({ ...source, token: 'secret-token' })), calendarEvents: state.calendarEvents.map((event) => ({ ...event, providerPayload: { access_token: 'secret-token' } })) }
  const parsed = parseWorkspaceStateV4(raw)
  assert.deepEqual(parsed, state)
  assert.doesNotMatch(JSON.stringify(parsed), /secret-token/)
  for (const patch of [
    { sourceId: 'missing-source' }, { id: legacy.tasks[0].id }, { status: 'completed' },
    { meetingUrl: 'javascript:alert(1)' }, { meetingUrl: 'https://user:password@example.test/' },
    { recurrence: { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' }, exceptions: [
      { originalStart: '2026-09-09T09:00:00Z', time: null }, { originalStart: '2026-09-09T10:00:00+01:00', time: null },
    ] } },
  ]) assert.throws(() => parseWorkspaceStateV4({ ...state, calendarEvents: [{ ...state.calendarEvents[0], ...patch }] }))
  assert.throws(() => parseWorkspaceStateV4({ ...state, calendarEventLinks: [{ id: 'link', eventId: 'event:one', taskId: 'missing' }] }), /unknown/)
  const result = { id: 'outcome:one', eventId: 'event:one', occurrenceId: null, action: 'followup', taskId: 'timed', note: '', createdAt: state.updatedAt }
  assert.equal(parseWorkspaceStateV4({ ...state, eventOutcomes: [result] }).eventOutcomes.length, 1, 'Unlink preserves independently referenced followup outcomes')
  const linked = { ...state, calendarEventLinks: [{ id: 'link', eventId: 'event:one', taskId: 'timed' }], eventOutcomes: [result] }
  assert.equal(parseWorkspaceStateV4(linked).eventOutcomes.length, 1)
  assert.throws(() => parseWorkspaceStateV4({ ...linked, eventOutcomes: [result, { ...result, id: 'outcome:two' }] }), /Duplicate event outcome/)
})

function event(sourceId: string): CalendarEvent {
  return { id: 'event:one', revision: 1, sourceId, title: 'Synthetic event', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time: { kind: 'fixed', startAt: '2026-09-09T09:00:00Z', endAt: '2026-09-09T10:00:00Z', timezone: 'UTC' }, recurrence: null, createdAt: legacy.updatedAt, updatedAt: legacy.updatedAt, deletedAt: null }
}
