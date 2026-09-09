import test from 'node:test'
import assert from 'node:assert/strict'
import { CalendarWriteOutbox, type WriteOperation, type WriteOutboxStore } from '../src/calendar-connections/write-outbox.ts'
import { createGoogleCalendarWriter, type GoogleWriteRequest } from '../src/calendar-connections/google-write.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { normalizeGoogleBatch } from '../src/calendar-connections/google-recurrence.ts'

const parent = { id: 'parent', etag: 'p1', summary: 'Before', start: { date: '2026-09-01' }, end: { date: '2026-09-02' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=10'] }
const pivot = { id: 'pivot', etag: 'i1', recurringEventId: 'parent', originalStartTime: { date: '2026-09-04' }, start: { date: '2026-09-04' }, end: { date: '2026-09-05' } }
const intent = { kind: 'recurring.future' as const, parent: { eventId: 'parent', etag: 'p1' }, originalStart: '2026-09-04', fields: { title: 'After' } }
async function setup(loss = '', reject = '', crashAfterRejection = false, compensationStatus = 0, divergence: Record<string, unknown> = {}) {
  const rows = new Map<string, WriteOperation>(), events = new Map<string, Record<string, unknown>>([['parent', structuredClone(parent)]]), mutations: GoogleWriteRequest[] = []
  const workspace = await createInMemoryWorkspaceStore().load()
  let offline = false, now = 0
  const store: WriteOutboxStore = {
    async insert(op) { rows.set(op.preview.operationId, structuredClone(op)); return true }, async get(id) { return structuredClone(rows.get(id) ?? null) }, async list() { return [...rows.values()] },
    async cas(id, version, next) {
      if (rows.get(id)?.version !== version) return false; rows.set(id, structuredClone(next))
      if (crashAfterRejection && Object.values(next.future ?? {}).some(step => step.state === 'rejected')) throw Error('crash after persisted rejection')
      return true
    },
    async claim(id, version, leaseId, now, leaseUntil, keys) {
      const op = rows.get(id)!
      if (op.version !== version || op.leaseUntil > now || [...rows.values()].some(other => other !== op && (other.state === 'applying' || other.outcomeUnknown) && other.preview.lockKeys.some(key => keys.includes(key)))) return null
      const next = { ...op, version: version + 1, leaseId, leaseUntil, attempts: op.attempts + 1, state: 'applying' as const, outcomeUnknown: true }; rows.set(id, structuredClone(next)); return structuredClone(next)
    },
  }
  const writer = createGoogleCalendarWriter({ kind: 'fake', session: () => ({ connected: true, canWrite: true, generation: 1 }), async request(_connection, req) {
    if (req.method === 'GET') { if (offline) throw Error('offline'); const body = events.get(decodeURIComponent(req.path.split('/').at(-1)!)); return { status: body ? 200 : 404, body } }
    const op = [...rows.values()].find(row => row.state === 'applying')!, step = req.method === 'POST' ? 'successor' : op.future!.compensation.state === 'applying' ? 'compensation' : 'parent'
    assert.equal(op.future![step].state, 'applying'); assert.equal(op.future![step].outcomeUnknown, true)
    mutations.push(structuredClone(req)); const id = req.method === 'POST' ? String(req.body!.id) : 'parent'
    if (reject === step) { Object.assign(events.get('parent')!, { etag: 'latest' }, divergence); return { status: 403 } }
    if (step === 'compensation') { assert.equal(op.future!.compensation.etag, 'latest'); assert.equal(req.headers['If-Match'], 'latest'); if (compensationStatus) return { status: compensationStatus } }
    const body = { ...events.get(id), ...req.body, id, etag: `v${mutations.length}` }; events.set(id, body)
    if (loss === step) { offline = true; throw Error('lost response') }
    return { status: 200, body }
  } }, async () => workspace)
  writer.readFuture = async () => structuredClone({ parent, pivot, exceptions: [], complete: true, ...await writer.readFutureLocal!('c', 'cal', 'parent') })
  const restart = () => { const core = new CalendarWriteOutbox(store, writer, async () => { throw Error('projection belongs to 4B') }, () => now); core.enabled = true; return core }
  const core = restart(), preview = await core.prepare('c', 'cal', intent, 'all'); await core.enqueue(preview.operationId, preview.hash, true)
  return { core, preview, rows, events, mutations, store, restart, workspace, recover: () => { offline = false; crashAfterRejection = false; now += 30_001 }, drift: () => { workspace.revision++ } }
}
test('future split proves both steps with fixed ID and one notification request each', async () => {
  const f = await setup(), op = await f.core.run(f.preview.operationId)
  assert.equal(op.state, 'applied'); assert.equal(op.localApplied, false)
  assert.equal(op.future!.parent.state, 'proved'); assert.equal(op.future!.successor.state, 'proved'); assert.ok(op.result!.future)
  assert.deepEqual(f.mutations.map(req => [req.method, req.query.sendUpdates]), [['PATCH', 'all'], ['POST', 'all']])
  assert.equal(f.mutations[0]!.headers['If-Match'], 'p1'); assert.equal(f.mutations[1]!.body!.id, op.future!.successor.proof!.id)
  await f.restart().run(f.preview.operationId); assert.equal(f.mutations.length, 2)
})
for (const step of ['parent', 'successor']) test(`future ${step} response loss survives JSON restart and reconciles without resend`, async () => {
  const f = await setup(step), op = await f.core.run(f.preview.operationId)
  assert.equal(op.outcomeUnknown, true); assert.equal(op.result, null)
  f.rows.set(f.preview.operationId, JSON.parse(JSON.stringify(op))); f.recover()
  const before = f.mutations.length
  const result = await f.restart().reconcile(f.preview.operationId)
  assert.equal(f.mutations.length, before)
  assert.equal(result.state, step === 'parent' ? 'applying' : 'applied'); assert.equal(result.outcomeUnknown, false)
  if (step === 'parent') {
    assert.equal(result.future!.successor.state, 'pending')
    assert.equal((await f.restart().run(f.preview.operationId)).state, 'applied')
  }
  assert.equal(f.mutations.length, 2)
})
test('future rejects workspace drift before first mutation', async () => {
  const f = await setup(); f.drift(); const op = await f.core.run(f.preview.operationId)
  assert.equal(op.state, 'conflict'); assert.equal(f.mutations.length, 0)
})
for (const drift of ['parent', 'etag', 'workspace', 'attachment']) test(`deferred successor refuses ${drift} drift and retains its lock`, async () => {
  const f = await setup('parent'); await f.core.run(f.preview.operationId); f.recover()
  await f.restart().reconcile(f.preview.operationId)
  if (drift === 'parent') f.events.get('parent')!.summary = 'Third-party edit'
  if (drift === 'etag') f.events.get('parent')!.etag = 'third-party-version'
  if (drift === 'workspace') f.drift()
  if (drift === 'attachment') {
    const now = '2026-09-09T00:00:00Z'
    const event = normalizeGoogleBatch([parent], { connectionId: 'c', calendarId: 'cal', timezone: 'UTC', now, cursor: null }, [], 'full').upserts[0]!.event
    f.workspace.calendarSources.push({ id: event.sourceId, revision: 1, provider: 'google', title: 'Calendar', color: '#000000', group: null, permission: 'write', selected: true, hidden: false, timezone: 'UTC', createdAt: now, updatedAt: now, archivedAt: null })
    f.workspace.calendarEvents.push(event)
    f.workspace.eventOutcomes.push({ id: 'attached-outcome', eventId: event.id, occurrenceId: null, action: 'note', taskId: null, note: 'Keep', createdAt: now })
  }
  const before = f.mutations.length, op = await f.restart().run(f.preview.operationId)
  assert.equal(op.state, 'conflict'); assert.equal(op.error, 'WRITE_SNAPSHOT_CHANGED'); assert.equal(op.outcomeUnknown, true)
  assert.equal(op.result, null); assert.equal(op.future!.successor.state, 'pending'); assert.equal(f.mutations.length, before)
  const overlap = await f.core.prepare('c', 'cal', { kind: 'recurring.series', parent: intent.parent, action: 'cancel' }, 'all')
  await f.core.enqueue(overlap.operationId, overlap.hash, true)
  await assert.rejects(f.restart().run(overlap.operationId), /WRITE_BUSY/)
  assert.equal(f.mutations.length, before)
})
test('unresolved future root keeps the parent lock and rejects an overlapping series write', async () => {
  const f = await setup('parent')
  const overlap = await f.core.prepare('c', 'cal', { kind: 'recurring.series', parent: intent.parent, action: 'cancel' }, 'all')
  await f.core.enqueue(overlap.operationId, overlap.hash, true)
  await f.core.run(f.preview.operationId)
  await assert.rejects(f.restart().run(overlap.operationId), /WRITE_BUSY/)
  assert.equal(f.mutations.length, 1)
  f.recover()
  const restored = await f.restart().reconcile(f.preview.operationId)
  assert.equal(restored.outcomeUnknown, false); assert.equal(restored.state, 'applying')
  await assert.rejects(f.restart().run(overlap.operationId), /WRITE_BUSY/)
  assert.equal(f.mutations.length, 1)
})
test('GET content without the exact root marker never permits successor creation', async () => {
  const f = await setup('parent'); await f.core.run(f.preview.operationId); f.recover()
  f.events.get('parent')!.extendedProperties = { private: { meowOperationId: f.preview.operationId, meowOperationHash: 'other' } }
  const result = await f.restart().reconcile(f.preview.operationId)
  assert.equal(result.outcomeUnknown, true); assert.equal(result.result, null); assert.equal(f.mutations.length, 1)
})
for (const step of ['parent', 'successor'] as const) test(`${step} proof refuses added semantic facts or status absent from the plan`, async () => {
  for (const patch of [{ attendees: [] }, { attachments: [{ fileUrl: 'https://example.test/file' }] }, { status: 'tentative' }, { eventType: 'outOfOffice' }, { description: 'third-party edit' }]) {
    const f = await setup(step); await f.core.run(f.preview.operationId); f.recover()
    const id = step === 'parent' ? 'parent' : String(f.mutations[1]!.body!.id)
    Object.assign(f.events.get(id)!, patch)
    const op = await f.restart().reconcile(f.preview.operationId)
    assert.equal(op.result, null, JSON.stringify(patch)); assert.equal(op.outcomeUnknown, true)
    assert.equal(f.mutations.length, step === 'parent' ? 1 : 2)
  }
})
for (const step of ['parent', 'successor'] as const) test(`${step} persisted rejection survives a crash before root finalization`, async () => {
  const f = await setup('', step, true)
  await assert.rejects(f.core.run(f.preview.operationId), /crash after persisted rejection/)
  const persisted = JSON.parse(JSON.stringify(f.rows.get(f.preview.operationId)!)) as WriteOperation
  assert.equal(persisted.future![step].state, 'rejected'); assert.equal(persisted.future![step].outcomeUnknown, false)
  f.rows.set(f.preview.operationId, persisted); f.recover()
  const before = f.mutations.length
  let op = await f.restart().reconcile(f.preview.operationId)
  assert.equal(f.mutations.length, before)
  assert.equal(op.result, null); assert.equal(op.state, step === 'parent' ? 'conflict' : 'applying')
  assert.equal(op.outcomeUnknown, false); assert.equal(op.error, step === 'parent' ? 'WRITE_REJECTED' : 'COMPENSATION_REQUIRED')
  if (step === 'successor') {
    assert.equal(op.future!.compensation.state, 'pending')
    op = await f.restart().run(f.preview.operationId)
    assert.equal(op.error, 'COMPENSATED'); assert.equal(op.outcomeUnknown, false)
  }
  assert.equal(f.mutations.length, step === 'parent' ? 1 : 3)
})
for (const step of ['parent', 'successor'] as const) test(`${step} proof accepts only enumerated provider metadata and equivalent defaults`, async () => {
  const f = await setup(step); await f.core.run(f.preview.operationId); f.recover()
  const id = step === 'parent' ? 'parent' : String(f.mutations[1]!.body!.id)
  Object.assign(f.events.get(id)!, { status: 'confirmed', eventType: 'default', created: '2026-09-09T00:00:00Z', updated: '2026-09-09T00:01:00Z', sequence: 2, kind: 'calendar#event', htmlLink: 'https://example.test/event', iCalUID: 'generated' })
  const before = f.mutations.length
  assert.equal((await f.restart().reconcile(f.preview.operationId)).state, step === 'parent' ? 'applying' : 'applied')
  assert.equal(f.mutations.length, before)
})

for (const loss of ['', 'compensation']) test(`child rejection restores original parent once, loss=${loss}`, async () => {
  const f = await setup(loss, 'successor'); let op = await f.core.run(f.preview.operationId)
  assert.equal(f.mutations.length, 3)
  if (loss) {
    assert.equal(op.outcomeUnknown, true); assert.equal(op.future!.compensation.etag, 'latest')
    f.rows.set(f.preview.operationId, JSON.parse(JSON.stringify(op))); f.recover()
    const before = f.mutations.length
    op = await f.restart().reconcile(f.preview.operationId)
    assert.equal(f.mutations.length, before)
  }
  assert.equal(op.state, 'failed'); assert.equal(op.error, 'COMPENSATED'); assert.equal(op.outcomeUnknown, false)
  assert.equal(op.result, null); assert.equal(op.localApplied, false); assert.equal(op.future!.compensation.state, 'proved')
  assert.deepEqual(f.events.get('parent')!.recurrence, parent.recurrence); assert.equal(f.events.size, 1)
  assert.deepEqual(f.mutations.map(req => [req.method, req.query.sendUpdates]), [['PATCH', 'all'], ['POST', 'all'], ['PATCH', 'all']])
  await f.restart().run(f.preview.operationId); assert.equal(f.mutations.length, 3)
})
for (const divergence of [{ summary: 'Other' }, { recurrence: parent.recurrence }, { id: 'other' }, { extendedProperties: { private: { meowOperationHash: 'other' } } }]) test(`compensation refuses divergent parent ${JSON.stringify(divergence)}`, async () => {
  const f = await setup('', 'successor', false, 0, divergence), op = await f.core.run(f.preview.operationId)
  assert.equal(op.state, 'conflict'); assert.equal(op.error, 'COMPENSATION_CONFLICT'); assert.equal(op.outcomeUnknown, true)
  assert.equal(op.result, null); assert.equal(op.localApplied, false); assert.equal(f.mutations.length, 2)
  await f.restart().reconcile(f.preview.operationId); assert.equal(f.mutations.length, 2)
})
for (const status of [412, 403]) test(`restore rejection ${status} retains explicit compensation conflict`, async () => {
  const f = await setup('', 'successor', false, status), op = await f.core.run(f.preview.operationId)
  assert.equal(op.state, 'conflict'); assert.equal(op.error, 'COMPENSATION_CONFLICT'); assert.equal(op.outcomeUnknown, true)
  assert.equal(op.result, null); assert.equal(op.localApplied, false)
  await f.restart().reconcile(f.preview.operationId); assert.equal(f.mutations.length, 3)
})

test('lost restore proof rejects third-party change without another notification', async () => {
  const f = await setup('compensation', 'successor'); await f.core.run(f.preview.operationId); f.recover()
  f.events.get('parent')!.summary = 'Third party'
  const op = await f.restart().reconcile(f.preview.operationId)
  assert.equal(op.error, 'COMPENSATION_CONFLICT'); assert.equal(op.result, null); assert.equal(f.mutations.length, 3)
})
test('only proven compensation releases the same-series lock', async () => {
  for (const status of [0, 412]) {
    const f = await setup('', 'successor', false, status)
    const overlap = await f.core.prepare('c', 'cal', { kind: 'recurring.series', parent: intent.parent, action: 'cancel' }, 'all')
    await f.core.enqueue(overlap.operationId, overlap.hash, true)
    await f.core.run(f.preview.operationId)
    const row = f.rows.get(overlap.operationId)!
    const claimed = await f.store.claim(row.preview.operationId, row.version, 'overlap', 0, 30_000, row.preview.lockKeys)
    assert.equal(claimed !== null, status === 0)
  }
})
