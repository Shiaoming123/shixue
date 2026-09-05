import assert from 'node:assert/strict'
import test from 'node:test'
import { materializeOccurrenceWindow } from '../src/domain/recurrence/materialize.ts'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'
import { parseWorkspaceStateOrMigrate } from '../src/domain/workspace/migrate.ts'
import { projectTaskItems } from '../src/lib/study-task-query.ts'
import { createSeedStudyState } from '../src/storage/study/types.ts'
import { createWorkspaceExport, parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'

test('legacy timestamp recurrence parses losslessly and normalizes date-only fields', () => {
  const raw = recurrenceWorkspace()
  delete (raw.recurrenceSeries[0] as Record<string, unknown>).anchorOn
  delete (raw.occurrences[0] as Record<string, unknown>).scheduledOn

  const parsed = parseWorkspaceState(raw)

  assert.equal(parsed.recurrenceSeries[0]?.anchorAt, '2026-09-05T09:00:00+08:00')
  assert.equal(parsed.recurrenceSeries[0]?.anchorOn, null)
  assert.equal(parsed.occurrences[0]?.scheduledAt, '2026-09-05T09:00:00+08:00')
  assert.equal(parsed.occurrences[0]?.scheduledOn, null)
})

test('date-only recurrence round-trips without synthesizing midnight', () => {
  const raw = recurrenceWorkspace()
  Object.assign(raw.recurrenceSeries[0]!, { anchorAt: null, anchorOn: '2026-09-05', createdThrough: '2026-09-05' })
  Object.assign(raw.occurrences[0]!, {
    scheduledAt: null,
    scheduledOn: '2026-09-05',
    override: { scheduledAt: null, scheduledOn: '2026-09-06', estimateMinutes: 30 },
  })

  const parsed = parseWorkspaceState(raw)
  const roundTrip = parseWorkspaceExport(JSON.stringify(createWorkspaceExport(parsed, '2026-09-05T00:00:00Z'))).state

  assert.equal(roundTrip.recurrenceSeries[0]?.anchorOn, '2026-09-05')
  assert.equal(roundTrip.occurrences[0]?.scheduledOn, '2026-09-05')
  assert.equal(roundTrip.occurrences[0]?.scheduledAt, null)
  assert.equal(roundTrip.occurrences[0]?.override?.scheduledOn, '2026-09-06')
  assert.doesNotMatch(JSON.stringify(roundTrip.occurrences[0]), /T00:00:00/)
})

test('parser rejects simultaneous timed and date-only schedules', () => {
  const raw = recurrenceWorkspace()
  Object.assign(raw.recurrenceSeries[0]!, { anchorOn: '2026-09-05' })
  assert.throws(() => parseWorkspaceState(raw), /mutually exclusive/)

  const occurrenceRaw = recurrenceWorkspace()
  Object.assign(occurrenceRaw.occurrences[0]!, { scheduledOn: '2026-09-05' })
  assert.throws(() => parseWorkspaceState(occurrenceRaw), /mutually exclusive/)

  const overrideRaw = recurrenceWorkspace()
  overrideRaw.occurrences[0]!.override = {
    scheduledAt: '2026-09-05T10:00:00+08:00', scheduledOn: '2026-09-05', estimateMinutes: null,
  }
  assert.throws(() => parseWorkspaceState(overrideRaw), /mutually exclusive/)
})

test('date-only materialization and projection remain date-only across timezones', () => {
  for (const timezone of ['Asia/Shanghai', 'America/Los_Angeles']) {
    const state = parseWorkspaceState(recurrenceWorkspace())
    Object.assign(state.recurrenceSeries[0]!, {
      anchorAt: null,
      anchorOn: '2026-09-05',
      createdThrough: '2026-09-05',
      timezone,
    })
    state.occurrences = []

    const result = materializeOccurrenceWindow(state, 'series:date', '2026-09-05T00:00:00Z')
    const occurrence = result.created[0]
    assert.equal(occurrence?.scheduledOn, timezone === 'Asia/Shanghai' ? '2026-09-06' : '2026-09-05')
    assert.equal(occurrence?.scheduledAt, null)

    const [row] = projectTaskItems(result.state, { from: occurrence!.scheduledOn!, to: occurrence!.scheduledOn! })
    assert.equal(row?.scheduledOn, occurrence?.scheduledOn)
    assert.equal(row?.scheduledAt, null)
  }
})

function recurrenceWorkspace(): Record<string, any> {
  const state = parseWorkspaceStateOrMigrate(createSeedStudyState('2026-09-05T00:00:00+08:00')) as unknown as Record<string, any>
  const task = state.tasks[0]!
  task.recurrenceSeriesId = 'series:date'
  state.recurrenceSeries = [{
    id: 'series:date', taskId: task.id, revision: 1,
    cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
    anchorAt: '2026-09-05T09:00:00+08:00', anchorOn: null,
    end: { kind: 'never' }, timezone: 'Asia/Shanghai',
    createdThrough: '2026-09-05T09:00:00+08:00', createdCount: 1,
  }]
  state.occurrences = [{
    id: 'occurrence:series:date:1', seriesId: 'series:date', ordinal: 1,
    scheduledAt: '2026-09-05T09:00:00+08:00', scheduledOn: null,
    status: 'pending', override: null, completedAt: null, revision: 1,
  }]
  return state
}
