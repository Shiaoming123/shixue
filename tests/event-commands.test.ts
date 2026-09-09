import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { EventCapabilityCommand } from '../src/domain/capabilities/event-commands.ts'
import { DomainCommandError, type CapabilityCommand, type CommandEnvelope } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import type { WorkspaceStateV4 } from '../src/domain/workspace/types.ts'

const now = '2026-09-09T00:00:00Z'
const event: Extract<EventCapabilityCommand, { type: 'event.create' }>['event'] = { title: 'Meeting', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time: { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-10' }, recurrence: null }
const source = { title: 'Personal', color: '#668575', group: null, timezone: 'UTC', selected: true, hidden: false }
async function setup() {
  const store = createInMemoryWorkspaceStore()
  let n = 0
  const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:events:${++n}`)
  const snapshot = () => store.load()
  const envelope = async (command: CapabilityCommand): Promise<CommandEnvelope> => ({ protocolVersion: 1, source: 'human-ui', idempotencyKey: `event-test:${++n}`, expectedWorkspaceRevision: (await snapshot()).revision, command })
  const run = async (command: CapabilityCommand) => service.execute(await envelope(command))
  const local = (await snapshot()).calendarSources[0]!.id
  return { store, service, snapshot, envelope, run, local }
}
function taskFacts(state: WorkspaceStateV4) { const { calendarSources, calendarEvents, commandReceipts, revision, updatedAt, ...facts } = state; return facts }
const code = (expected: string) => (error: unknown) => error instanceof DomainCommandError && error.code === expected

test('local source and event CRUD use receipts, CAS and monotonic undo without creating task facts', async () => {
  const h = await setup(); const before = await h.snapshot()
  const createdSource = await h.run({ type: 'calendar_source.create', sourceId: 'local:new', source })
  assert.ok(createdSource.undoToken)
  const created = await h.envelope({ type: 'event.create', eventId: 'event:one', sourceId: 'local:new', event })
  const result = await h.service.execute(created)
  assert.deepEqual(await h.service.execute(created), result)
  await assert.rejects(h.service.execute({ ...created, command: { ...created.command, event: { ...event, title: 'Changed replay' } } as CapabilityCommand }), code('IDEMPOTENCY_KEY_CONFLICT'))
  assert.deepEqual(result.events, [])
  let changed = await h.run({ type: 'event.update', eventId: 'event:one', expectedRevision: 1, scope: 'single', patch: { time: { kind: 'all-day', startOn: '2026-09-10', endOnExclusive: '2026-09-12' } } })
  await h.run({ type: 'undo.apply', token: changed.undoToken! })
  assert.equal((await h.snapshot()).calendarEvents[0]!.revision, 3)
  assert.deepEqual((await h.snapshot()).calendarEvents[0]!.time, event.time)
  changed = await h.run({ type: 'event.delete', eventId: 'event:one', expectedRevision: 3, scope: 'single' })
  await h.run({ type: 'undo.apply', token: changed.undoToken! })
  assert.equal((await h.snapshot()).calendarEvents[0]!.deletedAt, null)
  await assert.rejects(h.run({ type: 'undo.apply', token: changed.undoToken! }), code('UNDO_ALREADY_APPLIED'))
  changed = await h.run({ type: 'calendar_source.update', sourceId: 'local:new', expectedRevision: 1, patch: { hidden: true, selected: false } })
  await h.run({ type: 'undo.apply', token: changed.undoToken! })
  changed = await h.run({ type: 'calendar_source.archive', sourceId: 'local:new', expectedRevision: 3 })
  await assert.rejects(h.run({ type: 'event.delete', eventId: 'event:one', expectedRevision: 5, scope: 'single' }), code('VALIDATION_ERROR'))
  await h.run({ type: 'undo.apply', token: changed.undoToken! })
  assert.deepEqual(taskFacts(await h.snapshot()), taskFacts(before))
})

test('revision, fields, nested time and read/external/archive permissions fail without saving', async () => {
  for (const patch of [{ permission: 'read' }, { provider: 'google' }, { archivedAt: now }] as const) {
    const h = await setup(); await h.run({ type: 'event.create', eventId: 'event:protected', sourceId: h.local, event }); const state = await h.snapshot()
    Object.assign(state.calendarSources[0]!, patch); await h.store.save(state)
    const before = await h.snapshot()
    for (const command of [
      { type: 'event.create', sourceId: h.local, event },
      { type: 'event.update', eventId: 'event:protected', expectedRevision: 1, scope: 'single', patch: { title: 'Blocked' } },
      { type: 'event.delete', eventId: 'event:protected', expectedRevision: 1, scope: 'single' },
      { type: 'calendar_source.update', sourceId: h.local, expectedRevision: 1, patch: { hidden: true } },
      { type: 'calendar_source.archive', sourceId: h.local, expectedRevision: 1 },
    ] as const) await assert.rejects(h.run(command), code('VALIDATION_ERROR'))
    assert.deepEqual(await h.snapshot(), before)
  }
  const h = await setup(); await h.run({ type: 'event.create', eventId: 'event:one', sourceId: h.local, event })
  const before = await h.snapshot()
  await assert.rejects(h.run({ type: 'event.update', eventId: 'event:one', expectedRevision: 0, scope: 'single', patch: { title: 'stale' } }), code('ENTITY_REVISION_CONFLICT'))
  for (const patch of [{ sourceId: 'other' }, { revision: 900 }, { providerPayload: {} }, { time: { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-09' } }]) {
    await assert.rejects(h.run({ type: 'event.update', eventId: 'event:one', expectedRevision: 1, scope: 'single', patch } as CapabilityCommand), code('VALIDATION_ERROR'))
  }
  const envelope = await h.envelope({ type: 'event.delete', eventId: 'event:one', expectedRevision: 1, scope: 'single' })
  await assert.rejects(h.service.execute({ ...envelope, expectedWorkspaceRevision: before.revision - 1 }), code('WORKSPACE_REVISION_CONFLICT'))
  assert.deepEqual(await h.snapshot(), before)
})

test('series updates cannot bypass a live explicit preview by claiming single scope', async () => {
  const h = await setup()
  await h.run({ type: 'event.create', eventId: 'event:repeat', sourceId: h.local, event: { ...event, recurrence: { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' } } } })
  const command = { type: 'event.update', eventId: 'event:repeat', expectedRevision: 1, scope: 'series', patch: { title: 'New series title' } } as const
  const envelope = await h.envelope(command)
  const before = await h.snapshot()
  await assert.rejects(h.service.execute(envelope), /Explicit confirmation/)
  await assert.rejects(h.run({ ...command, scope: 'single' }), /series scope/)
  const preview = await h.service.preview(envelope)
  assert.equal(preview.confirmation, 'explicit'); assert.ok(preview.previewReceiptId)
  assert.deepEqual(await h.snapshot(), before)
  await h.service.execute({ ...envelope, explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: now } })
  assert.equal((await h.snapshot()).calendarEvents[0]!.title, 'New series title')
  await assert.rejects(h.run({ type: 'event.delete', eventId: 'event:repeat', expectedRevision: 2, scope: 'single' }), /series scope/)
  const deletion = await h.envelope({ type: 'event.delete', eventId: 'event:repeat', expectedRevision: 2, scope: 'series' })
  await assert.rejects(h.service.execute({ ...deletion, explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: now } }), /Explicit confirmation/)
  const deletionPreview = await h.service.preview(deletion)
  const removed = await h.service.execute({ ...deletion, explicitConfirmation: { previewReceiptId: deletionPreview.previewReceiptId!, confirmedAt: now } })
  await h.run({ type: 'undo.apply', token: removed.undoToken! })
  assert.equal((await h.snapshot()).calendarEvents[0]!.deletedAt, null)
})

test('undo authenticates its receipt and rechecks the current source permission', async () => {
  const h = await setup()
  const created = await h.run({ type: 'event.create', eventId: 'event:one', sourceId: h.local, event })
  await assert.rejects(h.run({ type: 'undo.apply', token: { ...created.undoToken!, id: 'forged' } }), code('UNDO_TOKEN_NOT_FOUND'))
  const state = await h.snapshot(); state.calendarSources[0]!.permission = 'read'; await h.store.save(state)
  const before = await h.snapshot()
  await assert.rejects(h.run({ type: 'undo.apply', token: created.undoToken! }), /writable local/)
  assert.deepEqual(await h.snapshot(), before)
})

test('single event exceptions move, cancel and reset by original identity with parent revision and undo', async () => {
  const h = await setup()
  await h.run({ type: 'event.create', eventId: 'event:repeat', sourceId: h.local, event: { ...event, recurrence: { cadence: { kind: 'daily', interval: 2 }, end: { kind: 'after', count: 3 } } } })
  const move = await h.run({ type: 'event.exception.set', eventId: 'event:repeat', expectedRevision: 1, originalStart: '2026-09-11', time: { kind: 'all-day', startOn: '2026-09-12', endOnExclusive: '2026-09-13' } })
  assert.equal((await h.snapshot()).calendarEvents[0]!.recurrence!.exceptions[0]!.originalStart, '2026-09-11')
  await h.run({ type: 'undo.apply', token: move.undoToken! })
  assert.deepEqual((await h.snapshot()).calendarEvents[0]!.recurrence!.exceptions, [])
  await h.run({ type: 'event.exception.set', eventId: 'event:repeat', expectedRevision: 3, originalStart: '2026-09-11', time: null })
  assert.equal((await h.snapshot()).calendarEvents[0]!.recurrence!.exceptions[0]!.time, null)
  await h.run({ type: 'event.exception.reset', eventId: 'event:repeat', expectedRevision: 4, originalStart: '2026-09-11' })
  assert.deepEqual((await h.snapshot()).calendarEvents[0]!.recurrence!.exceptions, [])
  const before = await h.snapshot()
  await assert.rejects(h.run({ type: 'event.exception.set', eventId: 'event:repeat', expectedRevision: 5, originalStart: '2026-09-10', time: null }), /Original start/)
  assert.deepEqual(await h.snapshot(), before)
})

test('preview does not reserve generated event/source IDs and save conflicts do not persist a receipt', async () => {
  const h = await setup()
  const envelope = await h.envelope({ type: 'event.create', sourceId: h.local, event })
  const before = await h.snapshot()
  assert.deepEqual((await h.service.preview(envelope)).affected, [{ type: 'calendar_event', id: 'new' }])
  const sourceEnvelope = await h.envelope({ type: 'calendar_source.create', source })
  assert.deepEqual((await h.service.preview(sourceEnvelope)).affected, [{ type: 'calendar_source', id: 'new' }])
  assert.deepEqual(await h.snapshot(), before)
  const conflicting = createTaskCapabilityService({ load: h.snapshot, save: async () => { throw new Error('Concurrent writer') } }, () => now, (kind) => `${kind}:conflict`)
  await assert.rejects(conflicting.execute(envelope), code('WORKSPACE_SAVE_CONFLICT'))
  assert.deepEqual(await h.snapshot(), before)
})

test('creation undo stays scoped and an intervening workspace edit makes its token stale', async () => {
  const h = await setup()
  const sourceResult = await h.run({ type: 'calendar_source.create', sourceId: 'source:temporary', source })
  await h.run({ type: 'undo.apply', token: sourceResult.undoToken! })
  assert.equal((await h.snapshot()).calendarSources.find(({ id }) => id === 'source:temporary')!.archivedAt, now)
  const created = await h.run({ type: 'event.create', eventId: 'event:temporary', sourceId: h.local, event })
  await h.run({ type: 'undo.apply', token: created.undoToken! })
  assert.equal((await h.snapshot()).calendarEvents[0]!.deletedAt, now)
  const another = await h.run({ type: 'event.create', eventId: 'event:stale', sourceId: h.local, event })
  await h.run({ type: 'calendar_source.update', sourceId: h.local, expectedRevision: 1, patch: { selected: false } })
  await assert.rejects(h.run({ type: 'undo.apply', token: another.undoToken! }), code('UNDO_REVISION_CONFLICT'))
})
