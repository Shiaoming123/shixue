import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService, fingerprintWorkspace } from '../src/domain/capabilities/service.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { normalizeGoogleEvent } from '../src/calendar-connections/google.ts'
import { stableId } from '../src/calendar-connections/types.ts'
import type { ExternalCalendarBatch } from '../src/domain/capabilities/calendar-external-commands.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import { createWorkspaceExport, parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'
import { parseWorkspaceStateV4 } from '../src/domain/workspace/parse.ts'
const now = '2026-09-10T12:00:00Z'
const sourceId = stableId('google', 'connection', 'calendar')
const item = (id: string) => normalizeGoogleEvent({ id, summary: `PRIVATE-${id}`, description: 'PRIVATE-NOTES', location: 'PRIVATE-LOCATION', htmlLink: 'https://calendar.google.com/calendar/event?eid=one', start: { dateTime: '2026-09-09T08:00:00Z' }, end: { dateTime: '2026-09-09T09:00:00Z' } }, { connectionId: 'connection', calendarId: 'calendar', timezone: 'UTC', now, cursor: null })
const batch = (batchId: string, ids: string[] = ['a']): ExternalCalendarBatch => ({ batchId, provider: 'google', connectionId: 'connection', calendarId: 'calendar', sourceId, mode: 'full', access: 'details', title: 'External calendar', timezone: 'UTC', upserts: ids.map(item), deletedRemoteIds: [] })
async function setup() {
  const store = createInMemoryWorkspaceStore(); const staged = new Map<string, ExternalCalendarBatch>(); let reads = 0
  const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:${crypto.randomUUID()}`, { loadExternalBatch: async (id) => { reads++; const value = staged.get(id); if (!value) throw new Error('No authenticated device batch'); return structuredClone(value) } })
  const run = async (command: CapabilityCommand, key = crypto.randomUUID()) => service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: key, expectedWorkspaceRevision: (await store.load()).revision, command })
  const apply = async (value: ExternalCalendarBatch) => { staged.set(value.batchId, value); return run({ type: 'calendar_external.apply', batchId: value.batchId }, value.batchId) }
  return { store, staged, service, run, apply, reads: () => reads }
}

test('write completion binds the whole workspace content even when restored revision and timestamp match', async () => {
  const h = await setup(), initial = await h.store.load()
  const value = { ...batch('write:guard'), operationId: 'native-operation', expectedWorkspaceHash: await fingerprintWorkspace(initial) }
  const changed = structuredClone(initial)
  changed.calendarSources[0]!.title = 'Restored different content'
  await h.store.save(changed, initial.updatedAt)
  await assert.rejects(h.apply(value), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'WORKSPACE_SAVE_CONFLICT')
  assert.deepEqual(await h.store.load(), changed)
  const fresh = { ...value, expectedWorkspaceHash: await fingerprintWorkspace(changed) }
  const applied = await h.apply(fresh)
  assert.equal((applied.data as any).operationId, 'native-operation')
  assert.equal('expectedWorkspaceHash' in (applied.data as object), false)
})

test('trusted batch apply is receipt-idempotent, retains source preferences and exports only safe event facts', async () => {
  const h = await setup(); const before = await h.store.load()
  const first = await h.apply(batch('one'))
  assert.deepEqual(first, await h.apply(batch('one'))); assert.equal(h.reads(), 1)
  await h.run({ type: 'calendar_source.preferences', sourceId, expectedRevision: 1, patch: { selected: false, hidden: true, color: '#123456' } })
  await h.apply({ ...batch('two', ['a', 'b']), mode: 'incremental' })
  const state = await h.store.load(); const source = state.calendarSources.find((source) => source.id === sourceId)!
  assert.equal(source.permission, 'read'); assert.equal(source.selected, false); assert.equal(source.hidden, true); assert.equal(source.color, '#123456')
  assert.deepEqual(state.tasks, before.tasks); assert.deepEqual(state.taskEvents, before.taskEvents)
  assert.equal(state.calendarEvents.length, 2); assert.match(state.calendarEvents[0]!.sourceUrl!, /^https:\/\/calendar.google.com/)
  const exported = createWorkspaceExport(state, now); assert.deepEqual(parseWorkspaceExport(JSON.stringify(exported)).state.calendarEvents, state.calendarEvents)
  assert.deepEqual(first.data, { batchId: 'one', provider: 'google', connectionId: 'connection', calendarId: 'calendar', sourceId, mode: 'full', applied: true })
  assert.doesNotMatch(JSON.stringify(state.commandReceipts), /PRIVATE|syncToken|nextCursor|access_token/)
})

test('incremental tombstones and full replacement stay within source; unlink outcomes and task facts survive permission downgrade', async () => {
  const h = await setup(); await h.apply(batch('one', ['a', 'b']))
  const state = await h.store.load(); const local = state.calendarSources.find((source) => source.provider === 'local')!
  await h.run({ type: 'event.create', sourceId: local.id, eventId: 'local-event', event: { title: 'Local event', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time: item('local').event.time, recurrence: null } })
  const beforeOutcome = await h.store.load()
  await h.run({ type: 'event.outcome.create', eventId: item('a').event.id, expectedEventRevision: 1, originalStart: null, action: 'followup', listId: state.lists[0]!.id, title: 'Independent followup', note: 'Local outcome notes' })
  const facts = await h.store.load()
  await h.apply({ ...batch('delete', []), mode: 'incremental', deletedRemoteIds: ['b'] })
  assert.ok((await h.store.load()).calendarEvents.find((event) => event.id === item('b').event.id)!.deletedAt)
  await h.apply({ ...batch('extra', ['c']), mode: 'incremental' })
  await h.apply(batch('full-only-a', ['a']))
  assert.ok((await h.store.load()).calendarEvents.find((event) => event.id === item('c').event.id)!.deletedAt)
  assert.equal((await h.store.load()).calendarEvents.find((event) => event.id === 'local-event')!.deletedAt, null)
  await h.apply({ ...batch('downgrade', []), access: 'freebusy' })
  const after = await h.store.load()
  assert.deepEqual(after.tasks, facts.tasks); assert.deepEqual(after.eventOutcomes, facts.eventOutcomes); assert.deepEqual(after.calendarEventLinks, facts.calendarEventLinks)
  assert.ok(after.calendarEvents.filter((event) => event.sourceId === sourceId).every((event) => event.deletedAt && event.title === '忙碌' && !event.notes && !event.location && event.sourceUrl === null))
  assert.deepEqual(after.calendarSources.find((source) => source.id === local.id), beforeOutcome.calendarSources.find((source) => source.id === local.id))
})

test('default service denies untrusted ingestion and forged batch identities or provider permissions never save', async () => {
  const h = await setup(); const before = await h.store.load()
  const untrusted = createTaskCapabilityService(h.store, () => now, () => crypto.randomUUID())
  await assert.rejects(untrusted.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: 'fake', expectedWorkspaceRevision: before.revision, command: { type: 'calendar_external.apply', batchId: 'fake' } }), /trusted device resolver/)
  await assert.rejects(h.apply({ ...batch('bad'), sourceId: before.calendarSources[0]!.id }), /identity/)
  const forged = batch('foreign'); forged.upserts[0]!.event.id = 'local-event'
  await assert.rejects(h.apply(forged), /identity/)
  assert.deepEqual(await h.store.load(), before)
  await h.apply(batch('good'))
  const current = await h.store.load()
  await assert.rejects(h.run({ type: 'calendar_source.preferences', sourceId, expectedRevision: 1, patch: { permission: 'write' } } as CapabilityCommand), /Only local/)
  assert.deepEqual(await h.store.load(), current)
})

test('save CAS failure preserves the entire workspace and source URL parser rejects unsafe schemes', async () => {
  const h = await setup(); const before = await h.store.load()
  const service = createTaskCapabilityService({ load: () => h.store.load(), save: async () => { throw new Error('Synthetic CAS race') } }, () => now, () => crypto.randomUUID(), { loadExternalBatch: async () => batch('cas') })
  await assert.rejects(service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: 'cas', expectedWorkspaceRevision: before.revision, command: { type: 'calendar_external.apply', batchId: 'cas' } }), /WORKSPACE_SAVE_CONFLICT/)
  assert.deepEqual(await h.store.load(), before)
  await h.apply(batch('good')); const state = await h.store.load()
  for (const sourceUrl of ['javascript:alert(1)', 'https://user:pass@calendar.google.com/']) assert.throws(() => parseWorkspaceStateV4({ ...state, calendarEvents: [{ ...state.calendarEvents[0], sourceUrl }] }), /sourceUrl/)
})
