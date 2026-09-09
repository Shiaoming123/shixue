import assert from 'node:assert/strict'
import test from 'node:test'
import { createCalendarConnectionRuntime } from '../src/calendar-connections/runtime.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { stableId } from '../src/calendar-connections/types.ts'
import { expandCalendarEventOccurrences } from '../src/domain/calendar/event-occurrences.ts'
import type { WorkspaceStore } from '../src/storage/workspace/types.ts'

test('disabled and web runtime never invoke native auth or network', async () => {
  for (const [enabled, platform] of [[false, 'desktop'], [true, 'web']] as const) {
    const runtime = createCalendarConnectionRuntime({ enabled, runtime: { platform, capabilities: [] }, config: { clientId: null, connectionId: 'test' }, invoke: async () => assert.fail('must not invoke') })
    assert.equal((await runtime.status()).state, 'unavailable')
    await assert.rejects(runtime.connect('details'), /UNAVAILABLE/)
    await assert.rejects(runtime.listCalendars(), /UNAVAILABLE/)
  }
})

test('native batch survives an ack failure and replay changes no task or event twice', async () => {
  const store = createInMemoryWorkspaceStore()
  const before = await store.load()
  const raw = { batchId: 'batch:1', provider: 'google', connectionId: 'test', calendarId: 'calendar', sourceId: stableId('google', 'test', 'calendar'), mode: 'full', access: 'details', title: 'Work', timezone: 'UTC', items: [{ id: 'meeting', summary: 'Meeting', start: { date: '2026-09-09' }, end: { date: '2026-09-10' } }] }
  let failAck = true
  const runtime = createCalendarConnectionRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'test' }, invoke: async (command, args) => {
    if (command.endsWith('|stage_events') || command.endsWith('|read_staged')) return raw
    assert.equal(command, 'plugin:calendar-connections|ack_events')
    const saved = await store.load()
    assert.ok(saved.commandReceipts.some((receipt) => receipt.id === args.workspaceReceiptId && receipt.idempotencyKey === raw.batchId))
    if (failAck) throw 'temporary network sentinel'
    return { batchId: raw.batchId, applied: true }
  } })
  await assert.rejects(runtime.syncCalendar('calendar', store), /SYNC_APPLIED_ACK_PENDING/)
  const applied = await store.load()
  failAck = false
  assert.deepEqual(await runtime.syncCalendar('calendar', store), { batchId: raw.batchId, applied: true })
  assert.deepEqual(await store.load(), applied)
  assert.deepEqual(applied.tasks, before.tasks)
  assert.equal(applied.calendarEvents.length, 1)
  assert.equal(applied.calendarSources.at(-1)?.permission, 'read')
})

test('bridge keeps auth replies and errors out of application state', async () => {
  const calls: string[] = []
  const runtime = createCalendarConnectionRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'test' }, invoke: async (command, args) => {
    calls.push(command)
    assert.deepEqual(args.config, { clientId: null, connectionId: 'test' })
    if (command.endsWith('|status')) return { state: 'ready', grantedScopes: ['read'], access_token: 'private-sentinel' }
    throw 'HTTP failed https://provider.invalid/?token=private-sentinel'
  } })
  assert.deepEqual(await runtime.status(), { state: 'ready', grantedScopes: ['read'] })
  await assert.rejects(runtime.disconnect(true), { message: 'CALENDAR_CONNECTION_FAILED' })
  assert.deepEqual(calls, ['plugin:calendar-connections|status', 'plugin:calendar-connections|disconnect'])
})

test('save CAS conflicts reload current facts and converge on another writer receipt for the same batch', async (context) => {
  for (const competitor of ['unrelated-change', 'same-batch'] as const) await context.test(competitor, async () => {
    const store = createInMemoryWorkspaceStore()
    const initial = await store.load()
    const raw = recurrenceBatch(`cas:${competitor}`, 'full', [parent])
    let reads = 0, saves = 0, acknowledgements = 0
    const runtime = createCalendarConnectionRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'test' }, invoke: async (command, args) => {
      if (command.endsWith('|stage_events')) return raw
      if (command.endsWith('|read_staged')) { reads++; return raw }
      assert.equal(command, 'plugin:calendar-connections|ack_events')
      const receipts = (await store.load()).commandReceipts.filter((receipt) => receipt.idempotencyKey === raw.batchId)
      assert.equal(receipts.length, 1)
      assert.equal(receipts[0]!.id, args.workspaceReceiptId)
      acknowledgements++
      return { batchId: raw.batchId, applied: true }
    } })
    const racedStore: WorkspaceStore = { ...store, async save(candidate, expectedUpdatedAt) {
      saves++
      if (saves === 1) {
        if (competitor === 'same-batch') await runtime.syncCalendar('calendar', store)
        else {
          const concurrent = await store.load(), previous = concurrent.updatedAt
          concurrent.revision++; concurrent.updatedAt = new Date(Date.parse(previous) + 1).toISOString()
          concurrent.calendarSources[0]!.title = 'Concurrent local preference'
          await store.save(concurrent, previous)
        }
      }
      return store.save(candidate, expectedUpdatedAt)
    } }
    await runtime.syncCalendar('calendar', racedStore)
    const final = await store.load()
    assert.equal(final.calendarEvents.length, 1)
    assert.equal(final.calendarEvents[0]!.revision, 1, 'Same batch must never be applied twice')
    assert.equal(final.commandReceipts.filter((receipt) => receipt.idempotencyKey === raw.batchId).length, 1)
    assert.deepEqual(final.tasks, initial.tasks)
    assert.equal(saves, competitor === 'same-batch' ? 1 : 2)
    assert.equal(reads, 2, 'Receipt convergence must not normalize or save the losing candidate again')
    assert.equal(acknowledgements, competitor === 'same-batch' ? 2 : 1)
    if (competitor === 'unrelated-change') assert.equal(final.calendarSources[0]!.title, 'Concurrent local preference')
  })
})

test('persistent save races stop within three attempts without acknowledging an unapplied batch', async () => {
  const store = createInMemoryWorkspaceStore()
  const raw = recurrenceBatch('cas:exhausted', 'full', [parent])
  let saves = 0
  const racedStore: WorkspaceStore = { ...store, async save(candidate, expectedUpdatedAt) {
    saves++
    const concurrent = await store.load(), previous = concurrent.updatedAt
    concurrent.revision++; concurrent.updatedAt = new Date(Date.parse(previous) + 1).toISOString()
    await store.save(concurrent, previous)
    return store.save(candidate, expectedUpdatedAt)
  } }
  const runtime = createCalendarConnectionRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'test' }, invoke: async (command) => {
    if (command.endsWith('|stage_events') || command.endsWith('|read_staged')) return raw
    assert.fail('Failed local CAS must not ack or reset the native cursor')
  } })
  await assert.rejects(runtime.syncCalendar('calendar', racedStore), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'WORKSPACE_SAVE_CONFLICT')
  assert.equal(saves, 3)
  assert.equal((await store.load()).calendarEvents.length, 0)
  assert.equal((await store.load()).commandReceipts.length, 0)
})

const parent = { id: 'parent', summary: 'Meeting', start: { dateTime: '2026-09-09T09:00:00+08:00', timeZone: 'Asia/Shanghai' }, end: { dateTime: '2026-09-09T10:00:00+08:00' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'] }
const moved = { id: 'exception', recurringEventId: 'parent', summary: 'Meeting', originalStartTime: { dateTime: '2026-09-16T09:00:00+08:00' }, start: { dateTime: '2026-09-17T09:00:00+08:00' }, end: { dateTime: '2026-09-17T10:00:00+08:00' } }
function recurrenceBatch(batchId: string, mode: 'full' | 'incremental', items: unknown[]) {
  return { batchId, provider: 'google', connectionId: 'test', calendarId: 'calendar', sourceId: stableId('google', 'test', 'calendar'), mode, access: 'details', title: 'Work', timezone: 'Asia/Shanghai', items }
}

test('weekly full and sparse incremental exceptions cross the runtime seam without creating child events or Tasks', async () => {
  const store = createInMemoryWorkspaceStore()
  const initial = await store.load()
  let raw = recurrenceBatch('weekly:full', 'full', [moved, parent])
  const acknowledged: string[] = []
  const runtime = createCalendarConnectionRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'test' }, invoke: async (command, args) => {
    if (command.endsWith('|stage_events') || command.endsWith('|read_staged')) return structuredClone(raw)
    assert.equal(command, 'plugin:calendar-connections|ack_events')
    assert.ok((await store.load()).commandReceipts.some((receipt) => receipt.id === args.workspaceReceiptId && receipt.idempotencyKey === raw.batchId))
    acknowledged.push(raw.batchId)
    return { batchId: raw.batchId, applied: true }
  } })
  await runtime.syncCalendar('calendar', store)
  let state = await store.load()
  const eventId = stableId('google', 'test', 'calendar', 'parent')
  const originalStart = '2026-09-16T01:00:00.000Z'
  assert.equal(state.calendarEvents.length, 1)
  assert.equal(state.calendarEvents[0]!.id, eventId)
  assert.equal(expandCalendarEventOccurrences(state.calendarEvents[0]!, { start: '2026-09-17', end: '2026-09-18' }, 'Asia/Shanghai')[0]!.originalStart, originalStart)
  raw = recurrenceBatch('weekly:cancel', 'incremental', [{ id: moved.id, recurringEventId: moved.recurringEventId, originalStartTime: moved.originalStartTime, status: 'cancelled' }])
  await runtime.syncCalendar('calendar', store)
  state = await store.load()
  assert.deepEqual(state.calendarEvents[0]!.recurrence!.exceptions, [{ originalStart, time: null }])
  assert.equal(expandCalendarEventOccurrences(state.calendarEvents[0]!, { start: '2026-09-16', end: '2026-09-18' }, 'Asia/Shanghai').length, 0)
  raw = recurrenceBatch('weekly:restore', 'incremental', [{ ...moved, start: { dateTime: '2026-09-16T09:00:00+08:00' }, end: { dateTime: '2026-09-16T10:00:00+08:00' } }])
  await runtime.syncCalendar('calendar', store)
  state = await store.load()
  assert.equal(state.calendarEvents.length, 1)
  assert.equal(expandCalendarEventOccurrences(state.calendarEvents[0]!, { start: '2026-09-16', end: '2026-09-17' }, 'Asia/Shanghai')[0]!.originalStart, originalStart)
  assert.deepEqual(state.tasks, initial.tasks)
  assert.deepEqual(state.taskEvents, initial.taskEvents)
  await runtime.syncCalendar('calendar', store)
  assert.deepEqual(await store.load(), state, 'An acknowledged native batch replay must reuse the receipt')
  assert.deepEqual(acknowledged, ['weekly:full', 'weekly:cancel', 'weekly:restore', 'weekly:restore'])
})

test('rule changes reset the cursor once; failed recovery preserves the old Workspace', async (context) => {
  for (const recovery of ['full', 'repeated-cursor', 'invalid-full']) await context.test(recovery, async () => {
    const failRecovery = recovery !== 'full'
    const store = createInMemoryWorkspaceStore()
    let raw = recurrenceBatch('reset:initial', 'full', [parent, moved])
    let resets = 0, stages = 0, acknowledgements = 0
    const changed = { ...parent, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=1'] }
    const runtime = createCalendarConnectionRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'test' }, invoke: async (command) => {
      if (command.endsWith('|stage_events')) { stages++; return structuredClone(raw) }
      if (command.endsWith('|read_staged')) return structuredClone(raw)
      if (command.endsWith('|reset_sync')) {
        resets++
        raw = recurrenceBatch('reset:recovery', recovery === 'repeated-cursor' ? 'incremental' : 'full', [recovery === 'invalid-full' ? { ...changed, recurrence: ['RRULE:FREQ=MONTHLY;BYSETPOS=-1'] } : changed])
        return { reset: true }
      }
      assert.equal(command, 'plugin:calendar-connections|ack_events')
      acknowledgements++
      return { batchId: raw.batchId, applied: true }
    } })
    await runtime.syncCalendar('calendar', store)
    const before = await store.load()
    raw = recurrenceBatch('reset:changed', 'incremental', [changed])
    if (failRecovery) {
      await assert.rejects(runtime.syncCalendar('calendar', store), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === (recovery === 'repeated-cursor' ? 'cursor-expired' : 'unsupported-recurrence'))
      assert.deepEqual(await store.load(), before)
      assert.equal(acknowledgements, 1, 'Failed recovery cannot acknowledge an unapplied batch')
    } else {
      await runtime.syncCalendar('calendar', store)
      const after = await store.load()
      assert.equal(after.calendarEvents.length, 1)
      assert.deepEqual(after.calendarEvents[0]!.recurrence!.end, { kind: 'after', count: 1 })
      assert.deepEqual(after.calendarEvents[0]!.recurrence!.exceptions, [])
      assert.deepEqual(after.tasks, before.tasks)
      assert.equal(acknowledgements, 2)
    }
    assert.equal(resets, 1)
    assert.equal(stages, 3)
  })
})
