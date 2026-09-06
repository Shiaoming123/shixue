import assert from 'node:assert/strict'
import test from 'node:test'
import { applyReviewCommand } from '../src/domain/capabilities/review-commands.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CapabilityCommand } from '../src/domain/capabilities/types.ts'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'
import { resolveLegacyReviewLink } from '../src/domain/learning/review-task-link.ts'
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
  assert.deepEqual(second.reviewTaskLinks.find(({ id }) => id === link.id)?.completion, {
    result: 'clear', reviewedOn: '2026-09-06',
  })
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

  const completedMismatch = structuredClone(next)
  const mismatchedOccurrence = completedMismatch.occurrences.find(({ id }) => id === 'occurrence:review-exact')!
  mismatchedOccurrence.status = 'pending'
  mismatchedOccurrence.completedAt = null
  assert.throws(() => parseWorkspaceState(completedMismatch), /completed review task link.*completed occurrence/i)

  await store.save({ ...next, commandReceipts: [] }, next.updatedAt)
  for (const [key, command] of [
    ['review-occurrence:direct-replay', { type: 'review.complete', linkId: link.id, result: 'clear', reviewedOn: '2026-09-06' }],
    ['review-occurrence:legacy-replay', { type: 'completion.review', recordId: link.completionRecordId, result: 'clear', reviewedOn: '2026-09-06' }],
  ] as const) {
    const before = await store.load()
    await service.execute({ protocolVersion: 1, idempotencyKey: key, source: 'human-ui', expectedWorkspaceRevision: before.revision, command })
    const replayed = await store.load()
    assert.equal(replayed.completionRecords.find(({ id }) => id === link.completionRecordId)?.reviewStage, 1)
    assert.deepEqual(replayed.taskEvents, before.taskEvents)
  }
  const beforeMismatch = await store.load()
  await assert.rejects(service.execute({
    protocolVersion: 1, idempotencyKey: 'review-occurrence:mismatch', source: 'human-ui', expectedWorkspaceRevision: beforeMismatch.revision,
    command: { type: 'review.complete', linkId: link.id, result: 'fuzzy', reviewedOn: '2026-09-06' },
  }), /does not match this review outcome/)
  assert.deepEqual(await store.load(), beforeMismatch)
})

test('review occurrence links reject status drift and cannot be skipped', async () => {
  const base = createInMemoryWorkspaceStore(createSeedStudyState(NOW))
  const seed = await base.load()
  const link = seed.reviewTaskLinks[0]!
  const reviewTask = seed.tasks.find(({ id }) => id === link.reviewTaskId)!
  reviewTask.recurrenceSeriesId = 'series:review-skip'
  seed.recurrenceSeries.push({
    id: 'series:review-skip', taskId: reviewTask.id, revision: 1,
    cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
    anchorAt: null, anchorOn: link.dueOn, end: { kind: 'never' }, timezone: 'Asia/Shanghai',
    createdThrough: link.dueOn, createdCount: 1,
  })
  seed.occurrences.push({
    id: 'occurrence:review-skip', seriesId: 'series:review-skip', ordinal: 1,
    scheduledAt: null, scheduledOn: link.dueOn, status: 'pending', override: null,
    completedAt: null, revision: 1,
  })
  link.occurrenceId = 'occurrence:review-skip'
  const invalid = structuredClone(seed)
  const invalidOccurrence = invalid.occurrences.find(({ id }) => id === 'occurrence:review-skip')!
  invalidOccurrence.status = 'skipped'
  assert.throws(() => parseWorkspaceState(invalid), /pending review task link.*pending occurrence/i)

  const store = createInMemoryWorkspaceStore(seed)
  const service = createTaskCapabilityService(store, () => NOW, (kind) => `${kind}:review-skip`)
  await assert.rejects(service.execute({
    protocolVersion: 1, idempotencyKey: 'review-occurrence:skip', source: 'human-ui', expectedWorkspaceRevision: seed.revision,
    command: { type: 'recurrence.skip', occurrenceId: 'occurrence:review-skip', expectedOccurrenceRevision: 1 },
  }), /linked review occurrence cannot be skipped/)
  assert.deepEqual(await store.load(), seed)
})

test('legacy review replay is independent of link order and does not advance the next stage', async () => {
  const { store, execute } = await setup()
  const link = (await store.load()).reviewTaskLinks[0]!
  const command = { type: 'completion.review', recordId: link.completionRecordId, result: 'clear', reviewedOn: '2026-09-06' } as const
  await execute(command, 'legacy-order:first')
  const first = await store.load()
  const reordered = { ...structuredClone(first), reviewTaskLinks: [...first.reviewTaskLinks].reverse(), commandReceipts: [] }
  await store.save(reordered, first.updatedAt)
  await execute(command, 'legacy-order:second')
  const second = await store.load()
  assert.equal(second.completionRecords.find(({ id }) => id === link.completionRecordId)?.reviewStage, 1)
  assert.equal(second.reviewTaskLinks.filter(({ completionRecordId, completedAt }) => completionRecordId === link.completionRecordId && completedAt === null).length, 1)
  assert.deepEqual(second.taskEvents, first.taskEvents)
})

test('exact completed review accepts only the persisted semantic outcome', async () => {
  const { store, execute } = await setup()
  const link = (await store.load()).reviewTaskLinks[0]!
  await execute({ type: 'review.complete', linkId: link.id, result: 'clear', reviewedOn: '2026-09-06' })
  const before = await store.load()
  await assert.rejects(
    execute({ type: 'review.complete', linkId: link.id, result: 'fuzzy', reviewedOn: '2026-09-06' }),
    /does not match this review outcome/,
  )
  assert.deepEqual(await store.load(), before)
})

test('legacy review refuses completed history that predates persisted outcomes', async () => {
  const { store, execute } = await setup()
  const link = (await store.load()).reviewTaskLinks[0]!
  await execute({ type: 'review.complete', linkId: link.id, result: 'clear', reviewedOn: '2026-09-06' })
  const state = await store.load()
  delete (state.reviewTaskLinks.find(({ id }) => id === link.id)! as Partial<typeof link>).completion
  const parsed = parseWorkspaceState(state)
  assert.equal(parsed.reviewTaskLinks.find(({ id }) => id === link.id)?.completion, null)
  assert.throws(
    () => resolveLegacyReviewLink(parsed, link.completionRecordId, 'clear', '2026-09-06'),
    /has no completion outcome/,
  )
})

test('legacy review cannot restart a relearn record with no active link', async () => {
  const { store, execute } = await setup()
  const link = (await store.load()).reviewTaskLinks[0]!
  await execute({ type: 'review.complete', linkId: link.id, result: 'relearn', reviewedOn: '2026-09-06' })
  const before = await store.load()
  await assert.rejects(
    execute({ type: 'completion.review', recordId: link.completionRecordId, result: 'clear', reviewedOn: '2026-09-07' }),
    /no active linked review/,
  )
  assert.deepEqual(await store.load(), before)
})

test('legacy review resolution fails loud when the current semantic target is ambiguous', async () => {
  const { store } = await setup()
  const state = await store.load()
  const link = state.reviewTaskLinks[0]!
  state.reviewTaskLinks.push({ ...structuredClone(link), id: 'review-link:ambiguous' })
  assert.throws(
    () => resolveLegacyReviewLink(state, link.completionRecordId, 'clear', '2026-09-06'),
    /ambiguous/,
  )
})

for (const status of ['skipped', 'completed'] as const) {
  test(`exact occurrence review rejects a ${status} occurrence before any review write`, async () => {
    const base = createInMemoryWorkspaceStore(createSeedStudyState(NOW))
    const seed = await base.load()
    const link = seed.reviewTaskLinks[0]!
    const reviewTask = seed.tasks.find(({ id }) => id === link.reviewTaskId)!
    reviewTask.recurrenceSeriesId = `series:review-${status}`
    seed.recurrenceSeries.push({
      id: `series:review-${status}`, taskId: reviewTask.id, revision: 1,
      cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
      anchorAt: null, anchorOn: link.dueOn, end: { kind: 'never' }, timezone: 'Asia/Shanghai',
      createdThrough: link.dueOn, createdCount: 1,
    })
    seed.occurrences.push({
      id: `occurrence:review-${status}`, seriesId: `series:review-${status}`, ordinal: 1,
      scheduledAt: null, scheduledOn: link.dueOn, status, override: null,
      completedAt: status === 'completed' ? NOW : null, revision: 1,
    })
    link.occurrenceId = `occurrence:review-${status}`
    const before = structuredClone(seed)
    assert.throws(() => applyReviewCommand(
      seed,
      { type: 'review.complete', linkId: link.id, result: 'clear', reviewedOn: '2026-09-06' },
      { now: NOW, id: (kind) => `${kind}:review-${status}` },
    ), /pending occurrence/)
    assert.deepEqual(seed, before)
  })
}

test('an early fuzzy review schedules strictly after both the old due date and review date', async () => {
  const { store, execute } = await setup()
  const link = (await store.load()).reviewTaskLinks[0]!
  await execute({ type: 'review.complete', linkId: link.id, result: 'fuzzy', reviewedOn: '2026-09-05' })
  const next = await store.load()
  const record = next.completionRecords.find(({ id }) => id === link.completionRecordId)!
  assert.equal(record.nextReviewOn, '2026-09-07')
  assert.equal(next.reviewTaskLinks.some(({ completionRecordId, reviewStage, dueOn, completedAt }) =>
    completionRecordId === record.id && reviewStage === record.reviewStage && dueOn === '2026-09-07' && completedAt === null), true)
})

test('workspace validation requires exactly one current pending link when a review date exists', async () => {
  const { store } = await setup()
  const state = await store.load()
  const recordId = state.reviewTaskLinks[0]!.completionRecordId
  for (const link of state.reviewTaskLinks) if (link.completionRecordId === recordId) link.completedAt = NOW
  assert.throws(() => parseWorkspaceState(state), /requires one matching pending review link/)
})
