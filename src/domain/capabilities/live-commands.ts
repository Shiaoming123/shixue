import { parseWorkspaceStateOrMigrate } from '../workspace/migrate.ts'
import type {
  StudySession,
  Task,
  TaskEvent,
  WorkspaceStateV3,
} from '../workspace/types.ts'
import { applyReviewResult, createSeedStudyState } from '../../storage/study/types.ts'
import { applyTaskCommand } from './task-commands.ts'
import {
  DomainCommandError,
  type CapabilityCommandContext,
  type CommandApplication,
  type EntityRef,
  type LiveCompatibilityCommand,
} from './types.ts'

export function applyLiveCompatibilityCommand(
  state: WorkspaceStateV3,
  command: LiveCompatibilityCommand,
  context: CapabilityCommandContext,
): CommandApplication {
  if (command.type === 'list.upsert') return upsertList(state, command)
  if (command.type === 'list_group.upsert') return upsertListGroup(state, command)
  if (command.type === 'list_group.archive') return archiveListGroup(state, command, context)
  if (command.type === 'task.plan') return planTask(state, command, context)
  if (command.type === 'task.transition') return transitionTask(state, command, context)
  if (command.type === 'task.start') return startTask(state, command, context)
  if (command.type === 'task.switch') return switchTask(state, command, context)
  if (command.type === 'session.pause') return pauseSession(state, command, context)
  if (command.type === 'session.resume') return resumeSession(state, command, context)
  if (command.type === 'session.scratchpad.update') return updateScratchpad(state, command, context)
  if (command.type === 'task.checklist.add') return addChecklistItem(state, command, context)
  if (command.type === 'task.checklist.set') return setChecklistItem(state, command, context)
  if (command.type === 'task.reorder') return reorderTasks(state, command, context)
  if (command.type === 'task.toggle_completion') return toggleCompletion(state, command, context)
  if (command.type === 'completion.review') return reviewCompletion(state, command, context)
  if (command.type === 'completion.create_next_action') return createNextAction(state, command, context)
  if (command.type === 'workspace.reset') return resetWorkspace(state, context)
  const commandType = (command as { type: string }).type
  throw new DomainCommandError('COMMAND_NOT_FOUND', `Command is not implemented: ${commandType}.`, { commandType })
}

function upsertList(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'list.upsert' }>,
): CommandApplication {
  const list = structuredClone(command.list)
  if (list.groupId !== null && !state.listGroups.some(({ id, archivedAt }) => id === list.groupId && archivedAt === null)) {
    throw new DomainCommandError('LIST_GROUP_NOT_FOUND', `Study list group not found: ${list.groupId}.`, { groupId: list.groupId })
  }
  const index = state.lists.findIndex(({ id }) => id === list.id)
  const operation = index < 0 ? 'create' as const : 'update' as const
  if (index < 0) state.lists.push(list)
  else state.lists[index] = list
  const entity: EntityRef = { type: 'list', id: list.id }
  return application(entity, operation, ['list'], list)
}

function upsertListGroup(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'list_group.upsert' }>,
): CommandApplication {
  const group = structuredClone(command.group)
  const index = state.listGroups.findIndex(({ id }) => id === group.id)
  const operation = index < 0 ? 'create' as const : 'update' as const
  if (index < 0) state.listGroups.push(group)
  else state.listGroups[index] = group
  const entity: EntityRef = { type: 'list_group', id: group.id }
  return application(entity, operation, ['listGroup'], group)
}

function archiveListGroup(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'list_group.archive' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const group = state.listGroups.find(({ id, archivedAt }) => id === command.groupId && archivedAt === null)
  if (!group) {
    throw new DomainCommandError('LIST_GROUP_NOT_FOUND', `Study list group not found: ${command.groupId}.`, {
      groupId: command.groupId,
    })
  }
  group.archivedAt = context.now
  group.updatedAt = context.now
  const moved = state.lists.filter(({ groupId }) => groupId === group.id)
  for (const list of moved) {
    list.groupId = null
    list.updatedAt = context.now
  }
  const entity: EntityRef = { type: 'list_group', id: group.id }
  return {
    affected: [entity, ...moved.map(({ id }) => ({ type: 'list' as const, id }))],
    changes: [
      { entity, operation: 'update', fields: ['archivedAt'] },
      ...moved.map(({ id }) => ({ entity: { type: 'list' as const, id }, operation: 'update' as const, fields: ['groupId'] })),
    ],
    events: [],
    compensation: null,
    data: json(group),
  }
}

function planTask(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'task.plan' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  if (task.status === 'in_progress') {
    throw new DomainCommandError('TASK_INVALID_TRANSITION', 'Pause or finish the active task before replanning it.', {
      taskId: task.id,
    })
  }
  const fromStatus = task.status
  const wasPlanned = task.status === 'planned'
  const changed = applyTaskCommand(state, {
    type: 'task.update',
    taskId: task.id,
    expectedRevision: command.expectedRevision,
    patch: command.patch,
    reminderRuleId: command.reminderRuleId,
  }, context)
  const updated = requireTask(state, task.id)
  updated.status = 'planned'
  if (updated.learning) updated.learning.blockedReason = null
  const eventType: TaskEvent['type'] = fromStatus === 'completed' || fromStatus === 'cancelled'
    ? 'reopened'
    : wasPlanned ? 'rescheduled' : 'planned'
  const event = appendEvent(state, updated, eventType, fromStatus, 'planned', context, undefined, command.eventId)
  return {
    ...changed,
    changes: [{ entity: taskRef(updated), operation: 'update', fields: [...changed.changes[0]!.fields, 'status'] }],
    events: [event],
    data: json(updated),
  }
}

function transitionTask(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'task.transition' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  const fromStatus = task.status
  if (command.toStatus === 'blocked' && !command.reason?.trim()) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Blocking a Study task requires a reason.')
  }
  if (fromStatus === command.toStatus) {
    throw new DomainCommandError('TASK_INVALID_TRANSITION', `Study task is already ${command.toStatus}.`, { taskId: task.id })
  }
  const allowed: Record<Task['status'], readonly Task['status'][]> = {
    inbox: ['planned', 'cancelled'],
    planned: ['blocked', 'cancelled'],
    in_progress: ['blocked', 'cancelled'],
    blocked: ['planned', 'cancelled'],
    completed: ['planned'],
    cancelled: ['planned'],
  }
  if (!allowed[fromStatus].includes(command.toStatus)) {
    throw invalidTransition(task, command.toStatus)
  }
  if (fromStatus === 'in_progress') finishActiveTaskSession(state, task.id, context.now)
  task.status = command.toStatus
  if (task.learning) task.learning.blockedReason = command.toStatus === 'blocked' ? command.reason!.trim() : null
  advanceTask(task, context.now)
  const type: TaskEvent['type'] = command.toStatus === 'blocked'
    ? 'blocked'
    : command.toStatus === 'cancelled'
      ? 'cancelled'
      : fromStatus === 'completed' || fromStatus === 'cancelled' ? 'reopened' : 'planned'
  const event = appendEvent(state, task, type, fromStatus, command.toStatus, context, command.reason, command.eventId)
  return taskApplication(task, ['status'], [event])
}

function startTask(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'task.start' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  if (task.status !== 'planned' && task.status !== 'blocked') {
    throw new DomainCommandError('TASK_INVALID_TRANSITION', 'Only a planned or blocked Study task can be started.', { taskId: task.id })
  }
  assertNoActiveSession(state)
  const fromStatus = task.status
  task.status = 'in_progress'
  if (task.learning) task.learning.blockedReason = null
  advanceTask(task, context.now)
  const session = newSession(command.sessionId ?? context.id('session'), task.id, context.now)
  state.studySessions.push(session)
  const event = appendEvent(state, task, 'started', fromStatus, 'in_progress', context, undefined, command.eventId)
  return taskAndSessionApplication(task, session, [event])
}

function switchTask(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'task.switch' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const target = requireTask(state, command.taskId, command.expectedRevision)
  if (target.status !== 'planned' && target.status !== 'blocked') {
    throw new DomainCommandError('TASK_INVALID_TRANSITION', 'Only a planned or blocked Study task can be switched to.', { taskId: target.id })
  }
  const events: TaskEvent[] = []
  const affected: EntityRef[] = []
  const changes: CommandApplication['changes'] = []
  const active = activeSession(state)
  if (active) {
    if (active.taskId === target.id) {
      throw new DomainCommandError('TASK_INVALID_TRANSITION', 'The target Study task is already active.', { taskId: target.id })
    }
    const previous = requireTask(state, active.taskId)
    finishSession(active, context.now)
    previous.status = 'planned'
    if (previous.learning) previous.learning.blockedReason = null
    advanceTask(previous, context.now)
    events.push(appendEvent(
      state, previous, 'paused', 'in_progress', 'planned', context,
      command.reason ?? 'Switched to another Study task.', command.pausedEventId,
    ))
    affected.push(taskRef(previous), sessionRef(active))
    changes.push(
      { entity: taskRef(previous), operation: 'update', fields: ['status'] },
      { entity: sessionRef(active), operation: 'update', fields: ['state'] },
    )
  }
  const fromStatus = target.status
  target.status = 'in_progress'
  if (target.learning) target.learning.blockedReason = null
  advanceTask(target, context.now)
  const session = newSession(command.sessionId ?? context.id('session'), target.id, context.now)
  state.studySessions.push(session)
  events.push(appendEvent(state, target, 'started', fromStatus, 'in_progress', context, command.reason, command.eventId))
  affected.push(taskRef(target), sessionRef(session))
  changes.push(
    { entity: taskRef(target), operation: 'update', fields: ['status'] },
    { entity: sessionRef(session), operation: 'create', fields: ['session'] },
  )
  return { affected, changes, events, compensation: null, data: json({ task: target, session }) }
}

function pauseSession(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'session.pause' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const session = requireSession(state, command.sessionId)
  if (session.state !== 'running' || !session.activeSince) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Only a running Study session can be paused.')
  }
  const task = requireTask(state, session.taskId, command.expectedTaskRevision)
  session.elapsedSeconds += elapsedSeconds(session.activeSince, context.now)
  session.state = 'paused'
  session.activeSince = null
  session.updatedAt = context.now
  advanceTask(task, context.now)
  const event = appendEvent(state, task, 'paused', 'in_progress', 'in_progress', context, undefined, command.eventId)
  return sessionApplication(task, session, [event])
}

function resumeSession(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'session.resume' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const session = requireSession(state, command.sessionId)
  if (session.state !== 'paused') {
    throw new DomainCommandError('VALIDATION_ERROR', 'Only a paused Study session can be resumed.')
  }
  assertNoActiveSession(state, session.id)
  const task = requireTask(state, session.taskId, command.expectedTaskRevision)
  session.state = 'running'
  session.activeSince = context.now
  session.updatedAt = context.now
  advanceTask(task, context.now)
  const event = appendEvent(state, task, 'resumed', 'in_progress', 'in_progress', context, undefined, command.eventId)
  return sessionApplication(task, session, [event])
}

function updateScratchpad(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'session.scratchpad.update' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const session = requireSession(state, command.sessionId)
  const task = requireTask(state, session.taskId, command.expectedTaskRevision)
  session.scratchpad = command.scratchpad
  session.updatedAt = context.now
  advanceTask(task, context.now)
  return sessionApplication(task, session, [])
}

function addChecklistItem(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'task.checklist.add' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  const item = {
    id: command.itemId ?? context.id('checklist'),
    text: command.text,
    checked: false,
    checkedAt: null,
    position: task.checklist.length,
  }
  task.checklist.push(item)
  advanceTask(task, context.now)
  const entity: EntityRef = { type: 'checklist_item', id: item.id }
  return {
    affected: [taskRef(task), entity],
    changes: [{ entity, operation: 'create', fields: ['checklistItem'] }],
    events: [], compensation: null, data: json(item),
  }
}

function setChecklistItem(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'task.checklist.set' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  const item = task.checklist.find(({ id }) => id === command.itemId)
  if (!item) {
    throw new DomainCommandError('CHECKLIST_ITEM_NOT_FOUND', `Study checklist item not found: ${command.itemId}.`, {
      itemId: command.itemId,
    })
  }
  item.checked = command.checked
  item.checkedAt = command.checked ? context.now : null
  advanceTask(task, context.now)
  const entity: EntityRef = { type: 'checklist_item', id: item.id }
  return {
    affected: [taskRef(task), entity],
    changes: [{ entity, operation: 'update', fields: ['checked', 'checkedAt'] }],
    events: [], compensation: null, data: json(item),
  }
}

function reorderTasks(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'task.reorder' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  if (new Set(command.taskIds).size !== command.taskIds.length) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Study task order cannot contain duplicate ids.')
  }
  const ordered = command.taskIds.map((id) => requireTask(state, id))
  const orderedIds = new Set(command.taskIds)
  let index = 0
  state.tasks = state.tasks.map((task) => orderedIds.has(task.id) ? ordered[index++]! : task)
  for (const task of ordered) advanceTask(task, context.now)
  const affected = ordered.map(taskRef)
  return {
    affected,
    changes: affected.map((entity) => ({ entity, operation: 'update', fields: ['position'] })),
    events: [], compensation: null, data: json(ordered),
  }
}

function toggleCompletion(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'task.toggle_completion' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const task = requireTask(state, command.taskId, command.expectedRevision)
  if (task.status === 'cancelled') {
    throw new DomainCommandError('TASK_INVALID_TRANSITION', 'A cancelled Study task cannot be completion-toggled.', { taskId: task.id })
  }
  const fromStatus = task.status
  let event: TaskEvent
  if (fromStatus === 'completed') {
    task.status = task.schedule.startAt || task.schedule.startOn ? 'planned' : 'inbox'
    if (task.learning) task.learning.blockedReason = null
    advanceTask(task, context.now)
    event = appendEvent(state, task, 'reopened', fromStatus, task.status, context, undefined, command.eventId)
  } else {
    finishActiveTaskSession(state, task.id, context.now)
    task.status = 'completed'
    if (task.learning) task.learning.blockedReason = null
    advanceTask(task, context.now)
    event = appendEvent(state, task, 'completed', fromStatus, 'completed', context, undefined, command.eventId)
  }
  return taskApplication(task, ['status'], [event])
}

function reviewCompletion(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'completion.review' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const index = state.completionRecords.findIndex(({ id, deletedAt }) => id === command.recordId && deletedAt === null)
  if (index < 0) {
    throw new DomainCommandError('COMPLETION_RECORD_NOT_FOUND', `Completion record not found: ${command.recordId}.`, {
      recordId: command.recordId,
    })
  }
  const record = state.completionRecords[index]!
  const task = requireTask(state, record.taskId, command.expectedTaskRevision)
  const updated = applyReviewResult(record, command.result, command.reviewedOn, context.now)
  state.completionRecords[index] = updated
  advanceTask(task, context.now)
  const entity: EntityRef = { type: 'completion_record', id: updated.id }
  const application: CommandApplication = {
    affected: [taskRef(task), entity],
    changes: [{ entity, operation: 'update', fields: ['review'] }],
    events: [], compensation: null, data: json(updated),
  }
  for (const link of state.reviewTaskLinks) {
    if (link.completionRecordId !== record.id || link.completedAt !== null) continue
    link.completedAt = context.now
    link.updatedAt = context.now
    application.changes.push({ entity, operation: 'update', fields: ['reviewTaskLinks'] })
    const reviewTask = state.tasks.find(({ id }) => id === link.reviewTaskId)
    if (!reviewTask || reviewTask.deletedAt || reviewTask.status === 'completed' || reviewTask.status === 'cancelled') continue
    const fromStatus = reviewTask.status
    finishActiveTaskSession(state, reviewTask.id, context.now)
    reviewTask.status = 'completed'
    if (reviewTask.learning) reviewTask.learning.blockedReason = null
    advanceTask(reviewTask, context.now)
    const event = appendEvent(state, reviewTask, 'completed', fromStatus, 'completed', context, `Reviewed completion ${record.id}.`)
    application.affected.push(taskRef(reviewTask))
    application.changes.push({ entity: taskRef(reviewTask), operation: 'update', fields: ['status'] })
    application.events.push(event)
  }
  return application
}

function createNextAction(
  state: WorkspaceStateV3,
  command: Extract<LiveCompatibilityCommand, { type: 'completion.create_next_action' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const record = state.completionRecords.find(({ id, deletedAt }) => id === command.recordId && deletedAt === null)
  if (!record) {
    throw new DomainCommandError('COMPLETION_RECORD_NOT_FOUND', `Completion record not found: ${command.recordId}.`, {
      recordId: command.recordId,
    })
  }
  requireTask(state, record.taskId, command.expectedTaskRevision)
  const task: Task = {
    id: command.taskId ?? context.id('task'),
    revision: 1,
    mode: 'learning',
    listId: record.topicId ?? 'list:system:learning',
    sectionId: null,
    tagIds: [],
    title: record.nextAction,
    notes: '',
    status: command.startOn !== undefined ? 'planned' : 'inbox',
    schedule: { startAt: null, startOn: command.startOn ?? null, estimateMinutes: null },
    deadline: { dueAt: null, dueOn: null },
    priority: 'none',
    checklist: [],
    learning: { acceptanceCriteria: [], blockedReason: null },
    recurrenceSeriesId: null,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
  }
  if (state.tasks.some(({ id }) => id === task.id)) {
    throw new DomainCommandError('TASK_ALREADY_EXISTS', `Task already exists: ${task.id}.`, { taskId: task.id })
  }
  state.tasks.push(task)
  const event = appendEvent(
    state, task, task.status === 'planned' ? 'planned' : 'captured', null, task.status, context,
    `Created from completion ${record.id}.`, command.eventId,
  )
  const affected = taskRef(task)
  return {
    affected: [affected],
    changes: [{ entity: affected, operation: 'create', fields: ['task'] }],
    events: [event], compensation: { type: 'task.remove_created', taskIds: [task.id] }, data: json(task),
  }
}

function resetWorkspace(state: WorkspaceStateV3, context: CapabilityCommandContext): CommandApplication {
  const reset = parseWorkspaceStateOrMigrate(createSeedStudyState(context.now), context.now)
  reset.tags.push({
    id: 'tag:demo:math',
    title: '数学',
    position: 0,
    createdAt: context.now,
    updatedAt: context.now,
    archivedAt: null,
  })
  reset.commandReceipts = []
  delete state.reminderMigration
  const currentRevision = state.revision
  Object.assign(state, reset)
  const entity: EntityRef = { type: 'workspace', id: 'workspace', revision: currentRevision }
  return {
    affected: [entity],
    changes: [{ entity, operation: 'replace', fields: ['workspace'] }],
    events: [], compensation: null, data: { resetVersion: 3 },
  }
}

function requireTask(state: WorkspaceStateV3, taskId: string, expectedRevision?: number): Task {
  const task = state.tasks.find(({ id, deletedAt }) => id === taskId && deletedAt === null)
  if (!task) throw new DomainCommandError('TASK_NOT_FOUND', `Study task not found: ${taskId}.`, { taskId })
  if (expectedRevision !== undefined && task.revision !== expectedRevision) {
    throw new DomainCommandError(
      'ENTITY_REVISION_CONFLICT',
      `Study task revision conflict: expected ${expectedRevision}, found ${task.revision}.`,
      { taskId, expectedRevision, actualRevision: task.revision },
    )
  }
  return task
}

function requireSession(state: WorkspaceStateV3, sessionId: string): StudySession {
  const session = state.studySessions.find(({ id, deletedAt }) => id === sessionId && deletedAt === null)
  if (!session) throw new DomainCommandError('SESSION_NOT_FOUND', `Study session not found: ${sessionId}.`, { sessionId })
  return session
}

function activeSession(state: WorkspaceStateV3): StudySession | undefined {
  return state.studySessions.find(({ state: sessionState, deletedAt }) =>
    deletedAt === null && (sessionState === 'running' || sessionState === 'paused'))
}

function assertNoActiveSession(state: WorkspaceStateV3, exceptId?: string): void {
  const active = state.studySessions.find(({ id, state: sessionState, deletedAt }) =>
    id !== exceptId && deletedAt === null && (sessionState === 'running' || sessionState === 'paused'))
  if (active) throw new DomainCommandError('VALIDATION_ERROR', 'Another Study session is already active.')
}

function finishActiveTaskSession(state: WorkspaceStateV3, taskId: string, now: string): void {
  const session = state.studySessions.find(({ taskId: id, state: sessionState, deletedAt }) =>
    id === taskId && deletedAt === null && (sessionState === 'running' || sessionState === 'paused'))
  if (session) finishSession(session, now)
}

function finishSession(session: StudySession, now: string): void {
  if (session.state === 'running' && session.activeSince) {
    session.elapsedSeconds += elapsedSeconds(session.activeSince, now)
  }
  session.state = 'finished'
  session.activeSince = null
  session.updatedAt = now
}

function elapsedSeconds(from: string, to: string): number {
  const milliseconds = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Study session elapsed time cannot be negative.')
  }
  return Math.floor(milliseconds / 1000)
}

function newSession(id: string, taskId: string, now: string): StudySession {
  return {
    id, taskId, state: 'running', startedAt: now, activeSince: now,
    elapsedSeconds: 0, scratchpad: '', createdAt: now, updatedAt: now, deletedAt: null,
  }
}

function advanceTask(task: Task, now: string): void {
  task.revision += 1
  task.updatedAt = now
}

function appendEvent(
  state: WorkspaceStateV3,
  task: Task,
  type: TaskEvent['type'],
  fromStatus: TaskEvent['fromStatus'],
  toStatus: TaskEvent['toStatus'],
  context: CapabilityCommandContext,
  reason?: string,
  explicitId?: string,
): TaskEvent {
  const event: TaskEvent = {
    id: explicitId ?? context.id('event'),
    sequence: state.taskEvents.length + 1,
    taskId: task.id,
    type,
    occurredAt: context.now,
    fromStatus,
    toStatus,
    reason: reason?.trim() || null,
    completionRecordId: null,
  }
  state.taskEvents.push(event)
  return event
}

function taskApplication(task: Task, fields: string[], events: TaskEvent[]): CommandApplication {
  const entity = taskRef(task)
  return {
    affected: [entity],
    changes: [{ entity, operation: 'update', fields }],
    events, compensation: null, data: json(task),
  }
}

function taskAndSessionApplication(task: Task, session: StudySession, events: TaskEvent[]): CommandApplication {
  return {
    affected: [taskRef(task), sessionRef(session)],
    changes: [
      { entity: taskRef(task), operation: 'update', fields: ['status'] },
      { entity: sessionRef(session), operation: 'create', fields: ['session'] },
    ],
    events, compensation: null, data: json({ task, session }),
  }
}

function sessionApplication(task: Task, session: StudySession, events: TaskEvent[]): CommandApplication {
  return {
    affected: [taskRef(task), sessionRef(session)],
    changes: [{ entity: sessionRef(session), operation: 'update', fields: ['session'] }],
    events, compensation: null, data: json(session),
  }
}

function application(
  entity: EntityRef,
  operation: 'create' | 'update',
  fields: string[],
  data: unknown,
): CommandApplication {
  return {
    affected: [entity], changes: [{ entity, operation, fields }],
    events: [], compensation: null, data: json(data),
  }
}

function taskRef(task: Task): EntityRef {
  return { type: 'task', id: task.id, revision: task.revision }
}

function sessionRef(session: StudySession): EntityRef {
  return { type: 'session', id: session.id }
}

function invalidTransition(task: Task, target: string): DomainCommandError {
  return new DomainCommandError(
    'TASK_INVALID_TRANSITION',
    `Study task cannot transition from ${task.status} to ${target}.`,
    { taskId: task.id, fromStatus: task.status, target },
  )
}

function json(value: unknown): CommandApplication['data'] {
  return structuredClone(value) as CommandApplication['data']
}
