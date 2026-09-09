import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import type { CalendarEventTime } from '../src/domain/calendar/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { parseWorkspaceState, parseWorkspaceStateV4 } from '../src/domain/workspace/parse.ts'
import { createTaskOnlyWorkspaceExportV3 } from '../src/storage/workspace/data-port.ts'
import { createReminderRuntime } from '../src/lib/reminder-runtime.ts'
import { createReminderActionBridge } from '../src/lib/reminder-actions.ts'

const now = '2026-09-09T12:00:00Z'
const allDay: CalendarEventTime = { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-10' }
async function setup(time: CalendarEventTime = allDay, repeat = false) {
  const store = createInMemoryWorkspaceStore()
  const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:${crypto.randomUUID()}`)
  const run = async (command: CapabilityCommand) => service.execute({ protocolVersion: 1, source: 'human-ui', expectedWorkspaceRevision: (await store.load()).revision, idempotencyKey: crypto.randomUUID(), command })
  const sourceId = (await store.load()).calendarSources[0]!.id
  await run({ type: 'calendar_source.update', sourceId, expectedRevision: 1, patch: { timezone: 'America/Los_Angeles' } })
  await run({ type: 'event.create', sourceId, eventId: 'event:remind', event: { title: 'Meeting', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [], availability: 'busy', status: 'confirmed', time, recurrence: repeat ? { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'after', count: 2 } } : null } })
  const set = () => run({ type: 'reminder.set', ruleId: 'rule:event', target: { kind: 'event', eventId: 'event:remind', originalStart: null }, trigger: { kind: 'at_start' }, enabled: true })
  return { store, service, run, set }
}

test('event reminders resolve all-day and floating in source timezone and fixed as instant', async () => {
  for (const [time, expected] of [
    [allDay, '2026-09-09T07:00:00.000Z'],
    [{ kind: 'floating', startLocal: '2026-03-08T02:30', endLocal: '2026-03-08T03:30' }, '2026-03-08T10:30:00.000Z'],
    [{ kind: 'fixed', startAt: '2026-09-09T08:00:00Z', endAt: '2026-09-09T09:00:00Z', timezone: 'Asia/Shanghai' }, '2026-09-09T08:00:00.000Z'],
  ] as [CalendarEventTime, string][]) {
    const h = await setup(time); await h.set()
    assert.equal((await h.store.load()).reminderDeliveries[0]!.scheduledFor, expected)
  }
})

test('series instance keys survive moves, old pending cancels, and cancelled snoozes cannot deliver', async () => {
  const h = await setup(allDay, true); await h.set()
  let state = await h.store.load()
  assert.deepEqual(state.reminderDeliveries.map((d) => d.originalStart), ['2026-09-09', '2026-09-10'])
  const first = state.reminderDeliveries[0]!
  await h.run({ type: 'reminder.snooze', deliveryId: first.id, until: '2026-09-09T13:00:00Z' })
  await h.run({ type: 'event.exception.set', eventId: 'event:remind', expectedRevision: 1, originalStart: '2026-09-09', time: { kind: 'all-day', startOn: '2026-09-10', endOnExclusive: '2026-09-11' } })
  state = await h.store.load()
  assert.equal(state.reminderDeliveries.find((d) => d.id === first.id)!.status, 'cancelled')
  await h.run({ type: 'reminder.reconcile' })
  state = await h.store.load()
  const pending = state.reminderDeliveries.filter((d) => d.status === 'pending')
  assert.equal(pending.length, 2)
  assert.equal(pending[0]!.scheduledFor, pending[1]!.scheduledFor)
  assert.equal(new Set(pending.map((d) => d.id)).size, 2, 'Two original instances moved to one instant must remain distinct')
  await h.run({ type: 'event.exception.set', eventId: 'event:remind', expectedRevision: 2, originalStart: '2026-09-09', time: null })
  assert.equal((await h.store.load()).reminderDeliveries.filter((d) => d.originalStart === '2026-09-09').every((d) => d.status === 'cancelled'), true)
})

test('event runtime claims once, preserves audit through undo, and actions never complete a task', async () => {
  const h = await setup(); await h.set()
  let sends = 0
  const errors: unknown[] = []
  const runtime = createReminderRuntime({ service: h.service, clock: () => now, withExclusiveLock: async (operation) => operation(), readLegacyRows: async () => [], enabled: () => true, sendNotification: async (_delivery, subject) => { assert.equal(subject.id, 'event:remind'); sends++; return true }, onError: (error) => errors.push(error) })
  await Promise.all([runtime.poll(), runtime.poll()]); await runtime.poll()
  assert.equal(sends, 1); assert.deepEqual(errors, [])
  const delivery = (await h.store.load()).reminderDeliveries[0]!
  assert.equal(delivery.status, 'delivered')
  const opens: unknown[] = []
  const actions = createReminderActionBridge({ service: h.service, openTask: () => assert.fail('event opened as task'), completeTask: () => assert.fail('event completed as task'), openEvent: (id, original) => { opens.push([id, original]) } })
  await actions(delivery.id, 'open'); assert.deepEqual(opens, [['event:remind', null]])
  await assert.rejects(actions(delivery.id, 'complete'), /不能完成任务/)
  await actions(delivery.id, 'snooze', '2026-09-09T13:00:00Z')
  await actions(delivery.id, 'dismiss')
  const changed = await h.run({ type: 'reminder.set', ruleId: 'rule:event', target: { kind: 'event', eventId: 'event:remind', originalStart: null }, trigger: { kind: 'before_start', minutes: 10 }, enabled: false, expectedRevision: 1 })
  await h.run({ type: 'undo.apply', token: changed.undoToken! })
  const state = await h.store.load()
  assert.equal(state.reminderRules[0]!.enabled, true)
  assert.equal(state.reminderRules[0]!.revision, 3)
  assert.equal(state.reminderDeliveries[0]!.status, 'dismissed', 'Undo must preserve delivery audit')
  runtime.stop()
})

test('target compatibility normalizes V4 writes while task-only export preserves V3 contract', async () => {
  const h = await setup(); await h.set()
  await h.run({ type: 'task.create', taskId: 'task:one', listId: 'list:system:learning', title: 'Study' })
  await h.run({ type: 'reminder.set', ruleId: 'rule:task', taskId: 'task:one', occurrenceId: null, trigger: { kind: 'absolute', at: now }, enabled: true })
  let state = await h.store.load()
  assert.equal(state.reminderRules.every((rule) => 'target' in rule && !('taskId' in rule)), true)
  const taskRule = state.reminderRules.find((rule) => rule.id === 'rule:task')!
  const legacy = { ...taskRule, taskId: 'task:one', occurrenceId: null } as any; delete legacy.target
  state.reminderRules[state.reminderRules.indexOf(taskRule)] = legacy
  state = parseWorkspaceStateV4(state)
  assert.deepEqual(state.reminderRules.find((rule) => rule.id === 'rule:task')!.target, { kind: 'task', taskId: 'task:one', occurrenceId: null })
  const exported = createTaskOnlyWorkspaceExportV3(state, now)
  assert.equal(exported.state.reminderRules.length, 1)
  assert.equal(exported.state.reminderRules[0]!.taskId, 'task:one')
  assert.equal('target' in exported.state.reminderRules[0]!, false)
  assert.deepEqual(parseWorkspaceState(exported.state), exported.state)
  await assert.rejects(h.run({ type: 'reminder.set', ruleId: 'rule:event', target: { kind: 'task', taskId: 'task:one', occurrenceId: null }, trigger: { kind: 'at_start' }, enabled: true }), /ownership/)
  await assert.rejects(h.run({ type: 'reminder.set', ruleId: 'invalid:due', target: { kind: 'event', eventId: 'event:remind', originalStart: null }, trigger: { kind: 'before_due', minutes: 10 }, enabled: true }), /deadlines/)
})

test('V4 import rejects forged recurrence exception and outcome instance identities', async () => {
  const h = await setup(allDay, true)
  const state = await h.store.load()
  const forged = structuredClone(state)
  forged.calendarEvents[0]!.recurrence!.exceptions.push({ originalStart: '2026-09-20', time: null })
  assert.throws(() => parseWorkspaceStateV4(forged), /occurrence|series|exception/i)
  state.eventOutcomes.push({ id: 'outcome:fake', eventId: 'event:remind', occurrenceId: '2026-09-20', action: 'note', taskId: null, note: 'Synthetic', createdAt: now })
  assert.throws(() => parseWorkspaceStateV4(state), /original occurrence/)
  state.eventOutcomes[0]!.occurrenceId = '2026-09-10'
  assert.equal(parseWorkspaceStateV4(state).eventOutcomes.length, 1)
})

test('undoing creation disables a rule and cancels pending without deleting audit identity', async () => {
  const h = await setup(); const result = await h.set()
  const before = await h.store.load()
  await h.run({ type: 'undo.apply', token: result.undoToken! })
  const after = await h.store.load()
  assert.equal(after.reminderRules[0]!.enabled, false)
  assert.equal(after.reminderRules[0]!.revision, 2)
  assert.equal(after.reminderDeliveries[0]!.id, before.reminderDeliveries[0]!.id)
  assert.equal(after.reminderDeliveries[0]!.status, 'cancelled')
})
