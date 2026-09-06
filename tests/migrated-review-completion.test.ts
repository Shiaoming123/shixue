import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createSeedStudyState } from '../src/storage/study/types.ts'

const NOW = '2026-09-05T12:00:00.000Z'

async function setup() {
  const store = createInMemoryWorkspaceStore(createSeedStudyState(NOW))
  let sequence = 0
  const service = createTaskCapabilityService(store, () => NOW, (kind) => `${kind}:review-test:${++sequence}`)
  const initial = await store.load()
  const link = initial.reviewTaskLinks[0]!
  const execute = async (command: CapabilityCommand) => service.execute({
    protocolVersion: 1,
    idempotencyKey: `review-test:${++sequence}`,
    source: 'human-ui',
    expectedWorkspaceRevision: (await store.load()).revision,
    command,
  })
  return { store, execute, initial, link }
}

test('reviewing legacy evidence retires its migrated task without creating recursive review evidence', async () => {
  const { store, execute, initial, link } = await setup()
  const result = await execute({ type: 'completion.review', recordId: link.completionRecordId, result: 'clear', reviewedOn: '2026-09-05' })
  const next = await store.load()
  assert.equal(next.tasks.find(({ id }) => id === link.reviewTaskId)?.status, 'completed')
  assert.equal(next.reviewTaskLinks.find(({ id }) => id === link.id)?.completedAt, NOW)
  assert.equal(next.completionRecords.find(({ id }) => id === link.completionRecordId)?.reviewStage, 1)
  assert.equal(next.completionRecords.length, initial.completionRecords.length)
  assert.equal(next.tasks.length, initial.tasks.length + 1)
  assert.equal(next.reviewTaskLinks.length, initial.reviewTaskLinks.length + 1)
  assert.equal(result.events.some(({ taskId, type }) => taskId === link.reviewTaskId && type === 'completed'), true)
  assert.equal(next.tasks.find(({ id }) => id === initial.reviewTaskLinks[1]!.reviewTaskId)?.status, 'planned')
  await execute({ type: 'completion.review', recordId: link.completionRecordId, result: 'clear', reviewedOn: '2026-09-05' })
  const later = await store.load()
  assert.deepEqual(later.tasks.find(({ id }) => id === link.reviewTaskId), next.tasks.find(({ id }) => id === link.reviewTaskId))
  assert.deepEqual(later.taskEvents, next.taskEvents)
})

test('reviewing from the evidence screen finishes an active migrated review session', async () => {
  const { store, execute, link } = await setup()
  await execute({ type: 'task.start', taskId: link.reviewTaskId })
  await execute({ type: 'completion.review', recordId: link.completionRecordId, result: 'fuzzy', reviewedOn: '2026-09-05' })
  const next = await store.load()
  assert.equal(next.studySessions.find(({ taskId }) => taskId === link.reviewTaskId)?.state, 'finished')
  assert.equal(next.tasks.find(({ id }) => id === link.reviewTaskId)?.status, 'completed')
})

test('reviews do not revive a cancelled migrated task', async () => {
  const { store, execute, link } = await setup()
  await execute({ type: 'task.transition', taskId: link.reviewTaskId, toStatus: 'cancelled', reason: 'Review from evidence instead' })
  const command = { type: 'completion.review', recordId: link.completionRecordId, result: 'clear', reviewedOn: '2026-09-05' } as const
  await execute(command)
  const first = await store.load()
  await execute(command)
  const next = await store.load()
  assert.equal(next.tasks.find(({ id }) => id === link.reviewTaskId)?.status, 'cancelled')
  assert.equal(next.reviewTaskLinks.find(({ id }) => id === link.id)?.completedAt, NOW)
  assert.deepEqual(next.taskEvents, first.taskEvents)
})
