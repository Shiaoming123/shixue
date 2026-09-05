import { createTaskCapabilityService } from '../domain/capabilities/service.ts'
import {
  CAPABILITY_PROTOCOL_VERSION,
  type CapabilityCommand,
} from '../domain/capabilities/types.ts'
import { SYSTEM_LEARNING_LIST_ID } from '../domain/workspace/migrate.ts'
import type { Task, WorkspaceStateV3 } from '../domain/workspace/types.ts'
import { createWorkspaceExport, parseWorkspaceExport } from '../storage/workspace/data-port.ts'
import { getWorkspaceStore } from '../storage/workspace/registry.ts'
import type {
  CompletionRecord,
  ReviewResult,
  StudyListGroup,
  StudySession,
  StudyState,
  StudyTask,
  StudyTopic,
  TaskChecklistItem,
} from '../storage/study/types.ts'

export type {
  CompletionRecord,
  ReviewResult,
  ReviewStage,
  StudyListGroup,
  StudySession,
  StudySessionState,
  StudyState,
  StudyTask,
  StudyTaskPriority,
  StudyTaskStatus,
  StudyTopic,
  TaskChecklistItem,
  TaskEvent,
  TaskEventType,
} from '../storage/study/types.ts'

export interface StudyWriteOptions {
  now?: string
  expectedRevision?: number
}

export interface TaskCommandOptions extends StudyWriteOptions {
  eventId?: string
}

export interface BulkTaskTarget {
  taskId: string
  expectedRevision?: number
  eventId?: string
}

export interface BulkTaskCommandOptions extends StudyWriteOptions {
  reason?: string
}

export type StudyTaskMetadataUpdate = Partial<Pick<StudyTask,
  | 'topicId'
  | 'title'
  | 'notes'
  | 'plannedOn'
  | 'dueOn'
  | 'reminderAt'
  | 'priority'
  | 'estimateMinutes'
  | 'acceptanceCriteria'
>> & { plannedAt?: string | null }

export type StudyTaskCreationInput = Pick<StudyTask, 'title'> &
  Partial<Pick<StudyTask,
    | 'topicId'
    | 'notes'
    | 'plannedOn'
    | 'dueOn'
    | 'reminderAt'
    | 'priority'
    | 'estimateMinutes'
    | 'acceptanceCriteria'
  >>

export async function loadStudyState(): Promise<StudyState> {
  return projectWorkspaceState(await getWorkspaceStore().load())
}

export async function saveStudyTopic(topic: StudyTopic): Promise<void> {
  const workspace = await getWorkspaceStore().load()
  const current = workspace.lists.find(({ id }) => id === topic.id)
  await executeCommand({
    type: 'list.upsert',
    list: {
      id: topic.id,
      groupId: topic.groupId ?? null,
      title: topic.title,
      position: current?.position ?? workspace.lists.length,
      goal: topic.goal,
      successCriteria: [...topic.successCriteria],
      weeklyTargetMinutes: topic.weeklyTargetMinutes,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
      archivedAt: topic.archivedAt,
    },
  }, topic.updatedAt)
}

export async function saveStudyListGroup(group: StudyListGroup): Promise<void> {
  await executeCommand({ type: 'list_group.upsert', group: structuredClone(group) }, group.updatedAt)
}

export async function archiveStudyListGroup(
  groupId: string,
  archivedAt = new Date().toISOString(),
): Promise<void> {
  await executeCommand({ type: 'list_group.archive', groupId }, archivedAt)
}

export async function saveStudySession(
  session: StudySession,
  expectedRevision?: number,
): Promise<void> {
  const current = requireSession(await loadStudyState(), session.id)
  if (!sameSessionLifecycle(current, session)) {
    throw new Error('saveStudySession cannot change Study session lifecycle fields.')
  }
  await executeCommand({
    type: 'session.scratchpad.update',
    sessionId: session.id,
    scratchpad: session.scratchpad,
    expectedTaskRevision: expectedRevision,
  }, session.updatedAt)
}

export async function saveStudyScratchpad(
  sessionId: string,
  scratchpad: string,
  options: StudyWriteOptions = {},
): Promise<StudySession> {
  const now = commandTime(options.now)
  await executeCommand({
    type: 'session.scratchpad.update',
    sessionId,
    scratchpad,
    expectedTaskRevision: options.expectedRevision,
  }, now)
  return requireSession(await loadStudyState(), sessionId)
}

export async function captureStudyTask(
  input: StudyTaskCreationInput,
  options: TaskCommandOptions & { taskId?: string } = {},
): Promise<StudyTask> {
  const now = commandTime(options.now)
  assertStudyDateOrder(input.plannedOn ?? null, input.dueOn ?? null)
  const taskId = makeId('task', options.taskId)
  await executeCommand({
    type: 'task.create',
    taskId,
    eventId: makeId('event', options.eventId),
    reminderRuleId: input.reminderAt ? makeId('reminder') : undefined,
    listId: listIdForTopic(input.topicId ?? null),
    mode: 'learning',
    title: input.title,
    notes: input.notes ?? '',
    startOn: input.plannedOn ?? null,
    dueOn: input.dueOn ?? null,
    reminderAt: input.reminderAt ?? null,
    priority: input.priority ?? 'none',
    estimateMinutes: input.estimateMinutes ?? null,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
  }, now)
  return requireTask(await loadStudyState(), taskId, undefined, true)
}

export async function updateStudyTask(
  taskId: string,
  input: StudyTaskMetadataUpdate,
  options: StudyWriteOptions = {},
): Promise<StudyTask> {
  const current = requireTask(await loadStudyState(), taskId)
  assertStudyDateOrder(effectivePlanDate(input, current.plannedOn), input.dueOn ?? current.dueOn)
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.update',
    taskId,
    expectedRevision: options.expectedRevision,
    patch: taskPatch(input),
    reminderRuleId: typeof input.reminderAt === 'string' ? makeId('reminder') : undefined,
  }, now)
  return requireTask(await loadStudyState(), taskId)
}

export async function deleteStudyTask(
  taskId: string,
  options: TaskCommandOptions = {},
): Promise<StudyTask> {
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.delete', taskId, expectedRevision: options.expectedRevision,
    eventId: makeId('event', options.eventId),
  }, now)
  return requireTask(await loadStudyState(), taskId, undefined, true)
}

export async function bulkDeleteStudyTasks(
  targets: readonly BulkTaskTarget[],
  options: BulkTaskCommandOptions = {},
): Promise<StudyTask[]> {
  assertUniqueTargets(targets, 'Bulk Study task command cannot contain duplicate ids.')
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.batch_delete',
    taskIds: targets.map(({ taskId }) => taskId),
    expectedRevisions: targetRevisions(targets),
    eventIds: targetEventIds(targets),
    reason: options.reason,
  }, now)
  const state = await loadStudyState()
  return targets.map(({ taskId }) => requireTask(state, taskId, undefined, true))
}

export async function bulkCancelStudyTasks(
  targets: readonly BulkTaskTarget[],
  options: BulkTaskCommandOptions = {},
): Promise<StudyTask[]> {
  assertUniqueTargets(targets, 'Bulk Study task command cannot contain duplicate ids.')
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.batch_cancel',
    taskIds: targets.map(({ taskId }) => taskId),
    expectedRevisions: targetRevisions(targets),
    eventIds: targetEventIds(targets),
    reason: options.reason,
  }, now)
  const state = await loadStudyState()
  return targets.map(({ taskId }) => requireTask(state, taskId))
}

export async function bulkRescheduleStudyTasks(
  targets: readonly BulkTaskTarget[],
  plannedOn: string | null,
  options: BulkTaskCommandOptions = {},
): Promise<StudyTask[]> {
  assertUniqueTargets(targets, 'Bulk Study task command cannot contain duplicate ids.')
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.batch_reschedule',
    taskIds: targets.map(({ taskId }) => taskId),
    expectedRevisions: targetRevisions(targets),
    eventIds: targetEventIds(targets),
    startOn: plannedOn,
    reason: options.reason,
  }, now)
  const state = await loadStudyState()
  return targets.map(({ taskId }) => requireTask(state, taskId))
}

export async function planStudyTask(
  taskId: string,
  input: StudyTaskMetadataUpdate,
  options: TaskCommandOptions = {},
): Promise<StudyTask> {
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.plan',
    taskId,
    expectedRevision: options.expectedRevision,
    patch: taskPatch(input),
    eventId: makeId('event', options.eventId),
    reminderRuleId: typeof input.reminderAt === 'string' ? makeId('reminder') : undefined,
  }, now)
  return requireTask(await loadStudyState(), taskId)
}

export async function transitionStudyTask(
  taskId: string,
  toStatus: 'planned' | 'blocked' | 'cancelled',
  options: TaskCommandOptions & { reason?: string } = {},
): Promise<StudyTask> {
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.transition', taskId, toStatus, reason: options.reason,
    expectedRevision: options.expectedRevision, eventId: makeId('event', options.eventId),
  }, now)
  return requireTask(await loadStudyState(), taskId)
}

export async function startStudyTask(
  taskId: string,
  options: TaskCommandOptions & { sessionId?: string } = {},
): Promise<{ task: StudyTask; session: StudySession }> {
  const now = commandTime(options.now)
  const sessionId = makeId('session', options.sessionId)
  await executeCommand({
    type: 'task.start', taskId, sessionId,
    expectedRevision: options.expectedRevision, eventId: makeId('event', options.eventId),
  }, now)
  const state = await loadStudyState()
  return { task: requireTask(state, taskId), session: requireSession(state, sessionId) }
}

export async function rescheduleStudyTask(
  taskId: string,
  plannedOn: string | null,
  options: TaskCommandOptions & { reason?: string } = {},
): Promise<StudyTask> {
  const task = requireTask(await loadStudyState(), taskId, options.expectedRevision)
  if (task.status === 'inbox' || task.status === 'completed' || task.status === 'cancelled') {
    throw new Error('Only a planned, in-progress, or blocked Study task can be rescheduled.')
  }
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.reschedule', taskId, startOn: plannedOn, reason: options.reason,
    expectedRevision: options.expectedRevision, eventId: makeId('event', options.eventId),
  }, now)
  return requireTask(await loadStudyState(), taskId)
}

export async function switchStudyTask(
  taskId: string,
  options: TaskCommandOptions & {
    sessionId?: string
    pausedEventId?: string
    reason?: string
  } = {},
): Promise<{ task: StudyTask; session: StudySession }> {
  const now = commandTime(options.now)
  const sessionId = makeId('session', options.sessionId)
  await executeCommand({
    type: 'task.switch', taskId, sessionId, reason: options.reason,
    expectedRevision: options.expectedRevision,
    pausedEventId: makeId('event', options.pausedEventId),
    eventId: makeId('event', options.eventId),
  }, now)
  const state = await loadStudyState()
  return { task: requireTask(state, taskId), session: requireSession(state, sessionId) }
}

export async function pauseStudySession(
  sessionId: string,
  options: TaskCommandOptions = {},
): Promise<StudySession> {
  const now = commandTime(options.now)
  await executeCommand({
    type: 'session.pause', sessionId, expectedTaskRevision: options.expectedRevision,
    eventId: makeId('event', options.eventId),
  }, now)
  return requireSession(await loadStudyState(), sessionId)
}

export async function resumeStudySession(
  sessionId: string,
  options: TaskCommandOptions = {},
): Promise<StudySession> {
  const now = commandTime(options.now)
  await executeCommand({
    type: 'session.resume', sessionId, expectedTaskRevision: options.expectedRevision,
    eventId: makeId('event', options.eventId),
  }, now)
  return requireSession(await loadStudyState(), sessionId)
}

export async function addTaskChecklistItem(
  taskId: string,
  text: string,
  options: TaskCommandOptions & { itemId?: string } = {},
): Promise<TaskChecklistItem> {
  const now = commandTime(options.now)
  const itemId = makeId('check', options.itemId)
  await executeCommand({
    type: 'task.checklist.add', taskId, text, itemId,
    expectedRevision: options.expectedRevision,
  }, now)
  const task = requireTask(await loadStudyState(), taskId)
  const item = task.checklist.find(({ id }) => id === itemId)
  if (!item) throw new Error(`Study checklist item not found: ${itemId}.`)
  return structuredClone(item)
}

export async function setTaskChecklistItem(
  taskId: string,
  itemId: string,
  checked: boolean,
  now = new Date().toISOString(),
  expectedRevision?: number,
): Promise<TaskChecklistItem> {
  await executeCommand({ type: 'task.checklist.set', taskId, itemId, checked, expectedRevision }, commandTime(now))
  const task = requireTask(await loadStudyState(), taskId)
  const item = task.checklist.find(({ id }) => id === itemId)
  if (!item) throw new Error(`Study checklist item not found: ${itemId}.`)
  return structuredClone(item)
}

export async function reorderStudyTasks(
  taskIds: string[],
  options: Pick<TaskCommandOptions, 'now'> = {},
): Promise<StudyTask[]> {
  await executeCommand({ type: 'task.reorder', taskIds: [...taskIds] }, commandTime(options.now))
  const state = await loadStudyState()
  return taskIds.map((id) => requireTask(state, id))
}

export async function completeStudyTask(
  input: {
    taskId: string
    sessionId?: string
    learned: string
    evidence: string
    blocker?: string
    nextAction: string
    mastery?: CompletionRecord['mastery']
  },
  options: TaskCommandOptions & { recordId?: string } = {},
): Promise<{ task: StudyTask; record: CompletionRecord }> {
  const task = requireTask(await loadStudyState(), input.taskId, options.expectedRevision)
  if (task.status !== 'planned' && task.status !== 'in_progress') {
    throw new Error('Only a planned or in-progress Study task can be completed.')
  }
  const now = commandTime(options.now)
  const recordId = makeId('completion', options.recordId)
  await executeCommand({
    type: 'task.complete',
    taskId: input.taskId,
    sessionId: input.sessionId,
    learned: input.learned,
    evidence: input.evidence,
    blocker: input.blocker,
    nextAction: input.nextAction,
    mastery: input.mastery,
    expectedRevision: options.expectedRevision,
    eventId: makeId('event', options.eventId),
    recordId,
  }, now)
  const state = await loadStudyState()
  const record = state.completionRecords.find(({ id }) => id === recordId)
  if (!record) throw new Error(`Completion record not found: ${recordId}.`)
  return { task: requireTask(state, input.taskId), record: structuredClone(record) }
}

export async function toggleStudyTaskCompletion(
  taskId: string,
  options: TaskCommandOptions = {},
): Promise<StudyTask> {
  const now = commandTime(options.now)
  await executeCommand({
    type: 'task.toggle_completion', taskId, expectedRevision: options.expectedRevision,
    eventId: makeId('event', options.eventId),
  }, now)
  return requireTask(await loadStudyState(), taskId)
}

export async function reviewCompletionRecord(
  recordId: string,
  result: ReviewResult,
  reviewedOn: string,
  options: TaskCommandOptions = {},
): Promise<CompletionRecord> {
  await executeCommand({
    type: 'completion.review', recordId, result, reviewedOn,
    expectedTaskRevision: options.expectedRevision,
  }, commandTime(options.now))
  const record = (await loadStudyState()).completionRecords.find(({ id }) => id === recordId)
  if (!record) throw new Error(`Completion record not found: ${recordId}.`)
  return structuredClone(record)
}

export async function createTaskFromNextAction(
  recordId: string,
  options: TaskCommandOptions & { taskId?: string; plannedOn?: string | null } = {},
): Promise<StudyTask> {
  const taskId = makeId('task', options.taskId)
  await executeCommand({
    type: 'completion.create_next_action', recordId, taskId,
    startOn: options.plannedOn,
    expectedTaskRevision: options.expectedRevision,
    eventId: makeId('event', options.eventId),
  }, commandTime(options.now))
  return requireTask(await loadStudyState(), taskId)
}

export async function exportStudyState(exportedAt?: string): Promise<string> {
  return JSON.stringify(createWorkspaceExport(await getWorkspaceStore().load(), exportedAt))
}

export async function importStudyState(content: string): Promise<StudyState> {
  const imported = parseWorkspaceExport(content)
  await executeCommand({ type: 'workspace.import', state: imported.state }, imported.exportedAt)
  return loadStudyState()
}

export async function resetStudyState(now = new Date().toISOString()): Promise<StudyState> {
  await executeCommand({ type: 'workspace.reset' }, commandTime(now))
  return loadStudyState()
}

export function projectWorkspaceState(workspace: WorkspaceStateV3): StudyState {
  const reminders = new Map<string, string>()
  for (const rule of workspace.reminderRules) {
    if (rule.enabled && rule.occurrenceId === null && rule.trigger.kind === 'absolute' && !reminders.has(rule.taskId)) {
      reminders.set(rule.taskId, rule.trigger.at)
    }
  }
  return {
    version: 2,
    listGroups: structuredClone(workspace.listGroups),
    topics: workspace.lists
      .filter(({ id }) => id !== SYSTEM_LEARNING_LIST_ID)
      .map((list) => ({
        id: list.id,
        groupId: list.groupId,
        title: list.title,
        goal: list.goal,
        successCriteria: [...list.successCriteria],
        weeklyTargetMinutes: list.weeklyTargetMinutes ?? 1,
        createdAt: list.createdAt,
        updatedAt: list.updatedAt,
        archivedAt: list.archivedAt,
      })),
    tasks: workspace.tasks.map((task) => projectTask(task, reminders.get(task.id) ?? null)),
    sessions: structuredClone(workspace.studySessions),
    taskEvents: structuredClone(workspace.taskEvents),
    completionRecords: structuredClone(workspace.completionRecords),
    updatedAt: workspace.updatedAt,
  }
}

async function executeCommand(command: CapabilityCommand, now: string): Promise<void> {
  const store = getWorkspaceStore()
  const current = await store.load()
  const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:${crypto.randomUUID()}`)
  await service.execute({
    protocolVersion: CAPABILITY_PROTOCOL_VERSION,
    idempotencyKey: `study:${crypto.randomUUID()}`,
    source: 'human-ui',
    expectedWorkspaceRevision: current.revision,
    command: withoutUndefinedFields(command),
  })
}

function withoutUndefinedFields<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as T
}

function taskPatch(input: StudyTaskMetadataUpdate) {
  const patch: Extract<CapabilityCommand, { type: 'task.update' }>['patch'] = {}
  if (input.topicId !== undefined) patch.listId = listIdForTopic(input.topicId)
  if (input.title !== undefined) patch.title = input.title
  if (input.notes !== undefined) patch.notes = input.notes
  if (input.plannedAt !== undefined) {
    patch.startAt = input.plannedAt
    patch.startOn = null
  } else if (input.plannedOn !== undefined) {
    patch.startAt = null
    patch.startOn = input.plannedOn
  }
  if (input.dueOn !== undefined) patch.dueOn = input.dueOn
  if (input.reminderAt !== undefined) patch.reminderAt = input.reminderAt
  if (input.priority !== undefined) patch.priority = input.priority
  if (input.estimateMinutes !== undefined) patch.estimateMinutes = input.estimateMinutes
  if (input.acceptanceCriteria !== undefined) patch.acceptanceCriteria = [...input.acceptanceCriteria]
  return patch
}

function effectivePlanDate(input: StudyTaskMetadataUpdate, currentPlannedOn: string | null): string | null {
  if (input.plannedAt !== undefined) return input.plannedAt?.slice(0, 10) ?? null
  return input.plannedOn ?? currentPlannedOn
}

function projectTask(task: Task, reminderAt: string | null): StudyTask {
  return {
    id: task.id,
    revision: task.revision,
    topicId: task.listId === SYSTEM_LEARNING_LIST_ID ? null : task.listId,
    title: task.title,
    notes: task.notes,
    status: task.status,
    plannedOn: task.schedule.startOn ?? task.schedule.startAt?.slice(0, 10) ?? null,
    dueOn: task.deadline.dueOn ?? task.deadline.dueAt?.slice(0, 10) ?? null,
    reminderAt,
    priority: task.priority,
    estimateMinutes: task.schedule.estimateMinutes,
    acceptanceCriteria: [...(task.learning?.acceptanceCriteria ?? [])],
    checklist: structuredClone(task.checklist),
    blockedReason: task.learning?.blockedReason ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    deletedAt: task.deletedAt,
  }
}

function listIdForTopic(topicId: string | null): string {
  return topicId ?? SYSTEM_LEARNING_LIST_ID
}

function requireTask(
  state: StudyState,
  taskId: string,
  expectedRevision?: number,
  includeDeleted = false,
): StudyTask {
  const task = state.tasks.find(({ id, deletedAt }) => id === taskId && (includeDeleted || deletedAt === null))
  if (!task) throw new Error(`Study task not found: ${taskId}.`)
  if (expectedRevision !== undefined && task.revision !== expectedRevision) {
    throw new Error(`Study task revision conflict: expected ${expectedRevision}, found ${task.revision}.`)
  }
  return structuredClone(task)
}

function requireSession(state: StudyState, sessionId: string): StudySession {
  const session = state.sessions.find(({ id, deletedAt }) => id === sessionId && deletedAt === null)
  if (!session) throw new Error(`Study session not found: ${sessionId}.`)
  return structuredClone(session)
}

function sameSessionLifecycle(current: StudySession, candidate: StudySession): boolean {
  return current.id === candidate.id &&
    current.taskId === candidate.taskId &&
    current.state === candidate.state &&
    current.startedAt === candidate.startedAt &&
    current.activeSince === candidate.activeSince &&
    current.elapsedSeconds === candidate.elapsedSeconds &&
    current.createdAt === candidate.createdAt &&
    current.deletedAt === candidate.deletedAt
}

function assertStudyDateOrder(plannedOn: string | null, dueOn: string | null): void {
  if (plannedOn && dueOn && dueOn < plannedOn) throw new Error('Study task dueOn cannot precede plannedOn.')
}

function assertUniqueTargets(targets: readonly BulkTaskTarget[], message: string): void {
  if (new Set(targets.map(({ taskId }) => taskId)).size !== targets.length) throw new Error(message)
}

function targetRevisions(targets: readonly BulkTaskTarget[]): Record<string, number> | undefined {
  const entries = targets.flatMap(({ taskId, expectedRevision }) =>
    expectedRevision === undefined ? [] : [[taskId, expectedRevision] as const])
  return entries.length ? Object.fromEntries(entries) : undefined
}

function targetEventIds(targets: readonly BulkTaskTarget[]): Record<string, string> {
  return Object.fromEntries(targets.map(({ taskId, eventId }) => [taskId, makeId('event', eventId)]))
}

function commandTime(value = new Date().toISOString()): string {
  if (!value) throw new Error('Study command requires a timestamp.')
  return value
}

function makeId(prefix: string, explicit?: string): string {
  return explicit ?? `${prefix}:${crypto.randomUUID()}`
}
