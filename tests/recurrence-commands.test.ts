import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CommandEnvelope } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'

const NOW = '2026-09-05T10:00:00.000Z'

function fixture() {
  let nextId = 0
  return createTaskCapabilityService(
    createInMemoryWorkspaceStore(),
    () => NOW,
    (kind) => `${kind}-${++nextId}`,
  )
}

async function executeNext(
  service: ReturnType<typeof fixture>,
  idempotencyKey: string,
  command: CommandEnvelope['command'],
) {
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  return service.execute({
    protocolVersion: 1,
    idempotencyKey,
    source: 'human-ui',
    expectedWorkspaceRevision: snapshot.revision,
    command,
  })
}

async function createRecurringTask(
  service = fixture(),
  basis: 'fixed_schedule' | 'after_completion' = 'fixed_schedule',
) {
  await executeNext(service, 'task-create', {
    type: 'task.create',
    taskId: 'task-recurring',
    listId: 'list:system:learning',
    title: 'Read one paper',
  })
  await executeNext(service, 'recurrence-create', {
    type: 'recurrence.create',
    taskId: 'task-recurring',
    expectedTaskRevision: 1,
    seriesId: 'series-daily',
    cadence: { kind: 'daily', interval: 1 },
    basis,
    anchorAt: '2026-09-05T09:00:00.000Z',
    end: { kind: 'never' },
    timezone: 'UTC',
  })
  return service
}

test('complete marks a current occurrence and after-completion creates the next item from the completion instant', async () => {
  const service = await createRecurringTask(fixture(), 'after_completion')
  const result = await executeNext(service, 'complete-current', {
    type: 'recurrence.complete',
    occurrenceId: 'occurrence:series-daily:1',
    expectedOccurrenceRevision: 1,
  })
  const snapshot = await service.query({ type: 'workspace.snapshot' })

  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:1')?.status, 'completed')
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:1')?.completedAt, NOW)
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:2')?.scheduledAt, '2026-09-06T09:00:00.000Z')
  assert.ok(result.undoToken)
})

test('skip is a reversible single-occurrence operation', async () => {
  const service = await createRecurringTask()
  const skipped = await executeNext(service, 'skip-current', {
    type: 'recurrence.skip',
    occurrenceId: 'occurrence:series-daily:1',
    expectedOccurrenceRevision: 1,
  })
  await executeNext(service, 'undo-skip', { type: 'undo.apply', token: skipped.undoToken! })
  const restored = await service.query({ type: 'workspace.snapshot' })

  assert.equal(restored.occurrences.find(({ id }) => id === 'occurrence:series-daily:1')?.status, 'pending')
})

test('occurrence update stores an override without mutating the recurrence series', async () => {
  const service = await createRecurringTask()
  await executeNext(service, 'override-current', {
    type: 'recurrence.update',
    occurrenceId: 'occurrence:series-daily:1',
    expectedOccurrenceRevision: 1,
    scope: 'occurrence',
    patch: { scheduledAt: '2026-09-05T10:30:00.000Z', estimateMinutes: 45 },
  })
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  const occurrence = snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:1')

  assert.deepEqual(occurrence?.override, { scheduledAt: '2026-09-05T10:30:00.000Z', estimateMinutes: 45 })
  assert.equal(occurrence?.scheduledAt, '2026-09-05T10:30:00.000Z')
  assert.equal(snapshot.recurrenceSeries.find(({ id }) => id === 'series-daily')?.revision, 1)
})

test('future update closes the old series and creates a deterministic successor without rewriting history', async () => {
  const service = await createRecurringTask()
  await executeNext(service, 'complete-history', {
    type: 'recurrence.complete',
    occurrenceId: 'occurrence:series-daily:1',
    expectedOccurrenceRevision: 1,
  })
  await executeNext(service, 'future-split', {
    type: 'recurrence.update',
    occurrenceId: 'occurrence:series-daily:1',
    expectedOccurrenceRevision: 2,
    scope: 'future',
    patch: {
      scheduledAt: '2026-09-08T09:00:00.000Z',
      cadence: { kind: 'weekly', interval: 1, weekdays: [2] },
    },
  })
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  const oldSeries = snapshot.recurrenceSeries.find(({ id }) => id === 'series-daily')
  const successor = snapshot.recurrenceSeries.find(({ id }) => id === 'series-daily:split:1')

  assert.equal(oldSeries?.end.kind, 'on')
  assert.equal(snapshot.tasks.find(({ id }) => id === 'task-recurring')?.recurrenceSeriesId, 'series-daily:split:1')
  assert.equal(successor?.anchorAt, '2026-09-08T09:00:00.000Z')
  assert.deepEqual(successor?.cadence, { kind: 'weekly', interval: 1, weekdays: [2] })
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:1')?.status, 'completed')
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:split:1:1')?.status, 'pending')
})

test('whole-series update previews with explicit confirmation and does not save', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })
  const preview = await service.preview({
    protocolVersion: 1,
    idempotencyKey: 'preview-series-update',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command: {
      type: 'recurrence.update',
      occurrenceId: 'occurrence:series-daily:1',
      expectedOccurrenceRevision: 1,
      scope: 'series',
      patch: { end: { kind: 'on', date: '2026-10-01' } },
    },
  })

  assert.equal(preview.accepted, true)
  assert.equal(preview.confirmation, 'explicit')
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})
