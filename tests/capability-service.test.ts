import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMAND_CATALOG } from '../src/domain/capabilities/catalog.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import { DomainCommandError, type CommandEnvelope } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'

const NOW = '2026-09-04T08:00:00.000Z'

function fixture(seed?: unknown) {
  let nextId = 0
  return createTaskCapabilityService(
    createInMemoryWorkspaceStore(seed),
    () => NOW,
    (kind) => `${kind}-${++nextId}`,
  )
}

function createEnvelope(
  expectedWorkspaceRevision: number,
  idempotencyKey = 'create-task',
): CommandEnvelope {
  return {
    protocolVersion: 1,
    idempotencyKey,
    source: 'human-ui',
    expectedWorkspaceRevision,
    command: {
      type: 'task.create',
      taskId: 'task-one',
      listId: 'list:system:learning',
      title: 'One task',
    },
  }
}

async function executeNext(
  service: ReturnType<typeof fixture>,
  idempotencyKey: string,
  command: CommandEnvelope['command'],
  source: CommandEnvelope['source'] = 'human-ui',
) {
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  return service.execute({
    protocolVersion: 1,
    idempotencyKey,
    source,
    expectedWorkspaceRevision: snapshot.revision,
    command,
  })
}

test('task.plan preserves an explicit precise schedule after its deadline', async () => {
  const service = fixture()
  await executeNext(service, 'create-conflict', {
    type: 'task.create', taskId: 'conflict', listId: 'list:system:learning', title: 'Explicit conflict',
    dueOn: '2026-09-06',
  })

  await executeNext(service, 'plan-conflict', {
    type: 'task.plan', taskId: 'conflict', patch: { startAt: '2026-09-07T06:00:00.000Z' },
  })

  const snapshot = await service.query({ type: 'workspace.snapshot' })
  const task = snapshot.tasks.find(({ id }) => id === 'conflict')
  assert.equal(task?.schedule.startAt, '2026-09-07T06:00:00.000Z')
  assert.equal(task?.deadline.dueOn, '2026-09-06')
})

test('task capability rejects invalid schedule shapes without saving', async (context) => {
  const commands: Array<[string, CommandEnvelope['command']]> = [
    ['dual representation', {
      type: 'task.create', taskId: 'dual', listId: 'list:system:learning', title: 'Dual schedule',
      startAt: '2026-09-07T06:00:00.000Z', startOn: '2026-09-07',
    }],
    ['invalid date', {
      type: 'task.create', taskId: 'invalid-date', listId: 'list:system:learning', title: 'Invalid date',
      startOn: '2026-02-30',
    }],
  ]

  for (const [label, command] of commands) {
    await context.test(label, async () => {
      const service = fixture()
      const before = await service.query({ type: 'workspace.snapshot' })
      await assert.rejects(
        executeNext(service, `invalid-${label}`, command),
        (error) => error instanceof DomainCommandError && error.code === 'VALIDATION_ERROR',
      )
      assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
    })
  }
})

test('does not save when one target in a batch is invalid', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  await service.execute({
    protocolVersion: 1,
    idempotencyKey: 'create-ok',
    source: 'human-ui',
    expectedWorkspaceRevision: initial.revision,
    command: { type: 'task.create', taskId: 'ok', listId: 'list:system:learning', title: 'Keep atomic' },
  })
  const before = await service.query({ type: 'workspace.snapshot' })

  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'batch-invalid',
      source: 'human-ui',
      expectedWorkspaceRevision: before.revision,
      command: {
        type: 'task.batch_reschedule',
        taskIds: ['ok', 'missing'],
        startOn: '2026-09-05',
      },
    }),
    /TASK_NOT_FOUND/,
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('returns the original receipt before checking CAS for a repeated idempotency key', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  const command = createEnvelope(initial.revision, 'same-key')

  const first = await service.execute(command)
  const second = await service.execute(command)
  const after = await service.query({ type: 'workspace.snapshot' })

  assert.deepEqual(second, first)
  assert.equal(after.tasks.filter(({ id }) => id === 'task-one').length, 1)
  assert.equal(after.commandReceipts.length, initial.commandReceipts.length + 1)
  assert.equal(after.revision, initial.revision + 1)
})

test('binds an idempotency key to the complete canonical request identity', async (context) => {
  const changes: Array<[string, (envelope: CommandEnvelope) => CommandEnvelope]> = [
    ['protocol', (envelope) => ({ ...envelope, protocolVersion: 2 } as unknown as CommandEnvelope)],
    ['source', (envelope) => ({ ...envelope, source: 'agent' })],
    ['workspace revision', (envelope) => ({ ...envelope, expectedWorkspaceRevision: envelope.expectedWorkspaceRevision + 1 })],
    ['command payload', (envelope) => ({
      ...envelope,
      command: { ...envelope.command, title: 'Different title' } as CommandEnvelope['command'],
    })],
  ]
  for (const [label, change] of changes) {
    await context.test(label, async () => {
      const service = fixture()
      const initial = await service.query({ type: 'workspace.snapshot' })
      const original = createEnvelope(initial.revision, 'bound-key')
      await service.execute(original)
      const before = await service.query({ type: 'workspace.snapshot' })

      await assert.rejects(
        service.execute(change(original)),
        (error) => error instanceof DomainCommandError && error.code === 'IDEMPOTENCY_KEY_CONFLICT',
      )
      assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
    })
  }
})

test('persists a key-independent canonical fingerprint and replays reordered equivalent payloads', async () => {
  const firstService = fixture()
  const firstInitial = await firstService.query({ type: 'workspace.snapshot' })
  const firstEnvelope = createEnvelope(firstInitial.revision, 'first-key')
  const first = await firstService.execute(firstEnvelope)
  const firstState = await firstService.query({ type: 'workspace.snapshot' })
  const firstFingerprint = (firstState.commandReceipts[0] as { requestFingerprint?: unknown }).requestFingerprint
  assert.match(String(firstFingerprint), /^sha256:[0-9a-f]{64}$/)

  const reordered: CommandEnvelope = {
    command: {
      title: 'One task', listId: 'list:system:learning', taskId: 'task-one', type: 'task.create',
    },
    expectedWorkspaceRevision: firstEnvelope.expectedWorkspaceRevision,
    source: firstEnvelope.source,
    idempotencyKey: firstEnvelope.idempotencyKey,
    protocolVersion: firstEnvelope.protocolVersion,
  }
  assert.deepEqual(await firstService.execute(reordered), first)

  const secondService = fixture()
  const secondInitial = await secondService.query({ type: 'workspace.snapshot' })
  await secondService.execute(createEnvelope(secondInitial.revision, 'second-key'))
  const secondState = await secondService.query({ type: 'workspace.snapshot' })
  const secondFingerprint = (secondState.commandReceipts[0] as { requestFingerprint?: unknown }).requestFingerprint
  assert.equal(secondFingerprint, firstFingerprint)
})

test('keeps large repeated workspace import fingerprints bounded and snapshots loadable', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  const large = structuredClone(initial)
  large.lists[0]!.goal = 'g'.repeat(100_000)
  let candidate = large

  for (let index = 0; index < 3; index += 1) {
    const before = await service.query({ type: 'workspace.snapshot' })
    await service.execute({
      protocolVersion: 1,
      idempotencyKey: `large-import-${index}`,
      source: 'human-ui',
      expectedWorkspaceRevision: before.revision,
      command: { type: 'workspace.import', state: candidate },
    })
    const after = await service.query({ type: 'workspace.snapshot' })
    assert.equal(after.lists[0]?.goal.length, 100_000)
    assert.equal(after.commandReceipts.length, 1)
    assert.match(String(after.commandReceipts[0]?.requestFingerprint), /^sha256:[0-9a-f]{64}$/)
    candidate = structuredClone(after)
  }
})

test('loads legacy unbound receipts but grants them neither replay nor undo authority', async () => {
  const writer = fixture()
  await executeNext(writer, 'legacy-create', {
    type: 'task.create', taskId: 'legacy-task', listId: 'list:system:learning', title: 'Before',
  })
  const update = await executeNext(writer, 'legacy-update', {
    type: 'task.update', taskId: 'legacy-task', expectedRevision: 1, patch: { title: 'After' },
  })
  const legacyState = await writer.query({ type: 'workspace.snapshot' })
  for (const receipt of legacyState.commandReceipts) {
    delete (receipt as { requestFingerprint?: string }).requestFingerprint
  }

  const service = fixture(legacyState)
  const loaded = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(loaded.commandReceipts.map(({ requestFingerprint }) => requestFingerprint), [null, null])
  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'legacy-update',
      source: 'agent',
      expectedWorkspaceRevision: loaded.revision,
      command: { type: 'task.delete', taskId: 'legacy-task', expectedRevision: 2 },
    }),
    (error) => error instanceof DomainCommandError && error.code === 'IDEMPOTENCY_KEY_CONFLICT',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), loaded)

  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'legacy-undo',
      source: 'human-ui',
      expectedWorkspaceRevision: loaded.revision,
      command: { type: 'undo.apply', token: update.undoToken! },
    }),
    (error) => error instanceof DomainCommandError && error.code === 'UNDO_TOKEN_NOT_FOUND',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), loaded)
})

test('rejects stale workspace and entity revisions without changing the workspace', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  await service.execute(createEnvelope(initial.revision))
  const before = await service.query({ type: 'workspace.snapshot' })

  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'stale-workspace',
      source: 'keyboard',
      expectedWorkspaceRevision: initial.revision,
      command: { type: 'task.update', taskId: 'task-one', patch: { title: 'Overwritten' } },
    }),
    (error) => error instanceof DomainCommandError && error.code === 'WORKSPACE_REVISION_CONFLICT',
  )
  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'stale-entity',
      source: 'agent',
      expectedWorkspaceRevision: before.revision,
      command: {
        type: 'task.update',
        taskId: 'task-one',
        expectedRevision: 999,
        patch: { title: 'Overwritten' },
      },
    }),
    (error) => error instanceof DomainCommandError && error.code === 'ENTITY_REVISION_CONFLICT',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('catalog exposes fixed risk, scope, reversibility, and preview metadata for every core command', () => {
  assert.deepEqual(COMMAND_CATALOG, [
    { type: 'calendar.move', risk: 'high', scope: 'series', reversibility: 'reversible', requiresPreview: true },
    { type: 'calendar.resize', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
    { type: 'task.create', risk: 'low', scope: 'single', reversibility: 'compensating', requiresPreview: false },
    { type: 'task.update', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
    { type: 'task.delete', risk: 'high', scope: 'single', reversibility: 'compensating', requiresPreview: true },
    { type: 'task.complete', risk: 'medium', scope: 'single', reversibility: 'reversible', requiresPreview: false },
    { type: 'task.reopen', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
    { type: 'task.reschedule', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
    { type: 'task.batch_reschedule', risk: 'medium', scope: 'batch', reversibility: 'reversible', requiresPreview: true },
    { type: 'task.batch_cancel', risk: 'high', scope: 'batch', reversibility: 'reversible', requiresPreview: true },
    { type: 'task.batch_delete', risk: 'high', scope: 'batch', reversibility: 'compensating', requiresPreview: true },
    { type: 'recurrence.create', risk: 'medium', scope: 'series', reversibility: 'reversible', requiresPreview: true },
    { type: 'recurrence.update', risk: 'high', scope: 'series', reversibility: 'reversible', requiresPreview: true },
    { type: 'recurrence.complete', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
    { type: 'recurrence.skip', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
    { type: 'list.upsert', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'list_group.upsert', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'list_group.archive', risk: 'medium', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'task.plan', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'task.transition', risk: 'medium', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'task.start', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'task.switch', risk: 'medium', scope: 'batch', reversibility: 'irreversible', requiresPreview: false },
    { type: 'session.pause', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'session.resume', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'session.scratchpad.update', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'task.checklist.add', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'task.checklist.set', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'task.reorder', risk: 'low', scope: 'batch', reversibility: 'irreversible', requiresPreview: false },
    { type: 'task.toggle_completion', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'completion.review', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'completion.create_next_action', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
    { type: 'workspace.reset', risk: 'high', scope: 'workspace', reversibility: 'irreversible', requiresPreview: true },
    { type: 'workspace.import', risk: 'high', scope: 'workspace', reversibility: 'irreversible', requiresPreview: true },
    ...(['reminder.set', 'reminder.snooze', 'reminder.dismiss', 'reminder.claim', 'reminder.ack', 'reminder.migrate', 'reminder.recover', 'reminder.retry', 'reminder.reconcile'] as const).map((type) => ({ type, risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false })),
    { type: 'undo.apply', risk: 'medium', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  ])
})

test('previews on a clone with fixed impact and confirmation metadata without saving', async () => {
  const service = fixture()
  const before = await service.query({ type: 'workspace.snapshot' })
  const preview = await service.preview(createEnvelope(before.revision, 'preview-create'))

  assert.deepEqual(preview, {
    accepted: true,
    descriptor: {
      type: 'task.create', risk: 'low', scope: 'single',
      reversibility: 'compensating', requiresPreview: false,
    },
    affected: [{ type: 'task', id: 'task-one', revision: 1 }],
    changes: [{
      entity: { type: 'task', id: 'task-one', revision: 1 },
      operation: 'create',
      fields: ['task'],
    }],
    validationErrors: [],
    confirmation: 'none',
    previewReceiptId: preview.previewReceiptId,
  })
  assert.equal(preview.previewReceiptId, null)
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('preview returns structured validation errors and review metadata for an invalid batch', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  const preview = await service.preview({
    protocolVersion: 1,
    idempotencyKey: 'preview-batch',
    source: 'agent',
    expectedWorkspaceRevision: initial.revision,
    command: {
      type: 'task.batch_reschedule',
      taskIds: ['missing'],
      startOn: '2026-09-05',
    },
  })

  assert.equal(preview.accepted, false)
  assert.deepEqual(preview.descriptor, {
    type: 'task.batch_reschedule', risk: 'medium', scope: 'batch',
    reversibility: 'reversible', requiresPreview: true,
  })
  assert.equal(preview.confirmation, 'review')
  assert.equal(preview.previewReceiptId, null)
  assert.deepEqual(preview.affected, [{ type: 'task', id: 'missing' }])
  assert.deepEqual(preview.changes, [])
  assert.equal(preview.validationErrors[0]?.code, 'TASK_NOT_FOUND')
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), initial)
})

test('create preview uses collision-free internal ids but exposes only a synthetic affected ref', async () => {
  const service = fixture()
  await executeNext(service, 'preview-collision-seed', {
    type: 'task.create', taskId: 'preview:task:1', listId: 'list:system:learning', title: 'Legal stored id',
  })
  const before = await service.query({ type: 'workspace.snapshot' })
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'preview-with-generated-id',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command: { type: 'task.create', listId: 'list:system:learning', title: 'Generated later' },
  }

  const preview = await service.preview(envelope)
  assert.equal(preview.accepted, true)
  assert.deepEqual(preview.affected, [{ type: 'task', id: 'new' }])
  assert.deepEqual(preview.changes, [{
    entity: { type: 'task', id: 'new' }, operation: 'create', fields: ['task'],
  }])
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)

  const result = await service.execute(envelope)
  assert.deepEqual(result.affected, [{ type: 'task', id: 'task-4', revision: 1 }])
  assert.equal((await service.query({ type: 'task.get', taskId: 'task-4' }))?.title, 'Generated later')
})

test('queries return cloned task views, command descriptions, and source-preserving audit data', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  const command = createEnvelope(initial.revision, 'agent-create')
  command.source = 'agent'
  command.command = {
    type: 'task.create', taskId: 'task-one', listId: 'list:system:learning',
    title: 'Searchable task', notes: 'Needle in notes',
  }
  await service.execute(command)

  const found = await service.query({ type: 'task.get', taskId: 'task-one' })
  assert.equal(found?.title, 'Searchable task')
  if (found) found.title = 'mutated result'
  assert.deepEqual((await service.query({ type: 'task.list', statuses: ['inbox'] })).map(({ id }) => id), ['task-one'])
  assert.deepEqual((await service.query({ type: 'task.search', text: 'NEEDLE' })).map(({ id }) => id), ['task-one'])
  assert.equal((await service.query({ type: 'task.get', taskId: 'task-one' }))?.title, 'Searchable task')
  assert.deepEqual(await service.query({ type: 'command.describe', commandType: 'task.batch_cancel' }), {
    type: 'task.batch_cancel', risk: 'high', scope: 'batch',
    reversibility: 'reversible', requiresPreview: true,
  })
  const audit = await service.query({ type: 'audit.list', commandType: 'task.create', limit: 1 })
  assert.equal(audit.receipts[0]?.source, 'agent')
  assert.deepEqual(audit.events.map(({ type }) => type), ['captured'])
})

test('single task commands advance entity revisions and preserve an ordered lifecycle audit', async () => {
  const service = fixture()
  await executeNext(service, 'single-create', {
    type: 'task.create', taskId: 'lifecycle', listId: 'list:system:learning', title: 'Draft',
  })
  const updated = await executeNext(service, 'single-update', {
    type: 'task.update', taskId: 'lifecycle', expectedRevision: 1,
    patch: { title: 'Lifecycle', notes: 'Changed', priority: 'high' },
  })
  assert.equal(updated.events.length, 0)
  assert.equal((updated.data as { revision: number }).revision, 2)

  await executeNext(service, 'single-reschedule', {
    type: 'task.reschedule', taskId: 'lifecycle', expectedRevision: 2, startOn: '2026-09-05',
  })
  await executeNext(service, 'single-complete', {
    type: 'task.complete', taskId: 'lifecycle', expectedRevision: 3,
  })
  await executeNext(service, 'single-reopen', {
    type: 'task.reopen', taskId: 'lifecycle', expectedRevision: 4,
  })
  await executeNext(service, 'single-delete', {
    type: 'task.delete', taskId: 'lifecycle', expectedRevision: 5, reason: 'No longer needed',
  })

  assert.equal(await service.query({ type: 'task.get', taskId: 'lifecycle' }), null)
  const deleted = await service.query({ type: 'task.get', taskId: 'lifecycle', includeDeleted: true })
  assert.deepEqual({
    revision: deleted?.revision,
    title: deleted?.title,
    status: deleted?.status,
    startOn: deleted?.schedule.startOn,
    deletedAt: deleted?.deletedAt,
  }, {
    revision: 6,
    title: 'Lifecycle',
    status: 'planned',
    startOn: '2026-09-05',
    deletedAt: NOW,
  })
  const audit = await service.query({ type: 'audit.list' })
  const taskEvents = audit.events.filter(({ taskId }) => taskId === 'lifecycle')
  assert.deepEqual(taskEvents.map(({ type }) => type), [
    'captured', 'rescheduled', 'completed', 'reopened', 'deleted',
  ])
  assert.deepEqual(taskEvents.map(({ sequence }) => sequence),
    taskEvents.map((_, index) => taskEvents[0]!.sequence + index))
  assert.equal(audit.receipts.filter(({ commandType }) => commandType.startsWith('task.')).length, 6)
})

test('learning completion requires evidence and records it atomically', async () => {
  const service = fixture()
  await executeNext(service, 'learning-create', {
    type: 'task.create', taskId: 'learning', mode: 'learning', listId: 'list:system:learning',
    title: 'Learn capability protocol', acceptanceCriteria: ['Explain CAS'],
  })
  await executeNext(service, 'learning-plan', {
    type: 'task.reschedule', taskId: 'learning', expectedRevision: 1, startOn: '2026-09-05',
  })
  const before = await service.query({ type: 'workspace.snapshot' })
  await assert.rejects(
    executeNext(service, 'learning-incomplete', {
      type: 'task.complete', taskId: 'learning', expectedRevision: 2,
      learned: '', evidence: 'Tests', nextAction: 'Review',
    }),
    (error) => error instanceof DomainCommandError && error.code === 'VALIDATION_ERROR',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)

  const result = await executeNext(service, 'learning-complete', {
    type: 'task.complete', taskId: 'learning', expectedRevision: 2,
    learned: 'CAS protects the snapshot', evidence: 'Passing test', nextAction: 'Use it in UI', mastery: 4,
  })
  const data = result.data as { task: { status: string }; record: { learned: string; mastery: number } }
  assert.equal(data.task.status, 'completed')
  assert.equal(data.record.learned, 'CAS protects the snapshot')
  assert.equal(data.record.mastery, 4)
  const state = await service.query({ type: 'workspace.snapshot' })
  assert.equal(state.completionRecords.at(-1)?.taskId, 'learning')
  assert.equal(state.taskEvents.at(-1)?.completionRecordId, state.completionRecords.at(-1)?.id)
})

test('batch cancel and delete mutate every validated target with consecutive events', async () => {
  const service = fixture()
  for (const taskId of ['batch-a', 'batch-b']) {
    await executeNext(service, `create-${taskId}`, {
      type: 'task.create', taskId, listId: 'list:system:learning', title: taskId,
    })
  }
  const cancel = await executeNext(service, 'batch-cancel', {
    type: 'task.batch_cancel', taskIds: ['batch-a', 'batch-b'],
    expectedRevisions: { 'batch-a': 1, 'batch-b': 1 }, reason: 'Later',
  })
  assert.deepEqual(cancel.events.map(({ type }) => type), ['cancelled', 'cancelled'])
  assert.equal(cancel.events[1]!.sequence, cancel.events[0]!.sequence + 1)
  assert.deepEqual((cancel.data as { revision: number; status: string }[]).map(({ revision, status }) => ({ revision, status })), [
    { revision: 2, status: 'cancelled' }, { revision: 2, status: 'cancelled' },
  ])

  const deleted = await executeNext(service, 'batch-delete', {
    type: 'task.batch_delete', taskIds: ['batch-a', 'batch-b'],
    expectedRevisions: { 'batch-a': 2, 'batch-b': 2 }, reason: 'Clean list',
  })
  assert.deepEqual(deleted.events.map(({ type }) => type), ['deleted', 'deleted'])
  assert.deepEqual((await service.query({ type: 'task.list' })).filter(({ id }) => id.startsWith('batch-')), [])
})

test('undo applies the original targeted compensation once and replays its own receipt idempotently', async () => {
  const service = fixture()
  await executeNext(service, 'undo-create', {
    type: 'task.create', taskId: 'undo-target', listId: 'list:system:learning', title: 'Before',
  })
  await executeNext(service, 'other-create', {
    type: 'task.create', taskId: 'untouched', listId: 'list:system:learning', title: 'Untouched',
  })
  const update = await executeNext(service, 'undo-update', {
    type: 'task.update', taskId: 'undo-target', expectedRevision: 1, patch: { title: 'After' },
  })
  assert.ok(update.undoToken)
  const beforeUndo = await service.query({ type: 'workspace.snapshot' })
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'apply-undo',
    source: 'keyboard',
    expectedWorkspaceRevision: beforeUndo.revision,
    command: { type: 'undo.apply', token: update.undoToken! },
  }

  const first = await service.execute(envelope)
  const replay = await service.execute(envelope)
  assert.deepEqual(replay, first)
  assert.equal((await service.query({ type: 'task.get', taskId: 'undo-target' }))?.title, 'Before')
  assert.equal((await service.query({ type: 'task.get', taskId: 'undo-target' }))?.revision, 3)
  assert.equal((await service.query({ type: 'task.get', taskId: 'untouched' }))?.title, 'Untouched')
  const afterUndo = await service.query({ type: 'workspace.snapshot' })
  assert.equal(afterUndo.revision, beforeUndo.revision + 1)

  await assert.rejects(
    service.execute({ ...envelope, idempotencyKey: 'apply-undo-again', expectedWorkspaceRevision: afterUndo.revision }),
    (error) => error instanceof DomainCommandError && error.code === 'UNDO_ALREADY_APPLIED',
  )
})

test('metadata update and its undo use receipts without fabricated lifecycle events', async () => {
  const service = fixture()
  await executeNext(service, 'metadata-create', {
    type: 'task.create', taskId: 'metadata-task', listId: 'list:system:learning', title: 'Before',
  })
  const update = await executeNext(service, 'metadata-update', {
    type: 'task.update', taskId: 'metadata-task', expectedRevision: 1, patch: { title: 'After' },
  })
  assert.deepEqual(update.events, [])
  const beforeUndo = await service.query({ type: 'workspace.snapshot' })
  const undo = await service.execute({
    protocolVersion: 1,
    idempotencyKey: 'metadata-undo',
    source: 'human-ui',
    expectedWorkspaceRevision: beforeUndo.revision,
    command: { type: 'undo.apply', token: update.undoToken! },
  })

  assert.deepEqual(undo.events, [])
  const afterUndo = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(afterUndo.taskEvents.filter(({ taskId }) => taskId === 'metadata-task').map(({ type }) => type), ['captured'])
  assert.deepEqual(afterUndo.commandReceipts.slice(-2).map(({ commandType }) => commandType), ['task.update', 'undo.apply'])
  assert.equal(afterUndo.tasks.find(({ id }) => id === 'metadata-task')?.title, 'Before')
})

test('undo restores a task reminder after adding, changing, or clearing it without touching other tasks', async (context) => {
  for (const scenario of ['add', 'change', 'clear'] as const) {
    await context.test(scenario, async () => {
      const service = fixture()
      const originalAt = '2026-09-06T09:00:00.000Z'
      const replacementAt = '2026-09-07T09:00:00.000Z'
      await executeNext(service, 'create-reminder-target', {
        type: 'task.create', taskId: 'reminder-target', listId: 'list:system:learning', title: 'Reminder target',
        ...(scenario === 'add' ? {} : { reminderAt: originalAt }),
      })
      await executeNext(service, 'create-unrelated-reminder', {
        type: 'task.create', taskId: 'unrelated-reminder', listId: 'list:system:learning', title: 'Keep reminder',
        reminderAt: originalAt,
      })
      const before = await service.query({ type: 'workspace.snapshot' })
      const update = await executeNext(service, 'edit-reminder', {
        type: 'task.update', taskId: 'reminder-target',
        patch: { reminderAt: scenario === 'clear' ? null : replacementAt },
      })
      await executeNext(service, 'undo-reminder', { type: 'undo.apply', token: update.undoToken! })
      const after = await service.query({ type: 'workspace.snapshot' })
      const reminderValues = (state: typeof before) => state.reminderRules
        .filter(({ taskId }) => taskId === 'reminder-target')
        .map(({ revision: _revision, ...rule }) => rule)
      assert.deepEqual(reminderValues(after), reminderValues(before))
      assert.deepEqual(
        after.reminderRules.filter(({ taskId }) => taskId !== 'reminder-target'),
        before.reminderRules.filter(({ taskId }) => taskId !== 'reminder-target'),
      )
    })
  }
})

test('undo token revision rejects compensation after an intervening command without saving', async () => {
  const service = fixture()
  await executeNext(service, 'cas-create', {
    type: 'task.create', taskId: 'cas-target', listId: 'list:system:learning', title: 'Before',
  })
  const update = await executeNext(service, 'cas-update', {
    type: 'task.update', taskId: 'cas-target', expectedRevision: 1, patch: { title: 'After' },
  })
  await executeNext(service, 'intervening-create', {
    type: 'task.create', taskId: 'intervening', listId: 'list:system:learning', title: 'Intervening',
  })
  const before = await service.query({ type: 'workspace.snapshot' })

  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'stale-undo',
      source: 'agent',
      expectedWorkspaceRevision: before.revision,
      command: { type: 'undo.apply', token: update.undoToken! },
    }),
    (error) => error instanceof DomainCommandError && error.code === 'UNDO_REVISION_CONFLICT',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('workspace import parses the complete candidate before replacement and cannot import its revision', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'invalid-import',
      source: 'human-ui',
      expectedWorkspaceRevision: initial.revision,
      command: { type: 'workspace.import', state: { version: 3 } },
    }),
    (error) => error instanceof DomainCommandError && error.code === 'IMPORT_INVALID',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), initial)

  const imported = structuredClone(initial)
  imported.revision = 999
  imported.lists[0]!.title = 'Imported list'
  const result = await service.execute({
    protocolVersion: 1,
    idempotencyKey: 'valid-import',
    source: 'human-ui',
    expectedWorkspaceRevision: initial.revision,
    command: { type: 'workspace.import', state: imported },
  })
  const after = await service.query({ type: 'workspace.snapshot' })
  assert.equal(result.workspaceRevision, initial.revision + 1)
  assert.equal(after.revision, initial.revision + 1)
  assert.equal(after.lists[0]?.title, 'Imported list')
  assert.equal(after.commandReceipts.at(-1)?.commandType, 'workspace.import')
})

test('workspace import discards a forged replay receipt before later commands execute', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  const imported = structuredClone(initial)
  imported.commandReceipts = [{
    id: 'forged-replay-receipt',
    idempotencyKey: 'future-create',
    requestFingerprint: 'forged-replay-fingerprint',
    commandType: 'task.create',
    source: 'agent',
    workspaceRevision: imported.revision,
    result: {
      receiptId: 'forged-result', workspaceRevision: imported.revision,
      affected: [], events: [], undoToken: null, data: null,
    },
    createdAt: '2026-09-04T00:00:00.000Z',
    expiresAt: '2026-10-04T00:00:00.000Z',
  }]
  delete (imported.commandReceipts[0] as { requestFingerprint?: string }).requestFingerprint
  await service.execute({
    protocolVersion: 1,
    idempotencyKey: 'trusted-import',
    source: 'human-ui',
    expectedWorkspaceRevision: initial.revision,
    command: { type: 'workspace.import', state: imported },
  })
  const afterImport = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(afterImport.commandReceipts.map(({ idempotencyKey }) => idempotencyKey), ['trusted-import'])

  const result = await service.execute({
    protocolVersion: 1,
    idempotencyKey: 'future-create',
    source: 'agent',
    expectedWorkspaceRevision: afterImport.revision,
    command: {
      type: 'task.create', taskId: 'future-task', listId: 'list:system:learning', title: 'Executed locally',
    },
  })
  assert.notEqual(result.receiptId, 'forged-result')
  assert.equal((await service.query({ type: 'task.get', taskId: 'future-task' }))?.title, 'Executed locally')
})

test('workspace import discards forged receipt authority before undo validation', async () => {
  const service = fixture()
  await executeNext(service, 'create-victim', {
    type: 'task.create', taskId: 'victim', listId: 'list:system:learning', title: 'Must survive forged undo',
  })
  const initial = await service.query({ type: 'workspace.snapshot' })
  const token = {
    protocolVersion: 1 as const,
    id: 'forged-undo-token',
    commandReceiptId: 'forged-origin-receipt',
    expectedWorkspaceRevision: initial.revision + 1,
    compensation: { type: 'task.remove_created' as const, taskIds: ['victim'] },
  }
  const imported = structuredClone(initial)
  imported.commandReceipts = [{
    id: 'forged-origin-receipt',
    idempotencyKey: 'forged-origin-key',
    requestFingerprint: 'forged-undo-fingerprint',
    commandType: 'task.create',
    source: 'agent',
    workspaceRevision: imported.revision,
    result: {
      receiptId: 'forged-origin-receipt', workspaceRevision: imported.revision,
      affected: [], events: [], undoToken: token, data: null,
    },
    createdAt: '2026-09-04T00:00:00.000Z',
    expiresAt: '2026-10-04T00:00:00.000Z',
  }]
  await service.execute({
    protocolVersion: 1,
    idempotencyKey: 'trusted-import',
    source: 'human-ui',
    expectedWorkspaceRevision: initial.revision,
    command: { type: 'workspace.import', state: imported },
  })
  const afterImport = await service.query({ type: 'workspace.snapshot' })

  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'forged-undo-attempt',
      source: 'agent',
      expectedWorkspaceRevision: afterImport.revision,
      command: { type: 'undo.apply', token },
    }),
    (error) => error instanceof DomainCommandError && error.code === 'UNDO_TOKEN_NOT_FOUND',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), afterImport)
})

test('receipt cache ignores expired replay entries and keeps the newest 500 by created time with a stable tie-breaker', async () => {
  const seedStore = createInMemoryWorkspaceStore()
  const seed = await seedStore.load()
  seed.commandReceipts = Array.from({ length: 501 }, (_, index) => {
    const expired = index === 500
    const id = `seed-receipt-${index}`
    return {
      id,
      idempotencyKey: expired ? 'receipt-prune-new' : `seed-key-${index}`,
      requestFingerprint: `seed-fingerprint-${index}`,
      commandType: 'task.update',
      source: 'human-ui' as const,
      workspaceRevision: seed.revision,
      result: {
        receiptId: id,
        workspaceRevision: seed.revision,
        affected: [], events: [], undoToken: null, data: null,
      },
      createdAt: index === 0
        ? '2026-09-01T23:30:00.000-02:00'
        : index === 1
          ? '2026-09-02T00:00:00.000+02:00'
          : index === 2
            ? '2026-09-01T22:00:00.000Z'
            : '2026-09-02T00:30:00.000+02:00',
      expiresAt: expired ? '2026-09-03T00:00:00.000Z' : '2026-10-05T00:00:00.000Z',
    }
  })
  const service = fixture(seed)
  await service.execute(createEnvelope(seed.revision, 'receipt-prune-new'))
  const after = await service.query({ type: 'workspace.snapshot' })

  assert.equal(after.commandReceipts.length, 500)
  assert.equal(after.commandReceipts.some(({ id }) => id === 'seed-receipt-500'), false)
  assert.equal(after.commandReceipts.some(({ id }) => id === 'seed-receipt-0'), true)
  assert.equal(after.commandReceipts.some(({ id }) => id === 'seed-receipt-1'), false)
  assert.equal(after.commandReceipts.some(({ id }) => id === 'seed-receipt-2'), true)
  assert.equal(after.commandReceipts.at(-1)?.idempotencyKey, 'receipt-prune-new')
  assert.equal(after.tasks.some(({ id }) => id === 'task-one'), true)
})

test('runtime protocol errors have stable codes and command source never bypasses domain rules', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  await assert.rejects(
    service.execute({
      ...createEnvelope(initial.revision, 'bad-protocol'),
      protocolVersion: 2,
    } as unknown as CommandEnvelope),
    (error) => error instanceof DomainCommandError && error.code === 'UNSUPPORTED_PROTOCOL_VERSION',
  )
  await assert.rejects(
    service.execute({
      ...createEnvelope(initial.revision, 'unknown-command'),
      command: { type: 'task.unknown' },
    } as unknown as CommandEnvelope),
    (error) => error instanceof DomainCommandError && error.code === 'COMMAND_NOT_FOUND',
  )
  await executeNext(service, 'source-create', {
    type: 'task.create', taskId: 'source-task', listId: 'list:system:learning', title: 'Source boundary',
  })
  const before = await service.query({ type: 'workspace.snapshot' })
  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'agent-invalid-reopen',
      source: 'agent',
      expectedWorkspaceRevision: before.revision,
      command: { type: 'task.reopen', taskId: 'source-task', expectedRevision: 1 },
    }),
    (error) => error instanceof DomainCommandError && error.code === 'TASK_INVALID_TRANSITION',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('rejects non-JSON-safe import requests with one stable domain error and no save', async (context) => {
  const cyclic: Record<string, unknown> = { version: 3 }
  cyclic.self = cyclic
  const cases: Array<[string, unknown]> = [
    ['bigint', { version: 3, unsupported: 1n }],
    ['cycle', cyclic],
  ]

  for (const [label, state] of cases) {
    await context.test(label, async () => {
      const service = fixture()
      const before = await service.query({ type: 'workspace.snapshot' })
      await assert.rejects(
        service.execute({
          protocolVersion: 1,
          idempotencyKey: `unsafe-${label}`,
          source: 'human-ui',
          expectedWorkspaceRevision: before.revision,
          command: { type: 'workspace.import', state },
        }),
        (error) => error instanceof DomainCommandError
          && error.code === 'VALIDATION_ERROR'
          && error.message === '[VALIDATION_ERROR] Command request must be JSON-safe.',
      )
      assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
    })
  }
})

test('rejects a sparse import array instead of replaying an empty-array receipt', async () => {
  const service = fixture()
  const initial = await service.query({ type: 'workspace.snapshot' })
  const empty = structuredClone(initial)
  empty.lists[0]!.successCriteria = []
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'sparse-array-import',
    source: 'human-ui',
    expectedWorkspaceRevision: initial.revision,
    command: { type: 'workspace.import', state: empty },
  }
  await service.execute(envelope)
  const afterFirst = await service.query({ type: 'workspace.snapshot' })

  const sparse = structuredClone(empty)
  sparse.lists[0]!.successCriteria = new Array<string>(1)
  await assert.rejects(
    service.execute({ ...envelope, command: { type: 'workspace.import', state: sparse } }),
    (error) => error instanceof DomainCommandError
      && error.code === 'VALIDATION_ERROR'
      && error.message === '[VALIDATION_ERROR] Command request must be JSON-safe.',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), afterFirst)

  const explicitNull = structuredClone(empty)
  explicitNull.lists[0]!.successCriteria = [null] as unknown as string[]
  await assert.rejects(
    service.execute({ ...envelope, command: { type: 'workspace.import', state: explicitNull } }),
    (error) => error instanceof DomainCommandError && error.code === 'IDEMPOTENCY_KEY_CONFLICT',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), afterFirst)
})

test('factory has no custom handler escape hatch around the catalog and central dispatcher', async () => {
  let nextId = 0
  const service = createTaskCapabilityService(
    createInMemoryWorkspaceStore(),
    () => NOW,
    (kind) => `${kind}-${++nextId}`,
    [{
      type: 'custom.escape',
      apply(state: { lists: Array<{ title: string }> }) {
        state.lists[0]!.title = 'Escaped catalog'
        return { affected: [], changes: [], events: [], compensation: null, data: null }
      },
    }] as never,
  )
  const before = await service.query({ type: 'workspace.snapshot' })

  await assert.rejects(
    service.execute({
      protocolVersion: 1,
      idempotencyKey: 'custom-escape',
      source: 'agent',
      expectedWorkspaceRevision: before.revision,
      command: { type: 'custom.escape' },
    } as unknown as CommandEnvelope),
    (error) => error instanceof DomainCommandError && error.code === 'COMMAND_NOT_FOUND',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})
