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
  let now = NOW
  const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:review-test:${++sequence}`)
  const initial = await store.load()
  const link = initial.reviewTaskLinks[0]!
  const execute = async (command: CapabilityCommand) => service.execute({
    protocolVersion: 1,
    idempotencyKey: `review-test:${++sequence}`,
    source: 'human-ui',
    expectedWorkspaceRevision: (await store.load()).revision,
    command,
  })
  return { store, execute, initial, link, setNow: (value: string) => { now = value } }
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

test('reviewing from evidence closes active sessions without losing elapsed time or stale blockers', async () => {
  const running = await setup()
  await running.execute({ type: 'task.start', taskId: running.link.reviewTaskId, sessionId: 'session:running-review' })
  const runningDraft = await running.store.load()
  runningDraft.tasks.find(({ id }) => id === running.link.reviewTaskId)!.learning!.blockedReason = 'stale blocker'
  await running.store.save(runningDraft, runningDraft.updatedAt)
  running.setNow('2026-09-05T13:00:00.000Z')
  await running.execute({ type: 'completion.review', recordId: running.link.completionRecordId, result: 'fuzzy', reviewedOn: '2026-09-05' })
  const runningNext = await running.store.load()
  const runningSession = runningNext.studySessions.find(({ id }) => id === 'session:running-review')
  assert.equal(runningSession?.state, 'finished')
  assert.equal(runningSession?.activeSince, null)
  assert.equal(runningSession?.elapsedSeconds, 3600)
  assert.equal(runningNext.tasks.find(({ id }) => id === running.link.reviewTaskId)?.status, 'completed')
  assert.equal(runningNext.tasks.find(({ id }) => id === running.link.reviewTaskId)?.learning?.blockedReason, null)

  const paused = await setup()
  await paused.execute({ type: 'task.start', taskId: paused.link.reviewTaskId, sessionId: 'session:paused-review' })
  paused.setNow('2026-09-05T12:20:00.000Z')
  await paused.execute({ type: 'session.pause', sessionId: 'session:paused-review' })
  paused.setNow('2026-09-05T13:00:00.000Z')
  await paused.execute({ type: 'completion.review', recordId: paused.link.completionRecordId, result: 'fuzzy', reviewedOn: '2026-09-05' })
  const pausedSession = (await paused.store.load()).studySessions.find(({ id }) => id === 'session:paused-review')
  assert.equal(pausedSession?.state, 'finished')
  assert.equal(pausedSession?.activeSince, null)
  assert.equal(pausedSession?.elapsedSeconds, 1200)

  const invalid = await setup()
  await invalid.execute({ type: 'task.start', taskId: invalid.link.reviewTaskId, sessionId: 'session:invalid-review' })
  invalid.setNow('2026-09-05T11:59:59.000Z')
  await assert.rejects(
    invalid.execute({ type: 'completion.review', recordId: invalid.link.completionRecordId, result: 'fuzzy', reviewedOn: '2026-09-05' }),
    /Study session elapsed time cannot be negative/,
  )
  const invalidNext = await invalid.store.load()
  assert.equal(invalidNext.studySessions.find(({ id }) => id === 'session:invalid-review')?.state, 'running')
  assert.equal(invalidNext.reviewTaskLinks.find(({ id }) => id === invalid.link.id)?.completedAt, null)
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
