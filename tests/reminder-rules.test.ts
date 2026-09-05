import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryKey, resolveReminderInstant } from '../src/domain/reminders/resolve.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'

test('independent rules preserve task schedule and delivery audit through snooze and disable', async () => {
  const service = createTaskCapabilityService(createInMemoryWorkspaceStore(), () => '2026-09-05T08:00:00.000Z', (kind) => `${kind}:${crypto.randomUUID()}`)
  let sequence = 0
  const execute = async (command: CapabilityCommand) => service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: `test:${++sequence}`, expectedWorkspaceRevision: (await service.query({ type: 'workspace.snapshot' })).revision, command })
  await execute({ type: 'task.create', taskId: 'task:one', listId: 'list:system:learning', title: 'Study', startAt: '2026-09-05T10:00:00.000Z' })
  await execute({ type: 'reminder.set', ruleId: 'rule:one', taskId: 'task:one', occurrenceId: null, trigger: { kind: 'at_start' }, enabled: true })
  await execute({ type: 'reminder.set', ruleId: 'rule:two', taskId: 'task:one', occurrenceId: null, trigger: { kind: 'before_start', minutes: 10 }, enabled: true })
  let state = await service.query({ type: 'workspace.snapshot' })
  assert.equal(state.reminderDeliveries.length, 2)
  const before = structuredClone(state.tasks)
  const delivery = state.reminderDeliveries[0]!
  await execute({ type: 'reminder.snooze', deliveryId: delivery.id, until: '2026-09-05T10:10:00.000Z' })
  state = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(state.tasks, before)
  assert.equal(state.reminderDeliveries[0]!.snoozedUntil, '2026-09-05T10:10:00.000Z')
  await execute({ type: 'reminder.set', ruleId: 'rule:one', taskId: 'task:one', occurrenceId: null, trigger: { kind: 'at_start' }, enabled: false })
  state = await service.query({ type: 'workspace.snapshot' })
  assert.equal(state.reminderRules.length, 2)
  assert.equal(state.reminderDeliveries[0]!.status, 'cancelled')
  assert.equal(state.reminderDeliveries[1]!.status, 'pending')
  await execute({ type: 'reminder.set', ruleId: 'user:absolute', taskId: 'task:one', occurrenceId: null, trigger: { kind: 'absolute', at: '2026-09-05T11:00:00Z' }, enabled: true })
  await execute({ type: 'task.update', taskId: 'task:one', patch: { reminderAt: null } })
  state = await service.query({ type: 'workspace.snapshot' })
  assert.equal(state.reminderRules.find(({ id }) => id === 'user:absolute')!.enabled, true)
  assert.equal(resolveReminderInstant(state.reminderRules[1]!, { ...state.tasks[0]!, schedule: { startAt: null, startOn: '2026-09-05', estimateMinutes: null } }, null), null)
  const occurrence = { id: 'o', seriesId: 's', ordinal: 1, scheduledAt: '2026-09-05T10:00:00Z', scheduledOn: null, status: 'pending' as const, override: { scheduledAt: null, scheduledOn: '2026-09-06', estimateMinutes: null }, completedAt: null, revision: 1 }
  assert.equal(resolveReminderInstant(state.reminderRules[1]!, state.tasks[0]!, occurrence), null)
  assert.equal(resolveReminderInstant({ ...state.reminderRules[1]!, trigger: { kind: 'before_due', minutes: 10 } }, { ...state.tasks[0]!, deadline: { dueAt: '2026-09-05T11:00:00Z', dueOn: null } }, occurrence), null)
  const protocol = structuredClone(state)
  protocol.reminderMigration = { version: 1, completedAt: '2026-09-05T08:00:00.000Z', mapped: [], quarantined: [{ row: { taskId: 'unknown', reminderAt: 'bad date', deliveredAt: 'old raw value' }, reason: 'unmappable' }] }
  protocol.reminderDeliveries[0]!.status = 'armed'
  assert.throws(() => parseWorkspaceState(protocol), /persisted claim/)
  protocol.reminderDeliveries[0]!.revision = 1
  protocol.reminderDeliveries[0]!.claim = { token: 'claim:one', armedAt: '2026-09-05T08:00:00.000Z' }
  const roundTrip = parseWorkspaceState(protocol)
  assert.deepEqual(roundTrip.reminderMigration, protocol.reminderMigration)
  assert.deepEqual(roundTrip.reminderDeliveries[0]!.claim, protocol.reminderDeliveries[0]!.claim)
})

test('delivery identity canonicalizes equivalent instants', () => {
  assert.equal(deliveryKey('rule', null, '2026-09-05T10:00:00+08:00'), deliveryKey('rule', null, '2026-09-05T02:00:00Z'))
})

test('persisted claims prevent concurrent or restarted sends; migration and envelopes are idempotent', async () => {
  const store = createInMemoryWorkspaceStore()
  const createService = () => createTaskCapabilityService(store, () => '2026-09-05T12:00:00.000Z', (kind) => `${kind}:${crypto.randomUUID()}`)
  let service = createService()
  let sequence = 0
  const envelope = async (command: CapabilityCommand) => ({ protocolVersion: 1 as const, source: 'notification' as const, idempotencyKey: `protocol:${++sequence}`, expectedWorkspaceRevision: (await service.query({ type: 'workspace.snapshot' })).revision, command })
  const execute = async (command: CapabilityCommand) => service.execute(await envelope(command))
  await execute({ type: 'task.create', taskId: 'task:protocol', listId: 'list:system:learning', title: 'Protocol' })
  await execute({ type: 'reminder.set', ruleId: 'rule:protocol', taskId: 'task:protocol', occurrenceId: null, trigger: { kind: 'absolute', at: '2026-09-05T10:00:00Z' }, enabled: true })
  const delivery = () => store.load().then((state) => state.reminderDeliveries[0]!)
  const request = async (token: string) => ({ deliveryId: (await delivery()).id, expectedRevision: (await delivery()).revision ?? 1, token })
  await assert.rejects(execute({ type: 'reminder.claim', ...await request('blocked') }), /migration/)
  const migration = await envelope({ type: 'reminder.migrate', rows: [] })
  const migrated = await service.execute(migration)
  assert.deepEqual(await service.execute(migration), migrated)
  await assert.rejects(service.execute({ ...migration, command: { type: 'reminder.migrate', rows: [{ taskId: 'different', reminderAt: 'x', deliveredAt: 'y' }] } }), /IDEMPOTENCY_KEY_CONFLICT/)
  const claim = await envelope({ type: 'reminder.claim', ...await request('claim:one') })
  const other = { ...claim, idempotencyKey: 'competitor', command: { ...claim.command, token: 'claim:two' } as CapabilityCommand }
  const results = await Promise.allSettled([service.execute(claim), service.execute(other)])
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1)
  service = createService()
  const armed = await delivery()
  assert.equal(armed.status, 'armed')
  await assert.rejects(execute({ type: 'reminder.claim', ...await request('after-restart') }), /not available/)
  await execute({ type: 'reminder.recover', claims: [{ deliveryId: armed.id, expectedRevision: armed.revision!, token: armed.claim!.token }] })
  await assert.rejects(execute({ type: 'reminder.claim', ...await request('ambiguous') }), /not available/)
  await execute({ type: 'reminder.retry', deliveryId: armed.id, expectedRevision: (await delivery()).revision! })
  await execute({ type: 'reminder.claim', ...await request('final') })
  await assert.rejects(execute({ type: 'reminder.ack', ...await request('wrong'), outcome: 'accepted' }), /token/)
  const ack = await envelope({ type: 'reminder.ack', ...await request('final'), outcome: 'accepted' })
  const accepted = await service.execute(ack)
  assert.deepEqual(await service.execute(ack), accepted)
  service = createService()
  assert.equal((await delivery()).status, 'delivered')
  await assert.rejects(execute({ type: 'reminder.claim', ...await request('never') }), /not available/)
})

test('legacy migration marks known submissions and quarantines unknown rows without replay', async () => {
  const { applyDeliveryCommand } = await import('../src/domain/reminders/delivery-commands.ts')
  const state = await createInMemoryWorkspaceStore().load()
  const task = state.tasks[0]!
  state.reminderRules.push({ id: 'legacy', taskId: task.id, occurrenceId: null, trigger: { kind: 'absolute', at: '2026-09-05T10:00:00+08:00' }, enabled: true, revision: 1 })
  const rows = [{ taskId: task.id, reminderAt: '2026-09-05T02:00:00Z', deliveredAt: '2026-09-05T02:00:01Z' }, { taskId: 'missing', reminderAt: 'unknown', deliveredAt: 'raw' }]
  applyDeliveryCommand(state, { type: 'reminder.migrate', rows }, '2026-09-05T12:00:00Z')
  const parsed = parseWorkspaceState(state)
  assert.equal(parsed.reminderMigration!.quarantined.length, 1)
  assert.deepEqual(parsed.reminderMigration!.quarantined[0]!.row, rows[1])
  assert.equal(parsed.reminderDeliveries[0]!.status, 'delivered')
  applyDeliveryCommand(parsed, { type: 'reminder.migrate', rows }, '2026-09-06T12:00:00Z')
  assert.equal(parsed.reminderDeliveries.length, 1)
})
