import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'
import { suggestTaskSchedule } from '../src/domain/calendar/scheduling.ts'
import { selectCalendarWeeklySummary } from '../src/domain/calendar/calendar-weekly-summary.ts'
import type { ScheduleQuery } from '../src/domain/calendar/scheduling.ts'

function fixture() {
  const state = parseWorkspaceExport(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')).state
  state.tasks = [state.tasks[0]!]
  state.tasks[0]!.schedule = { startAt: null, startOn: null, estimateMinutes: 60 }
  state.tasks[0]!.deadline = { dueAt: null, dueOn: null }
  state.tasks[0]!.recurrenceSeriesId = null
  state.taskEvents = []
  state.occurrences = []
  state.studySessions = []
  return state
}
const query: ScheduleQuery = { taskId: 'timed', range: { start: '2026-09-09', end: '2026-09-10' }, timezone: 'UTC', now: '2026-09-09T00:00:00Z', workingHours: [{ weekdays: [3], startMinute: 540, endMinute: 720 }], lockedIntervals: [] }

test('preview preserves facts, deadline and locked blocks while returning stable revision guards', async () => {
  const state = fixture(), before = structuredClone(state)
  const locked = { startAt: '2026-09-09T09:00:00Z', endAt: '2026-09-09T10:00:00Z' }
  const result = await suggestTaskSchedule(state, { ...query, lockedIntervals: [locked] })
  assert.equal(result.candidates[0]!.startAt, '2026-09-09T10:00:00.000Z')
  assert.equal(result.taskRevision, state.tasks[0]!.revision)
  assert.equal(result.workspaceRevision, state.revision)
  assert.deepEqual(state, before)
  assert.equal(result.availabilityFingerprint, (await suggestTaskSchedule(state, { ...query, lockedIntervals: [locked], now: '2026-09-09T00:01:00Z' })).availabilityFingerprint)
  state.tasks[0]!.deadline.dueAt = '2026-09-09T09:30:00Z'
  assert.equal((await suggestTaskSchedule(state, query)).reason, 'insufficient-capacity')
})

test('external errors, insufficient coverage and expired caches never become free time', async () => {
  const state = fixture()
  const entry = { calendarId: 'external', startAt: '2026-09-09T00:00:00Z', endAt: '2026-09-10T00:00:00Z', fetchedAt: '2026-09-08T23:00:00Z', expiresAt: '2026-09-09T01:00:00Z', error: null, intervals: [] }
  const good = await suggestTaskSchedule(state, { ...query, externalBusy: [entry] })
  assert.equal(good.reason, null)
  for (const patch of [{ error: 'failed' }, { endAt: '2026-09-09T12:00:00Z' }, { expiresAt: query.now }]) {
    const result = await suggestTaskSchedule(state, { ...query, externalBusy: [{ ...entry, ...patch }] })
    assert.equal(result.reason, 'availability-unknown')
    assert.notEqual(result.availabilityFingerprint, good.availabilityFingerprint)
  }
  assert.equal((await suggestTaskSchedule(state, { ...query, requiredExternalCalendarIds: ['missing'] })).reason, 'availability-unknown')
})

test('spring DST skips nonexistent wall starts and preserves a continuous elapsed hour', async () => {
  const result = await suggestTaskSchedule(fixture(), { ...query, range: { start: '2026-03-08', end: '2026-03-09' }, timezone: 'America/Los_Angeles', now: '2026-03-08T00:00:00Z', workingHours: [{ weekdays: [0], startMinute: 120, endMinute: 240 }] })
  assert.equal(result.candidates[0]!.startAt, '2026-03-08T10:00:00.000Z')
  assert.equal(result.candidates[0]!.endAt, '2026-03-08T11:00:00.000Z')
  await assert.rejects(suggestTaskSchedule(fixture(), { ...query, range: { start: '2026-02-30', end: '2026-03-02' } }), /Invalid/)
})

test('hidden external sources require fresh coverage and hidden local meetings still block', async () => {
  const state = fixture()
  const source = state.calendarSources[0]!
  source.hidden = true
  source.selected = false
  source.provider = 'google'
  assert.equal((await suggestTaskSchedule(state, query)).reason, 'availability-unknown')
  source.provider = 'local'
  state.calendarEvents.push({ id: 'busy', revision: 1, sourceId: source.id, title: 'Busy', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time: { kind: 'fixed', startAt: '2026-09-08T23:00:00Z', endAt: '2026-09-09T10:00:00Z', timezone: 'UTC' }, recurrence: null, createdAt: query.now, updatedAt: query.now, deletedAt: null })
  assert.equal((await suggestTaskSchedule(state, query)).candidates[0]!.startAt, '2026-09-09T10:00:00.000Z')
  state.calendarEvents[0]!.availability = 'free'
  assert.equal((await suggestTaskSchedule(state, query)).candidates[0]!.startAt, '2026-09-09T09:00:00.000Z')
})

test('weekly plan clips at the boundary; focus and completion require facts', () => {
  const state = fixture()
  state.tasks[0]!.schedule.startAt = '2026-09-06T23:30:00Z'
  state.tasks[0]!.status = 'completed'
  const session = { id: 'cross', taskId: 'timed', state: 'running' as const, startedAt: '2026-09-06T23:00:00Z', activeSince: '2026-09-07T00:00:00Z', elapsedSeconds: 600, scratchpad: '', createdAt: query.now, updatedAt: '2026-09-07T00:00:00Z', deletedAt: null }
  state.studySessions.push(session)
  const args = { asOf: '2026-09-07T01:00:00Z', timezone: 'UTC', weekStartsOn: 1 as const }
  const summary = selectCalendarWeeklySummary(state, args)
  assert.equal(summary.plannedMinutes, 30)
  assert.equal(summary.completedCount, 0, 'Status alone must not invent recorded completion')
  assert.equal(summary.actualFocusSeconds, 3600)
  assert.equal(summary.unallocatedFocusSeconds, 600)
  assert.deepEqual(summary.unallocatedSessionIds, ['cross'])
  state.taskEvents.push({ id: 'done', taskId: 'timed', sequence: 1, type: 'completed', occurredAt: '2026-09-07T00:30:00Z', fromStatus: 'planned', toStatus: 'completed', reason: null, completionRecordId: null })
  assert.equal(selectCalendarWeeklySummary(state, args).completionRate, 1)
  state.taskEvents.push({ ...state.taskEvents[0]!, id: 'moved', sequence: 2, type: 'rescheduled' })
  assert.equal(selectCalendarWeeklySummary(state, args).movementCount, 1)
})

test('unmaterialized recurring timeboxes block preview without persisting generated occurrences', async () => {
  const state = fixture()
  const series = state.recurrenceSeries[0]!
  series.anchorAt = '2026-09-09T09:00:00Z'
  series.timezone = 'UTC'
  series.end = { kind: 'never' }
  state.tasks.push({ ...structuredClone(state.tasks[0]!), id: series.taskId, recurrenceSeriesId: series.id })
  const before = structuredClone(state)
  assert.equal((await suggestTaskSchedule(state, query)).candidates[0]!.startAt, '2026-09-09T10:00:00.000Z')
  assert.deepEqual(state, before)
  state.occurrences.push({ id: `occurrence:${series.id}:1`, seriesId: series.id, ordinal: 1, scheduledAt: series.anchorAt, scheduledOn: null, status: 'cancelled', override: null, completedAt: null, revision: 1 })
  assert.equal((await suggestTaskSchedule(state, query)).candidates[0]!.startAt, '2026-09-09T09:00:00.000Z')
  assert.equal((await suggestTaskSchedule(state, { ...query, range: { ...query.range, end: '2026-12-01' } })).reason, 'availability-unknown')
})
