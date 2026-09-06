import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import { DomainCommandError, type CommandEnvelope } from '../src/domain/capabilities/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createWorkspaceExport, parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'
import { projectCalendarItems } from '../src/domain/calendar/project.ts'
import {
  calendarKeyboardCommand,
  calendarMenuMoveCommand,
  calendarPointerMovePreview,
  calendarCommandForPreview,
} from '../src/components/calendar/use-calendar-drag.ts'

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

test('pointer, menu, and keyboard timed writes round-trip an explicit offset wall clock', async () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const service = fixture()
    for (const [taskId, start] of [
      ['task:pointer', { startOn: '2026-09-05' }],
      ['task:menu', { startAt: '2026-09-05T09:00:00+08:00', estimateMinutes: 30 }],
      ['task:keyboard', { startAt: '2026-09-05T09:00:00+08:00', estimateMinutes: 30 }],
    ] as const) {
      await executeNext(service, `create-${taskId}`, {
        type: 'task.create', taskId, listId: 'list:system:learning', title: taskId, ...start,
      })
    }
    const snapshot = await service.query({ type: 'workspace.snapshot' })
    const projected = projectCalendarItems(snapshot, { start: '2026-09-05', end: '2026-09-08' })
    const pointerItem = projected.find(({ taskId }) => taskId === 'task:pointer')!
    const menuItem = projected.find(({ taskId }) => taskId === 'task:menu')!
    const keyboardItem = projected.find(({ taskId }) => taskId === 'task:keyboard')!
    const clock = { kind: 'offset', offset: '+08:00' } as const

    const pointerPreview = calendarPointerMovePreview(pointerItem, '2026-09-06', 9 * 60 + 45, 30, clock)
    await executeNext(service, 'pointer-move', calendarCommandForPreview(pointerItem, 'move', pointerPreview, true))
    await executeNext(service, 'menu-move', calendarMenuMoveCommand(menuItem, '2026-09-06', 10 * 60 + 15, 30, clock))
    await executeNext(service, 'keyboard-move', calendarKeyboardCommand(keyboardItem, 'ArrowDown', false, clock)!)

    const taskIds = new Set(['task:pointer', 'task:menu', 'task:keyboard'])
    const persisted = await service.query({ type: 'workspace.snapshot' })
    assert.deepEqual(persisted.tasks.filter(({ id }) => taskIds.has(id)).map(({ id, schedule }) => [id, schedule.startAt]), [
      ['task:pointer', '2026-09-06T09:45:00+08:00'],
      ['task:menu', '2026-09-06T10:15:00+08:00'],
      ['task:keyboard', '2026-09-05T09:15:00+08:00'],
    ])
    const refreshed = projectCalendarItems(persisted, { start: '2026-09-05', end: '2026-09-08' })
    assert.deepEqual(refreshed.filter(({ taskId }) => taskIds.has(taskId)).map(({ taskId, displayDate, displayMinute }) => [taskId, displayDate, displayMinute]), [
      ['task:keyboard', '2026-09-05', 9 * 60 + 15],
      ['task:pointer', '2026-09-06', 9 * 60 + 45],
      ['task:menu', '2026-09-06', 10 * 60 + 15],
    ])
    assert.deepEqual({ date: pointerPreview.displayDate, minute: pointerPreview.displayMinute }, { date: '2026-09-06', minute: 9 * 60 + 45 })
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})

test('pointer, menu, and keyboard occurrence writes round-trip the series timezone off-device', async () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'Asia/Shanghai'
  try {
    const service = fixture()
    await executeNext(service, 'create-la-task', {
      type: 'task.create', taskId: 'task:la', listId: 'list:system:learning', title: 'LA series', estimateMinutes: 30,
    })
    await executeNext(service, 'create-la-series', {
      type: 'recurrence.create', taskId: 'task:la', expectedTaskRevision: 1, seriesId: 'series:la',
      cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorAt: '2026-09-05T09:00:00-07:00',
      end: { kind: 'after', count: 3 }, timezone: 'America/Los_Angeles',
    })
    const clock = { kind: 'timezone', timezone: 'America/Los_Angeles' } as const
    const before = projectCalendarItems(await service.query({ type: 'workspace.snapshot' }), { start: '2026-09-05', end: '2026-09-09' })
    const pointerItem = before.find(({ occurrenceId }) => occurrenceId === 'occurrence:series:la:1')!
    const menuItem = before.find(({ occurrenceId }) => occurrenceId === 'occurrence:series:la:2')!
    const keyboardItem = before.find(({ occurrenceId }) => occurrenceId === 'occurrence:series:la:3')!

    const pointerPreview = calendarPointerMovePreview(pointerItem, '2026-09-05', 10 * 60 + 30, 30, clock)
    await executeNext(service, 'pointer-la', calendarCommandForPreview(pointerItem, 'move', pointerPreview))
    await executeNext(service, 'menu-la', calendarMenuMoveCommand(menuItem, '2026-09-06', 11 * 60 + 15, 30, clock))
    await executeNext(service, 'keyboard-la', calendarKeyboardCommand(keyboardItem, 'ArrowDown', false, clock)!)

    const persisted = await service.query({ type: 'workspace.snapshot' })
    assert.deepEqual(persisted.occurrences.filter(({ seriesId }) => seriesId === 'series:la').map(({ id, override }) => [id, override?.scheduledAt]), [
      ['occurrence:series:la:1', '2026-09-05T17:30:00.000Z'],
      ['occurrence:series:la:2', '2026-09-06T18:15:00.000Z'],
      ['occurrence:series:la:3', '2026-09-07T16:15:00.000Z'],
    ])
    const refreshed = projectCalendarItems(persisted, { start: '2026-09-05', end: '2026-09-09' })
    assert.deepEqual(refreshed.filter(({ taskId }) => taskId === 'task:la').map(({ occurrenceId, displayDate, displayMinute }) => [occurrenceId, displayDate, displayMinute]), [
      ['occurrence:series:la:1', '2026-09-05', 10 * 60 + 30],
      ['occurrence:series:la:2', '2026-09-06', 11 * 60 + 15],
      ['occurrence:series:la:3', '2026-09-07', 9 * 60 + 15],
    ])
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})

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

test('timed placement atomically stores start and duration while existing moves preserve duration', async () => {
  const service = fixture()
  await executeNext(service, 'create-unscheduled-task', {
    type: 'task.create', taskId: 'task:drop', listId: 'list:system:learning', title: 'Drop me',
  })
  const before = await service.query({ type: 'workspace.snapshot' })

  await executeNext(service, 'drop-task-with-duration', {
    type: 'calendar.move', taskId: 'task:drop', startAt: '2026-09-06T10:15:00+08:00',
    estimateMinutes: 30, scope: 'task',
  } as CommandEnvelope['command'])
  const after = await service.query({ type: 'workspace.snapshot' })
  assert.equal(after.revision, before.revision + 1)
  assert.deepEqual(after.tasks.find(({ id }) => id === 'task:drop')?.schedule, {
    startAt: '2026-09-06T10:15:00+08:00', startOn: null, estimateMinutes: 30,
  })

  await executeNext(service, 'move-existing-without-duration', {
    type: 'calendar.move', taskId: 'task:drop', startAt: '2026-09-06T11:00:00+08:00', scope: 'task',
  } as CommandEnvelope['command'])
  assert.equal((await service.query({ type: 'task.get', taskId: 'task:drop' }))?.schedule.estimateMinutes, 30)
})

test('all-day task with no estimate becomes a projected timed item and undo restores it', async () => {
  const service = fixture()
  await executeNext(service, 'create-date-only-null-duration', {
    type: 'task.create', taskId: 'task:date-only', listId: 'list:system:learning', title: 'Date only', startOn: '2026-09-06',
  })
  const before = await service.query({ type: 'workspace.snapshot' })
  const originalSchedule = before.tasks.find(({ id }) => id === 'task:date-only')?.schedule
  const moved = await executeNext(service, 'time-date-only-atomically', {
    type: 'calendar.move', taskId: 'task:date-only', startAt: '2026-09-06T10:00:00+08:00', estimateMinutes: 30,
  } as CommandEnvelope['command'])
  const after = await service.query({ type: 'workspace.snapshot' })
  assert.equal(projectCalendarItems(after, { start: '2026-09-06', end: '2026-09-07' }).find(({ taskId }) => taskId === 'task:date-only')?.kind, 'timed')
  await executeNext(service, 'undo-time-date-only', { type: 'undo.apply', token: moved.undoToken! })
  const restored = await service.query({ type: 'workspace.snapshot' })
  assert.deepEqual(restored.tasks.find(({ id }) => id === 'task:date-only')?.schedule, originalSchedule)
  assert.equal(projectCalendarItems(restored, { start: '2026-09-06', end: '2026-09-07' }).find(({ taskId }) => taskId === 'task:date-only')?.kind, 'all-day')
})

test('date-only occurrence with no estimate becomes a projected timed item and undo restores it', async () => {
  const service = fixture()
  await executeNext(service, 'create-date-series-task', {
    type: 'task.create', taskId: 'task:date-series', listId: 'list:system:learning', title: 'Date series',
  })
  await executeNext(service, 'create-date-series', {
    type: 'recurrence.create', taskId: 'task:date-series', expectedTaskRevision: 1, seriesId: 'series:date',
    cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', anchorOn: '2026-09-05',
    end: { kind: 'after', count: 3 }, timezone: 'Asia/Shanghai',
  })
  const before = await service.query({ type: 'workspace.snapshot' })
  const occurrenceId = 'occurrence:series:date:2'
  const originalOccurrence = before.occurrences.find(({ id }) => id === occurrenceId)
  const moved = await executeNext(service, 'time-date-occurrence-atomically', {
    type: 'calendar.move', taskId: 'task:date-series', occurrenceId, scope: 'occurrence',
    startAt: '2026-09-06T10:00:00+08:00', estimateMinutes: 45,
  } as CommandEnvelope['command'])
  const after = await service.query({ type: 'workspace.snapshot' })
  const projected = projectCalendarItems(after, { start: '2026-09-05', end: '2026-09-08' }).find(({ occurrenceId: id }) => id === occurrenceId)
  assert.deepEqual({ kind: projected?.kind, minutes: projected && projected.end ? (Date.parse(projected.end) - Date.parse(projected.start)) / 60_000 : null }, { kind: 'timed', minutes: 45 })
  await executeNext(service, 'undo-time-date-occurrence', { type: 'undo.apply', token: moved.undoToken! })
  assert.deepEqual((await service.query({ type: 'workspace.snapshot' })).occurrences.find(({ id }) => id === occurrenceId), originalOccurrence)
})

test('atomic timed placement rejects invalid or date-only duration without saving', async () => {
  const service = fixture()
  await executeNext(service, 'create-invalid-placement-task', {
    type: 'task.create', taskId: 'task:invalid-drop', listId: 'list:system:learning', title: 'Invalid drop',
  })
  for (const command of [
    { type: 'calendar.move', taskId: 'task:invalid-drop', startAt: '2026-09-06T10:00:00+08:00', estimateMinutes: 31 },
    { type: 'calendar.move', taskId: 'task:invalid-drop', startOn: '2026-09-06', estimateMinutes: 30 },
  ] as const) {
    const before = await service.query({ type: 'workspace.snapshot' })
    await assert.rejects(
      executeNext(service, `reject-placement-${command.startAt ?? command.startOn}`, command as CommandEnvelope['command']),
      (error) => error instanceof DomainCommandError && error.code === 'VALIDATION_ERROR',
    )
    assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
  }
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

  const snapshot = await service.query({ type: 'workspace.snapshot' })
  const preview = await service.preview({
    protocolVersion: 1,
    idempotencyKey: 'preview-single-resize',
    source: 'human-ui',
    expectedWorkspaceRevision: snapshot.revision,
    command: { type: 'calendar.resize', taskId: 'task:resize', estimateMinutes: 35, scope: 'single' },
  })
  assert.equal(preview.accepted, true)
  assert.deepEqual(preview.descriptor, {
    type: 'calendar.resize', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false,
  })
  assert.equal(preview.confirmation, 'none')

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
      const before = await service.query({ type: 'workspace.snapshot' })
      const movedResult = await executeNext(service, `move-${scenario.timezone}-occurrence`, {
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

      await executeNext(service, `undo-${scenario.timezone}-occurrence`, {
        type: 'undo.apply', token: movedResult.undoToken!,
      })
      const afterUndo = await service.query({ type: 'workspace.snapshot' })
      assert.deepEqual(afterUndo.recurrenceSeries, before.recurrenceSeries)
      assert.deepEqual(afterUndo.occurrences, before.occurrences)
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

test('calendar commands do not persist move or resize drafts when workspace CAS save fails', async (context) => {
  const scenarios = [
    {
      label: 'move',
      command: { type: 'calendar.move', taskId: 'task:cas-calendar', startAt: '2026-09-06T09:00:00+08:00' },
      attempted: { startAt: '2026-09-06T09:00:00+08:00', estimateMinutes: 30 },
    },
    {
      label: 'resize',
      command: { type: 'calendar.resize', taskId: 'task:cas-calendar', estimateMinutes: 45 },
      attempted: { startAt: null, estimateMinutes: 45 },
    },
  ] as const

  for (const scenario of scenarios) {
    await context.test(scenario.label, async () => {
      const seedService = fixture()
      await executeNext(seedService, `create-cas-calendar-task-${scenario.label}`, {
        type: 'task.create', taskId: 'task:cas-calendar', listId: 'list:system:learning', title: 'CAS calendar',
        startOn: '2026-09-05', estimateMinutes: 30,
      })
      const persisted = createInMemoryWorkspaceStore(await seedService.query({ type: 'workspace.snapshot' }))
      let attempted: { startAt: string | null; estimateMinutes: number | null } | undefined
      const service = createTaskCapabilityService({
        load: () => persisted.load(),
        async save(state) {
          const schedule = state.tasks.find(({ id }) => id === 'task:cas-calendar')!.schedule
          attempted = { startAt: schedule.startAt, estimateMinutes: schedule.estimateMinutes }
          throw new Error('simulated workspace CAS conflict')
        },
      }, () => NOW, (kind) => `${kind}-cas`)
      const before = await service.query({ type: 'workspace.snapshot' })

      await assert.rejects(
        executeNext(service, `${scenario.label}-with-save-conflict`, scenario.command as CommandEnvelope['command']),
        (error) => error instanceof DomainCommandError && error.code === 'WORKSPACE_SAVE_CONFLICT',
      )
      assert.deepEqual(attempted, scenario.attempted)
      assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
    })
  }
})

test('moving future occurrences requires confirmation and undo restores the unsplit series', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    idempotencyKey: 'move-calendar-future',
    source: 'human-ui',
    expectedWorkspaceRevision: before.revision,
    command: {
      type: 'calendar.move', taskId: 'task:r', occurrenceId: 'occurrence:series:1:2',
      scope: 'future', startAt: '2026-09-10T11:30:00+08:00',
    },
  }

  await assert.rejects(
    service.execute(envelope),
    (error) => error instanceof DomainCommandError && error.code === 'VALIDATION_ERROR',
  )
  assert.deepEqual((await service.query({ type: 'workspace.snapshot' })).recurrenceSeries, before.recurrenceSeries)
  const preview = await service.preview(envelope)
  assert.equal(preview.accepted, true)
  assert.equal(preview.confirmation, 'explicit')
  const moved = await service.execute({
    ...envelope,
    explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: NOW },
  })
  const afterMove = await service.query({ type: 'workspace.snapshot' })
  assert.equal(afterMove.tasks.find(({ id }) => id === 'task:r')?.recurrenceSeriesId, 'series:1:split:2')
  assert.deepEqual(
    afterMove.occurrences.find(({ id }) => id === 'occurrence:series:1:split:2:1'),
    {
      id: 'occurrence:series:1:split:2:1', seriesId: 'series:1:split:2', ordinal: 1,
      scheduledAt: '2026-09-10T11:30:00+08:00', scheduledOn: null, status: 'pending',
      override: null, completedAt: null, revision: 1,
    },
  )

  await executeNext(service, 'undo-calendar-future-move', { type: 'undo.apply', token: moved.undoToken! })
  const afterUndo = await service.query({ type: 'workspace.snapshot' })
  assert.equal(afterUndo.tasks.find(({ id }) => id === 'task:r')?.recurrenceSeriesId, 'series:1')
  assert.deepEqual(afterUndo.recurrenceSeries, before.recurrenceSeries)
  assert.deepEqual(afterUndo.occurrences, before.occurrences)
})

test('moving a non-first recurrence occurrence shifts the series so the selected slot lands exactly', async (context) => {
  const scenarios = [
    {
      label: 'timed across America/Los_Angeles DST',
      timezone: 'America/Los_Angeles',
      anchor: { anchorAt: '2026-10-31T09:00:00-07:00' },
      cadence: { kind: 'daily', interval: 1 },
      occurrenceId: 'occurrence:series:move:2',
      move: { startAt: '2026-11-02T10:30:00-08:00' },
      expectedAnchor: { anchorAt: '2026-11-01T18:30:00.000Z', anchorOn: null },
      expectedCadence: { kind: 'daily', interval: 1 },
      expectedSelected: { scheduledAt: '2026-11-02T18:30:00.000Z', scheduledOn: null },
    },
    {
      label: 'date-only',
      timezone: 'Asia/Shanghai',
      anchor: { anchorOn: '2026-09-05' },
      cadence: { kind: 'weekly', interval: 1, weekdays: [1, 3] },
      occurrenceId: 'occurrence:series:move:3',
      move: { startOn: '2026-09-18' },
      expectedAnchor: { anchorAt: null, anchorOn: '2026-09-09' },
      expectedCadence: { kind: 'weekly', interval: 1, weekdays: [0, 5] },
      expectedSelected: { scheduledAt: null, scheduledOn: '2026-09-18' },
    },
  ] as const

  for (const [index, scenario] of scenarios.entries()) {
    await context.test(scenario.label, async () => {
      const service = fixture()
      await executeNext(service, `create-series-move-task-${index}`, {
        type: 'task.create', taskId: 'task:series-move', listId: 'list:system:learning',
        title: scenario.label, estimateMinutes: 30,
      })
      await executeNext(service, `create-series-move-series-${index}`, {
        type: 'recurrence.create', taskId: 'task:series-move', expectedTaskRevision: 1,
        seriesId: 'series:move', cadence: scenario.cadence, basis: 'fixed_schedule',
        ...scenario.anchor, end: { kind: 'after', count: 3 }, timezone: scenario.timezone,
      })
      const before = await service.query({ type: 'workspace.snapshot' })
      const envelope: CommandEnvelope = {
        protocolVersion: 1,
        idempotencyKey: `move-calendar-series-${index}`,
        source: 'human-ui',
        expectedWorkspaceRevision: before.revision,
        command: {
          type: 'calendar.move', taskId: 'task:series-move', occurrenceId: scenario.occurrenceId,
          scope: 'series', ...scenario.move,
        } as CommandEnvelope['command'],
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
      const series = afterMove.recurrenceSeries.find(({ id }) => id === 'series:move')
      const selected = afterMove.occurrences.find(({ id }) => id === scenario.occurrenceId)
      assert.deepEqual({ anchorAt: series?.anchorAt, anchorOn: series?.anchorOn }, scenario.expectedAnchor)
      assert.deepEqual(series?.cadence, scenario.expectedCadence)
      assert.deepEqual(
        { scheduledAt: selected?.scheduledAt, scheduledOn: selected?.scheduledOn },
        scenario.expectedSelected,
      )

      await executeNext(service, `undo-calendar-series-move-${index}`, { type: 'undo.apply', token: moved.undoToken! })
      const afterUndo = await service.query({ type: 'workspace.snapshot' })
      assert.deepEqual(afterUndo.recurrenceSeries, before.recurrenceSeries)
      assert.deepEqual(afterUndo.occurrences, before.occurrences)
    })
  }
})

test('moving an after-completion series relocates its pending occurrence and preserves successor cadence', async (context) => {
  const scenarios = [
    {
      label: 'timed across America/Los_Angeles DST',
      timezone: 'America/Los_Angeles',
      initialNow: '2026-10-31T16:00:00.000Z',
      anchor: { anchorAt: '2026-10-31T09:00:00-07:00' },
      cadence: { kind: 'daily', interval: 1 },
      move: { startAt: '2026-11-02T10:30:00-08:00' },
      expectedTarget: { scheduledAt: '2026-11-02T10:30:00-08:00', scheduledOn: null },
      completedAt: '2026-11-02T18:30:00.000Z',
      expectedSuccessor: { scheduledAt: '2026-11-03T18:30:00.000Z', scheduledOn: null },
    },
    {
      label: 'date-only weekly',
      timezone: 'Asia/Shanghai',
      initialNow: '2026-09-05T10:00:00.000Z',
      anchor: { anchorOn: '2026-09-05' },
      cadence: { kind: 'weekly', interval: 1, weekdays: [1, 3] },
      move: { startOn: '2026-09-18' },
      expectedTarget: { scheduledAt: null, scheduledOn: '2026-09-18' },
      completedAt: '2026-09-18T04:00:00.000Z',
      expectedSuccessor: { scheduledAt: null, scheduledOn: '2026-09-28' },
    },
  ] as const

  for (const [index, scenario] of scenarios.entries()) {
    await context.test(scenario.label, async () => {
      let nextId = 0
      const service = createTaskCapabilityService(
        createInMemoryWorkspaceStore(),
        () => scenario.initialNow,
        (kind) => `${kind}-after-${index}-${++nextId}`,
      )
      await executeNext(service, `create-after-task-${index}`, {
        type: 'task.create', taskId: 'task:after-move', listId: 'list:system:learning', title: scenario.label,
      })
      await executeNext(service, `create-after-series-${index}`, {
        type: 'recurrence.create', taskId: 'task:after-move', expectedTaskRevision: 1,
        seriesId: 'series:after-move', cadence: scenario.cadence, basis: 'after_completion',
        ...scenario.anchor, end: { kind: 'never' }, timezone: scenario.timezone,
      })
      await executeNext(service, `complete-after-first-${index}`, {
        type: 'recurrence.complete', occurrenceId: 'occurrence:series:after-move:1',
      })
      const before = await service.query({ type: 'workspace.snapshot' })
      const envelope: CommandEnvelope = {
        protocolVersion: 1,
        idempotencyKey: `move-after-series-${index}`,
        source: 'human-ui',
        expectedWorkspaceRevision: before.revision,
        command: {
          type: 'calendar.move', taskId: 'task:after-move', occurrenceId: 'occurrence:series:after-move:2',
          scope: 'series', ...scenario.move,
        } as CommandEnvelope['command'],
      }

      await assert.rejects(
        service.execute(envelope),
        (error) => error instanceof DomainCommandError && error.code === 'VALIDATION_ERROR',
      )
      const preview = await service.preview(envelope)
      assert.equal(preview.accepted, true)
      assert.equal(preview.confirmation, 'explicit')
      const moved = await service.execute({
        ...envelope,
        explicitConfirmation: { previewReceiptId: preview.previewReceiptId!, confirmedAt: scenario.initialNow },
      })
      const afterMove = await service.query({ type: 'workspace.snapshot' })
      const series = afterMove.recurrenceSeries.find(({ id }) => id === 'series:after-move')
      const selected = afterMove.occurrences.find(({ id }) => id === 'occurrence:series:after-move:2')
      assert.deepEqual(series?.cadence, scenario.cadence)
      assert.deepEqual(
        { scheduledAt: selected?.scheduledAt, scheduledOn: selected?.scheduledOn },
        scenario.expectedTarget,
      )

      const continuing = createTaskCapabilityService(
        createInMemoryWorkspaceStore(afterMove),
        () => scenario.completedAt,
        (kind) => `${kind}-after-continue-${index}`,
      )
      await executeNext(continuing, `complete-moved-after-${index}`, {
        type: 'recurrence.complete', occurrenceId: 'occurrence:series:after-move:2',
      })
      const afterCompletion = await continuing.query({ type: 'workspace.snapshot' })
      const successor = afterCompletion.occurrences.find(({ id }) => id === 'occurrence:series:after-move:3')
      assert.deepEqual(
        { scheduledAt: successor?.scheduledAt, scheduledOn: successor?.scheduledOn },
        scenario.expectedSuccessor,
      )

      await executeNext(service, `undo-after-series-move-${index}`, { type: 'undo.apply', token: moved.undoToken! })
      const afterUndo = await service.query({ type: 'workspace.snapshot' })
      assert.deepEqual(afterUndo.recurrenceSeries, before.recurrenceSeries)
      assert.deepEqual(afterUndo.occurrences, before.occurrences)
    })
  }
})

test('calendar resize rejects unsupported future and series scopes without saving', async () => {
  const service = await createRecurringTask()
  const before = await service.query({ type: 'workspace.snapshot' })
  for (const scope of ['future', 'series'] as const) {
    const preview = await service.preview({
      protocolVersion: 1,
      idempotencyKey: `reject-calendar-resize-${scope}`,
      source: 'human-ui',
      expectedWorkspaceRevision: before.revision,
      command: {
        type: 'calendar.resize', taskId: 'task:r', occurrenceId: 'occurrence:series:1:1',
        estimateMinutes: 45, scope,
      } as CommandEnvelope['command'],
    })
    assert.equal(preview.accepted, false)
    assert.equal(preview.validationErrors[0]?.code, 'VALIDATION_ERROR')
    assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
  }
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
