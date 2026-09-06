import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'

test('learning occurrence completion saves evidence atomically without completing the template', async () => {
  const store = createInMemoryWorkspaceStore()
  const service = createTaskCapabilityService(store, () => '2026-09-05T12:00:00Z', () => crypto.randomUUID())
  const envelope = async (command: CapabilityCommand) => ({ protocolVersion: 1 as const, source: 'human-ui' as const, idempotencyKey: crypto.randomUUID(), expectedWorkspaceRevision: (await store.load()).revision, command })
  const execute = async (command: CapabilityCommand) => service.execute(await envelope(command))
  await execute({ type: 'task.create', mode: 'learning', taskId: 'learning', listId: 'list:system:learning', title: 'Practice', startAt: '2026-09-05T10:00:00Z' })
  await execute({ type: 'recurrence.create', taskId: 'learning', seriesId: 'learning:series', cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorAt: '2026-09-05T10:00:00Z', end: { kind: 'after', count: 2 }, timezone: 'UTC' })
  const before = await store.load()
  const occurrence = before.occurrences.find(({ seriesId }) => seriesId === 'learning:series')!
  const command = { type: 'recurrence.complete' as const, occurrenceId: occurrence.id, expectedOccurrenceRevision: occurrence.revision }
  await assert.rejects(execute(command), /evidence|required/i)
  assert.deepEqual(await store.load(), before)
  for (const field of ['learned', 'evidence', 'nextAction'] as const) {
    await assert.rejects(execute({ ...command, learned: 'Learned', evidence: 'Proof', nextAction: 'Next', [field]: '   ' }), /evidence|required/i)
    assert.deepEqual(await store.load(), before)
  }
  const complete = await envelope({ ...command, learned: 'Learned one thing', evidence: 'Worked example', nextAction: 'Repeat tomorrow', recordId: 'proof:one' })
  const result = await service.execute(complete)
  assert.deepEqual(await service.execute(complete), result)
  const after = await store.load()
  assert.deepEqual(after.tasks.filter(({ id }) => before.tasks.some((task) => task.id === id)), before.tasks)
  const reviewLink = after.reviewTaskLinks.find(({ completionRecordId }) => completionRecordId === 'proof:one')!
  assert.equal(after.tasks.find(({ id }) => id === reviewLink.reviewTaskId)?.status, 'planned')
  assert.equal(after.occurrences.find(({ id }) => id === occurrence.id)!.status, 'completed')
  assert.equal(after.occurrences.filter(({ status }) => status === 'pending').length, 1)
  assert.equal(after.completionRecords.filter(({ id }) => id === 'proof:one').length, 1)
  assert.equal(after.completionRecords.find(({ id }) => id === 'proof:one')!.evidence, 'Worked example')
  assert.ok(after.taskEvents.some((event) => event.occurrenceId === occurrence.id && event.completionRecordId === 'proof:one'))
  await execute({ type: 'undo.apply', token: result.undoToken! })
  const undone = await store.load()
  assert.equal(undone.occurrences.find(({ id }) => id === occurrence.id)!.status, 'pending')
  assert.ok(undone.completionRecords.find(({ id }) => id === 'proof:one')!.deletedAt)
  assert.equal(undone.reviewTaskLinks.some(({ id }) => id === reviewLink.id), false)
  assert.ok(undone.tasks.find(({ id }) => id === reviewLink.reviewTaskId)?.deletedAt)
})
