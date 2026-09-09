import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { normalizeNativeCalendarBatch } from '../src/calendar-connections/runtime.ts'

import { recurringBatch, generateRecurrenceProjectionFixtures } from '../scripts/generate-calendar-recurrence-projection.ts'

test('recurrence projection binds receipt evidence and rejects substituted plan identities', () => {
  const batch = recurringBatch()
  const normalized = normalizeNativeCalendarBatch(batch, 'connection', 'calendar', batch.observedAt, [], { operationId: batch.operationId, plan: batch.plan })
  assert.deepEqual(normalized.writeProjection, { plan: batch.plan, expectedWorkspaceHash: batch.expectedWorkspaceHash, observedAt: batch.observedAt })
  for (const key of ['parentEventId', 'instanceEventId', 'originalStart'] as const) {
    const forged = structuredClone(batch); forged.plan[key] = 'substituted'
    assert.throws(() => normalizeNativeCalendarBatch(forged, 'connection', 'calendar', batch.observedAt, [], { operationId: batch.operationId, plan: batch.plan }), /invalid-response/)
  }
  for (const key of ['observedAt', 'expectedWorkspaceHash'] as const) {
    const forged = structuredClone(batch); forged[key] = 'invalid'
    assert.throws(() => normalizeNativeCalendarBatch(forged, 'connection', 'calendar', batch.observedAt, [], { operationId: batch.operationId, plan: batch.plan }))
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
    const sourceEvents = current.calendarEvents.filter((event) => event.sourceId === batch.sourceId)
    if (name !== 'series-create') assert.ok(sourceEvents.some((event) => event.id.endsWith('unrelated%22%5D') && event.title === (batch.access === 'none' ? '忙碌' : 'Unrelated')), `${name}: unrelated same-source event retained or sanitized`)
    const input = { ...batch, nextSyncToken: 'ordinary-cursor-sentinel' }, before = structuredClone(input)
    normalizeNativeCalendarBatch(input, batch.connectionId, batch.calendarId, batch.observedAt, base.calendarEvents, { operationId: batch.operationId, plan: batch.plan })
    assert.deepEqual(input, before, 'write normalization cannot advance the ordinary cursor')
  }
  const parent = (index: number) => fixture.cases[index]!.current.calendarEvents.find((event) => event.sourceId === fixture.cases[index]!.batch.sourceId)!
  assert.deepEqual(parent(1).recurrence!.exceptions, [{ originalStart: '2026-09-10', time: { kind: 'all-day', startOn: '2026-09-11', endOnExclusive: '2026-09-12' } }])
  assert.equal(parent(2).recurrence!.exceptions[0]!.time, null)
  assert.deepEqual(parent(3).recurrence!.exceptions[0]!.time, { kind: 'all-day', startOn: '2026-09-10', endOnExclusive: '2026-09-11' })
  assert.deepEqual(parent(4).recurrence!.end, { kind: 'after', count: 10 })
  assert.deepEqual(parent(5).recurrence!.cadence, { kind: 'weekly', interval: 1, weekdays: [3, 4] })
  assert.deepEqual(parent(5).recurrence!.end, { kind: 'on', date: '2026-10-14' })
  assert.equal(parent(6).title, '忙碌')
})

test('production normalizer retains root binding and fails closed without a frozen staged plan', () => {
  const batch = recurringBatch()
  const expected = { operationId: batch.operationId, plan: structuredClone(batch.plan) }
  const normalized = normalizeNativeCalendarBatch(batch, 'connection', 'calendar', batch.observedAt, [], expected)
  assert.equal(normalized.operationId, batch.operationId)
  assert.equal(normalized.expectedWorkspaceHash, batch.expectedWorkspaceHash)
  assert.throws(() => normalizeNativeCalendarBatch(batch, 'connection', 'calendar', batch.observedAt, []), /invalid-response/)
  batch.plan.hash = `sha256:${'c'.repeat(64)}`
  assert.throws(() => normalizeNativeCalendarBatch(batch, 'connection', 'calendar', batch.observedAt, [], expected), /invalid-response/)
})

test('cancelled series requires a real recurring parent rather than a substituted ordinary tombstone', () => {
  const batch: any = recurringBatch()
  batch.plan = { hash: batch.plan.hash, kind: 'recurring.series', parentEventId: 'parent' }
  batch.items = [{ ...batch.items[0], status: 'cancelled' }]
  const expected = { operationId: batch.operationId, plan: structuredClone(batch.plan) }
  assert.deepEqual(normalizeNativeCalendarBatch(batch, 'connection', 'calendar', batch.observedAt, [], expected).deletedRemoteIds, ['parent'])
  delete batch.items[0].recurrence
  assert.throws(() => normalizeNativeCalendarBatch(batch, 'connection', 'calendar', batch.observedAt, [], expected), /invalid-response/)
})

test('production applyLocal rejects a valid-format read-plan hash substitution before saving or ack', async () => {
  const { createNativeCalendarWriteRuntime } = await import('../src/calendar-connections/native-write-runtime.ts')
  const { createInMemoryWorkspaceStore } = await import('../src/storage/study/in-memory.ts')
  const { fingerprintWorkspace } = await import('../src/domain/capabilities/service.ts')
  for (const tampered of [false, true]) {
    const store = createInMemoryWorkspaceStore(), base = await store.load(), batch = recurringBatch()
    batch.expectedWorkspaceHash = await fingerprintWorkspace(base)
    let acknowledged = false
    const runtime = createNativeCalendarWriteRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: batch.connectionId }, invoke: async (command, args) => {
      assert.equal(args.operationId, batch.operationId)
      if (command.endsWith('|write_stage_local')) return structuredClone(batch)
      if (command.endsWith('|write_read_local')) {
        const read = structuredClone(batch)
        if (tampered) read.plan.hash = `sha256:${'c'.repeat(64)}`
        return read
      }
      assert.equal(command, 'plugin:calendar-connections|write_ack_local')
      const receipt = (await store.load()).commandReceipts.find((entry) => entry.id === args.workspaceReceiptId)!
      assert.equal((receipt.result.data as any).operationId, batch.operationId)
      assert.equal((receipt.result.data as any).writeProjection.expectedWorkspaceHash, batch.expectedWorkspaceHash)
      assert.equal((receipt.result.data as any).writeProjection.plan.hash, batch.plan.hash)
      acknowledged = true
      return { applied: true, operationId: batch.operationId, batchId: batch.batchId }
    } })
    if (tampered) {
      await assert.rejects(runtime.applyLocal(batch.operationId, store), /invalid-response/)
      assert.deepEqual(await store.load(), base)
      assert.equal(acknowledged, false)
    } else {
      await runtime.applyLocal(batch.operationId, store)
      assert.equal(acknowledged, true)
    }
  }
})
