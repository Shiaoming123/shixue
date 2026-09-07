import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import { DomainCommandError, type CommandEnvelope } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'

const NOW = '2026-09-07T00:00:00.000Z'

function setup() {
  let nextId = 0
  const service = createTaskCapabilityService(
    createInMemoryWorkspaceStore(),
    () => NOW,
    (kind) => `${kind}:tag-test:${++nextId}`,
  )
  const execute = async (idempotencyKey: string, command: CommandEnvelope['command']) => {
    const state = await service.query({ type: 'workspace.snapshot' })
    return service.execute({
      protocolVersion: 1,
      idempotencyKey,
      source: 'human-ui',
      expectedWorkspaceRevision: state.revision,
      command,
    })
  }
  return { service, execute }
}

test('tag create is trimmed, audited, idempotent, and undoable', async () => {
  const { service, execute } = setup()
  const before = await service.query({ type: 'workspace.snapshot' })
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'create-math',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command: { type: 'tag.create', tagId: 'tag:math', title: '  数学  ' },
  }
  const first = await service.execute(envelope)
  const replay = await service.execute(envelope)
  assert.deepEqual(replay, first)
  assert.deepEqual(first.events, [])
  assert.ok(first.undoToken)
  assert.deepEqual((await service.query({ type: 'workspace.snapshot' })).tags.at(-1), {
    id: 'tag:math', title: '数学', position: 0, createdAt: NOW, updatedAt: NOW, archivedAt: null,
  })
  const audit = await service.query({ type: 'audit.list', commandType: 'tag.create' })
  assert.equal(audit.receipts.length, 1)
  assert.equal(audit.events.length, 0)
  await assert.rejects(
    service.execute({ ...envelope, command: { type: 'tag.create', tagId: 'tag:other', title: '其他' } }),
    (error) => error instanceof DomainCommandError && error.code === 'IDEMPOTENCY_KEY_CONFLICT',
  )
  const beforeUndo = await service.query({ type: 'workspace.snapshot' })
  const undoPreview = await service.preview({
    protocolVersion: 1,
    idempotencyKey: 'undo-create-math',
    source: 'human-ui',
    expectedWorkspaceRevision: beforeUndo.revision,
    command: { type: 'undo.apply', token: first.undoToken! },
  })
  assert.deepEqual(undoPreview.changes, [{ entity: { type: 'tag', id: 'tag:math' }, operation: 'delete', fields: ['state'] }])
  await execute('undo-create-math', { type: 'undo.apply', token: first.undoToken! })
  assert.equal((await service.query({ type: 'workspace.snapshot' })).tags.some(({ id }) => id === 'tag:math'), false)
})

test('automatic tag ids stay private during preview and preview does not persist', async () => {
  const { service } = setup()
  const before = await service.query({ type: 'workspace.snapshot' })
  const preview = await service.preview({
    protocolVersion: 1,
    idempotencyKey: 'preview-auto-tag',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command: { type: 'tag.create', title: 'Previewed' },
  })
  assert.deepEqual(preview.affected, [{ type: 'tag', id: 'new' }])
  assert.deepEqual(preview.changes, [{ entity: { type: 'tag', id: 'new' }, operation: 'create', fields: ['tag'] }])
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('tag titles and explicit ids remain unambiguous while archived titles may be reused', async () => {
  const { service, execute } = setup()
  const state = await service.query({ type: 'workspace.snapshot' })
  const existingTaskId = state.tasks[0]!.id
  await execute('create-alpha', { type: 'tag.create', tagId: 'tag:alpha', title: 'Alpha' })
  await assert.rejects(
    execute('duplicate-alpha', { type: 'tag.create', tagId: 'tag:alpha-2', title: ' Alpha ' }),
    (error) => error instanceof DomainCommandError && error.code === 'TAG_ALREADY_EXISTS',
  )
  await assert.rejects(
    execute('colliding-id', { type: 'tag.create', tagId: existingTaskId, title: 'Collision' }),
    (error) => error instanceof DomainCommandError && error.code === 'TAG_ALREADY_EXISTS',
  )
  await execute('archive-alpha', { type: 'tag.archive', tagId: 'tag:alpha' })
  await execute('reuse-alpha', { type: 'tag.create', tagId: 'tag:alpha-2', title: 'Alpha' })
  assert.equal((await service.query({ type: 'workspace.snapshot' })).tags.filter(({ title }) => title === 'Alpha').length, 2)
})

test('tag rename and archive preserve identity and restore exactly through undo', async () => {
  const { service, execute } = setup()
  await execute('create-tag', { type: 'tag.create', tagId: 'tag:one', title: 'One' })
  const renamed = await execute('rename-tag', { type: 'tag.rename', tagId: 'tag:one', title: 'Two' })
  assert.equal((await service.query({ type: 'workspace.snapshot' })).tags[0]?.title, 'Two')
  await execute('undo-rename', { type: 'undo.apply', token: renamed.undoToken! })
  assert.equal((await service.query({ type: 'workspace.snapshot' })).tags[0]?.title, 'One')

  const archived = await execute('archive-tag', { type: 'tag.archive', tagId: 'tag:one' })
  assert.equal((await service.query({ type: 'workspace.snapshot' })).tags[0]?.archivedAt, NOW)
  await execute('undo-archive', { type: 'undo.apply', token: archived.undoToken! })
  const restored = (await service.query({ type: 'workspace.snapshot' })).tags[0]
  assert.equal(restored?.title, 'One')
  assert.equal(restored?.archivedAt, null)
  assert.equal(restored?.createdAt, NOW)
})

test('archiving a referenced tag preserves history without blocking unrelated task edits', async () => {
  const { service, execute } = setup()
  const initial = await service.query({ type: 'workspace.snapshot' })
  const [firstTask, secondTask] = initial.tasks
  assert.ok(firstTask && secondTask)
  await execute('create-history', { type: 'tag.create', tagId: 'tag:history', title: 'History' })
  await execute('attach-history', { type: 'task.update', taskId: firstTask.id, patch: { tagIds: ['tag:history'] } })
  await execute('archive-history', { type: 'tag.archive', tagId: 'tag:history' })
  assert.deepEqual((await service.query({ type: 'task.get', taskId: firstTask.id }))?.tagIds, ['tag:history'])
  await execute('edit-tagged-task', { type: 'task.update', taskId: firstTask.id, patch: { notes: 'kept' } })
  await execute('retain-archived-tag', { type: 'task.update', taskId: firstTask.id, patch: { tagIds: ['tag:history'] } })

  const beforeRejectedAttach = await service.query({ type: 'workspace.snapshot' })
  await assert.rejects(
    execute('attach-archived', { type: 'task.update', taskId: secondTask.id, patch: { tagIds: ['tag:history'] } }),
    (error) => error instanceof DomainCommandError && error.code === 'TAG_NOT_FOUND',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), beforeRejectedAttach)
})

test('a tag undo token becomes stale after any later workspace write', async () => {
  const { execute } = setup()
  const first = await execute('create-first', { type: 'tag.create', tagId: 'tag:first', title: 'First' })
  await execute('create-second', { type: 'tag.create', tagId: 'tag:second', title: 'Second' })
  await assert.rejects(
    execute('undo-stale-first', { type: 'undo.apply', token: first.undoToken! }),
    (error) => error instanceof DomainCommandError && error.code === 'UNDO_REVISION_CONFLICT',
  )
})
