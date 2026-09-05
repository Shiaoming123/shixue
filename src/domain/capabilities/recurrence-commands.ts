import { nextAfterCompletion } from '../recurrence/calculate.ts'
import type {
  RecurrenceSeries,
  Task,
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

function createRecurrence(
  state: WorkspaceStateV3,
  command: Extract<RecurrenceCapabilityCommand, { type: 'recurrence.create' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  assertIso(command.anchorAt, 'Recurrence anchorAt')
  assertCadence(command.cadence)
  if (!command.timezone.trim()) throw validation('Recurrence timezone is required.')
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
    anchorAt: command.anchorAt,
    end: structuredClone(command.end),
    timezone: command.timezone,
    createdThrough: command.anchorAt,
    createdCount: 1,
  }
  const occurrence: TaskOccurrence = {
    id: occurrenceId,
    seriesId,
    ordinal: 1,
    scheduledAt: command.anchorAt,
    status: 'pending',
    override: command.estimateMinutes === undefined ? null : {
      scheduledAt: null,
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

  return recurrenceApplication({
    tasks: [task],
    series: [series],
    occurrences: [occurrence],
    fields: ['recurrenceSeriesId', 'recurrenceSeries', 'occurrence'],
    compensation: {
      tasks: [beforeTask],
      recurrenceSeries: [],
      occurrenceSnapshots: [],
      createdSeriesIds: [series.id],
      createdOccurrenceIds: [occurrence.id],
    },
    data: { series, occurrence },
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
    applyOccurrencePatch(occurrence, command.patch)
    return recurrenceApplication({
      tasks: [],
      series: [],
      occurrences: [occurrence],
      fields: ['override'],
      compensation: { ...before, createdSeriesIds: [], createdOccurrenceIds: [] },
      data: occurrence,
    })
  }
  if (command.scope === 'series') {
    applySeriesPatch(series, command.patch)
    series.revision += 1
    const pending = recomputePendingOccurrences(state, series)
    return recurrenceApplication({
      tasks: [],
      series: [series],
      occurrences: pending,
      fields: ['recurrenceSeries', 'occurrences'],
      compensation: { ...before, createdSeriesIds: [], createdOccurrenceIds: [] },
      data: { series, occurrences: pending },
    })
  }
  const successor = splitFutureSeries(state, task, series, occurrence, command.patch, context)
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
  const task = requireTask(state, series.taskId)
  const before = recurrenceSnapshot(task, state, series.id)
  occurrence.status = 'completed'
  occurrence.completedAt = context.now
  occurrence.revision += 1

  const created = series.basis === 'after_completion'
    ? createAfterCompletionSuccessor(state, series, occurrence, context.now)
    : null
  const changedOccurrences = created ? [occurrence, created] : [occurrence]
  return recurrenceApplication({
    tasks: [],
    series: created ? [series] : [],
    occurrences: changedOccurrences,
    fields: created ? ['status', 'completedAt', 'occurrence'] : ['status', 'completedAt'],
    compensation: {
      ...before,
      createdSeriesIds: [],
      createdOccurrenceIds: created ? [created.id] : [],
    },
    data: created ? { occurrence, nextOccurrence: created } : occurrence,
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
  return recurrenceApplication({
    tasks: [],
    series: [],
    occurrences: [occurrence],
    fields: ['status'],
    compensation: { ...before, createdSeriesIds: [], createdOccurrenceIds: [] },
    data: occurrence,
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
  const closedOn = addCalendarDays(localDate(occurrence.scheduledAt, series.timezone), -1)
  series.end = { kind: 'on', date: closedOn }
  series.revision += 1

  const successor: RecurrenceSeries = {
    ...structuredClone(series),
    id: successorId,
    taskId: task.id,
    revision: 1,
    anchorAt: patch.scheduledAt ?? patch.anchorAt ?? occurrence.scheduledAt,
    end: patch.end ?? successorEnd(originalEnd, occurrence.ordinal),
    createdThrough: patch.scheduledAt ?? patch.anchorAt ?? occurrence.scheduledAt,
    createdCount: 1,
  }
  applySeriesPatch(successor, patch)
  if (patch.scheduledAt !== undefined && patch.scheduledAt !== null) successor.anchorAt = patch.scheduledAt
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
    status: 'pending',
    override: patch.estimateMinutes === undefined ? null : { scheduledAt: null, estimateMinutes: patch.estimateMinutes },
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

function recomputePendingOccurrences(state: WorkspaceStateV3, series: RecurrenceSeries): TaskOccurrence[] {
  const changed: TaskOccurrence[] = []
  for (const occurrence of state.occurrences.filter((item) => item.seriesId === series.id && item.status === 'pending')) {
    const scheduledAt = occurrenceInstant(series, occurrence.ordinal)
    if (!scheduledAt || isPastSeriesEnd(series, scheduledAt, occurrence.ordinal)) {
      occurrence.status = 'cancelled'
      occurrence.override = null
      occurrence.completedAt = null
      occurrence.revision += 1
      changed.push(occurrence)
      continue
    }
    if (occurrence.scheduledAt !== scheduledAt || occurrence.override !== null || occurrence.revision !== series.revision) {
      occurrence.scheduledAt = scheduledAt
      occurrence.override = null
      occurrence.completedAt = null
      occurrence.revision += 1
      changed.push(occurrence)
    }
  }
  return changed
}

function createAfterCompletionSuccessor(
  state: WorkspaceStateV3,
  series: RecurrenceSeries,
  completed: TaskOccurrence,
  completedAt: string,
): TaskOccurrence | null {
  const nextOrdinal = completed.ordinal + 1
  if (series.end.kind === 'after' && nextOrdinal > series.end.count) return null
  const scheduledAt = nextAfterCompletion(series, completedAt)
  if (!scheduledAt) return null
  if (series.end.kind === 'on' && localDate(scheduledAt, series.timezone) > series.end.date) return null
  const id = occurrenceIdFor(series.id, nextOrdinal)
  if (state.occurrences.some((occurrence) => occurrence.id === id)) return null
  const occurrence: TaskOccurrence = {
    id,
    seriesId: series.id,
    ordinal: nextOrdinal,
    scheduledAt,
    status: 'pending',
    override: null,
    completedAt: null,
    revision: series.revision,
  }
  series.createdThrough = scheduledAt
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
  if (patch.anchorAt !== undefined) {
    assertIso(patch.anchorAt, 'Recurrence anchorAt')
    series.anchorAt = patch.anchorAt
  }
  if (patch.end !== undefined) series.end = structuredClone(patch.end)
  if (patch.timezone !== undefined) {
    if (!patch.timezone.trim()) throw validation('Recurrence timezone is required.')
    series.timezone = patch.timezone
  }
}

function applyOccurrencePatch(occurrence: TaskOccurrence, patch: RecurrenceUpdatePatch): void {
  if (patch.scheduledAt !== undefined && patch.scheduledAt !== null) assertIso(patch.scheduledAt, 'Occurrence scheduledAt')
  const scheduledAt = patch.scheduledAt === undefined ? occurrence.override?.scheduledAt ?? null : patch.scheduledAt
  const estimateMinutes = patch.estimateMinutes === undefined ? occurrence.override?.estimateMinutes ?? null : patch.estimateMinutes
  occurrence.override = scheduledAt === null && estimateMinutes === null ? null : { scheduledAt, estimateMinutes }
  if (scheduledAt !== null) occurrence.scheduledAt = scheduledAt
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
  }
  data: unknown
}): CommandApplication {
  const affected = [
    ...input.tasks.map((task) => ({ type: 'task' as const, id: task.id, revision: task.revision })),
    ...input.series.map((series) => ({ type: 'recurrence_series' as const, id: series.id, revision: series.revision })),
    ...input.occurrences.map((occurrence) => ({ type: 'occurrence' as const, id: occurrence.id, revision: occurrence.revision })),
  ]
  return {
    affected,
    changes: affected.map((entity) => ({ entity, operation: 'update', fields: input.fields })),
    events: [],
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
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function occurrenceInstant(series: RecurrenceSeries, ordinal: number): string | null {
  const anchor = localDateTime(series.anchorAt, series.timezone)
  const date = occurrenceDate(series, anchor.date, ordinal)
  return date ? zonedDateTimeToInstant(date, anchor.time, series.timezone).toISOString() : null
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

function isPastSeriesEnd(series: RecurrenceSeries, scheduledAt: string, ordinal: number): boolean {
  if (series.end.kind === 'never') return false
  if (series.end.kind === 'after') return ordinal > series.end.count
  return localDate(scheduledAt, series.timezone) > series.end.date
}

function localDateTime(iso: string, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function zonedDateTimeToInstant(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute))
  for (let i = 0; i < 8; i += 1) {
    const parts = localDateTime(utc.toISOString(), timezone)
    if (parts.date === date && parts.time === time) return utc
    const localMinutes = toMinuteNumber(parts.date, parts.time)
    const targetMinutes = toMinuteNumber(date, time)
    utc = new Date(utc.getTime() + (targetMinutes - localMinutes) * 60_000)
  }
  throw validation(`Unable to resolve ${date}T${time} in ${timezone}`)
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

function toMinuteNumber(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return (((year * 12 + month) * 31 + day) * 24 * 60) + hour * 60 + minute
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
