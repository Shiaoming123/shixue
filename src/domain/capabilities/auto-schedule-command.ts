import type { BusyResult } from '../../calendar-connections/types.ts'
import { suggestTaskSchedule, schedulingRangeBounds, type ScheduleQuery } from '../calendar/scheduling.ts'
import type { WorkspaceStateV4 } from '../workspace/types.ts'
import { applyTaskCommand } from './task-commands.ts'
import { DomainCommandError, type CapabilityCommandContext } from './types.ts'

export type AutoScheduleQuery = Omit<ScheduleQuery, 'now' | 'externalBusy'>
export interface TaskAutoScheduleCommand {
  type: 'task.auto_schedule'
  query: AutoScheduleQuery
  expectedTaskRevision: number
  availabilityFingerprint: string
  startAt: string
}

export function validateAutoScheduleCommand(command: TaskAutoScheduleCommand) {
  if (!command.query || typeof command.query !== 'object' || Array.isArray(command.query)) throw new DomainCommandError('VALIDATION_ERROR', 'Invalid scheduling query.')
  if (Object.keys(command).some((key) => !['type', 'query', 'expectedTaskRevision', 'availabilityFingerprint', 'startAt'].includes(key)) || Object.keys(command.query).some((key) => !['taskId', 'range', 'timezone', 'workingHours', 'lockedIntervals', 'requiredExternalCalendarIds', 'maxCandidates'].includes(key))) throw new DomainCommandError('VALIDATION_ERROR', 'Scheduling accepts only the approved query; external availability comes from the device runtime.')
  try { schedulingRangeBounds(command.query.range, command.query.timezone) }
  catch { throw new DomainCommandError('VALIDATION_ERROR', 'Invalid scheduling range or timezone.') }
}

export async function applyAutoSchedule(state: WorkspaceStateV4, command: TaskAutoScheduleCommand, context: CapabilityCommandContext, externalBusy: BusyResult[] = []) {
  validateAutoScheduleCommand(command)
  const task = state.tasks.find(({ id }) => id === command.query.taskId)
  if (!task || task.revision !== command.expectedTaskRevision) throw new DomainCommandError('ENTITY_REVISION_CONFLICT', '任务已变化，请重新生成建议。')
  const suggestion = await suggestTaskSchedule(state, { ...command.query, now: context.now, externalBusy })
  if (suggestion.availabilityFingerprint !== command.availabilityFingerprint) throw new DomainCommandError('VALIDATION_ERROR', '可用时间已变化，请重新生成建议。')
  const candidate = suggestion.candidates.find(({ startAt }) => startAt === command.startAt)
  if (!candidate) throw new DomainCommandError('VALIDATION_ERROR', '该时段已不可安排，请重新生成建议。')
  return applyTaskCommand(state, { type: 'task.reschedule', taskId: task.id, startAt: candidate.startAt, startOn: null, estimateMinutes: candidate.estimateMinutes }, context)
}
