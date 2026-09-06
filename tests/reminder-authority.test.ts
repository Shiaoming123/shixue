import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createReminderRuntime, withReminderRuntimeLock } from '../src/lib/reminder-runtime.ts'
import { reconcileReminderDeliveries } from '../src/domain/reminders/resolve.ts'
import { applyDeliveryCommand } from '../src/domain/reminders/delivery-commands.ts'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'

async function fixture() {
  const store = createInMemoryWorkspaceStore()
  const service = createTaskCapabilityService(store, () => '2026-09-05T12:00:00Z', () => crypto.randomUUID())
  const execute = async (command: CapabilityCommand) => service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: crypto.randomUUID(), expectedWorkspaceRevision: (await store.load()).revision, command })
  await execute({ type: 'task.create', taskId: 't', listId: 'list:system:learning', title: 'T' })
  const rule = { type: 'reminder.set' as const, taskId: 't', ruleId: 'r', occurrenceId: null, enabled: true, trigger: { kind: 'absolute' as const, at: '2026-09-05T10:00:00Z' } }
  await execute(rule)
  return { store, service, execute, rule }
}

test('re-enabling an unsent rule resumes its delivery; acknowledged rows stay delivered', async () => {
  const { store, execute, rule } = await fixture()
  await execute({ ...rule, enabled: false })
  await execute(rule)
  await execute({ type: 'reminder.reconcile' })
  assert.equal((await store.load()).reminderDeliveries[0]!.status, 'pending')
  await execute({ type: 'reminder.migrate', rows: [{ taskId: 't', reminderAt: rule.trigger.at, deliveredAt: '2026-09-05T10:00:01Z' }] })
  await execute({ ...rule, enabled: false })
  await execute(rule)
  assert.equal((await store.load()).reminderDeliveries[0]!.status, 'delivered')
})

test('import removes old and portable migration authority', async () => {
  const { store, execute } = await fixture()
  const candidate = await store.load()
  await execute({ type: 'reminder.migrate', rows: [] })
  await execute({ type: 'workspace.import', state: candidate })
  assert.equal((await store.load()).reminderMigration, undefined)
  candidate.reminderMigration = { version: 1, completedAt: '2026-09-05T12:00:00Z', mapped: [], quarantined: [] }
  await execute({ type: 'workspace.import', state: candidate })
  assert.equal((await store.load()).reminderMigration, undefined)
})

test('task-level absolute reminders are one instant, including legacy recurring tasks', async () => {
  const { store } = await fixture()
  const state = await store.load()
  state.tasks.find(({ id }) => id === 't')!.recurrenceSeriesId = 's'
  state.recurrenceSeries.push({ id: 's', taskId: 't', revision: 1, cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorAt: '2026-09-05T10:00:00Z', anchorOn: null, end: { kind: 'never' }, timezone: 'Asia/Shanghai', createdThrough: '2026-09-06', createdCount: 2 })
  state.occurrences.push(...['o1', 'o2'].map((id, index) => ({ id, seriesId: 's', ordinal: index + 1, scheduledAt: '2026-09-05T10:00:00Z', scheduledOn: null, status: 'pending' as const, override: null, completedAt: null, revision: 1 })))
  applyDeliveryCommand(state, { type: 'reminder.migrate', rows: [{ taskId: 't', reminderAt: '2026-09-05T10:00:00Z', deliveredAt: '2026-09-05T10:00:01Z' }] }, '2026-09-05T12:00:00Z')
  reconcileReminderDeliveries(state)
  assert.equal(state.reminderDeliveries.length, 1)
  assert.equal(state.reminderDeliveries[0]!.status, 'delivered')
  assert.doesNotThrow(() => parseWorkspaceState(state))
})

test('exclusive runtime ownership covers an awaited send and still reads local legacy rows', async () => {
  const { store, service, execute } = await fixture()
  await execute({ type: 'reminder.migrate', rows: [] })
  let releaseSend!: () => void
  let sendEntered!: () => void
  const entered = new Promise<void>((resolve) => { sendEntered = resolve })
  const hold = new Promise<void>((resolve) => { releaseSend = resolve })
  let tail = Promise.resolve()
  const withExclusiveLock = (operation: () => Promise<void>) => {
    const work = tail.then(operation)
    tail = work.catch(() => {})
    return work
  }
  let reads = 0
  let sends = 0
  const errors: unknown[] = []
  const options = { service, withExclusiveLock, readLegacyRows: async () => { reads++; return [] }, enabled: () => true, clock: () => '2026-09-05T12:00:00Z', onError: (error: unknown) => { errors.push(error) }, sendNotification: async () => { sends++; sendEntered(); await hold; return true } }
  const a = createReminderRuntime(options)
  const b = createReminderRuntime(options)
  const pendingA = a.poll()
  await entered
  const pendingB = b.poll()
  await new Promise((resolve) => setTimeout(resolve, 10))
  releaseSend()
  await Promise.all([pendingA, pendingB])
  assert.equal((await store.load()).reminderDeliveries[0]!.status, 'delivered')
  assert.equal(sends, 1)
  assert.equal(reads, 2)
  assert.deepEqual(errors, [])
})

test('a portable empty marker cannot bypass different local legacy evidence', async () => {
  const { service, execute } = await fixture()
  await execute({ type: 'reminder.migrate', rows: [] })
  const errors: unknown[] = []
  let reads = 0
  let sends = 0
  const runtime = createReminderRuntime({ service, withExclusiveLock: async (operation) => operation(), enabled: () => true, onError: (error) => { errors.push(error) }, readLegacyRows: async () => { reads++; return [{ taskId: 't', reminderAt: '2026-09-05T10:00:00Z', deliveredAt: '2026-09-05T10:00:01Z' }] }, sendNotification: async () => { sends++; return true } })
  await runtime.poll()
  assert.equal(reads, 1)
  assert.equal(sends, 0)
  assert.match(String(errors[0]), /migration input changed/)
})

test('unavailable cross-context lock fails closed before entering the runtime', async () => {
  let entered = false
  await assert.rejects(withReminderRuntimeLock(async () => { entered = true }, null), /locking is unavailable/)
  assert.equal(entered, false)
})

test('restoring an old pending backup preserves a newer local submission', async () => {
  const { store, execute } = await fixture()
  const backup = await store.load()
  await execute({ type: 'reminder.migrate', rows: [] })
  const id = backup.reminderDeliveries[0]!.id
  await execute({ type: 'reminder.claim', deliveryId: id, expectedRevision: 1, token: 'local' })
  await execute({ type: 'reminder.ack', deliveryId: id, expectedRevision: 2, token: 'local', outcome: 'accepted' })
  const acknowledged = (await store.load()).reminderDeliveries[0]!
  await execute({ type: 'workspace.import', state: backup })
  await execute({ type: 'reminder.migrate', rows: [] })
  assert.deepEqual((await store.load()).reminderDeliveries[0], acknowledged)
  await assert.rejects(execute({ type: 'reminder.claim', deliveryId: id, expectedRevision: 3, token: 'replay' }), /not available/)
})

test('identical migration preserves an explicit snooze and its later acknowledgement', async () => {
  const { store, execute } = await fixture()
  const rows = [{ taskId: 't', reminderAt: '2026-09-05T10:00:00Z', deliveredAt: '2026-09-05T10:00:01Z' }]
  await execute({ type: 'reminder.migrate', rows })
  const id = (await store.load()).reminderDeliveries[0]!.id
  await execute({ type: 'reminder.snooze', deliveryId: id, until: '2026-09-05T12:10:00Z' })
  const snoozed = (await store.load()).reminderDeliveries[0]!
  await execute({ type: 'reminder.migrate', rows })
  assert.deepEqual((await store.load()).reminderDeliveries[0], snoozed)
  const later = createTaskCapabilityService(store, () => '2026-09-05T12:11:00Z', () => crypto.randomUUID())
  const executeLater = async (command: CapabilityCommand) => later.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: crypto.randomUUID(), expectedWorkspaceRevision: (await store.load()).revision, command })
  await executeLater({ type: 'reminder.claim', deliveryId: id, expectedRevision: snoozed.revision!, token: 'snoozed-send' })
  await executeLater({ type: 'reminder.ack', deliveryId: id, expectedRevision: (await store.load()).reminderDeliveries[0]!.revision!, token: 'snoozed-send', outcome: 'accepted' })
  const latest = (await store.load()).reminderDeliveries[0]!
  await executeLater({ type: 'reminder.migrate', rows })
  assert.deepEqual((await store.load()).reminderDeliveries[0], latest)
  assert.equal(latest.acknowledgedAt, '2026-09-05T12:11:00Z')
})
