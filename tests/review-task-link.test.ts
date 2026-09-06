import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createSeedStudyState } from '../src/storage/study/types.ts'

const NOW = '2026-09-06T12:00:00.000Z'

async function setup() {
  const store = createInMemoryWorkspaceStore(createSeedStudyState(NOW))
  let sequence = 0
  const service = createTaskCapabilityService(store, () => NOW, (kind) => `${kind}:review-link:${++sequence}`)
  const execute = async (command: CapabilityCommand, key = `review-link:${++sequence}`) => service.execute({
    protocolVersion: 1,
    idempotencyKey: key,
    source: 'human-ui',
    expectedWorkspaceRevision: (await store.load()).revision,
    command,
  })
  return { store, execute }
}

test('review.schedule is semantically idempotent across command keys and reuses a migrated link', async () => {
  const { store, execute } = await setup()
  const initial = await store.load()
  const migrated = initial.reviewTaskLinks[0]!
  const command = {
    type: 'review.schedule',
    completionRecordId: migrated.completionRecordId,
    dueOn: migrated.dueOn,
  } as const
  await execute(command, 'schedule:first')
  await execute(command, 'schedule:second')
  const next = await store.load()
  assert.equal(next.reviewTaskLinks.filter(({ completionRecordId, reviewStage, dueOn }) =>
    completionRecordId === migrated.completionRecordId &&
    reviewStage === migrated.reviewStage &&
    dueOn === migrated.dueOn).length, 1)
  assert.equal(next.reviewTaskLinks.find(({ id }) => id === migrated.id)?.reviewTaskId, migrated.reviewTaskId)
})

test('review.complete consumes one exact link once and creates the next review without recursive evidence', async () => {
  const { store, execute } = await setup()
  const initial = await store.load()
  const link = initial.reviewTaskLinks[0]!
  const recordCount = initial.completionRecords.length
  const command = { type: 'review.complete', linkId: link.id, result: 'clear', reviewedOn: '2026-09-06' } as const
  await execute(command, 'complete:first')
  const first = await store.load()
  await execute(command, 'complete:second')
  const second = await store.load()
  assert.equal(second.completionRecords.length, recordCount)
  assert.equal(second.completionRecords.find(({ id }) => id === link.completionRecordId)?.reviewStage, 1)
  assert.equal(second.reviewTaskLinks.find(({ id }) => id === link.id)?.completedAt, NOW)
  assert.equal(second.reviewTaskLinks.filter(({ completionRecordId, completedAt }) =>
    completionRecordId === link.completionRecordId && completedAt === null).length, 1)
  assert.deepEqual(second.reviewTaskLinks, first.reviewTaskLinks)
  assert.deepEqual(second.taskEvents, first.taskEvents)
})

test('generic completion of a linked review task routes through review.complete', async () => {
  const { store, execute } = await setup()
  const initial = await store.load()
  const link = initial.reviewTaskLinks[0]!
  const reviewTask = initial.tasks.find(({ id }) => id === link.reviewTaskId)!
  await execute({ type: 'task.complete', taskId: reviewTask.id, expectedRevision: reviewTask.revision, reviewedOn: '2026-09-06' })
  const next = await store.load()
  assert.equal(next.reviewTaskLinks.find(({ id }) => id === link.id)?.completedAt, NOW)
  assert.equal(next.completionRecords.length, initial.completionRecords.length)
})

test('generic linked completion requires an explicit local review date without saving', async () => {
  const { store, execute } = await setup()
  const before = await store.load()
  const link = before.reviewTaskLinks[0]!
  await assert.rejects(
    execute({ type: 'task.complete', taskId: link.reviewTaskId }),
    /local reviewedOn date/,
  )
  assert.deepEqual(await store.load(), before)
})

test('new learning evidence creates a visible review target and undo leaves no active orphan', async () => {
  const { store, execute } = await setup()
  const initial = await store.load()
  const task = initial.tasks.find(({ mode, status, deletedAt, id }) =>
    mode === 'learning' && status === 'planned' && deletedAt === null &&
    !initial.reviewTaskLinks.some(({ reviewTaskId }) => reviewTaskId === id))!
  const result = await execute({
    type: 'task.complete', taskId: task.id, expectedRevision: task.revision,
    learned: '可验证收获', evidence: '测试通过', nextAction: '继续练习', recordId: 'completion:new-evidence',
  })
  const completed = await store.load()
  const link = completed.reviewTaskLinks.find(({ completionRecordId }) => completionRecordId === 'completion:new-evidence')!
  assert.equal(completed.tasks.find(({ id }) => id === link.reviewTaskId)?.status, 'planned')
  assert.equal(completed.tasks.find(({ id }) => id === link.reviewTaskId)?.deletedAt, null)
  assert.ok(result.undoToken)
  await execute({ type: 'undo.apply', token: result.undoToken! })
  const undone = await store.load()
  assert.equal(undone.reviewTaskLinks.some(({ id }) => id === link.id), false)
  assert.notEqual(undone.tasks.find(({ id }) => id === link.reviewTaskId)?.deletedAt, null)
  assert.notEqual(undone.completionRecords.find(({ id }) => id === 'completion:new-evidence')?.deletedAt, null)
})

test('workspace validation rejects duplicate or stale pending review targets', async () => {
  const { store } = await setup()
  const state = await store.load()
  const link = state.reviewTaskLinks[0]!
  state.reviewTaskLinks.push({ ...structuredClone(link), id: 'review-link:duplicate' })
  assert.throws(() => parseWorkspaceState(state), /duplicate links/)
  const stale = await store.load()
  stale.reviewTaskLinks[0]!.dueOn = '2026-12-31'
  assert.throws(() => parseWorkspaceState(stale), /does not match its active review/)
})

test('fuzzy preserves the stage for tomorrow while relearn closes the review chain', async () => {
  const fuzzySetup = await setup()
  const fuzzyLink = (await fuzzySetup.store.load()).reviewTaskLinks[0]!
  await fuzzySetup.execute({ type: 'review.complete', linkId: fuzzyLink.id, result: 'fuzzy', reviewedOn: '2026-09-06' })
  const fuzzy = await fuzzySetup.store.load()
  const fuzzyRecord = fuzzy.completionRecords.find(({ id }) => id === fuzzyLink.completionRecordId)!
  assert.equal(fuzzyRecord.reviewStage, fuzzyLink.reviewStage)
  assert.equal(fuzzyRecord.nextReviewOn, '2026-09-07')
  assert.equal(fuzzy.reviewTaskLinks.some(({ completionRecordId, reviewStage, dueOn, completedAt }) =>
    completionRecordId === fuzzyRecord.id && reviewStage === fuzzyLink.reviewStage && dueOn === '2026-09-07' && completedAt === null), true)

  const relearnSetup = await setup()
  const relearnLink = (await relearnSetup.store.load()).reviewTaskLinks[0]!
  await relearnSetup.execute({ type: 'review.complete', linkId: relearnLink.id, result: 'relearn', reviewedOn: '2026-09-06' })
  const relearn = await relearnSetup.store.load()
  assert.equal(relearn.completionRecords.find(({ id }) => id === relearnLink.completionRecordId)?.nextReviewOn, null)
  assert.equal(relearn.reviewTaskLinks.some(({ completionRecordId, completedAt }) =>
    completionRecordId === relearnLink.completionRecordId && completedAt === null), false)
})

test('replaying a generic toggle against a completed review target is a semantic no-op', async () => {
  const { store, execute } = await setup()
  const link = (await store.load()).reviewTaskLinks[0]!
  await execute({ type: 'task.toggle_completion', taskId: link.reviewTaskId, reviewedOn: '2026-09-06' }, 'toggle:first')
  const first = await store.load()
  await execute({ type: 'task.toggle_completion', taskId: link.reviewTaskId, reviewedOn: '2026-09-06' }, 'toggle:second')
  const second = await store.load()
  assert.equal(second.tasks.find(({ id }) => id === link.reviewTaskId)?.status, 'completed')
  assert.deepEqual(second.taskEvents, first.taskEvents)
  assert.equal(second.completionRecords.find(({ id }) => id === link.completionRecordId)?.reviewStage, 1)
})

test('recurrence completion resolves the exact linked occurrence without creating evidence', async () => {
  const base = createInMemoryWorkspaceStore(createSeedStudyState(NOW))
  const seed = await base.load()
  const link = seed.reviewTaskLinks[0]!
  const reviewTask = seed.tasks.find(({ id }) => id === link.reviewTaskId)!
  reviewTask.recurrenceSeriesId = 'series:review-exact'
  seed.recurrenceSeries.push({
    id: 'series:review-exact', taskId: reviewTask.id, revision: 1,
    cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
    anchorAt: null, anchorOn: link.dueOn, end: { kind: 'never' }, timezone: 'Asia/Shanghai',
    createdThrough: link.dueOn, createdCount: 1,
  })
  seed.occurrences.push({
    id: 'occurrence:review-exact', seriesId: 'series:review-exact', ordinal: 1,
    scheduledAt: null, scheduledOn: link.dueOn, status: 'pending', override: null,
    completedAt: null, revision: 1,
  })
  link.occurrenceId = 'occurrence:review-exact'
  const store = createInMemoryWorkspaceStore(seed)
  let sequence = 0
  const service = createTaskCapabilityService(store, () => NOW, (kind) => `${kind}:review-occurrence:${++sequence}`)
  await service.execute({
    protocolVersion: 1, idempotencyKey: 'review-occurrence:complete', source: 'human-ui',
    expectedWorkspaceRevision: seed.revision,
    command: { type: 'recurrence.complete', occurrenceId: 'occurrence:review-exact', expectedOccurrenceRevision: 1, reviewedOn: '2026-09-06' },
  })
  const next = await store.load()
  assert.equal(next.occurrences.find(({ id }) => id === 'occurrence:review-exact')?.status, 'completed')
  assert.equal(next.reviewTaskLinks.find(({ id }) => id === link.id)?.completedAt, NOW)
  assert.equal(next.completionRecords.length, seed.completionRecords.length)
})
