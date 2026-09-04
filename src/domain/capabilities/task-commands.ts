import type { StudySession, Task, TaskEvent, WorkspaceStateV3 } from '../workspace/types.ts'
import {
  DomainCommandError,
  type CapabilityCommandContext,
  type CommandApplication,
  type TaskCapabilityCommand,
  type TaskUpdatePatch,
} from './types.ts'

export function applyTaskCommand(
  state: WorkspaceStateV3,
  command: TaskCapabilityCommand,
  context: CapabilityCommandContext,
): CommandApplication {
  if (command.type === 'task.create') return createTask(state, command, context)
  if (command.type === 'task.update') return updateTask(state, command, context)
  if (command.type === 'task.delete') return deleteTask(state, command, context)
  if (command.type === 'task.complete') return completeTask(state, command, context)
  if (command.type === 'task.reopen') return reopenTask(state, command, context)
  if (command.type === 'task.reschedule') return rescheduleTask(state, command, context)
  if (command.type === 'task.batch_reschedule') return batchReschedule(state, command, context)
  if (command.type === 'task.batch_cancel') return batchCancel(state, command, context)
  if (command.type === 'task.batch_delete') return batchDelete(state, command, context)
  const commandType = (command as { type: string }).type
  throw new DomainCommandError('COMMAND_NOT_FOUND', `Command is not implemented: ${commandType}.`, {
    commandType,
  })
}

function createTask(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.create' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  requireText(command.title, 'Task title')
  assertReferences(state, command.listId, command.sectionId ?? null, command.tagIds ?? [])
  assertSchedule(command.startAt ?? null, command.startOn ?? null)
  assertDeadline(command.dueAt ?? null, command.dueOn ?? null)
  if ((command.mode ?? 'general') === 'general' && command.acceptanceCriteria !== undefined) {
    throw new DomainCommandError('VALIDATION_ERROR', 'A general task cannot have learning acceptance criteria.')
  }
  const id = command.taskId ?? context.id('task')
  if (state.tasks.some((task) => task.id === id)) {
    throw new DomainCommandError('TASK_ALREADY_EXISTS', `Task already exists: ${id}.`, { taskId: id })
  }
  const task: Task = {
    id,
    revision: 1,
    mode: command.mode ?? 'general',
    listId: command.listId,
    sectionId: command.sectionId ?? null,
    tagIds: [...(command.tagIds ?? [])],
    title: command.title,
    notes: command.notes ?? '',
    status: 'inbox',
    schedule: {
      startAt: command.startAt ?? null,
      startOn: command.startOn ?? null,
      estimateMinutes: command.estimateMinutes ?? null,
    },
    deadline: { dueAt: command.dueAt ?? null, dueOn: command.dueOn ?? null },
    priority: command.priority ?? 'none',
    checklist: structuredClone(command.checklist ?? []),
    learning: command.mode === 'learning'
      ? { acceptanceCriteria: [...(command.acceptanceCriteria ?? [])], blockedReason: null }
      : null,
    recurrenceSeriesId: null,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
  }
  state.tasks.push(task)
  const event = appendEvent(state, task, 'captured', null, 'inbox', context)
  const affected = taskRef(task)
  return {
    affected: [affected],
    changes: [{ entity: affected, operation: 'create', fields: ['task'] }],
    events: [event],
    compensation: { type: 'task.remove_created', taskIds: [task.id] },
    data: json(task),
  }
}

function updateTask(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.update' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  const before = structuredClone(task)
  const fields = applyPatch(state, task, command.patch)
  task.revision += 1
  task.updatedAt = context.now
  const affected = taskRef(task)
  return {
    affected: [affected],
    changes: [{ entity: affected, operation: 'update', fields }],
    events: [],
    compensation: { type: 'task.restore', tasks: [before], sessions: [], completionRecordIds: [] },
    data: json(task),
  }
}

function deleteTask(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.delete' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  const before = structuredClone(task)
  const sessions = activeTaskSessions(state, [task.id])
  finishSessions(sessions.current, context.now)
  task.deletedAt = context.now
  task.revision += 1
  task.updatedAt = context.now
  const event = appendEvent(state, task, 'deleted', task.status, task.status, context, command.reason)
  const affected = taskRef(task)
  return {
    affected: [affected],
    changes: [{ entity: affected, operation: 'delete', fields: ['deletedAt'] }],
    events: [event],
    compensation: { type: 'task.restore', tasks: [before], sessions: sessions.before, completionRecordIds: [] },
    data: json(task),
  }
}

function completeTask(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.complete' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  if (task.status === 'completed' || task.status === 'cancelled') invalidTransition(task, 'completed')
  if (task.mode === 'learning') {
    if (task.status !== 'planned' && task.status !== 'in_progress') invalidTransition(task, 'completed')
    requireText(command.learned, 'Completion learned')
    requireText(command.evidence, 'Completion evidence')
    requireText(command.nextAction, 'Completion next action')
  }
  const before = structuredClone(task)
  const sessions = activeTaskSessions(state, [task.id], command.sessionId)
  finishSessions(sessions.current, context.now)
  const fromStatus = task.status
  task.status = 'completed'
  if (task.learning) task.learning.blockedReason = null
  task.revision += 1
  task.updatedAt = context.now

  const record = task.mode === 'learning' ? {
    id: context.id('completion'), taskId: task.id,
    topicId: task.listId === 'list:system:learning' ? null : task.listId,
    sessionIds: sessions.current.map(({ id }) => id), taskTitleSnapshot: task.title,
    learned: command.learned!, evidence: command.evidence!, blocker: command.blocker ?? '',
    nextAction: command.nextAction!, mastery: command.mastery ?? null, completedAt: context.now,
    reviewStage: 0 as const, nextReviewOn: addCalendarDays(context.now.slice(0, 10), 1),
    lastReviewResult: null, lastReviewedAt: null, createdAt: context.now,
    updatedAt: context.now, deletedAt: null,
  } : null
  if (record) state.completionRecords.push(record)
  const event = appendEvent(state, task, 'completed', fromStatus, 'completed', context, undefined, record?.id)
  const affected = taskRef(task)
  return {
    affected: [affected],
    changes: [{ entity: affected, operation: 'update', fields: ['status', ...(record ? ['completionRecord'] : [])] }],
    events: [event],
    compensation: {
      type: 'task.restore', tasks: [before], sessions: sessions.before,
      completionRecordIds: record ? [record.id] : [],
    },
    data: json(record ? { task, record } : task),
  }
}

function reopenTask(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.reopen' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  if (task.status !== 'completed' && task.status !== 'cancelled') invalidTransition(task, 'reopened')
  const before = structuredClone(task)
  const fromStatus = task.status
  task.status = task.schedule.startAt || task.schedule.startOn ? 'planned' : 'inbox'
  if (task.learning) task.learning.blockedReason = null
  task.revision += 1
  task.updatedAt = context.now
  const event = appendEvent(state, task, 'reopened', fromStatus, task.status, context)
  const affected = taskRef(task)
  return {
    affected: [affected],
    changes: [{ entity: affected, operation: 'update', fields: ['status'] }],
    events: [event],
    compensation: { type: 'task.restore', tasks: [before], sessions: [], completionRecordIds: [] },
    data: json(task),
  }
}

function rescheduleTask(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.reschedule' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  if (task.status === 'completed' || task.status === 'cancelled') invalidTransition(task, 'planned')
  assertSchedule(command.startAt ?? null, command.startOn ?? null)
  const before = structuredClone(task)
  const sessions = activeTaskSessions(state, [task.id])
  finishSessions(sessions.current, context.now)
  const fromStatus = task.status
  task.status = 'planned'
  task.schedule.startAt = command.startAt ?? null
  task.schedule.startOn = command.startOn ?? null
  if (task.learning) task.learning.blockedReason = null
  task.revision += 1
  task.updatedAt = context.now
  const event = appendEvent(state, task, 'rescheduled', fromStatus, 'planned', context, command.reason)
  const affected = taskRef(task)
  return {
    affected: [affected],
    changes: [{ entity: affected, operation: 'update', fields: ['status', 'schedule'] }],
    events: [event],
    compensation: { type: 'task.restore', tasks: [before], sessions: sessions.before, completionRecordIds: [] },
    data: json(task),
  }
}

function batchReschedule(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.batch_reschedule' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  assertSchedule(command.startAt ?? null, command.startOn ?? null)
  const tasks = requireTasks(state, command.taskIds, command.expectedRevisions)
  for (const task of tasks) if (task.status === 'completed' || task.status === 'cancelled') invalidTransition(task, 'planned')
  const before = structuredClone(tasks)
  const sessions = activeTaskSessions(state, command.taskIds)
  finishSessions(sessions.current, context.now)
  const events = tasks.map((task) => {
    const fromStatus = task.status
    task.status = 'planned'
    task.schedule.startAt = command.startAt ?? null
    task.schedule.startOn = command.startOn ?? null
    if (task.learning) task.learning.blockedReason = null
    task.revision += 1
    task.updatedAt = context.now
    return appendEvent(state, task, 'rescheduled', fromStatus, 'planned', context, command.reason)
  })
  return batchApplication(tasks, before, sessions.before, events, ['status', 'schedule'])
}

function batchCancel(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.batch_cancel' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const tasks = requireTasks(state, command.taskIds, command.expectedRevisions)
  for (const task of tasks) if (task.status === 'completed' || task.status === 'cancelled') invalidTransition(task, 'cancelled')
  const before = structuredClone(tasks)
  const sessions = activeTaskSessions(state, command.taskIds)
  finishSessions(sessions.current, context.now)
  const events = tasks.map((task) => {
    const fromStatus = task.status
    task.status = 'cancelled'
    if (task.learning) task.learning.blockedReason = null
    task.revision += 1
    task.updatedAt = context.now
    return appendEvent(state, task, 'cancelled', fromStatus, 'cancelled', context, command.reason)
  })
  return batchApplication(tasks, before, sessions.before, events, ['status'])
}

function batchDelete(
  state: WorkspaceStateV3,
  command: Extract<TaskCapabilityCommand, { type: 'task.batch_delete' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const tasks = requireTasks(state, command.taskIds, command.expectedRevisions)
  const before = structuredClone(tasks)
  const sessions = activeTaskSessions(state, command.taskIds)
  finishSessions(sessions.current, context.now)
  const events = tasks.map((task) => {
    task.deletedAt = context.now
    task.revision += 1
    task.updatedAt = context.now
    return appendEvent(state, task, 'deleted', task.status, task.status, context, command.reason)
  })
  return batchApplication(tasks, before, sessions.before, events, ['deletedAt'], 'delete')
}

function batchApplication(
  tasks: Task[], before: Task[], sessions: StudySession[], events: TaskEvent[],
  fields: string[], operation: 'update' | 'delete' = 'update',
): CommandApplication {
  const affected = tasks.map(taskRef)
  return {
    affected,
    changes: affected.map((entity) => ({ entity, operation, fields })),
    events,
    compensation: { type: 'task.restore', tasks: before, sessions, completionRecordIds: [] },
    data: json(tasks),
  }
}

function applyPatch(state: WorkspaceStateV3, task: Task, patch: TaskUpdatePatch): string[] {
  if (patch.title !== undefined) requireText(patch.title, 'Task title')
  const listId = patch.listId ?? task.listId
  const sectionId = patch.sectionId === undefined ? task.sectionId : patch.sectionId
  const tagIds = patch.tagIds ?? task.tagIds
  assertReferences(state, listId, sectionId, tagIds)
  const startAt = patch.startAt === undefined ? task.schedule.startAt : patch.startAt
  const startOn = patch.startOn === undefined ? task.schedule.startOn : patch.startOn
  const dueAt = patch.dueAt === undefined ? task.deadline.dueAt : patch.dueAt
  const dueOn = patch.dueOn === undefined ? task.deadline.dueOn : patch.dueOn
  assertSchedule(startAt, startOn)
  assertDeadline(dueAt, dueOn)
  if (task.learning === null && (patch.acceptanceCriteria !== undefined || patch.blockedReason !== undefined)) {
    throw new DomainCommandError('VALIDATION_ERROR', 'A general task cannot have learning fields.')
  }
  const fields = Object.keys(patch)
  if (patch.listId !== undefined) task.listId = patch.listId
  if (patch.sectionId !== undefined) task.sectionId = patch.sectionId
  if (patch.tagIds !== undefined) task.tagIds = [...patch.tagIds]
  if (patch.title !== undefined) task.title = patch.title
  if (patch.notes !== undefined) task.notes = patch.notes
  if (patch.startAt !== undefined) task.schedule.startAt = patch.startAt
  if (patch.startOn !== undefined) task.schedule.startOn = patch.startOn
  if (patch.estimateMinutes !== undefined) task.schedule.estimateMinutes = patch.estimateMinutes
  if (patch.dueAt !== undefined) task.deadline.dueAt = patch.dueAt
  if (patch.dueOn !== undefined) task.deadline.dueOn = patch.dueOn
  if (patch.priority !== undefined) task.priority = patch.priority
  if (patch.checklist !== undefined) task.checklist = structuredClone(patch.checklist)
  if (patch.acceptanceCriteria !== undefined) task.learning!.acceptanceCriteria = [...patch.acceptanceCriteria]
  if (patch.blockedReason !== undefined) task.learning!.blockedReason = patch.blockedReason
  return fields
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

function requireTasks(
  state: WorkspaceStateV3,
  taskIds: readonly string[],
  expectedRevisions: Readonly<Record<string, number>> | undefined,
): Task[] {
  if (taskIds.length === 0 || new Set(taskIds).size !== taskIds.length) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Task ids must be a non-empty unique list.')
  }
  return taskIds.map((taskId) => requireTask(state, taskId, expectedRevisions?.[taskId]))
}

function assertReferences(state: WorkspaceStateV3, listId: string, sectionId: string | null, tagIds: readonly string[]): void {
  if (!state.lists.some(({ id, archivedAt }) => id === listId && archivedAt === null)) {
    throw new DomainCommandError('LIST_NOT_FOUND', `Task list not found: ${listId}.`, { listId })
  }
  if (sectionId !== null) {
    const section = state.sections.find(({ id, archivedAt }) => id === sectionId && archivedAt === null)
    if (!section || section.listId !== listId) {
      throw new DomainCommandError('SECTION_NOT_FOUND', `Task section not found in list: ${sectionId}.`, { sectionId, listId })
    }
  }
  if (new Set(tagIds).size !== tagIds.length) throw new DomainCommandError('VALIDATION_ERROR', 'Task tag ids must be unique.')
  for (const tagId of tagIds) {
    if (!state.tags.some(({ id, archivedAt }) => id === tagId && archivedAt === null)) {
      throw new DomainCommandError('TAG_NOT_FOUND', `Task tag not found: ${tagId}.`, { tagId })
    }
  }
}

function assertSchedule(startAt: string | null, startOn: string | null): void {
  if (startAt && startOn) throw new DomainCommandError('VALIDATION_ERROR', 'Task schedule startAt and startOn are mutually exclusive.')
}

function assertDeadline(dueAt: string | null, dueOn: string | null): void {
  if (dueAt && dueOn) throw new DomainCommandError('VALIDATION_ERROR', 'Task deadline dueAt and dueOn are mutually exclusive.')
}

function activeTaskSessions(
  state: WorkspaceStateV3, taskIds: readonly string[], explicitSessionId?: string,
): { current: StudySession[]; before: StudySession[] } {
  let current = state.studySessions.filter(({ taskId, state: sessionState, deletedAt }) =>
    taskIds.includes(taskId) && deletedAt === null && (sessionState === 'running' || sessionState === 'paused'))
  if (explicitSessionId !== undefined) {
    const explicit = state.studySessions.find(({ id, deletedAt }) => id === explicitSessionId && deletedAt === null)
    if (!explicit || !taskIds.includes(explicit.taskId)) {
      throw new DomainCommandError('VALIDATION_ERROR', `Study session does not belong to the task: ${explicitSessionId}.`)
    }
    current = [explicit]
  }
  return { current, before: structuredClone(current) }
}

function finishSessions(sessions: readonly StudySession[], now: string): void {
  for (const session of sessions) {
    if (session.state === 'running' && session.activeSince) {
      session.elapsedSeconds += Math.floor((Date.parse(now) - Date.parse(session.activeSince)) / 1000)
    }
    session.state = 'finished'
    session.activeSince = null
    session.updatedAt = now
  }
}

function appendEvent(
  state: WorkspaceStateV3, task: Task, type: TaskEvent['type'],
  fromStatus: TaskEvent['fromStatus'], toStatus: TaskEvent['toStatus'],
  context: CapabilityCommandContext, reason?: string, completionRecordId?: string,
): TaskEvent {
  const event: TaskEvent = {
    id: context.id('event'), sequence: state.taskEvents.length + 1, taskId: task.id, type,
    occurredAt: context.now, fromStatus, toStatus, reason: reason?.trim() || null,
    completionRecordId: completionRecordId ?? null,
  }
  state.taskEvents.push(event)
  return event
}

function taskRef(task: Task): { type: 'task'; id: string; revision: number } {
  return { type: 'task', id: task.id, revision: task.revision }
}

function invalidTransition(task: Task, target: string): never {
  throw new DomainCommandError('TASK_INVALID_TRANSITION', `Task ${task.id} cannot transition from ${task.status} to ${target}.`, {
    taskId: task.id, fromStatus: task.status, target,
  })
}

function requireText(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new DomainCommandError('VALIDATION_ERROR', `${label} is required.`)
  }
  return value
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function json(value: unknown): CommandApplication['data'] {
  return structuredClone(value) as CommandApplication['data']
}
