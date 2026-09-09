import test from 'node:test'
import assert from 'node:assert/strict'
import { CalendarWriteOutbox, type CalendarWriter, type WriteOperation, type WriteOutboxStore } from '../src/calendar-connections/write-outbox.ts'

const parent = { id: 'parent', etag: 'p1', summary: 'Before', start: { date: '2026-09-01' }, end: { date: '2026-09-02' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=10'] }
const pivot = { id: 'pivot', etag: 'i1', recurringEventId: 'parent', originalStartTime: { date: '2026-09-04' }, start: { date: '2026-09-04' }, end: { date: '2026-09-05' } }
const intent = { kind: 'recurring.future' as const, parent: { eventId: 'parent', etag: 'p1' }, originalStart: '2026-09-04', fields: { title: 'After' } }
function setup(overrides = {}) {
  let row: WriteOperation | null = null
  const writer = { mode: 'fake', readFuture: async () => ({ parent, pivot, exceptions: [], complete: true, attachedFacts: [], workspaceHash: 'snapshot1', ...overrides }) } as unknown as CalendarWriter
  return new CalendarWriteOutbox({ insert: async (value: WriteOperation) => { row = structuredClone(value); return true }, get: async () => row } as WriteOutboxStore, writer, async () => {})
}
test('future freezes one serializable root and child cannot enqueue independently', async () => {
  const core = setup(), preview = await core.prepare('c', 'cal', intent, 'all')
  assert.equal(preview.intent.kind, 'recurring.future')
  if (preview.intent.kind !== 'recurring.future') return
  const plan = preview.intent.plan!
  assert.deepEqual(plan.parent.body.recurrence, ['RRULE:FREQ=DAILY;COUNT=3'])
  assert.deepEqual(plan.successor.body.recurrence, ['RRULE:FREQ=DAILY;COUNT=7'])
  assert.equal(plan.parent.etag, 'p1'); assert.equal(plan.pivot.etag, 'i1')
  assert.deepEqual(preview.lockKeys, ['parent', 'pivot', plan.successor.eventId].sort())
  assert.deepEqual(JSON.parse(JSON.stringify(preview)), preview)
  await assert.rejects(core.enqueue(plan.successor.eventId, preview.hash, true), /PREVIEW_NOT_CONFIRMED/)
  plan.parent.body.recurrence = []
  const row = await core.enqueue(preview.operationId, preview.hash, true)
  assert.deepEqual(row.future, { parent: { state: 'pending' }, successor: { state: 'pending' }, compensation: { state: 'pending' } })
  assert.notDeepEqual(row.preview, preview)
  await assert.rejects(core.run(preview.operationId), /WRITE_UNSUPPORTED/)
  await assert.rejects(core.reconcile(preview.operationId), /WRITE_UNSUPPORTED/)
})
test('future rejects incomplete, attached, exceptional, lossy and unprovable snapshots', async () => {
  for (const patch of [{ complete: false }, { attachedFacts: ['link'] }, { exceptions: [pivot] }, { parent: { ...parent, recurrence: ['RRULE:FREQ=DAILY;BYHOUR=9'] } }, { pivot: { ...pivot, originalStartTime: { date: '2026-09-05' } } }, { parent: { ...parent, attachments: [] } }]) {
    await assert.rejects(setup(patch).prepare('c', 'cal', intent, 'all'), /WRITE_UNSUPPORTED/)
  }
})
