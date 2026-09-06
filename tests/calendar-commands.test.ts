import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import { DomainCommandError, type CommandEnvelope } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createWorkspaceExport, parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'

const NOW = '2026-09-05T10:00:00.000Z'

function fixture(seed?: unknown) {
  let nextId = 0
  return createTaskCapabilityService(
    createInMemoryWorkspaceStore(seed),
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

async function createRecurringTask(service = fixture()) {
  await executeNext(service, 'create-recurring-task', {
    type: 'task.create',
    taskId: 'task:r',
    listId: 'list:system:learning',
    title: 'Recurring review',
  })
  await executeNext(service, 'create-recurring-series', {
    type: 'recurrence.create',
    taskId: 'task:r',
    expectedTaskRevision: 1,
    seriesId: 'series:1',
    cadence: { kind: 'daily', interval: 1 },
    basis: 'fixed_schedule',
    anchorAt: '2026-09-05T09:00:00+08:00',
    end: { kind: 'after', count: 3 },
    timezone: 'Asia/Shanghai',
  })
  return service
}

test('moving an occurrence defaults to an override and undo restores it', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })
  const originalSeries = before.recurrenceSeries.find(({ id }) => id === 'series:1')!
  const originalOccurrence = before.occurrences.find(({ id }) => id === 'occurrence:series:1:2')!
  const originalOther = before.occurrences.find(({ id }) => id === 'occurrence:series:1:3')!

  const moved = await executeNext(service, 'move-occurrence', {
    type: 'calendar.move',
    taskId: 'task:r',
    occurrenceId: 'occurrence:series:1:2',
    startAt: '2026-09-06T10:00:00+08:00',
  } as CommandEnvelope['command'])
  const afterMove = await service.query({ type: 'workspace.snapshot' })
  const movedOccurrence = afterMove.occurrences.find(({ id }) => id === 'occurrence:series:1:2')

  assert.deepEqual(movedOccurrence?.override, {
    scheduledAt: '2026-09-06T10:00:00+08:00',
    scheduledOn: null,
    estimateMinutes: null,
  })
  assert.deepEqual(afterMove.recurrenceSeries.find(({ id }) => id === 'series:1'), originalSeries)
  assert.deepEqual(afterMove.occurrences.find(({ id }) => id === 'occurrence:series:1:3'), originalOther)

  await executeNext(service, 'undo-occurrence-move', { type: 'undo.apply', token: moved.undoToken! })
  const afterUndo = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(afterUndo.occurrences.find(({ id }) => id === 'occurrence:series:1:2'), originalOccurrence)
})

test('moving a task converts between timed and all-day schedules', async () => {
  const service = fixture()
  await executeNext(service, 'create-movable-task', {
    type: 'task.create',
    taskId: 'task:move',
    listId: 'list:system:learning',
    title: 'Move me',
    startAt: '2026-09-05T09:00:00+08:00',
    estimateMinutes: 30,
  })

  await executeNext(service, 'move-task-to-all-day', {
    type: 'calendar.move',
    taskId: 'task:move',
    startOn: '2026-09-06',
  } as CommandEnvelope['command'])
  assert.deepEqual(
    (await service.query({ type: 'task.get', taskId: 'task:move' }))?.schedule,
    { startAt: null, startOn: '2026-09-06', estimateMinutes: 30 },
  )

  await executeNext(service, 'move-task-to-time', {
    type: 'calendar.move',
    taskId: 'task:move',
    startAt: '2026-09-06T10:00:00+08:00',
  } as CommandEnvelope['command'])
  assert.deepEqual(
    (await service.query({ type: 'task.get', taskId: 'task:move' }))?.schedule,
    { startAt: '2026-09-06T10:00:00+08:00', startOn: null, estimateMinutes: 30 },
  )
})

test('resizing a task accepts five-minute boundaries and rejects invalid durations without saving', async () => {
  const service = fixture()
  await executeNext(service, 'create-resizable-task', {
    type: 'task.create',
    taskId: 'task:resize',
    listId: 'list:system:learning',
    title: 'Resize me',
    startAt: '2026-09-05T09:00:00+08:00',
    estimateMinutes: 30,
  })

  for (const estimateMinutes of [5, 1440]) {
    await executeNext(service, `resize-task-${estimateMinutes}`, {
      type: 'calendar.resize',
      taskId: 'task:resize',
      estimateMinutes,
    } as CommandEnvelope['command'])
    assert.equal(
      (await service.query({ type: 'task.get', taskId: 'task:resize' }))?.schedule.estimateMinutes,
      estimateMinutes,
    )
  }

  for (const estimateMinutes of [0, 4, 6, 1445, 7.5]) {
    const before = await service.query({ type: 'workspace.snapshot' })
    await assert.rejects(
      executeNext(service, `reject-resize-${estimateMinutes}`, {
        type: 'calendar.resize',
        taskId: 'task:resize',
        estimateMinutes,
      } as CommandEnvelope['command']),
      (error) => error instanceof Error && error.message.startsWith('[VALIDATION_ERROR]'),
    )
    assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
  }
})

test('occurrence moves preserve schedule kind through reload and export/import in two timezones', async (context) => {
  const scenarios = [
    {
      label: 'Asia/Shanghai timed to all-day',
      timezone: 'Asia/Shanghai',
      anchorAt: '2026-09-05T09:00:00+08:00',
      anchorOn: undefined,
      move: { startOn: '2026-09-06' },
      expected: { scheduledAt: null, scheduledOn: '2026-09-06', estimateMinutes: 30 },
    },
    {
      label: 'America/Los_Angeles all-day to timed',
      timezone: 'America/Los_Angeles',
      anchorAt: undefined,
      anchorOn: '2026-09-05',
      move: { startAt: '2026-09-06T10:00:00-07:00' },
      expected: { scheduledAt: '2026-09-06T10:00:00-07:00', scheduledOn: null, estimateMinutes: 30 },
    },
  ] as const

  for (const scenario of scenarios) {
    await context.test(scenario.label, async () => {
      const service = fixture()
      await executeNext(service, `create-${scenario.timezone}-task`, {
        type: 'task.create', taskId: 'task:zone', listId: 'list:system:learning', title: scenario.label,
        estimateMinutes: 30,
      })
      await executeNext(service, `create-${scenario.timezone}-series`, {
        type: 'recurrence.create', taskId: 'task:zone', expectedTaskRevision: 1, seriesId: 'series:zone',
        cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule',
        ...(scenario.anchorAt === undefined ? { anchorOn: scenario.anchorOn } : { anchorAt: scenario.anchorAt }),
        end: { kind: 'after', count: 3 }, timezone: scenario.timezone,
      })
      await executeNext(service, `move-${scenario.timezone}-occurrence`, {
        type: 'calendar.move', taskId: 'task:zone', occurrenceId: 'occurrence:series:zone:2',
        scope: 'occurrence', ...scenario.move,
      } as CommandEnvelope['command'])
      const moved = await service.query({ type: 'workspace.snapshot' })

      for (const persisted of [
        await fixture(moved).query({ type: 'workspace.snapshot' }),
        parseWorkspaceExport(JSON.stringify(createWorkspaceExport(moved, NOW))).state,
      ]) {
        const occurrence = persisted.occurrences.find(({ id }) => id === 'occurrence:series:zone:2')
        assert.deepEqual(occurrence?.override, scenario.expected)
        assert.deepEqual(
          { scheduledAt: occurrence?.scheduledAt, scheduledOn: occurrence?.scheduledOn },
          { scheduledAt: scenario.expected.scheduledAt, scheduledOn: scenario.expected.scheduledOn },
        )
      }
    })
  }
})

test('calendar move requires exactly one target slot and does not save invalid shapes', async () => {
  const service = fixture()
  await executeNext(service, 'create-move-validation-task', {
    type: 'task.create', taskId: 'task:validate-move', listId: 'list:system:learning', title: 'Validate move',
    startOn: '2026-09-05',
  })

  const commands = [
    { type: 'calendar.move', taskId: 'task:validate-move' },
    {
      type: 'calendar.move', taskId: 'task:validate-move',
      startAt: '2026-09-06T09:00:00+08:00', startOn: '2026-09-06',
    },
  ] as const
  for (const [index, command] of commands.entries()) {
    const before = await service.query({ type: 'workspace.snapshot' })
    await assert.rejects(
      executeNext(service, `reject-move-shape-${index}`, command as CommandEnvelope['command']),
      (error) => error instanceof Error && error.message.startsWith('[VALIDATION_ERROR]'),
    )
    assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
  }
})

test('resizing an occurrence defaults to its override and undo leaves the series unchanged', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })
  const originalSeries = before.recurrenceSeries.find(({ id }) => id === 'series:1')!
  const originalOccurrence = before.occurrences.find(({ id }) => id === 'occurrence:series:1:2')!
  const originalOther = before.occurrences.find(({ id }) => id === 'occurrence:series:1:3')!

  const resized = await executeNext(service, 'resize-occurrence', {
    type: 'calendar.resize', taskId: 'task:r', occurrenceId: 'occurrence:series:1:2', estimateMinutes: 60,
  } as CommandEnvelope['command'])
  const afterResize = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(afterResize.occurrences.find(({ id }) => id === 'occurrence:series:1:2')?.override, {
    scheduledAt: originalOccurrence.scheduledAt, scheduledOn: originalOccurrence.scheduledOn, estimateMinutes: 60,
  })
  assert.deepEqual(afterResize.recurrenceSeries.find(({ id }) => id === 'series:1'), originalSeries)
  assert.deepEqual(afterResize.occurrences.find(({ id }) => id === 'occurrence:series:1:3'), originalOther)

  await executeNext(service, 'undo-occurrence-resize', { type: 'undo.apply', token: resized.undoToken! })
  const afterUndo = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(afterUndo.occurrences.find(({ id }) => id === 'occurrence:series:1:2'), originalOccurrence)
})

test('calendar commands do not persist a draft when workspace CAS save fails', async () => {
  const seedService = fixture()
  await executeNext(seedService, 'create-cas-calendar-task', {
    type: 'task.create', taskId: 'task:cas-calendar', listId: 'list:system:learning', title: 'CAS calendar',
    startOn: '2026-09-05',
  })
  const persisted = createInMemoryWorkspaceStore(await seedService.query({ type: 'workspace.snapshot' }))
  let attemptedStartAt: string | null | undefined
  const service = createTaskCapabilityService({
    load: () => persisted.load(),
    async save(state) {
      attemptedStartAt = state.tasks.find(({ id }) => id === 'task:cas-calendar')?.schedule.startAt
      throw new Error('simulated workspace CAS conflict')
    },
  }, () => NOW, (kind) => `${kind}-cas`)
  const before = await service.query({ type: 'workspace.snapshot' })

  await assert.rejects(
    executeNext(service, 'move-with-save-conflict', {
      type: 'calendar.move', taskId: 'task:cas-calendar', startAt: '2026-09-06T09:00:00+08:00',
    } as CommandEnvelope['command']),
    (error) => error instanceof DomainCommandError && error.code === 'WORKSPACE_SAVE_CONFLICT',
  )
  assert.equal(attemptedStartAt, '2026-09-06T09:00:00+08:00')
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('moving a recurrence series requires explicit preview confirmation and remains undoable', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })
  const command = {
    type: 'calendar.move', taskId: 'task:r', occurrenceId: 'occurrence:series:1:1',
    startAt: '2026-09-07T09:00:00+08:00', scope: 'series',
  } as CommandEnvelope['command']
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'move-calendar-series',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command,
  }

  await assert.rejects(
    service.execute(envelope),
    (error) => error instanceof DomainCommandError && error.code === 'VALIDATION_ERROR',
  )
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)

  const preview = await service.preview(envelope)
  assert.equal(preview.accepted, true)
  assert.equal(preview.confirmation, 'explicit')
  const moved = await service.execute({
    ...envelope,
    explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
  })
  const afterMove = await service.query({ type: 'workspace.snapshot' })
  assert.equal(afterMove.recurrenceSeries.find(({ id }) => id === 'series:1')?.anchorAt, '2026-09-07T09:00:00+08:00')

  await executeNext(service, 'undo-calendar-series-move', { type: 'undo.apply', token: moved.undoToken! })
  const afterUndo = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(afterUndo.recurrenceSeries.find(({ id }) => id === 'series:1'), before.recurrenceSeries.find(({ id }) => id === 'series:1'))
})

test('resizing a recurrence series changes its inherited duration without rewriting occurrences', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })
  const command = {
    type: 'calendar.resize', taskId: 'task:r', occurrenceId: 'occurrence:series:1:1',
    estimateMinutes: 45, scope: 'series',
  } as CommandEnvelope['command']
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'resize-calendar-series',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command,
  }
  const preview = await service.preview(envelope)
  assert.equal(preview.accepted, true)
  assert.equal(preview.confirmation, 'explicit')

  const resized = await service.execute({
    ...envelope,
    explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
  })
  const afterResize = await service.query({ type: 'workspace.snapshot' })
  assert.equal(afterResize.tasks.find(({ id }) => id === 'task:r')?.schedule.estimateMinutes, 45)
  assert.deepEqual(afterResize.recurrenceSeries, before.recurrenceSeries)
  assert.deepEqual(afterResize.occurrences, before.occurrences)

  await executeNext(service, 'undo-calendar-series-resize', { type: 'undo.apply', token: resized.undoToken! })
  assert.equal((await service.query({ type: 'task.get', taskId: 'task:r' }))?.schedule.estimateMinutes, null)
})

test('calendar scope must match task or occurrence targets', async () => {
  const service = await createRecurringTask()
  await executeNext(service, 'create-scope-task', {
    type: 'task.create', taskId: 'task:scope', listId: 'list:system:learning', title: 'Scope target',
    startOn: '2026-09-05',
  })
  const commands = [
    {
      type: 'calendar.move', taskId: 'task:scope', startOn: '2026-09-06', scope: 'occurrence',
    },
    {
      type: 'calendar.move', taskId: 'task:r', occurrenceId: 'occurrence:series:1:1',
      startOn: '2026-09-06', scope: 'task',
    },
  ] as const

  for (const [index, command] of commands.entries()) {
    const before = await service.query({ type: 'workspace.snapshot' })
    await assert.rejects(
      executeNext(service, `reject-scope-target-${index}`, command as CommandEnvelope['command']),
      (error) => error instanceof DomainCommandError && error.code === 'VALIDATION_ERROR',
    )
    assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
  }
})
