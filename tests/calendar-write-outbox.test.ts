import test from 'node:test'
import assert from 'node:assert/strict'
import { CalendarWriteOutbox, type CalendarWriter, type RemoteWriteIdentity, type WriteOperation, type WriteOutboxStore, type WritePreview, type WriteResponse, type WriteResult } from '../src/calendar-connections/write-outbox.ts'
import { createNativeWriteOutboxStore } from '../src/calendar-connections/write-outbox-native-store.ts'

class Memory implements WriteOutboxStore {
  rows = new Map<string, WriteOperation>()
  async insert(value: WriteOperation) { if (this.rows.has(value.preview.operationId)) return false; this.rows.set(value.preview.operationId, structuredClone(value)); return true }
  async get(id: string) { return structuredClone(this.rows.get(id) ?? null) }
  async list() { return structuredClone([...this.rows.values()]) }
  async cas(id: string, version: number, next: WriteOperation) { if (this.rows.get(id)?.version !== version || next.version !== version + 1) return false; this.rows.set(id, structuredClone(next)); return true }
  async claim(id: string, version: number, leaseId: string, now: number, leaseUntil: number, lockKeys: string[]) {
    const old = this.rows.get(id); if (!old || old.version !== version || old.leaseUntil > now) return null
    if ([...this.rows.values()].some((other) => other.preview.operationId !== id && (other.state === 'applying' || other.outcomeUnknown) && other.preview.connectionId === old.preview.connectionId && other.preview.calendarId === old.preview.calendarId && other.preview.lockKeys.some((key) => lockKeys.includes(key)))) return null
    const next = { ...old, version: version + 1, state: 'applying' as const, outcomeUnknown: true, attempts: old.attempts + 1, leaseId, leaseUntil }; this.rows.set(id, structuredClone(next)); return structuredClone(next)
  }
}
class Fake implements CalendarWriter {
  mode = 'fake' as const
  connected = true; generation = 1; writes: WritePreview[] = []; reads = 0; responses = new Map<string, WriteResult>(); loseResponse = false; quota = false; etag = 'v1'; selfEmail = 'me@example.com'; beforeInspectReturn: (() => void) | null = null; beforeWriteReturn: (() => Promise<void>) | null = null
  session() { return { connected: this.connected, generation: this.generation, canWrite: true } }
  async inspect(preview: WritePreview): Promise<RemoteWriteIdentity> { this.reads++; this.beforeInspectReturn?.(); return { connectionId: preview.connectionId, calendarId: preview.calendarId, eventId: preview.eventId, canWrite: true, etag: preview.intent.kind === 'create' ? null : this.etag, selfEmail: this.selfEmail } }
  async execute(preview: WritePreview): Promise<WriteResponse> {
    if (this.quota) return { kind: 'rejected', code: 'quota' }
    if (preview.intent.kind !== 'create' && preview.intent.etag !== this.etag) return { kind: 'conflict' }
    if (!this.responses.has(preview.operationId)) { this.writes.push(structuredClone(preview)); this.responses.set(preview.operationId, { operationId: preview.operationId, connectionId: preview.connectionId, calendarId: preview.calendarId, eventId: preview.eventId, etag: preview.intent.kind === 'delete' ? null : 'v2' }) }
    await this.beforeWriteReturn?.()
    if (this.loseResponse) throw new Error('response lost')
    return { kind: 'applied', result: this.responses.get(preview.operationId)! }
  }
  async reconcile(preview: WritePreview): Promise<WriteResponse> { this.reads++; const result = this.responses.get(preview.operationId); return result ? { kind: 'applied', result } : { kind: 'unknown' } }
}
const create = { kind: 'create' as const, fields: { title: 'Meeting', time: { kind: 'all-day' as const, startOn: '2026-09-09', endOnExclusive: '2026-09-10' }, attendees: [{ email: 'guest@example.com', optional: false }] } }
test('native store bridge only invokes device persistence with lease/CAS fields', async () => {
  const calls: Array<Record<string, unknown>> = []
  const store = createNativeWriteOutboxStore(async (command, args) => { assert.equal(command, 'plugin:calendar-connections|outbox_store'); calls.push(args); return null })
  await store.claim('id', 2, 'lease', 100, 200, ['event']); await store.get('id'); await store.list()
  assert.deepEqual(calls, [{ request: { kind: 'claim', id: 'id', version: 2, leaseId: 'lease', now: 100, leaseUntil: 200, lockKeys: ['event'] } }, { request: { kind: 'get', id: 'id' } }, { request: { kind: 'list' } }])
})
test('recurring single locks its parent and instance while unknown', async () => {
  const { core, store } = setup(); core.enabled = true
  const single = await core.prepare('c', 'cal', { kind: 'recurring.single', parent: { eventId: 'parent', etag: 'p1' }, originalStart: '2026-09-09T00:00:00.000Z', instance: { eventId: 'instance', etag: 'v1' }, action: 'cancel' }, 'all')
  const series = await core.prepare('c', 'cal', { kind: 'recurring.series', parent: { eventId: 'parent', etag: 'p1' }, action: 'cancel' }, 'all')
  await core.enqueue(single.operationId, single.hash, true); await core.enqueue(series.operationId, series.hash, true)
  await store.claim(single.operationId, 1, 'crashed', 0, 1, single.lockKeys)
  await assert.rejects(core.run(series.operationId), /WRITE_BUSY/)
})
function setup() { const store = new Memory(); const writer = new Fake(); let localFailure = false; let localCount = 0; const core = new CalendarWriteOutbox(store, writer, async () => { localCount++; if (localFailure) throw new Error('local CAS failed') }, () => 100_000); return { store, writer, core, localCount: () => localCount, failLocal: (value: boolean) => { localFailure = value } } }

test('preview is frozen, confirmation explicit, stable Google ID and notifications survive response loss', async () => {
  const { core, writer } = setup(); const preview = await core.prepare('connection', 'calendar', create, 'all')
  assert.match(preview.eventId, /^[a-v0-9]{5,1024}$/)
  await assert.rejects(core.enqueue(preview.operationId, 'wrong', true), /PREVIEW_NOT_CONFIRMED/)
  preview.sendUpdates = 'none'; preview.intent = { kind: 'delete', eventId: 'wrong', etag: 'wrong' }
  await core.enqueue(preview.operationId, preview.hash, true)
  await assert.rejects(core.run(preview.operationId), /WRITE_UNAVAILABLE/); assert.equal(writer.reads, 0)
  core.enabled = true; writer.loseResponse = true
  const unknown = await core.run(preview.operationId); assert.equal(unknown.outcomeUnknown, true)
  await assert.rejects(core.run(preview.operationId), /RECONCILE_REQUIRED/)
  assert.equal((await core.reconcile(preview.operationId)).state, 'applied')
  assert.equal(writer.writes.length, 1); assert.equal(writer.writes[0]!.sendUpdates, 'all'); assert.equal(writer.writes[0]!.eventId, preview.eventId)
})
test('If-Match conflict stops, RSVP checks self, cancel and delete retain distinct intents', async () => {
  const { core, writer } = setup(); core.enabled = true
  for (const kind of ['update', 'cancel', 'delete', 'rsvp'] as const) {
    const intent = kind === 'update' ? { kind, eventId: 'e', etag: 'v1', fields: { title: 'New' } } : kind === 'rsvp' ? { kind, eventId: 'e', etag: 'v1', selfEmail: 'other@example.com', response: 'accepted' as const } : { kind, eventId: 'e', etag: 'v1' }
    const preview = await core.prepare('c', 'cal', intent, 'externalOnly'); await core.enqueue(preview.operationId, preview.hash, true)
    writer.etag = kind === 'update' ? 'v2' : 'v1'
    const result = await core.run(preview.operationId)
    assert.equal(result.state, kind === 'update' ? 'conflict' : kind === 'rsvp' ? 'failed' : 'applied')
  }
  assert.deepEqual(writer.writes.map((item) => item.intent.kind), ['cancel', 'delete'])
  assert.ok(writer.writes.every((item) => item.intent.kind !== 'create' && item.intent.etag === 'v1'))
})
test('disconnect or kill after inspect cannot send; native writer is unavailable', async () => {
  for (const kill of [false, true]) {
    const { core, writer } = setup(); core.enabled = true
    writer.beforeInspectReturn = () => { if (kill) core.enabled = false; else { writer.connected = false; writer.generation++ } }
    const preview = await core.prepare('c', 'cal', create, 'none'); await core.enqueue(preview.operationId, preview.hash, true)
    assert.equal((await core.run(preview.operationId)).state, 'failed'); assert.equal(writer.writes.length, 0)
  }
  const { core, writer } = setup(); core.enabled = true; Object.assign(writer, { mode: 'native' })
  const preview = await core.prepare('c', 'cal', create, 'none'); await core.enqueue(preview.operationId, preview.hash, true)
  await assert.rejects(core.run(preview.operationId), /WRITE_UNAVAILABLE/)
})
test('same event serialized; crashed applying recovers only by reconciliation', async () => {
  const { core, writer, store } = setup(); core.enabled = true
  const a = await core.prepare('c', 'cal', { kind: 'cancel', eventId: 'e', etag: 'v1' }, 'all')
  const b = await core.prepare('c', 'cal', { kind: 'delete', eventId: 'e', etag: 'v1' }, 'all')
  await core.enqueue(a.operationId, a.hash, true); await core.enqueue(b.operationId, b.hash, true)
  await store.claim(a.operationId, 1, 'crashed', 0, 1)
  await assert.rejects(core.run(a.operationId), /RECONCILE_REQUIRED/)
  await assert.rejects(core.run(b.operationId), /WRITE_BUSY/)
  assert.equal((await core.reconcile(a.operationId)).outcomeUnknown, true); assert.equal(writer.writes.length, 0)
  await assert.rejects(core.run(b.operationId), /WRITE_BUSY/)
})
test('concurrent executions serialize by event; authenticated self RSVP preserves other participants', async () => {
  const { core, writer } = setup(); core.enabled = true
  let release!: () => void; let entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  writer.beforeWriteReturn = () => { entered(); return new Promise<void>((resolve) => { release = resolve }) }
  const a = await core.prepare('c', 'cal', { kind: 'rsvp', eventId: 'e', etag: 'v1', selfEmail: 'me@example.com', response: 'tentative' }, 'all')
  const b = await core.prepare('c', 'cal', { kind: 'cancel', eventId: 'e', etag: 'v1' }, 'all')
  await core.enqueue(a.operationId, a.hash, true); await core.enqueue(b.operationId, b.hash, true)
  const running = core.run(a.operationId); await ready
  await assert.rejects(core.run(b.operationId), /WRITE_BUSY/); release()
  assert.equal((await running).state, 'applied')
  assert.deepEqual(writer.writes[0]!.intent, { kind: 'rsvp', eventId: 'e', etag: 'v1', selfEmail: 'me@example.com', response: 'tentative' })
})
test('local apply failure never resends remote operation; quota rejection is not unknown', async () => {
  const fixture = setup(); const { core, writer } = fixture; core.enabled = true; fixture.failLocal(true)
  const preview = await core.prepare('c', 'cal', create, 'all'); await core.enqueue(preview.operationId, preview.hash, true)
  assert.equal((await core.run(preview.operationId)).localApplied, false)
  fixture.failLocal(false); assert.equal((await core.run(preview.operationId)).localApplied, true)
  assert.equal(writer.writes.length, 1); assert.equal(fixture.localCount(), 2)
  writer.quota = true; const next = await core.prepare('c', 'cal', create, 'none'); await core.enqueue(next.operationId, next.hash, true)
  const failed = await core.run(next.operationId); assert.equal(failed.state, 'failed'); assert.equal(failed.outcomeUnknown, false); assert.equal(failed.error, 'quota')
})
test('reconciliation permission/quota/conflict failures never release an unknown prior write', async () => {
  for (const response of [{ kind: 'rejected', code: 'permission' }, { kind: 'rejected', code: 'quota' }, { kind: 'conflict' }] as const) {
    const { core, writer } = setup(); core.enabled = true; writer.loseResponse = true
    const preview = await core.prepare('c', 'cal', create, 'all'); await core.enqueue(preview.operationId, preview.hash, true)
    await core.run(preview.operationId)
    writer.reconcile = async () => response
    const result = await core.reconcile(preview.operationId)
    assert.equal(result.outcomeUnknown, true); assert.equal(result.state, 'failed'); assert.equal(writer.writes.length, 1)
  }
})
