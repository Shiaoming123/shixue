import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { CommandEnvelope } from '../src/domain/capabilities/types.ts'
import type { WorkspaceStateV3 } from '../src/domain/workspace/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import type { WorkspaceStore } from '../src/storage/workspace/types.ts'

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

async function previewAndConfirm(
  service: ReturnType<typeof fixture>,
  idempotencyKey: string,
  command: CommandEnvelope['command'],
) {
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey,
    source: 'human-ui',
    expectedWorkspaceRevision: snapshot.revision,
    command,
  }
  const preview = await service.preview(envelope)
  assert.equal(preview.accepted, true)
  assert.equal(preview.confirmation, 'explicit')
  assert.match(String(preview.previewReceiptId), /^preview:[0-9a-f-]{36}$/)
  return service.execute({
    ...envelope,
    explicitConfirmation: {
      previewReceiptId: preview.previewReceiptId!,
      confirmedAt: NOW,
    },
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
    end: basis === 'fixed_schedule' ? { kind: 'after', count: 1 } : { kind: 'never' },
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
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:2')?.scheduledAt, '2026-09-06T10:00:00.000Z')
  assert.ok(result.undoToken)
})

test('task.create can atomically create task, series, and initial occurrence with idempotent replay', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'create-with-recurrence',
    source: 'human-ui',
    expectedWorkspaceRevision: initial.revision,
    command: {
      type: 'task.create',
      taskId: 'atomic-task',
      listId: 'list:system:learning',
      title: 'Atomic recurring task',
      recurrence: {
        seriesId: 'series-atomic',
        cadence: { kind: 'daily', interval: 1 },
        basis: 'fixed_schedule',
        anchorAt: '2026-09-05T09:00:00.000Z',
        end: { kind: 'never' },
        timezone: 'UTC',
      },
    },
  }

  const created = await service.execute(envelope)
  const replay = await service.execute(envelope)
  const snapshot = await service.query({ type: 'workspace.snapshot' })

  assert.deepEqual(replay, created)
  assert.equal(snapshot.tasks.find(({ id }) => id === 'atomic-task')?.recurrenceSeriesId, 'series-atomic')
  assert.equal(snapshot.recurrenceSeries.find(({ id }) => id === 'series-atomic')?.taskId, 'atomic-task')
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-atomic:1')?.status, 'pending')
  assert.equal(snapshot.occurrences.filter(({ seriesId, status }) => seriesId === 'series-atomic' && status === 'pending').length, 50)
  assert.equal(snapshot.revision, initial.revision + 1)
  assert.equal(snapshot.commandReceipts.filter(({ idempotencyKey }) => idempotencyKey === 'create-with-recurrence').length, 1)
})

test('undoing an atomically created recurring task removes its whole recurrence graph', async () => {
  const service = fixture()
  const created = await executeNext(service, 'create-recurring-for-undo', {
    type: 'task.create', taskId: 'undo-recurring-task', listId: 'list:system:learning', title: 'Undo recurring task',
    recurrence: {
      seriesId: 'undo-recurring-series', cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
      anchorOn: '2026-09-06', end: { kind: 'never' }, timezone: 'UTC',
    },
  })

  await executeNext(service, 'undo-recurring-create', { type: 'undo.apply', token: created.undoToken! })
  const snapshot = await service.query({ type: 'workspace.snapshot' })

  assert.equal(snapshot.tasks.find(({ id }) => id === 'undo-recurring-task')?.deletedAt, NOW)
  assert.equal(snapshot.tasks.find(({ id }) => id === 'undo-recurring-task')?.recurrenceSeriesId, null)
  assert.equal(snapshot.recurrenceSeries.some(({ id }) => id === 'undo-recurring-series'), false)
  assert.equal(snapshot.occurrences.some(({ seriesId }) => seriesId === 'undo-recurring-series'), false)
})

test('recurrence commands reject invalid IANA timezones without persisting partial state', async () => {
  const service = fixture()
  await executeNext(service, 'timezone-task', { type: 'task.create', taskId: 'timezone-task', listId: 'list:system:learning', title: 'Timezone' })
  const before = await service.query({ type: 'workspace.snapshot' })
  await assert.rejects(executeNext(service, 'invalid-timezone', {
    type: 'recurrence.create', taskId: 'timezone-task', expectedTaskRevision: 1,
    cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorOn: '2026-09-06',
    end: { kind: 'never' }, timezone: 'Mars/Olympus_Mons',
  }), /Invalid IANA timezone/)
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('recurrence.create and fixed occurrence completion refill the bounded production window', async () => {
  const service = fixture()
  await executeNext(service, 'window-task', { type: 'task.create', taskId: 'window-task', listId: 'list:system:learning', title: 'Window' })
  await executeNext(service, 'window-series', {
    type: 'recurrence.create', taskId: 'window-task', expectedTaskRevision: 1, seriesId: 'window-series',
    cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorAt: '2026-09-06T09:00:00.000Z',
    end: { kind: 'never' }, timezone: 'UTC',
  })
  const created = await service.query({ type: 'workspace.snapshot' })
  assert.equal(created.occurrences.filter(({ seriesId, status }) => seriesId === 'window-series' && status === 'pending').length, 50)

  await executeNext(service, 'window-complete', {
    type: 'recurrence.complete', occurrenceId: 'occurrence:window-series:1', expectedOccurrenceRevision: 1,
  })
  const refilled = await service.query({ type: 'workspace.snapshot' })
  assert.equal(refilled.occurrences.filter(({ seriesId, status }) => seriesId === 'window-series' && status === 'pending').length, 50)
  assert.equal(refilled.occurrences.find(({ id }) => id === 'occurrence:window-series:51')?.status, 'pending')
})

test('task.create recurrence validation and CAS failures leave no partial state', async () => {
  const service = fixture()
  const before = await service.query({ type: 'workspace.snapshot' })
  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'invalid-recurring-create',
      source: 'human-ui',
      expectedWorkspaceRevision: before.revision,
      command: {
        type: 'task.create',
        taskId: 'invalid-task',
        listId: 'list:system:learning',
        title: 'Invalid recurring task',
        recurrence: {
          seriesId: 'invalid-series',
          cadence: { kind: 'weekly', interval: 1, weekdays: [1, 1] },
          basis: 'fixed_schedule',
          anchorAt: '2026-09-05T09:00:00.000Z',
          end: { kind: 'never' },
          timezone: 'UTC',
        },
      },
    }),
    /VALIDATION_ERROR/,
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)

  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'stale-recurring-create',
      source: 'human-ui',
      expectedWorkspaceRevision: before.revision - 1,
      command: {
        type: 'task.create',
        taskId: 'stale-task',
        listId: 'list:system:learning',
        title: 'Stale recurring task',
        recurrence: {
          seriesId: 'stale-series',
          cadence: { kind: 'daily', interval: 1 },
          basis: 'fixed_schedule',
          anchorAt: '2026-09-05T09:00:00.000Z',
          end: { kind: 'never' },
          timezone: 'UTC',
        },
      },
    }),
    /WORKSPACE_REVISION_CONFLICT/,
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('task.create recurrence leaves no draft entities or receipt after save conflict', async () => {
  const backing = createInMemoryWorkspaceStore()
  const before = await backing.load()
  let attempted: WorkspaceStateV3 | null = null
  const conflictStore: WorkspaceStore = {
    async load() { return structuredClone(before) },
    async save(state) {
      attempted = structuredClone(state)
      throw new Error('forced save conflict after draft generation')
    },
  }
  const service = createTaskCapabilityService(conflictStore, () => NOW, (kind) => `${kind}-conflict`)

  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'save-conflict-recurring-create',
      source: 'human-ui',
      expectedWorkspaceRevision: before.revision,
      command: {
        type: 'task.create', taskId: 'conflict-task', listId: 'list:system:learning', title: 'Conflict recurring task',
        recurrence: {
          seriesId: 'conflict-series', cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
          anchorAt: '2026-09-05T09:00:00.000Z', end: { kind: 'never' }, timezone: 'UTC',
        },
      },
    }),
    /WORKSPACE_SAVE_CONFLICT/,
  )

  assert.equal(attempted?.tasks.some(({ id }) => id === 'conflict-task'), true)
  assert.equal(attempted?.recurrenceSeries.some(({ id }) => id === 'conflict-series'), true)
  assert.equal(attempted?.occurrences.some(({ seriesId }) => seriesId === 'conflict-series'), true)
  assert.equal(attempted?.commandReceipts.some(({ idempotencyKey }) => idempotencyKey === 'save-conflict-recurring-create'), true)
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
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

  assert.deepEqual(occurrence?.override, { scheduledAt: '2026-09-05T10:30:00.000Z', scheduledOn: null, estimateMinutes: 45 })
  assert.equal(occurrence?.scheduledAt, '2026-09-05T10:30:00.000Z')
  assert.equal(snapshot.recurrenceSeries.find(({ id }) => id === 'series-daily')?.revision, 1)
})

test('occurrence updates reject series-only rule fields instead of silently ignoring them', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })

  await assert.rejects(executeNext(service, 'reject-occurrence-rule-change', {
    type: 'recurrence.update', occurrenceId: 'occurrence:series-daily:1', expectedOccurrenceRevision: 1,
    scope: 'occurrence', patch: { basis: 'after_completion', end: { kind: 'after', count: 3 } },
  }), /Occurrence updates cannot change series fields/)

  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('date-only recurrence commands preserve date-only schedules without midnight timestamps', async () => {
  const service = fixture()
  await executeNext(service, 'date-task-create', {
    type: 'task.create', taskId: 'date-task', listId: 'list:system:learning', title: 'All-day review',
  })
  await executeNext(service, 'date-recurrence-create', {
    type: 'recurrence.create', taskId: 'date-task', expectedTaskRevision: 1,
    seriesId: 'series-date', cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
    anchorOn: '2026-09-05', end: { kind: 'never' }, timezone: 'Asia/Shanghai',
  })
  await executeNext(service, 'date-occurrence-update', {
    type: 'recurrence.update', occurrenceId: 'occurrence:series-date:1', expectedOccurrenceRevision: 1,
    scope: 'occurrence', patch: { scheduledOn: '2026-09-06' },
  })

  const snapshot = await service.query({ type: 'workspace.snapshot' })
  const series = snapshot.recurrenceSeries.find(({ id }) => id === 'series-date')
  const occurrence = snapshot.occurrences.find(({ id }) => id === 'occurrence:series-date:1')
  assert.deepEqual([series?.anchorAt, series?.anchorOn], [null, '2026-09-05'])
  assert.deepEqual([occurrence?.scheduledAt, occurrence?.scheduledOn], [null, '2026-09-06'])
  assert.doesNotMatch(JSON.stringify(occurrence), /T00:00:00/)
})

test('future update closes the old series and creates a deterministic successor without rewriting history', async () => {
  const service = await createRecurringTask()
  await executeNext(service, 'complete-history', {
    type: 'recurrence.complete',
    occurrenceId: 'occurrence:series-daily:1',
    expectedOccurrenceRevision: 1,
  })
  await previewAndConfirm(service, 'future-split', {
    type: 'recurrence.update',
    occurrenceId: 'occurrence:series-daily:1',
    expectedOccurrenceRevision: 2,
    scope: 'future',
    patch: {
      scheduledAt: '2026-09-08T09:00:00.000Z',
      cadence: { kind: 'weekly', interval: 1, weekdays: [2] },
      end: { kind: 'after', count: 3 },
    },
  })
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  const oldSeries = snapshot.recurrenceSeries.find(({ id }) => id === 'series-daily')
  const successor = snapshot.recurrenceSeries.find(({ id }) => id === 'series-daily:split:1')

  assert.equal(oldSeries?.end.kind, 'on')
  assert.equal(snapshot.tasks.find(({ id }) => id === 'task-recurring')?.recurrenceSeriesId, 'series-daily:split:1')
  assert.equal(successor?.anchorAt, '2026-09-08T09:00:00.000Z')
  assert.deepEqual(successor?.cadence, { kind: 'weekly', interval: 1, weekdays: [2] })
  assert.deepEqual(successor?.end, { kind: 'after', count: 3 })
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:1')?.status, 'completed')
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:series-daily:split:1:1')?.status, 'pending')
})

test('future update preserves unspecified series fields and converts end.after to successor remaining count', async () => {
  const service = await createRecurringTask()
  await executeNext(service, 'set-after-end', {
    type: 'recurrence.update',
    occurrenceId: 'occurrence:series-daily:1',
    expectedOccurrenceRevision: 1,
    scope: 'occurrence',
    patch: { estimateMinutes: 30 },
  })
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  snapshot.recurrenceSeries[0]!.end = { kind: 'after', count: 5 }
  snapshot.occurrences.push({
    id: 'occurrence:series-daily:3',
    seriesId: 'series-daily',
    ordinal: 3,
    scheduledAt: '2026-09-07T09:00:00.000Z',
    status: 'pending',
    override: null,
    completedAt: null,
    revision: 1,
  })
  const seeded = createTaskCapabilityService(createInMemoryWorkspaceStore(snapshot), () => NOW, (kind) => `${kind}-seed`)

  await previewAndConfirm(seeded, 'future-split-remaining', {
    type: 'recurrence.update',
    occurrenceId: 'occurrence:series-daily:3',
    expectedOccurrenceRevision: 1,
    scope: 'future',
    patch: { scheduledAt: '2026-09-10T09:00:00.000Z' },
  })
  const after = await seeded.query({ type: 'workspace.snapshot' })
  const successor = after.recurrenceSeries.find(({ id }) => id === 'series-daily:split:3')

  assert.deepEqual(successor?.cadence, { kind: 'daily', interval: 1 })
  assert.equal(successor?.basis, 'fixed_schedule')
  assert.equal(successor?.timezone, 'UTC')
  assert.deepEqual(successor?.end, { kind: 'after', count: 3 })
})

test('future and whole-series updates reject execute without matching explicit preview confirmation', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })
  const future: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'future-no-confirmation',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command: {
      type: 'recurrence.update',
      occurrenceId: 'occurrence:series-daily:1',
      expectedOccurrenceRevision: 1,
      scope: 'future',
      patch: { end: { kind: 'on', date: '2026-10-01' } },
    },
  }

  await assert.rejects(service.execute(future), /Explicit confirmation/)
  await assert.rejects(
    service.execute({
      ...future,
      idempotencyKey: 'future-wrong-confirmation',
      explicitConfirmation: { previewReceiptId: 'preview:forged', confirmedAt: NOW },
    }),
    /Explicit confirmation/,
  )

  const preview = await service.preview({ ...future, idempotencyKey: 'future-confirmed' })
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
  await assert.rejects(service.execute({
    ...future,
    idempotencyKey: 'future-different-request',
    explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
  }), /Explicit confirmation/)
  const restarted = createTaskCapabilityService(createInMemoryWorkspaceStore(await service.query({ type: 'workspace.snapshot' })), () => NOW, (kind) => `${kind}-restart`)
  await assert.rejects(restarted.execute({
    ...future,
    idempotencyKey: 'future-confirmed',
    explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
  }), /Explicit confirmation/)
  await assert.rejects(
    service.execute({
      ...future,
      idempotencyKey: 'future-command-mismatch',
      command: {
        ...future.command,
        patch: { end: { kind: 'on', date: '2026-10-02' } },
      },
      explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
    }),
    /Explicit confirmation/,
  )
  await service.execute({
    ...future,
    idempotencyKey: 'future-confirmed',
    explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
  })
})

test('switching a fixed series to after-completion retains one pending occurrence and resumes from completion', async () => {
  const service = fixture()
  await executeNext(service, 'basis-task', { type: 'task.create', taskId: 'basis-task', listId: 'list:system:learning', title: 'Basis transition' })
  await executeNext(service, 'basis-series', {
    type: 'recurrence.create', taskId: 'basis-task', expectedTaskRevision: 1, seriesId: 'basis-series',
    cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorAt: '2026-09-06T09:00:00.000Z',
    end: { kind: 'never' }, timezone: 'UTC',
  })

  await previewAndConfirm(service, 'basis-to-after-completion', {
    type: 'recurrence.update', occurrenceId: 'occurrence:basis-series:1', expectedOccurrenceRevision: 1,
    scope: 'series', patch: { basis: 'after_completion' },
  })
  let snapshot = await service.query({ type: 'workspace.snapshot' })
  assert.equal(snapshot.occurrences.filter(({ seriesId, status }) => seriesId === 'basis-series' && status === 'pending').length, 1)
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:basis-series:2')?.status, 'cancelled')

  await executeNext(service, 'complete-after-basis-transition', {
    type: 'recurrence.complete', occurrenceId: 'occurrence:basis-series:1', expectedOccurrenceRevision: 1,
  })
  snapshot = await service.query({ type: 'workspace.snapshot' })
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:basis-series:2')?.status, 'pending')
  assert.equal(snapshot.occurrences.find(({ id }) => id === 'occurrence:basis-series:2')?.scheduledAt, '2026-09-06T10:00:00.000Z')
})

test('whole-series update previews explicitly, then recomputes pending rows while preserving history', async () => {
  const service = await createRecurringTask()
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  snapshot.occurrences.push(
    {
      id: 'occurrence:series-daily:2',
      seriesId: 'series-daily',
      ordinal: 2,
      scheduledAt: '2026-09-06T09:00:00.000Z',
      status: 'pending',
      override: { scheduledAt: '2026-09-06T10:00:00.000Z', estimateMinutes: 20 },
      completedAt: null,
      revision: 1,
    },
    {
      id: 'occurrence:series-daily:3',
      seriesId: 'series-daily',
      ordinal: 3,
      scheduledAt: '2026-09-07T09:00:00.000Z',
      status: 'completed',
      override: null,
      completedAt: '2026-09-07T10:00:00.000Z',
      revision: 1,
    },
    {
      id: 'occurrence:series-daily:4',
      seriesId: 'series-daily',
      ordinal: 4,
      scheduledAt: '2026-09-08T09:00:00.000Z',
      status: 'skipped',
      override: null,
      completedAt: null,
      revision: 1,
    },
  )
  const seeded = createTaskCapabilityService(createInMemoryWorkspaceStore(snapshot), () => NOW, (kind) => `${kind}-whole`)
  const before = await seeded.query({ type: 'workspace.snapshot' })
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'series-update',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command: {
      type: 'recurrence.update',
      occurrenceId: 'occurrence:series-daily:1',
      expectedOccurrenceRevision: 1,
      scope: 'series',
      patch: {
        cadence: { kind: 'weekly', interval: 1, weekdays: [1] },
        anchorAt: '2026-09-07T09:00:00.000Z',
        end: { kind: 'after', count: 2 },
      },
    },
  }

  const preview = await seeded.preview(envelope)

  assert.equal(preview.accepted, true)
  assert.equal(preview.confirmation, 'explicit')
  assert.deepEqual(await seeded.query({ type: 'workspace.snapshot' }), before)

  await seeded.execute({
    ...envelope,
    explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
  })
  const after = await seeded.query({ type: 'workspace.snapshot' })

  assert.equal(after.occurrences.find(({ id }) => id === 'occurrence:series-daily:1')?.scheduledAt, '2026-09-07T09:00:00.000Z')
  assert.equal(after.occurrences.find(({ id }) => id === 'occurrence:series-daily:2')?.scheduledAt, '2026-09-14T09:00:00.000Z')
  assert.equal(after.occurrences.find(({ id }) => id === 'occurrence:series-daily:2')?.override, null)
  assert.equal(after.occurrences.find(({ id }) => id === 'occurrence:series-daily:3')?.status, 'completed')
  assert.equal(after.occurrences.find(({ id }) => id === 'occurrence:series-daily:4')?.status, 'skipped')
})

test('complete, skip, and update append durable occurrence audit events', async () => {
  const commands = [
    { type: 'recurrence.complete', occurrenceId: 'occurrence:series-daily:1', expectedOccurrenceRevision: 1 } as const,
    { type: 'recurrence.skip', occurrenceId: 'occurrence:series-daily:1', expectedOccurrenceRevision: 1 } as const,
    { type: 'recurrence.update', occurrenceId: 'occurrence:series-daily:1', expectedOccurrenceRevision: 1, scope: 'occurrence', patch: { scheduledOn: '2026-09-08' } } as const,
  ]
  for (const [index, command] of commands.entries()) {
    const service = await createRecurringTask()
    const result = await executeNext(service, `audited-${index}`, command)
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0]?.occurrenceId, 'occurrence:series-daily:1')
    const audit = await service.query({ type: 'audit.list', commandType: command.type })
    assert.equal(audit.events.at(-1)?.id, result.events[0]?.id)
  }
})

test('whole-series update preserves pending after-completion schedules', async () => {
  const service = await createRecurringTask(fixture(), 'after_completion')
  await executeNext(service, 'complete-after-completion', {
    type: 'recurrence.complete', occurrenceId: 'occurrence:series-daily:1', expectedOccurrenceRevision: 1,
  })
  const before = await service.query({ type: 'workspace.snapshot' })
  const pending = before.occurrences.find(({ id }) => id === 'occurrence:series-daily:2')!
  const envelope: CommandEnvelope = {
    protocolVersion: 1, idempotencyKey: 'after-completion-series-update', source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command: {
      type: 'recurrence.update', occurrenceId: 'occurrence:series-daily:1', expectedOccurrenceRevision: 2,
      scope: 'series', patch: { cadence: { kind: 'weekly', interval: 1, weekdays: [1] }, anchorAt: '2026-10-01T09:00:00.000Z' },
    },
  }
  const preview = await service.preview(envelope)
  await service.execute({
    ...envelope,
    explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
  })
  const after = await service.query({ type: 'workspace.snapshot' })
  const preserved = after.occurrences.find(({ id }) => id === 'occurrence:series-daily:2')!

  assert.equal(preserved.status, 'pending')
  assert.equal(preserved.scheduledAt, pending.scheduledAt)
  assert.deepEqual(preserved.override, pending.override)
  assert.equal(preserved.revision, pending.revision)
})
