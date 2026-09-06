import type { TaskOccurrence, WorkspaceStateV3 } from '../workspace/types.ts'
import { applyRecurrenceCommand, seriesMovePatchForOccurrence } from './recurrence-commands.ts'
import { applyTaskCommand } from './task-commands.ts'
import {
  DomainCommandError,
  type CapabilityCommandContext,
  type CommandApplication,
  type RecurrenceUpdateCommand,
} from './types.ts'

export type CalendarMoveScope = 'task' | RecurrenceUpdateCommand['scope']
export type CalendarResizeScope = 'single' | 'occurrence'

export interface CalendarMoveCommand {
  type: 'calendar.move'
  taskId: string
  occurrenceId?: string
  startAt?: string | null
  startOn?: string | null
  scope?: CalendarMoveScope
}

export interface CalendarResizeCommand {
  type: 'calendar.resize'
  taskId: string
  occurrenceId?: string
  estimateMinutes: number
  scope?: CalendarResizeScope
}

export type CalendarCapabilityCommand = CalendarMoveCommand | CalendarResizeCommand

export function applyCalendarCommand(
  state: WorkspaceStateV3,
  command: CalendarCapabilityCommand,
  context: CapabilityCommandContext,
): CommandApplication {
  if (command.type === 'calendar.resize') {
    assertResizeScopeTarget(command.occurrenceId, command.scope)
    assertDuration(command.estimateMinutes)
    if (command.occurrenceId === undefined) {
      return applyTaskCommand(state, {
        type: 'task.update',
        taskId: command.taskId,
        patch: { estimateMinutes: command.estimateMinutes },
      }, context)
    }
    const occurrence = requireOccurrenceTask(state, command.taskId, command.occurrenceId)
    const schedule = effectiveOccurrenceSchedule(occurrence)
    return applyRecurrenceCommand(state, {
      type: 'recurrence.update',
      occurrenceId: command.occurrenceId,
      scope: 'occurrence',
      patch: { ...schedule, estimateMinutes: command.estimateMinutes },
    }, context)
  }
  assertMoveScopeTarget(command.occurrenceId, command.scope)
  assertMoveTarget(command.startAt ?? null, command.startOn ?? null)
  if (command.occurrenceId === undefined) {
    return applyTaskCommand(state, {
      type: 'task.reschedule',
      taskId: command.taskId,
      startAt: command.startAt ?? null,
      startOn: command.startOn ?? null,
    }, context)
  }
  const occurrence = requireOccurrenceTask(state, command.taskId, command.occurrenceId)
  const scope = recurrenceScope(command.scope)
  const patch = scope === 'series'
    ? seriesMovePatchForOccurrence(
        state.recurrenceSeries.find(({ id }) => id === occurrence.seriesId)!,
        occurrence,
        command.startAt ?? null,
        command.startOn ?? null,
      )
    : {
        scheduledAt: command.startAt,
        scheduledOn: command.startOn,
        ...(scope === 'occurrence'
          ? { estimateMinutes: occurrence.override?.estimateMinutes ?? state.tasks.find(({ id }) => id === command.taskId)!.schedule.estimateMinutes }
          : {}),
      }
  return applyRecurrenceCommand(state, {
    type: 'recurrence.update',
    occurrenceId: command.occurrenceId,
    scope,
    patch,
  }, context)
}

function assertMoveScopeTarget(occurrenceId: string | undefined, scope: CalendarMoveScope | undefined): void {
  if (occurrenceId === undefined && scope !== undefined && scope !== 'task') {
    throw new DomainCommandError('VALIDATION_ERROR', 'A task calendar command must use task scope.')
  }
  if (occurrenceId !== undefined && scope === 'task') {
    throw new DomainCommandError('VALIDATION_ERROR', 'An occurrence calendar command cannot use task scope.')
  }
}

function assertResizeScopeTarget(occurrenceId: string | undefined, scope: CalendarResizeScope | undefined): void {
  if (occurrenceId === undefined && scope !== undefined && scope !== 'single') {
    throw new DomainCommandError('VALIDATION_ERROR', 'A task calendar resize must use single scope.')
  }
  if (occurrenceId !== undefined && scope !== undefined && scope !== 'occurrence') {
    throw new DomainCommandError('VALIDATION_ERROR', 'An occurrence calendar resize must use occurrence scope.')
  }
}

function recurrenceScope(scope: CalendarMoveScope | undefined): RecurrenceUpdateCommand['scope'] {
  if (scope === 'task') {
    throw new DomainCommandError('VALIDATION_ERROR', 'An occurrence calendar command cannot use task scope.')
  }
  return scope ?? 'occurrence'
}

function assertMoveTarget(startAt: string | null, startOn: string | null): void {
  if ((startAt === null) === (startOn === null)) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Calendar move requires exactly one of startAt or startOn.')
  }
}

function assertDuration(estimateMinutes: number): void {
  if (!Number.isInteger(estimateMinutes) || estimateMinutes < 5 || estimateMinutes > 1440 || estimateMinutes % 5 !== 0) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Calendar duration must be from 5 to 1440 minutes in 5-minute steps.', {
      estimateMinutes,
    })
  }
}

function requireOccurrenceTask(state: WorkspaceStateV3, taskId: string, occurrenceId: string): TaskOccurrence {
  const occurrence = state.occurrences.find(({ id }) => id === occurrenceId)
  const series = occurrence && state.recurrenceSeries.find(({ id }) => id === occurrence.seriesId)
  if (series?.taskId !== taskId) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Calendar occurrence does not belong to the task.', {
      taskId,
      occurrenceId,
    })
  }
  return occurrence!
}

function effectiveOccurrenceSchedule(occurrence: TaskOccurrence): Pick<TaskOccurrence, 'scheduledAt' | 'scheduledOn'> {
  if (occurrence.override && (occurrence.override.scheduledAt !== null || occurrence.override.scheduledOn !== null)) {
    return { scheduledAt: occurrence.override.scheduledAt, scheduledOn: occurrence.override.scheduledOn }
  }
  return { scheduledAt: occurrence.scheduledAt, scheduledOn: occurrence.scheduledOn }
}
