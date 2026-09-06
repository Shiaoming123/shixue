import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createReminderRuntime } from '../src/lib/reminder-runtime.ts'
import { createReminderActionBridge } from '../src/lib/reminder-actions.ts'

test('runtime serializes wakeups, records ambiguity without retry, and routes in-app actions', async () => {
  const store = createInMemoryWorkspaceStore()
  const service = createTaskCapabilityService(store, () => '2026-09-05T12:00:00.000Z', (kind) => `${kind}:${crypto.randomUUID()}`)
  const execute = async (command: CapabilityCommand) => service.execute({ protocolVersion: 1, source: 'human-ui', expectedWorkspaceRevision: (await store.load()).revision, idempotencyKey: crypto.randomUUID(), command })
  await execute({ type: 'task.create', taskId: 'runtime:task', listId: 'list:system:learning', title: 'Reminder' })
  await execute({ type: 'reminder.set', ruleId: 'runtime:rule', taskId: 'runtime:task', occurrenceId: null, trigger: { kind: 'absolute', at: '2026-09-05T10:00:00Z' }, enabled: true })
  let sends = 0
  const errors: unknown[] = []
  const runtime = createReminderRuntime({ withExclusiveLock: async (operation) => operation(), service, readLegacyRows: async () => [], enabled: () => true, clock: () => '2026-09-05T12:00:00Z', sendNotification: async () => { sends++; throw new Error('uncertain send') }, onError: (error) => { errors.push(error) } })
  await Promise.all([runtime.poll(), runtime.poll()])
  await runtime.poll()
  assert.equal(sends, 1)
  assert.equal(errors.length, 1)
  const delivery = (await store.load()).reminderDeliveries[0]!
  assert.equal(delivery.status, 'ambiguous')
  const completed: unknown[] = []
  const actions = createReminderActionBridge({ service, openTask: () => {}, completeTask: (taskId, occurrenceId) => { completed.push([taskId, occurrenceId]) } })
  await actions(delivery.id, 'complete')
  assert.deepEqual(completed, [['runtime:task', null]])
  assert.notEqual((await store.load()).tasks.find(({ id }) => id === 'runtime:task')!.status, 'completed')
  await actions(delivery.id, 'dismiss')
  assert.equal((await store.load()).reminderDeliveries[0]!.status, 'dismissed')
  runtime.stop()
})

test('failed migration never enables sending and Rust has no legacy writer or notifier', async () => {
  const service = createTaskCapabilityService(createInMemoryWorkspaceStore(), () => '2026-09-05T12:00:00Z', () => crypto.randomUUID())
  let sends = 0
  const errors: unknown[] = []
  const runtime = createReminderRuntime({ withExclusiveLock: async (operation) => operation(), service, enabled: () => true, readLegacyRows: async () => { throw new Error('cannot read legacy') }, sendNotification: async () => { sends++; return true }, onError: (error) => { errors.push(error) } })
  await runtime.poll()
  assert.equal(sends, 0)
  assert.equal(errors.length, 1)
  assert.equal((await service.query({ type: 'workspace.snapshot' })).reminderMigration, undefined)
  const rust = readFileSync(new URL('../src-tauri/src/reminder_scheduler.rs', import.meta.url), 'utf8')
  assert.match(rust, /read_only\(true\)/)
  assert.doesNotMatch(rust, /NotificationExt|\.notification\(|INSERT INTO|UPDATE study/)
  const runtimeSource = readFileSync(new URL('../src/lib/reminder-runtime.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(runtimeSource, /requestPermission/)
})
