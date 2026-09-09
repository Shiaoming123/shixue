import assert from 'node:assert/strict'
import test from 'node:test'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import type { CalendarEventTime } from '../src/domain/calendar/types.ts'
import { applyEventOutcomeUndo } from '../src/domain/capabilities/event-outcome-commands.ts'
import { createWorkspaceExport, parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'
const NOW = '2026-09-10T12:00:00.000Z'
const fixed: CalendarEventTime = { kind: 'fixed', startAt: '2026-09-09T08:00:00Z', endAt: '2026-09-09T09:00:00Z', timezone: 'UTC' }
async function setup(time = fixed, repeat = false) {
  const store = createInMemoryWorkspaceStore()
  const service = createTaskCapabilityService(store, () => NOW, (kind) => `${kind}:${crypto.randomUUID()}`)
  const run = async (command: CapabilityCommand) => service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: crypto.randomUUID(), expectedWorkspaceRevision: (await store.load()).revision, command })
  const initial = await store.load()
  await run({ type: 'event.create', eventId: 'meeting', sourceId: initial.calendarSources[0]!.id, event: { title: 'Meeting', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time, recurrence: repeat ? { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'after', count: 2 } } : null } })
  return { store, service, run, listId: initial.lists[0]!.id }
}
const note = { type: 'event.outcome.create', eventId: 'meeting', originalStart: null, expectedEventRevision: 1, action: 'note', note: 'Decisions' } as const

test('semantic retries create one independent general followup and survive unlink/export/import', async () => {
  const h = await setup(); const before = await h.store.load()
  const command = { ...note, action: 'followup', title: 'Send summary', listId: h.listId } as const
  const first = await h.run(command); const second = await h.run(command)
  assert.deepEqual(first.data, second.data); assert.equal(second.undoToken, null)
  let state = await h.store.load()
  const outcome = state.eventOutcomes[0]!
  assert.equal(state.eventOutcomes.length, 1)
  assert.equal(state.tasks.length, before.tasks.length + 1)
  assert.equal(state.tasks.find((task) => task.id === outcome.taskId)!.mode, 'general')
  assert.deepEqual(state.calendarEvents, before.calendarEvents)
  const unlinked = await h.run({ type: 'event.unlink', eventId: 'meeting', taskId: outcome.taskId! })
  state = await h.store.load()
  assert.deepEqual(state.calendarEventLinks, [])
  assert.deepEqual(state.eventOutcomes, [outcome])
  await h.run({ type: 'undo.apply', token: unlinked.undoToken! })
  assert.equal((await h.store.load()).calendarEventLinks.length, 1)
  await h.run({ type: 'event.unlink', eventId: 'meeting', taskId: outcome.taskId! })
  state = await h.store.load()
  const imported = parseWorkspaceExport(JSON.stringify(createWorkspaceExport(state, NOW))).state
  await h.run({ type: 'workspace.import', state: imported })
  assert.deepEqual((await h.store.load()).eventOutcomes, state.eventOutcomes)
  assert.deepEqual((await h.store.load()).tasks, state.tasks)
})

test('notes and no-followup never create tasks; read-only events allow local outcomes and retain them after deletion/archive', async () => {
  const h = await setup(); const before = await h.store.load()
  before.calendarSources[0]!.provider = 'google'; before.calendarSources[0]!.permission = 'read'
  await h.store.save(before)
  await h.run(note); await h.run({ ...note, action: 'dismiss' })
  const state = await h.store.load()
  assert.equal(state.eventOutcomes.length, 2); assert.deepEqual(state.tasks, before.tasks)
  state.calendarEvents[0]!.deletedAt = NOW; state.calendarSources[0]!.archivedAt = NOW
  await h.store.save(state)
  assert.deepEqual((await h.store.load()).eventOutcomes, state.eventOutcomes)
  await h.run(note)
  assert.equal((await h.store.load()).eventOutcomes.length, 2)
})

test('real instance identity, revision and actual override end guard after-event actions', async () => {
  const h = await setup(fixed, true)
  await assert.rejects(h.run(note), /original occurrence/)
  await assert.rejects(h.run({ ...note, originalStart: '2026-09-20T08:00:00Z' }), /does not exist/)
  await assert.rejects(h.run({ ...note, originalStart: '2026-09-09T08:00:00Z', expectedEventRevision: 0 }), /REVISION_CONFLICT/)
  await h.run({ type: 'event.exception.set', eventId: 'meeting', expectedRevision: 1, originalStart: '2026-09-09T08:00:00Z', time: { ...fixed, startAt: '2026-09-11T08:00:00Z', endAt: '2026-09-11T09:00:00Z' } })
  await assert.rejects(h.run({ ...note, originalStart: '2026-09-09T08:00:00Z', expectedEventRevision: 2 }), /not ended/)
  await h.run({ ...note, originalStart: '2026-09-10T08:00:00Z', expectedEventRevision: 2 })
  assert.equal((await h.store.load()).eventOutcomes[0]!.occurrenceId, '2026-09-10T08:00:00.000Z')
})

test('all-day exclusive end and floating end use source timezone, not device timezone', async () => {
  for (const time of [{ kind: 'all-day', startOn: '2026-09-10', endOnExclusive: '2026-09-11' }, { kind: 'floating', startLocal: '2026-09-10T12:00', endLocal: '2026-09-10T13:00' }] as CalendarEventTime[]) {
    const h = await setup(time)
    await assert.rejects(h.run(note), /not ended/)
    const state = await h.store.load(); state.calendarSources[0]!.timezone = 'Pacific/Kiritimati'; await h.store.save(state)
    await h.run(note)
    assert.equal((await h.store.load()).eventOutcomes.length, 1)
  }
})

test('followup undo removes only generated link/outcome and soft-deletes only the unchanged new task', async () => {
  const h = await setup()
  const created = await h.run({ ...note, action: 'followup', title: 'Follow up', listId: h.listId })
  const before = await h.store.load(); const taskId = before.eventOutcomes[0]!.taskId!
  const edited = structuredClone(before); edited.tasks.find((task) => task.id === taskId)!.revision++
  const compensation = created.undoToken!.compensation
  assert.equal(compensation.type, 'event.outcome.remove_created')
  if (compensation.type !== 'event.outcome.remove_created') assert.fail()
  assert.throws(() => applyEventOutcomeUndo(edited, compensation, { now: NOW, id: () => crypto.randomUUID() }), /task changed/)
  assert.equal(edited.eventOutcomes.length, 1)
  await h.run({ type: 'undo.apply', token: created.undoToken! })
  const after = await h.store.load()
  assert.deepEqual(after.eventOutcomes, []); assert.deepEqual(after.calendarEventLinks, [])
  assert.equal(after.tasks.find((task) => task.id === taskId)!.deletedAt, NOW)
  assert.deepEqual(after.calendarEvents, before.calendarEvents)
})

test('explicit link is idempotent and undo/unlink never delete either independently existing fact', async () => {
  const h = await setup()
  await h.run({ type: 'task.create', taskId: 'existing', title: 'Independent work', listId: h.listId })
  const before = await h.store.load()
  const linked = await h.run({ type: 'event.link', eventId: 'meeting', taskId: 'existing' })
  await h.run({ type: 'undo.apply', token: linked.undoToken! })
  assert.deepEqual((await h.store.load()).calendarEventLinks, [])
  const first = await h.run({ type: 'event.link', eventId: 'meeting', taskId: 'existing' })
  const replay = await h.run({ type: 'event.link', eventId: 'meeting', taskId: 'existing' })
  assert.deepEqual(first.data, replay.data)
  await h.run({ type: 'event.unlink', eventId: 'meeting', taskId: 'existing' })
  const after = await h.store.load()
  assert.deepEqual(after.tasks, before.tasks)
  assert.deepEqual(after.calendarEvents, before.calendarEvents)
  assert.deepEqual(after.eventOutcomes, [])
})
