import assert from 'node:assert/strict'
import test from 'node:test'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import { DomainCommandError, type CommandEnvelope } from '../src/domain/capabilities/types.ts'
import { suggestTaskSchedule } from '../src/domain/calendar/scheduling.ts'
import type { AutoScheduleQuery } from '../src/domain/capabilities/auto-schedule-command.ts'
import type { BusyResult } from '../src/calendar-connections/types.ts'

const NOW = '2026-09-09T00:00:00.000Z'
const query: AutoScheduleQuery = { taskId: 'schedule-me', range: { start: '2026-09-09', end: '2026-09-10' }, timezone: 'UTC', workingHours: [{ weekdays: [3], startMinute: 540, endMinute: 720 }], lockedIntervals: [] }
const busy: BusyResult = { calendarId: 'remote', startAt: NOW, endAt: '2026-09-10T00:00:00.000Z', fetchedAt: '2026-09-08T23:59:00.000Z', expiresAt: '2026-09-09T00:05:00.000Z', intervals: [], error: null }

async function fixture(external = false, resolver = true) {
  const store = createInMemoryWorkspaceStore()
  let serial = 0, now = NOW, calls = 0
  const externalBusy: BusyResult[] = external ? [structuredClone(busy)] : []
  const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:auto-test:${++serial}`, resolver ? { loadSchedulingBusy: async () => { calls++; return structuredClone(externalBusy) } } : {})
  let state = await store.load()
  await service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: 'create', expectedWorkspaceRevision: state.revision, command: { type: 'task.create', taskId: query.taskId, listId: 'list:system:learning', title: 'Schedule me', mode: 'general', estimateMinutes: 60 } })
  state = await store.load()
  if (external) {
    const source = state.calendarSources[0]!
    source.provider = 'google'
    source.hidden = true
    externalBusy[0]!.sourceId = source.id
    await store.save(state)
  }
  const suggestion = await suggestTaskSchedule(state, { ...query, now, externalBusy })
  assert.ok(suggestion.candidates.length)
  const envelope: CommandEnvelope = { protocolVersion: 1, source: 'human-ui', idempotencyKey: 'auto', expectedWorkspaceRevision: state.revision, command: { type: 'task.auto_schedule', query: structuredClone(query), expectedTaskRevision: suggestion.taskRevision!, availabilityFingerprint: suggestion.availabilityFingerprint, startAt: suggestion.candidates[0]!.startAt } }
  return { store, service, envelope, externalBusy, calls: () => calls, clock: (value: string) => { now = value } }
}
const code = (value: string) => (error: unknown) => error instanceof DomainCommandError && error.code === value

test('preview writes no facts; confirmation reuses reschedule event and existing undo', async () => {
  const { store, service, envelope } = await fixture()
  const before = await store.load()
  assert.equal((await service.preview(envelope)).accepted, true)
  assert.deepEqual(await store.load(), before)
  const result = await service.execute(envelope)
  const scheduled = await store.load()
  assert.equal(scheduled.tasks.find(({ id }) => id === query.taskId)!.schedule.startAt, '2026-09-09T09:00:00.000Z')
  assert.equal(scheduled.taskEvents.length, before.taskEvents.length + 1)
  assert.equal(scheduled.taskEvents[scheduled.taskEvents.length - 1]!.type, 'rescheduled')
  assert.ok(result.undoToken)
  await service.execute({ ...envelope, idempotencyKey: 'undo-auto', expectedWorkspaceRevision: scheduled.revision, command: { type: 'undo.apply', token: result.undoToken! } })
  assert.deepEqual((await store.load()).tasks.find(({ id }) => id === query.taskId)!.schedule, before.tasks.find(({ id }) => id === query.taskId)!.schedule)
})

test('stale workspace, task and availability guards reject without writes', async (context) => {
  for (const guard of ['workspace', 'task', 'fingerprint'] as const) await context.test(guard, async () => {
    const { store, service, envelope } = await fixture()
    if (guard === 'workspace') envelope.expectedWorkspaceRevision--
    else if (envelope.command.type === 'task.auto_schedule') {
      if (guard === 'task') envelope.command.expectedTaskRevision--
      else envelope.command.availabilityFingerprint = 'stale'
    }
    const before = await store.load()
    await assert.rejects(service.execute(envelope), code(guard === 'workspace' ? 'WORKSPACE_REVISION_CONFLICT' : guard === 'task' ? 'ENTITY_REVISION_CONFLICT' : 'VALIDATION_ERROR'))
    assert.deepEqual(await store.load(), before)
  })
})

test('execution refreshes external busy and rejects expired coverage after a successful preview', async () => {
  const value = await fixture(true)
  assert.equal((await value.service.preview(value.envelope)).accepted, true)
  const before = await value.store.load()
  value.clock('2026-09-09T00:06:00.000Z')
  await assert.rejects(value.service.execute(value.envelope), code('VALIDATION_ERROR'))
  assert.equal(value.calls(), 2)
  assert.deepEqual(await value.store.load(), before)
})

test('external sources cannot execute scheduling without the trusted runtime resolver', async () => {
  const { store, service, envelope } = await fixture(true, false)
  const before = await store.load()
  assert.equal((await service.preview(envelope)).accepted, false)
  await assert.rejects(service.execute(envelope), code('VALIDATION_ERROR'))
  assert.deepEqual(await store.load(), before)
})

test('a new busy meeting invalidates the suggested slot even while the cache remains fresh', async () => {
  const value = await fixture(true)
  const before = await value.store.load()
  value.externalBusy[0]!.intervals.push({ startAt: '2026-09-09T09:00:00.000Z', endAt: '2026-09-09T10:00:00.000Z' })
  await assert.rejects(value.service.execute(value.envelope), code('VALIDATION_ERROR'))
  assert.deepEqual(await value.store.load(), before)
})

test('invalid query inputs are rejected before invoking the trusted availability resolver', async (context) => {
  for (const malicious of [{ now: NOW }, { externalBusy: [busy] }, { range: { start: '2026-02-30', end: '2026-03-02' } }]) await context.test(Object.keys(malicious)[0]!, async () => {
    const value = await fixture()
    assert.equal(value.envelope.command.type, 'task.auto_schedule')
    if (value.envelope.command.type !== 'task.auto_schedule') return
    Object.assign(value.envelope.command.query, malicious)
    const before = await value.store.load()
    await assert.rejects(value.service.execute(value.envelope), code('VALIDATION_ERROR'))
    assert.equal(value.calls(), 0)
    assert.deepEqual(await value.store.load(), before)
  })
})
