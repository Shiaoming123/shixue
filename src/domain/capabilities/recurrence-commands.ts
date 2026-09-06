import { nextAfterCompletion } from '../recurrence/calculate.ts'
import { materializeOccurrenceWindow } from '../recurrence/materialize.ts'
import { assertIanaTimezone, parseZonedDateTime, zonedDateTimeToInstant } from '../recurrence/timezone.ts'
import type {
  CompletionRecord,
  RecurrenceSeries,
  Task,
  TaskEvent,
  TaskOccurrence,
  WorkspaceStateV3,
} from '../workspace/types.ts'
import {
  DomainCommandError,
  type CapabilityCommandContext,
  type CommandApplication,
  type RecurrenceCapabilityCommand,
  type RecurrenceUpdatePatch,
} from './types.ts'

export function applyRecurrenceCommand(
  state: WorkspaceStateV3,
  command: RecurrenceCapabilityCommand,
  context: CapabilityCommandContext,
): CommandApplication {
  if (command.type === 'recurrence.create') return createRecurrence(state, command, context)
  if (command.type === 'recurrence.update') return updateRecurrence(state, command, context)
  if (command.type === 'recurrence.complete') return completeOccurrence(state, command, context)
  if (command.type === 'recurrence.skip') return skipOccurrence(state, command, context)
  const commandType = (command as { type: string }).type
  throw new DomainCommandError('COMMAND_NOT_FOUND', `Command is not implemented: ${commandType}.`, { commandType })
}

export function seriesMovePatchForOccurrence(
  series: RecurrenceSeries,
  occurrence: TaskOccurrence,
  startAt: string | null,
  startOn: string | null,
): RecurrenceUpdatePatch {
  const target = recurrenceSchedule(startAt, startOn, 'Calendar series target')
  if (series.basis === 'after_completion') {
    if (occurrence.status !== 'pending') {
      throw validation(`Only the pending after-completion occurrence can move its series: ${occurrence.id}.`)
    }
    return {
      anchorAt: target.at,
      anchorOn: target.on,
      scheduledAt: target.at,
      scheduledOn: target.on,
    }
  }
  const timedTarget = target.at === null ? null : localDateTime(target.at, series.timezone)
  const targetDate = target.on ?? timedTarget!.date
  const current = occurrenceSchedule(series, occurrence.ordinal)
  if (!current) throw validation(`Occurrence is outside its recurrence series: ${occurrence.id}.`)
  const currentDate = scheduleDate(current.at, current.on, series.timezone)
  const currentAnchorDate = series.anchorOn ?? localDateTime(series.anchorAt!, series.timezone).date
  let anchorDate: string
  const cadence = structuredClone(series.cadence)

  if (cadence.kind === 'daily' || cadence.kind === 'weekly') {
    const dayShift = calendarDayDifference(currentDate, targetDate)
    anchorDate = addCalendarDays(currentAnchorDate, dayShift)
    if (cadence.kind === 'weekly') {
      const weekdayShift = ((dayShift % 7) + 7) % 7
      cadence.weekdays = cadence.weekdays
        .map((weekday) => (weekday + weekdayShift) % 7)
        .sort((left, right) => left - right)
    }
  } else if (cadence.kind === 'monthly') {
    const targetDay = Number(targetDate.slice(8, 10))
    anchorDate = addCalendarMonths(targetDate, -(occurrence.ordinal - 1) * cadence.interval, targetDay)
    cadence.dayOfMonth = targetDay
  } else {
    const targetMonth = Number(targetDate.slice(5, 7))
    const targetDay = Number(targetDate.slice(8, 10))
    anchorDate = addCalendarYears(targetDate, -(occurrence.ordinal - 1) * cadence.interval, targetMonth, targetDay)
    cadence.month = targetMonth
    cadence.dayOfMonth = targetDay
  }

  return target.at === null
    ? { anchorAt: null, anchorOn: anchorDate, cadence }
    : {
        anchorAt: zonedDateTimeToInstant(anchorDate, timedTarget!.time, series.timezone).toISOString(),
        anchorOn: null,
        cadence,
      }
}

function createRecurrence(
  state: WorkspaceStateV3,
  command: Extract<RecurrenceCapabilityCommand, { type: 'recurrence.create' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const anchor = recurrenceSchedule(command.anchorAt ?? null, command.anchorOn ?? null, 'Recurrence anchor')
  assertCadence(command.cadence)
  assertTimezone(command.timezone)
  const task = requireTask(state, command.taskId, command.expectedTaskRevision)
  if (task.recurrenceSeriesId !== null) {
    throw validation(`Task already has recurrence: ${task.id}.`, { taskId: task.id, seriesId: task.recurrenceSeriesId })
  }
  const beforeTask = structuredClone(task)
  const seriesId = command.seriesId ?? context.id('recurrence_series')
  if (state.recurrenceSeries.some(({ id }) => id === seriesId)) {
    throw validation(`Recurrence series already exists: ${seriesId}.`, { seriesId })
  }
  const occurrenceId = command.occurrenceId ?? occurrenceIdFor(seriesId, 1)
  if (state.occurrences.some(({ id }) => id === occurrenceId)) {
    throw validation(`Occurrence already exists: ${occurrenceId}.`, { occurrenceId })
  }
  const series: RecurrenceSeries = {
    id: seriesId,
    taskId: task.id,
    revision: 1,
    cadence: structuredClone(command.cadence),
    basis: command.basis,
    anchorAt: anchor.at,
    anchorOn: anchor.on,
    end: structuredClone(command.end),
    timezone: command.timezone,
    createdThrough: anchor.on ?? anchor.at,
    createdCount: 1,
  }
  const occurrence: TaskOccurrence = {
    id: occurrenceId,
    seriesId,
    ordinal: 1,
    scheduledAt: anchor.at,
    scheduledOn: anchor.on,
    status: 'pending',
    override: command.estimateMinutes === undefined ? null : {
      scheduledAt: null,
      scheduledOn: null,
      estimateMinutes: command.estimateMinutes,
    },
    completedAt: null,
    revision: 1,
  }
  task.recurrenceSeriesId = seriesId
  task.revision += 1
  task.updatedAt = context.now
  state.recurrenceSeries.push(series)
  state.occurrences.push(occurrence)
  const materialized = fillSeriesWindow(state, series, context.now)
  const occurrences = [occurrence, ...materialized]

  return recurrenceApplication({
    tasks: [task],
    series: [series],
    occurrences,
    fields: ['recurrenceSeriesId', 'recurrenceSeries', 'occurrence'],
    compensation: {
      tasks: [beforeTask],
      recurrenceSeries: [],
      occurrenceSnapshots: [],
      createdSeriesIds: [series.id],
      createdOccurrenceIds: occurrences.map(({ id }) => id),
    },
    data: { series, occurrence, occurrences },
    events: [],
  })
}

function updateRecurrence(
  state: WorkspaceStateV3,
  command: Extract<RecurrenceCapabilityCommand, { type: 'recurrence.update' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  if (Object.keys(command.patch).length === 0) throw validation('Recurrence update patch cannot be empty.')
  const occurrence = requireOccurrence(state, command.occurrenceId, command.expectedOccurrenceRevision)
  const series = requireSeries(state, occurrence.seriesId)
  const task = requireTask(state, series.taskId)
  const before = recurrenceSnapshot(task, state, series.id)
  if (command.scope === 'occurrence') {
    assertOccurrencePatch(command.patch)
    applyOccurrencePatch(occurrence, command.patch)
    const event = appendOccurrenceEvent(state, task, occurrence, 'rescheduled', context, 'Occurrence updated.')
    return recurrenceApplication({
      tasks: [],
      series: [],
      occurrences: [occurrence],
      fields: ['override'],
      compensation: { ...before, createdSeriesIds: [], createdOccurrenceIds: [] },
      data: occurrence,
      events: [event],
    })
  }
  if (command.scope === 'series') {
    const priorBasis = series.basis
    applySeriesPatch(series, command.patch)
    series.revision += 1
    const relocated = priorBasis === 'after_completion' && series.basis === 'after_completion'
      ? relocateAfterCompletionOccurrence(series, occurrence, command.patch)
      : null
    const pending = recomputePendingOccurrences(state, series, priorBasis)
    const materialized = fillSeriesWindow(state, series, context.now)
    const changed = [
      ...(relocated ? [relocated] : []),
      ...pending.filter((item) => item.id !== relocated?.id),
      ...materialized,
    ]
    const event = appendOccurrenceEvent(state, task, occurrence, 'rescheduled', context, 'Recurrence series updated.')
    return recurrenceApplication({
      tasks: [],
      series: [series],
      occurrences: changed,
      fields: ['recurrenceSeries', 'occurrences'],
      compensation: { ...before, createdSeriesIds: [], createdOccurrenceIds: [] },
      data: { series, occurrences: changed },
      events: [event],
    })
  }
  const successor = splitFutureSeries(state, task, series, occurrence, command.patch, context)
  const materialized = fillSeriesWindow(state, successor.series, context.now)
  successor.changedOccurrences.push(...materialized)
  successor.createdOccurrences.push(...materialized)
  const event = appendOccurrenceEvent(state, task, occurrence, 'rescheduled', context, 'Future occurrences updated.')
  return recurrenceApplication({
    tasks: [task],
    series: [series, successor.series],
    occurrences: successor.changedOccurrences,
    fields: ['recurrenceSeries', 'occurrences'],
    compensation: {
      ...before,
      createdSeriesIds: [successor.series.id],
      createdOccurrenceIds: successor.createdOccurrences.map(({ id }) => id),
    },
    data: { closedSeries: series, successorSeries: successor.series, occurrences: successor.createdOccurrences },
    events: [event],
  })
}

function completeOccurrence(
  state: WorkspaceStateV3,
  command: Extract<RecurrenceCapabilityCommand, { type: 'recurrence.complete' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const occurrence = requireOccurrence(state, command.occurrenceId, command.expectedOccurrenceRevision)
  if (occurrence.status !== 'pending') throw validation(`Occurrence cannot be completed from ${occurrence.status}.`, { occurrenceId: occurrence.id })
  const series = requireSeries(state, occurrence.seriesId)
  const task = requireTask(state, series.taskId, command.expectedTaskRevision)
  const record = createOccurrenceCompletionRecord(task, command, context)
  if (record) state.completionRecords.push(record)
  const before = recurrenceSnapshot(task, state, series.id)
  occurrence.status = 'completed'
  occurrence.completedAt = context.now
  occurrence.revision += 1

  const next = series.basis === 'after_completion'
    ? createAfterCompletionSuccessor(state, series, occurrence, context.now)
    : null
  const materialized = series.basis === 'fixed_schedule' ? fillSeriesWindow(state, series, context.now) : []
  const created = [...(next ? [next] : []), ...materialized]
  const changedOccurrences = [occurrence, ...created]
  const event = appendOccurrenceEvent(state, task, occurrence, 'completed', context, 'Occurrence completed.')
  event.completionRecordId = record?.id ?? null
  return recurrenceApplication({
    tasks: [],
    series: created.length ? [series] : [],
    occurrences: changedOccurrences,
    fields: created.length ? ['status', 'completedAt', 'occurrence'] : ['status', 'completedAt'],
    compensation: {
      ...before,
      completionRecordIds: record ? [record.id] : [],
      createdSeriesIds: [],
      createdOccurrenceIds: created.map(({ id }) => id),
    },
    data: record ? { occurrence, record, occurrences: created } : created.length ? { occurrence, nextOccurrence: created[0], occurrences: created } : occurrence,
    events: [event],
  })
}

function skipOccurrence(
  state: WorkspaceStateV3,
  command: Extract<RecurrenceCapabilityCommand, { type: 'recurrence.skip' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const occurrence = requireOccurrence(state, command.occurrenceId, command.expectedOccurrenceRevision)
  if (occurrence.status !== 'pending') throw validation(`Occurrence cannot be skipped from ${occurrence.status}.`, { occurrenceId: occurrence.id })
  const series = requireSeries(state, occurrence.seriesId)
  const task = requireTask(state, series.taskId)
  const before = recurrenceSnapshot(task, state, series.id)
  occurrence.status = 'skipped'
  occurrence.completedAt = null
  occurrence.revision += 1
  const materialized = series.basis === 'fixed_schedule' ? fillSeriesWindow(state, series, context.now) : []
  const event = appendOccurrenceEvent(state, task, occurrence, 'cancelled', context, 'Occurrence skipped.')
  return recurrenceApplication({
    tasks: [],
    series: materialized.length ? [series] : [],
    occurrences: [occurrence, ...materialized],
    fields: ['status'],
    compensation: { ...before, createdSeriesIds: [], createdOccurrenceIds: materialized.map(({ id }) => id) },
    data: occurrence,
    events: [event],
  })
}

function splitFutureSeries(
  state: WorkspaceStateV3,
  task: Task,
  series: RecurrenceSeries,
  occurrence: TaskOccurrence,
  patch: RecurrenceUpdatePatch,
  context: CapabilityCommandContext,
): { series: RecurrenceSeries; changedOccurrences: TaskOccurrence[]; createdOccurrences: TaskOccurrence[] } {
  const successorId = `${series.id}:split:${occurrence.ordinal}`
  if (state.recurrenceSeries.some(({ id }) => id === successorId)) {
    throw validation(`Recurrence successor already exists: ${successorId}.`, { seriesId: successorId })
  }
  const originalEnd = structuredClone(series.end)
  const closedOn = addCalendarDays(scheduleDate(occurrence.scheduledAt, occurrence.scheduledOn, series.timezone), -1)
  series.end = { kind: 'on', date: closedOn }
  series.revision += 1

  const successorAnchor = patchSchedule(patch, occurrence)
  const successor: RecurrenceSeries = {
    ...structuredClone(series),
    id: successorId,
    taskId: task.id,
    revision: 1,
    anchorAt: successorAnchor.at,
    anchorOn: successorAnchor.on,
    end: patch.end ?? successorEnd(originalEnd, occurrence.ordinal),
    createdThrough: successorAnchor.on ?? successorAnchor.at,
    createdCount: 1,
  }
  applySeriesPatch(successor, patch)
  state.recurrenceSeries.push(successor)
  task.recurrenceSeriesId = successor.id
  task.revision += 1
  task.updatedAt = context.now

  const cancelled = state.occurrences
    .filter((item) => item.seriesId === series.id && item.ordinal >= occurrence.ordinal && item.status === 'pending')
  for (const item of cancelled) {
    item.status = 'cancelled'
    item.completedAt = null
    item.revision += 1
  }
  const first: TaskOccurrence = {
    id: occurrenceIdFor(successor.id, 1),
    seriesId: successor.id,
    ordinal: 1,
    scheduledAt: successor.anchorAt,
    scheduledOn: successor.anchorOn,
    status: 'pending',
    override: patch.estimateMinutes === undefined ? null : { scheduledAt: null, scheduledOn: null, estimateMinutes: patch.estimateMinutes },
    completedAt: null,
    revision: successor.revision,
  }
  state.occurrences.push(first)
  return { series: successor, changedOccurrences: [...cancelled, first], createdOccurrences: [first] }
}

function successorEnd(end: RecurrenceSeries['end'], splitOrdinal: number): RecurrenceSeries['end'] {
  if (end.kind !== 'after') return structuredClone(end)
  return { kind: 'after', count: Math.max(1, end.count - splitOrdinal + 1) }
}

function recomputePendingOccurrences(
  state: WorkspaceStateV3,
  series: RecurrenceSeries,
  priorBasis: RecurrenceSeries['basis'],
): TaskOccurrence[] {
  const changed: TaskOccurrence[] = []
  const pending = state.occurrences
    .filter((item) => item.seriesId === series.id && item.status === 'pending')
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
  if (series.basis === 'after_completion') {
    let retained = false
    for (const occurrence of pending) {
      if (isPastSeriesEnd(series, occurrence.scheduledAt, occurrence.scheduledOn, occurrence.ordinal)) {
        occurrence.status = 'cancelled'
        occurrence.override = null
        occurrence.completedAt = null
        occurrence.revision += 1
        changed.push(occurrence)
      } else if (priorBasis !== 'after_completion' && retained) {
        occurrence.status = 'cancelled'
        occurrence.override = null
        occurrence.completedAt = null
        occurrence.revision += 1
        changed.push(occurrence)
      } else {
        retained = true
      }
    }
    return changed
  }
  for (const occurrence of pending) {
    const schedule = occurrenceSchedule(series, occurrence.ordinal)
    if (!schedule || isPastSeriesEnd(series, schedule.at, schedule.on, occurrence.ordinal)) {
      occurrence.status = 'cancelled'
      occurrence.override = null
      occurrence.completedAt = null
      occurrence.revision += 1
      changed.push(occurrence)
      continue
    }
    if (occurrence.scheduledAt !== schedule.at || occurrence.scheduledOn !== schedule.on || occurrence.override !== null || occurrence.revision !== series.revision) {
      occurrence.scheduledAt = schedule.at
      occurrence.scheduledOn = schedule.on
      occurrence.override = null
      occurrence.completedAt = null
      occurrence.revision += 1
      changed.push(occurrence)
    }
  }
  return changed
}

function relocateAfterCompletionOccurrence(
  series: RecurrenceSeries,
  occurrence: TaskOccurrence,
  patch: RecurrenceUpdatePatch,
): TaskOccurrence | null {
  if (patch.scheduledAt === undefined && patch.scheduledOn === undefined) return null
  if (occurrence.status !== 'pending') {
    throw validation(`Only a pending after-completion occurrence can be rescheduled: ${occurrence.id}.`)
  }
  const schedule = patchSchedule(patch, occurrence)
  if (isPastSeriesEnd(series, schedule.at, schedule.on, occurrence.ordinal)) {
    throw validation(`After-completion occurrence falls outside the recurrence end: ${occurrence.id}.`)
  }
  occurrence.scheduledAt = schedule.at
  occurrence.scheduledOn = schedule.on
  occurrence.override = null
  occurrence.completedAt = null
  occurrence.revision += 1
  series.createdThrough = schedule.on ?? schedule.at
  return occurrence
}

function createAfterCompletionSuccessor(
  state: WorkspaceStateV3,
  series: RecurrenceSeries,
  completed: TaskOccurrence,
  completedAt: string,
): TaskOccurrence | null {
  const nextOrdinal = completed.ordinal + 1
  if (series.end.kind === 'after' && nextOrdinal > series.end.count) return null
  const scheduled = nextAfterCompletion(series, completedAt)
  if (!scheduled) return null
  const schedule = scheduleValue(scheduled)
  if (series.end.kind === 'on' && scheduleDate(schedule.at, schedule.on, series.timezone) > series.end.date) return null
  const id = occurrenceIdFor(series.id, nextOrdinal)
  const existing = state.occurrences.find((occurrence) => occurrence.id === id)
  if (existing) {
    if (existing.status !== 'cancelled') return null
    existing.scheduledAt = schedule.at
    existing.scheduledOn = schedule.on
    existing.status = 'pending'
    existing.override = null
    existing.completedAt = null
    existing.revision += 1
    series.createdThrough = scheduled
    series.createdCount = Math.max(series.createdCount, nextOrdinal)
    return existing
  }
  const occurrence: TaskOccurrence = {
    id,
    seriesId: series.id,
    ordinal: nextOrdinal,
    scheduledAt: schedule.at,
    scheduledOn: schedule.on,
    status: 'pending',
    override: null,
    completedAt: null,
    revision: series.revision,
  }
  series.createdThrough = scheduled
  series.createdCount = Math.max(series.createdCount, nextOrdinal)
  state.occurrences.push(occurrence)
  return occurrence
}

function applySeriesPatch(series: RecurrenceSeries, patch: RecurrenceUpdatePatch): void {
  if (patch.cadence !== undefined) {
    assertCadence(patch.cadence)
    series.cadence = structuredClone(patch.cadence)
  }
  if (patch.basis !== undefined) series.basis = patch.basis
  if (patch.anchorAt !== undefined || patch.anchorOn !== undefined) {
    const anchor = recurrenceSchedule(
      patch.anchorAt !== undefined ? patch.anchorAt : patch.anchorOn ? null : series.anchorAt,
      patch.anchorOn !== undefined ? patch.anchorOn : patch.anchorAt ? null : series.anchorOn,
      'Recurrence anchor',
    )
    series.anchorAt = anchor.at
    series.anchorOn = anchor.on
  }
  if (patch.end !== undefined) series.end = structuredClone(patch.end)
  if (patch.timezone !== undefined) {
    assertTimezone(patch.timezone)
    series.timezone = patch.timezone
  }
}

function applyOccurrencePatch(occurrence: TaskOccurrence, patch: RecurrenceUpdatePatch): void {
  const currentAt = occurrence.override?.scheduledAt ?? null
  const currentOn = occurrence.override?.scheduledOn ?? null
  const schedule = patch.scheduledAt !== undefined || patch.scheduledOn !== undefined
    ? optionalSchedule(
      patch.scheduledAt !== undefined ? patch.scheduledAt : patch.scheduledOn ? null : currentAt,
      patch.scheduledOn !== undefined ? patch.scheduledOn : patch.scheduledAt ? null : currentOn,
      'Occurrence override schedule',
    )
    : { at: currentAt, on: currentOn }
  const estimateMinutes = patch.estimateMinutes === undefined ? occurrence.override?.estimateMinutes ?? null : patch.estimateMinutes
  occurrence.override = schedule.at === null && schedule.on === null && estimateMinutes === null ? null : { scheduledAt: schedule.at, scheduledOn: schedule.on, estimateMinutes }
  if (schedule.at !== null || schedule.on !== null) {
    occurrence.scheduledAt = schedule.at
    occurrence.scheduledOn = schedule.on
  }
  occurrence.revision += 1
}

function recurrenceSnapshot(task: Task, state: WorkspaceStateV3, activeSeriesId: string) {
  return {
    tasks: [structuredClone(task)],
    recurrenceSeries: state.recurrenceSeries
      .filter((series) => series.id === activeSeriesId || series.taskId === task.id)
      .map((series) => structuredClone(series)),
    occurrenceSnapshots: state.occurrences
      .filter((occurrence) => state.recurrenceSeries.some((series) => series.id === occurrence.seriesId && series.taskId === task.id))
      .map((occurrence) => structuredClone(occurrence)),
  }
}

function fillSeriesWindow(state: WorkspaceStateV3, series: RecurrenceSeries, now: string): TaskOccurrence[] {
  const created = materializeOccurrenceWindow(state, series.id, now).created
  state.occurrences.push(...created)
  const last = created[created.length - 1]
  if (last) {
    series.createdThrough = last.scheduledOn ?? last.scheduledAt
    series.createdCount = Math.max(series.createdCount, last.ordinal)
  }
  return created
}

function appendOccurrenceEvent(
  state: WorkspaceStateV3,
  task: Task,
  occurrence: TaskOccurrence,
  type: TaskEvent['type'],
  context: CapabilityCommandContext,
  reason: string,
): TaskEvent {
  const event: TaskEvent = {
    id: context.id('event'),
    sequence: state.taskEvents.length + 1,
    taskId: task.id,
    occurrenceId: occurrence.id,
    type,
    occurredAt: context.now,
    fromStatus: task.status,
    toStatus: task.status,
    reason,
    completionRecordId: null,
  }
  state.taskEvents.push(event)
  return event
}

function recurrenceApplication(input: {
  tasks: Task[]
  series: RecurrenceSeries[]
  occurrences: TaskOccurrence[]
  fields: string[]
  compensation: {
    tasks: Task[]
    recurrenceSeries: RecurrenceSeries[]
    occurrenceSnapshots: TaskOccurrence[]
    createdSeriesIds: string[]
    createdOccurrenceIds: string[]
    completionRecordIds?: string[]
  }
  data: unknown
  events: TaskEvent[]
}): CommandApplication {
  const affected = [
    ...input.tasks.map((task) => ({ type: 'task' as const, id: task.id, revision: task.revision })),
    ...input.series.map((series) => ({ type: 'recurrence_series' as const, id: series.id, revision: series.revision })),
    ...input.occurrences.map((occurrence) => ({ type: 'occurrence' as const, id: occurrence.id, revision: occurrence.revision })),
  ]
  return {
    affected,
    changes: affected.map((entity) => ({ entity, operation: 'update', fields: input.fields })),
    events: input.events,
    compensation: { type: 'recurrence.restore', ...input.compensation },
    data: structuredClone(input.data) as CommandApplication['data'],
  }
}

function requireTask(state: WorkspaceStateV3, taskId: string, expectedRevision?: number): Task {
  const task = state.tasks.find(({ id }) => id === taskId)
  if (!task) throw new DomainCommandError('TASK_NOT_FOUND', `Task not found: ${taskId}.`, { taskId })
  if (task.deletedAt !== null) throw new DomainCommandError('TASK_ALREADY_DELETED', `Task is deleted: ${taskId}.`, { taskId })
  if (expectedRevision !== undefined && task.revision !== expectedRevision) {
    throw new DomainCommandError('ENTITY_REVISION_CONFLICT', `Task revision conflict: ${taskId}.`, {
      taskId, expectedRevision, actualRevision: task.revision,
    })
  }
  return task
}

function requireSeries(state: WorkspaceStateV3, seriesId: string): RecurrenceSeries {
  const series = state.recurrenceSeries.find(({ id }) => id === seriesId)
  if (!series) throw validation(`Recurrence series not found: ${seriesId}.`, { seriesId })
  return series
}

function requireOccurrence(state: WorkspaceStateV3, occurrenceId: string, expectedRevision?: number): TaskOccurrence {
  const occurrence = state.occurrences.find(({ id }) => id === occurrenceId)
  if (!occurrence) throw validation(`Occurrence not found: ${occurrenceId}.`, { occurrenceId })
  if (expectedRevision !== undefined && occurrence.revision !== expectedRevision) {
    throw new DomainCommandError('ENTITY_REVISION_CONFLICT', `Occurrence revision conflict: ${occurrenceId}.`, {
      occurrenceId, expectedRevision, actualRevision: occurrence.revision,
    })
  }
  return occurrence
}

function assertCadence(cadence: RecurrenceSeries['cadence']): void {
  if (!Number.isInteger(cadence.interval) || cadence.interval <= 0) throw validation('Recurrence interval must be positive.')
  if (cadence.kind === 'weekly') {
    if (cadence.weekdays.length === 0 || new Set(cadence.weekdays).size !== cadence.weekdays.length) {
      throw validation('Weekly recurrence weekdays must be unique and non-empty.')
    }
  }
}

function assertOccurrencePatch(patch: RecurrenceUpdatePatch): void {
  const seriesFields = ['cadence', 'basis', 'anchorAt', 'anchorOn', 'end', 'timezone'] as const
  const unsupported = seriesFields.filter((field) => patch[field] !== undefined)
  if (unsupported.length > 0) {
    throw validation(`Occurrence updates cannot change series fields: ${unsupported.join(', ')}.`, {
      fields: unsupported.join(','),
    })
  }
}

function assertTimezone(timezone: string): void {
  if (!timezone.trim()) throw validation('Recurrence timezone is required.')
  try { assertIanaTimezone(timezone) } catch (error) { throw validation(error instanceof Error ? error.message : String(error)) }
}

function assertIso(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw validation(`${label} must be an ISO datetime.`)
}

function validation(message: string, details: Record<string, string | number | boolean | null> = {}): DomainCommandError {
  return new DomainCommandError('VALIDATION_ERROR', message, details)
}

function occurrenceIdFor(seriesId: string, ordinal: number): string {
  return `occurrence:${seriesId}:${ordinal}`
}

function localDate(iso: string, timezone: string): string {
  return parseZonedDateTime(iso, timezone).date
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function calendarDayDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000)
}

function occurrenceSchedule(series: RecurrenceSeries, ordinal: number): { at: string | null; on: string | null } | null {
  const timed = series.anchorAt !== null
  const anchor = timed ? localDateTime(series.anchorAt!, series.timezone) : { date: series.anchorOn!, time: '' }
  const date = occurrenceDate(series, anchor.date, ordinal)
  if (!date) return null
  return timed
    ? { at: zonedDateTimeToInstant(date, anchor.time, series.timezone).toISOString(), on: null }
    : { at: null, on: date }
}

function occurrenceDate(series: RecurrenceSeries, anchorDate: string, ordinal: number): string | null {
  const offset = ordinal - 1
  if (series.cadence.kind === 'daily') return addCalendarDays(anchorDate, offset * series.cadence.interval)
  if (series.cadence.kind === 'weekly') return weeklyDate(anchorDate, series.cadence.interval, series.cadence.weekdays, offset)
  if (series.cadence.kind === 'monthly') return addCalendarMonths(anchorDate, offset * series.cadence.interval, series.cadence.dayOfMonth)
  return addCalendarYears(anchorDate, offset * series.cadence.interval, series.cadence.month, series.cadence.dayOfMonth)
}

function weeklyDate(anchorDate: string, interval: number, weekdays: readonly number[], offset: number): string | null {
  let seen = 0
  for (let dayOffset = 0; dayOffset <= 500 * 7; dayOffset += 1) {
    const date = addCalendarDays(anchorDate, dayOffset)
    if (Math.floor(dayOffset / 7) % interval !== 0) continue
    if (!weekdays.includes(weekdayOf(date))) continue
    if (seen === offset) return date
    seen += 1
  }
  return null
}

function isPastSeriesEnd(series: RecurrenceSeries, scheduledAt: string | null, scheduledOn: string | null, ordinal: number): boolean {
  if (series.end.kind === 'never') return false
  if (series.end.kind === 'after') return ordinal > series.end.count
  return scheduleDate(scheduledAt, scheduledOn, series.timezone) > series.end.date
}

function recurrenceSchedule(at: string | null, on: string | null, label: string): { at: string | null; on: string | null } {
  if ((at === null) === (on === null)) throw validation(`${label} fields are mutually exclusive and require exactly one value.`)
  if (at !== null) assertIso(at, `${label}At`)
  if (on !== null && !/^\d{4}-\d{2}-\d{2}$/.test(on)) throw validation(`${label}On must use YYYY-MM-DD.`)
  return { at, on }
}

function optionalSchedule(at: string | null, on: string | null, label: string): { at: string | null; on: string | null } {
  if (at === null && on === null) return { at, on }
  return recurrenceSchedule(at, on, label)
}

function scheduleValue(value: string): { at: string | null; on: string | null } {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { at: null, on: value } : { at: value, on: null }
}

function scheduleDate(at: string | null, on: string | null, timezone: string): string {
  return on ?? localDate(at!, timezone)
}

function patchSchedule(patch: RecurrenceUpdatePatch, occurrence: TaskOccurrence): { at: string | null; on: string | null } {
  if (patch.scheduledAt !== undefined || patch.scheduledOn !== undefined) {
    return recurrenceSchedule(
      patch.scheduledAt !== undefined ? patch.scheduledAt : patch.scheduledOn ? null : occurrence.scheduledAt,
      patch.scheduledOn !== undefined ? patch.scheduledOn : patch.scheduledAt ? null : occurrence.scheduledOn,
      'Occurrence schedule',
    )
  }
  if (patch.anchorAt !== undefined || patch.anchorOn !== undefined) {
    return recurrenceSchedule(
      patch.anchorAt !== undefined ? patch.anchorAt : patch.anchorOn ? null : occurrence.scheduledAt,
      patch.anchorOn !== undefined ? patch.anchorOn : patch.anchorAt ? null : occurrence.scheduledOn,
      'Recurrence anchor',
    )
  }
  return recurrenceSchedule(occurrence.scheduledAt, occurrence.scheduledOn, 'Occurrence schedule')
}

function localDateTime(iso: string, timezone: string): { date: string; time: string } {
  return parseZonedDateTime(iso, timezone)
}

function addCalendarMonths(date: string, months: number, dayOfMonth: number): string {
  const [year, month] = date.split('-').map(Number)
  const totalMonths = year * 12 + (month - 1) + months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = (totalMonths % 12) + 1
  return formatDate(targetYear, targetMonth, Math.min(dayOfMonth, daysInMonth(targetYear, targetMonth)))
}

function addCalendarYears(date: string, years: number, month: number, dayOfMonth: number): string {
  const [year] = date.split('-').map(Number)
  const targetYear = year + years
  return formatDate(targetYear, month, Math.min(dayOfMonth, daysInMonth(targetYear, month)))
}

function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function createOccurrenceCompletionRecord(
  task: Task,
  command: Extract<RecurrenceCapabilityCommand, { type: 'recurrence.complete' }>,
  context: CapabilityCommandContext,
): CompletionRecord | null {
  if (task.mode !== 'learning') return null
  for (const field of ['learned', 'evidence', 'nextAction'] as const) {
    if (typeof command[field] !== 'string' || !command[field]!.trim()) throw validation(`Learning completion ${field} evidence is required.`)
  }
  const reviewDate = new Date(context.now)
  reviewDate.setUTCDate(reviewDate.getUTCDate() + 1)
  return {
    id: command.recordId ?? context.id('completion'), taskId: task.id,
    topicId: task.listId === 'list:system:learning' ? null : task.listId,
    sessionIds: [], taskTitleSnapshot: task.title,
    learned: command.learned!, evidence: command.evidence!, blocker: command.blocker ?? '',
    nextAction: command.nextAction!, mastery: command.mastery ?? null, completedAt: context.now,
    reviewStage: 0, nextReviewOn: reviewDate.toISOString().slice(0, 10),
    lastReviewResult: null, lastReviewedAt: null, createdAt: context.now,
    updatedAt: context.now, deletedAt: null,
  }
}
