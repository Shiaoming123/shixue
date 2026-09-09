import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { openMeowDatabase } from '../src/storage/indexeddb/database.ts'
import { createIndexedDbWorkspaceStore, V3_WORKSPACE_STATE_BACKUP_KEY } from '../src/storage/study/indexeddb.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import type { WorkspaceStore } from '../src/storage/workspace/types.ts'
import { createWorkspaceExport, parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'

const legacy = JSON.parse(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')).state
const now = '2026-09-10T12:00:00.000Z'
const event = { title: 'Synthetic IndexedDB meeting', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time: { kind: 'fixed', startAt: '2026-09-11T08:00:00Z', endAt: '2026-09-11T09:00:00Z', timezone: 'UTC' }, recurrence: null } as const
function commands(store: WorkspaceStore) {
  const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:${crypto.randomUUID()}`)
  const run = async (command: CapabilityCommand) => service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: crypto.randomUUID(), expectedWorkspaceRevision: (await store.load()).revision, command })
  return { service, run }
}
async function setup() {
  const databaseName = `event-service-${crypto.randomUUID()}`
  const database = await openMeowDatabase(databaseName)
  await database.put('studyState', { key: 'current', state: structuredClone(legacy) })
  const store = createIndexedDbWorkspaceStore({ databaseName, seed: legacy })
  const migrated = await store.load()
  return { databaseName, database, store, migrated, ...commands(store) }
}

test('V3 IndexedDB migration then capability event/reminder create, move, undo and export/import retain independent facts', async () => {
  const h = await setup()
  const reload = () => createIndexedDbWorkspaceStore({ databaseName: h.databaseName, seed: legacy }).load()
  try {
    assert.equal(h.migrated.version, 4)
    assert.deepEqual((await h.database.get('studyState', V3_WORKSPACE_STATE_BACKUP_KEY))!.state, legacy)
    const sourceId = h.migrated.calendarSources[0]!.id
    await h.run({ type: 'event.create', eventId: 'event:idb', sourceId, event })
    await h.run({ type: 'reminder.set', ruleId: 'rule:idb', target: { kind: 'event', eventId: 'event:idb', originalStart: null }, trigger: { kind: 'before_start', minutes: 10 }, enabled: true })
    let state = await reload()
    assert.deepEqual(state.tasks, h.migrated.tasks, 'Event creation must never clone an event into task storage')
    assert.deepEqual(state.taskEvents, h.migrated.taskEvents)
    assert.equal(state.calendarEvents[0]!.id, 'event:idb')
    const delivery = state.reminderDeliveries.find((d) => d.reminderRuleId === 'rule:idb')!
    assert.equal(delivery.scheduledFor, '2026-09-11T07:50:00.000Z')
    const moved = await h.run({ type: 'event.update', eventId: 'event:idb', expectedRevision: 1, scope: 'single', patch: { time: { ...event.time, startAt: '2026-09-11T10:00:00Z', endAt: '2026-09-11T11:00:00Z' } } })
    state = await reload()
    assert.equal(state.reminderDeliveries.find((d) => d.id === delivery.id)!.status, 'cancelled')
    assert.equal(state.calendarEvents[0]!.revision, 2)
    await h.run({ type: 'undo.apply', token: moved.undoToken! })
    state = await reload()
    assert.deepEqual(state.calendarEvents[0]!.time, event.time)
    assert.equal(state.calendarEvents[0]!.revision, 3)
    assert.equal(state.reminderDeliveries.find((d) => d.id === delivery.id)!.status, 'pending')
    const exported = JSON.stringify(createWorkspaceExport(state, now))
    const target = await setup()
    try {
      await target.run({ type: 'workspace.import', state: parseWorkspaceExport(exported).state })
      const imported = await createIndexedDbWorkspaceStore({ databaseName: target.databaseName, seed: legacy }).load()
      assert.deepEqual(imported.calendarEvents, state.calendarEvents)
      assert.deepEqual(imported.reminderRules, state.reminderRules)
      assert.deepEqual(imported.reminderDeliveries, state.reminderDeliveries)
      assert.deepEqual(imported.tasks, h.migrated.tasks)
      assert.deepEqual((await target.database.get('studyState', V3_WORKSPACE_STATE_BACKUP_KEY))!.state, legacy)
    } finally { target.database.close() }
  } finally { h.database.close() }
})

test('IndexedDB service rejects read-only source and a real save CAS race without persisting its candidate', async () => {
  const h = await setup()
  const raw = async () => JSON.stringify((await h.database.get('studyState', 'current'))!.state)
  try {
    const protectedState = await h.store.load()
    protectedState.calendarSources[0]!.permission = 'read'
    await h.store.save(protectedState, h.migrated.updatedAt)
    const before = await raw()
    await assert.rejects(h.run({ type: 'event.create', eventId: 'event:forbidden', sourceId: protectedState.calendarSources[0]!.id, event }), /read-only|writable|write/i)
    assert.equal(await raw(), before, 'A rejected command must not write a receipt or event')

    protectedState.calendarSources[0]!.permission = 'write'
    await h.store.save(protectedState, protectedState.updatedAt)
    let winnerBytes = ''
    const racing: WorkspaceStore = {
      load: () => h.store.load(),
      async save(candidate, expectedUpdatedAt) {
        const winner = await h.store.load()
        winner.calendarSources[0]!.title = 'Concurrent accepted change'
        winner.calendarSources[0]!.revision++
        winner.revision++
        winner.updatedAt = '2026-09-12T00:00:00.000Z'
        await h.store.save(winner, expectedUpdatedAt)
        winnerBytes = await raw()
        await h.store.save(candidate, expectedUpdatedAt)
      },
    }
    await assert.rejects(commands(racing).run({ type: 'event.create', eventId: 'event:loser', sourceId: protectedState.calendarSources[0]!.id, event }), /WORKSPACE_SAVE_CONFLICT/)
    assert.equal(await raw(), winnerBytes, 'The adapter CAS must retain the concurrent winner byte-for-byte')
    assert.deepEqual((await h.store.load()).calendarEvents, [])
    assert.deepEqual((await h.store.load()).tasks, h.migrated.tasks)
  } finally { h.database.close() }
})
