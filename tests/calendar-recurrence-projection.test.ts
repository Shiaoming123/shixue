import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { normalizeNativeCalendarBatch } from '../src/calendar-connections/runtime.ts'

import { recurringBatch, generateRecurrenceProjectionFixtures } from '../scripts/generate-calendar-recurrence-projection.ts'

test('recurrence projection binds receipt evidence and rejects substituted plan identities', () => {
  const batch = recurringBatch()
  const normalized = normalizeNativeCalendarBatch(batch, 'connection', 'calendar', batch.observedAt, [])
  assert.deepEqual(normalized.writeProjection, { plan: batch.plan, expectedWorkspaceHash: batch.expectedWorkspaceHash, observedAt: batch.observedAt })
  for (const key of ['parentEventId', 'instanceEventId', 'originalStart'] as const) {
    const forged = structuredClone(batch); forged.plan[key] = 'substituted'
    assert.throws(() => normalizeNativeCalendarBatch(forged, 'connection', 'calendar', batch.observedAt, []), /invalid-response/)
  }
  for (const key of ['observedAt', 'expectedWorkspaceHash'] as const) {
    const forged = structuredClone(batch); forged[key] = 'invalid'
    assert.throws(() => normalizeNativeCalendarBatch(forged, 'connection', 'calendar', batch.observedAt, []))
  }
})

test('real capability fixtures fold exceptions into parents and preserve unrelated workspace facts', async () => {
  const fixture = await generateRecurrenceProjectionFixtures()
  assert.deepEqual(fixture, JSON.parse(readFileSync(new URL('./fixtures/calendar-recurrence-projection.json', import.meta.url), 'utf8')))
  for (const { name, base, current, batch } of fixture.cases) {
    const mutable = new Set(['calendarSources', 'calendarEvents', 'commandReceipts', 'revision', 'updatedAt'])
    for (const key of Object.keys(base)) if (!mutable.has(key)) assert.deepEqual(current[key as keyof typeof current], base[key], `${name}: ${key}`)
    const receipt = current.commandReceipts.find((entry) => entry.idempotencyKey === batch.batchId)!
    assert.deepEqual((receipt.result.data as any).writeProjection, { plan: batch.plan, expectedWorkspaceHash: batch.expectedWorkspaceHash, observedAt: batch.observedAt })
    assert.equal((receipt.result.data as any).operationId, batch.operationId)
    assert.equal(current.calendarEvents.filter((event) => event.sourceId === batch.sourceId).length, 1)
    const input = { ...batch, nextSyncToken: 'ordinary-cursor-sentinel' }, before = structuredClone(input)
    normalizeNativeCalendarBatch(input, batch.connectionId, batch.calendarId, batch.observedAt, base.calendarEvents)
    assert.deepEqual(input, before, 'write normalization cannot advance the ordinary cursor')
  }
  const parent = (index: number) => fixture.cases[index]!.current.calendarEvents.find((event) => event.sourceId === fixture.cases[index]!.batch.sourceId)!
  assert.deepEqual(parent(1).recurrence!.exceptions, [{ originalStart: '2026-09-10', time: { kind: 'all-day', startOn: '2026-09-11', endOnExclusive: '2026-09-12' } }])
  assert.equal(parent(2).recurrence!.exceptions[0]!.time, null)
  assert.deepEqual(parent(3).recurrence!.exceptions[0]!.time, { kind: 'all-day', startOn: '2026-09-10', endOnExclusive: '2026-09-11' })
  assert.deepEqual(parent(4).recurrence!.end, { kind: 'after', count: 10 })
  assert.equal(parent(5).title, '忙碌')
})
