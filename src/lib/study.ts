import { createStudyExport, parseStudyExport } from '../storage/study/data-port.ts'
import { getStudyStore } from '../storage/study/registry.ts'
import {
  applyReviewResult,
  nextReviewDate,
  parseStudyState,
  type CompletionRecord,
  type ReviewResult,
  type StudySession,
  type StudyState,
  type StudyTask,
  type StudyTaskStatus,
  type StudyTopic,
  type TaskChecklistItem,
  type TaskEvent,
  type TaskEventType,
} from '../storage/study/types.ts'

export type {
  CompletionRecord,
  ReviewResult,
  ReviewStage,
  StudySession,
  StudySessionState,
  StudyState,
  StudyTask,
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

export function loadStudyState(): Promise<StudyState> {
  return getStudyStore().load()
}

export async function saveStudyState(
  state: StudyState,
  expectedUpdatedAt?: string,
): Promise<void> {
  await getStudyStore().save(parseStudyState(state), expectedUpdatedAt)
}

export async function saveStudyTopic(topic: StudyTopic): Promise<void> {
  const current = await loadStudyState()
  const index = current.topics.findIndex(({ id }) => id === topic.id)
  if (index >= 0) current.topics[index] = structuredClone(topic)
  else current.topics.push(structuredClone(topic))
  await persist(current, topic.updatedAt)
}

export async function saveStudySession(
  session: StudySession,
  expectedRevision?: number,
): Promise<void> {
  const state = await loadStudyState()
  const index = state.sessions.findIndex(({ id }) => id === session.id)
  if (index < 0) throw new Error(`Study session not found: ${session.id}.`)
  const current = state.sessions[index]
  if (!sameSessionLifecycle(current, session)) {
    throw new Error('saveStudySession cannot change Study session lifecycle fields.')
  }
  const task = requireTask(state, current.taskId, expectedRevision)
  current.scratchpad = session.scratchpad
  current.updatedAt = session.updatedAt
  advanceTask(task, session.updatedAt)
  await persist(state, session.updatedAt)
}

export async function saveStudyScratchpad(
  sessionId: string,
  scratchpad: string,
  options: StudyWriteOptions = {},
): Promise<StudySession> {
  const state = await loadStudyState()
  const session = requireSession(state, sessionId)
  const task = requireTask(state, session.taskId, options.expectedRevision)
  const now = commandTime(options.now)
  session.scratchpad = scratchpad
  session.updatedAt = now
  advanceTask(task, now)
  await persist(state, now)
  return structuredClone(session)
}

export async function captureStudyTask(
  input: { title: string; notes?: string },
  options: TaskCommandOptions & { taskId?: string } = {},
): Promise<StudyTask> {
  const state = await loadStudyState()
  const now = commandTime(options.now)
  const task: StudyTask = {
    id: makeId('task', options.taskId), revision: 1, topicId: null,
    title: input.title, notes: input.notes ?? '', status: 'inbox',
    plannedOn: null, dueOn: null, estimateMinutes: null,
    acceptanceCriteria: [], checklist: [], blockedReason: null,
    createdAt: now, updatedAt: now, deletedAt: null,
  }
  state.tasks.push(task)
  appendEvent(state, task, 'captured', null, 'inbox', options.eventId, now)
  await persist(state, now)
  return structuredClone(task)
}

export async function planStudyTask(
  taskId: string,
  input: {
    topicId?: string | null
    title?: string
    notes?: string
    plannedOn?: string | null
    dueOn?: string | null
    estimateMinutes?: number | null
    acceptanceCriteria?: string[]
  },
  options: TaskCommandOptions = {},
): Promise<StudyTask> {
  const state = await loadStudyState()
  const task = requireTask(state, taskId, options.expectedRevision)
  if (task.status === 'in_progress') throw new Error('Pause or finish the active task before replanning it.')
  const before = task.status
  const wasPlanned = task.status === 'planned'
  Object.assign(task, withoutUndefined(input))
  task.status = 'planned'
  task.blockedReason = null
  advanceTask(task, commandTime(options.now))
  const type: TaskEventType =
    before === 'completed' || before === 'cancelled'
      ? 'reopened'
      : wasPlanned ? 'rescheduled' : 'planned'
  appendEvent(state, task, type, before, 'planned', options.eventId, task.updatedAt)
  await persist(state, task.updatedAt)
  return structuredClone(task)
}

export async function transitionStudyTask(
  taskId: string,
  toStatus: 'planned' | 'blocked' | 'cancelled',
  options: TaskCommandOptions & { reason?: string } = {},
): Promise<StudyTask> {
  const state = await loadStudyState()
  const task = requireTask(state, taskId, options.expectedRevision)
  const fromStatus = task.status
  if (toStatus === 'blocked' && !options.reason?.trim()) throw new Error('Blocking a Study task requires a reason.')
  if (fromStatus === toStatus) throw new Error(`Study task is already ${toStatus}.`)
  const allowed: Record<StudyTaskStatus, readonly StudyTaskStatus[]> = {
    inbox: ['planned', 'cancelled'],
    planned: ['blocked', 'cancelled'],
    in_progress: ['blocked', 'cancelled'],
    blocked: ['planned', 'cancelled'],
    completed: ['planned'],
    cancelled: ['planned'],
  }
  if (!allowed[fromStatus].includes(toStatus)) {
    throw new Error(`Study task cannot transition from ${fromStatus} to ${toStatus}.`)
  }
  const now = commandTime(options.now)
  if (fromStatus === 'in_progress') {
    const active = state.sessions.find(({ taskId: id, state, deletedAt }) =>
      id === taskId && !deletedAt && (state === 'running' || state === 'paused'))
    if (active) finishSession(active, now)
  }
  task.status = toStatus
  task.blockedReason = toStatus === 'blocked' ? options.reason!.trim() : null
  advanceTask(task, now)
  const type: TaskEventType = toStatus === 'blocked'
    ? 'blocked'
    : toStatus === 'cancelled'
      ? 'cancelled'
      : fromStatus === 'completed' || fromStatus === 'cancelled' ? 'reopened' : 'planned'
  appendEvent(state, task, type, fromStatus, toStatus, options.eventId, now, options.reason)
  await persist(state, now)
  return structuredClone(task)
}

export async function startStudyTask(
  taskId: string,
  options: TaskCommandOptions & { sessionId?: string } = {},
): Promise<{ task: StudyTask; session: StudySession }> {
  const state = await loadStudyState()
  const task = requireTask(state, taskId, options.expectedRevision)
  if (task.status !== 'planned' && task.status !== 'blocked') throw new Error('Only a planned or blocked Study task can be started.')
  assertNoActiveSession(state)
  const now = commandTime(options.now)
  const fromStatus = task.status
  task.status = 'in_progress'
  task.blockedReason = null
  advanceTask(task, now)
  const session: StudySession = {
    id: makeId('session', options.sessionId), taskId, state: 'running',
    startedAt: now, activeSince: now, elapsedSeconds: 0, scratchpad: '',
    createdAt: now, updatedAt: now, deletedAt: null,
  }
  state.sessions.push(session)
  appendEvent(state, task, 'started', fromStatus, 'in_progress', options.eventId, now)
  await persist(state, now)
  return { task: structuredClone(task), session: structuredClone(session) }
}

export async function rescheduleStudyTask(
  taskId: string,
  plannedOn: string | null,
  options: TaskCommandOptions & { reason?: string } = {},
): Promise<StudyTask> {
  const state = await loadStudyState()
  const task = requireTask(state, taskId, options.expectedRevision)
  if (task.status === 'inbox' || task.status === 'completed' || task.status === 'cancelled') {
    throw new Error('Only a planned, in-progress, or blocked Study task can be rescheduled.')
  }
  const now = commandTime(options.now)
  const session = state.sessions.find(({ taskId: id, state, deletedAt }) =>
    id === taskId && !deletedAt && (state === 'running' || state === 'paused'))
  if (session) finishSession(session, now)
  const fromStatus = task.status
  task.status = 'planned'
  task.plannedOn = plannedOn
  task.blockedReason = null
  advanceTask(task, now)
  appendEvent(state, task, 'rescheduled', fromStatus, 'planned', options.eventId, now, options.reason)
  await persist(state, now)
  return structuredClone(task)
}

export async function switchStudyTask(
  taskId: string,
  options: TaskCommandOptions & {
    sessionId?: string
    pausedEventId?: string
    reason?: string
  } = {},
): Promise<{ task: StudyTask; session: StudySession }> {
  const state = await loadStudyState()
  const target = requireTask(state, taskId, options.expectedRevision)
  if (target.status !== 'planned' && target.status !== 'blocked') {
    throw new Error('Only a planned or blocked Study task can be switched to.')
  }
  const now = commandTime(options.now)
  const active = state.sessions.find(({ state, deletedAt }) =>
    !deletedAt && (state === 'running' || state === 'paused'))
  if (active) {
    if (active.taskId === taskId) throw new Error('The target Study task is already active.')
    const previous = requireTask(state, active.taskId)
    finishSession(active, now)
    previous.status = 'planned'
    previous.blockedReason = null
    advanceTask(previous, now)
    appendEvent(state, previous, 'paused', 'in_progress', 'planned', options.pausedEventId, now, options.reason ?? 'Switched to another Study task.')
  }
  const fromStatus = target.status
  target.status = 'in_progress'
  target.blockedReason = null
  advanceTask(target, now)
  const session: StudySession = {
    id: makeId('session', options.sessionId), taskId, state: 'running',
    startedAt: now, activeSince: now, elapsedSeconds: 0, scratchpad: '',
    createdAt: now, updatedAt: now, deletedAt: null,
  }
  state.sessions.push(session)
  appendEvent(state, target, 'started', fromStatus, 'in_progress', options.eventId, now, options.reason)
  await persist(state, now)
  return { task: structuredClone(target), session: structuredClone(session) }
}

export async function pauseStudySession(
  sessionId: string,
  options: TaskCommandOptions = {},
): Promise<StudySession> {
  const state = await loadStudyState()
  const session = requireSession(state, sessionId)
  if (session.state !== 'running' || !session.activeSince) throw new Error('Only a running Study session can be paused.')
  const task = requireTask(state, session.taskId, options.expectedRevision)
  const now = commandTime(options.now)
  session.elapsedSeconds += elapsedSeconds(session.activeSince, now)
  session.state = 'paused'
  session.activeSince = null
  session.updatedAt = now
  advanceTask(task, now)
  appendEvent(state, task, 'paused', 'in_progress', 'in_progress', options.eventId, now)
  await persist(state, now)
  return structuredClone(session)
}

export async function resumeStudySession(
  sessionId: string,
  options: TaskCommandOptions = {},
): Promise<StudySession> {
  const state = await loadStudyState()
  const session = requireSession(state, sessionId)
  if (session.state !== 'paused') throw new Error('Only a paused Study session can be resumed.')
  assertNoActiveSession(state, sessionId)
  const task = requireTask(state, session.taskId, options.expectedRevision)
  const now = commandTime(options.now)
  session.state = 'running'
  session.activeSince = now
  session.updatedAt = now
  advanceTask(task, now)
  appendEvent(state, task, 'resumed', 'in_progress', 'in_progress', options.eventId, now)
  await persist(state, now)
  return structuredClone(session)
}

export async function addTaskChecklistItem(
  taskId: string,
  text: string,
  options: TaskCommandOptions & { itemId?: string } = {},
): Promise<TaskChecklistItem> {
  const state = await loadStudyState()
  const task = requireTask(state, taskId, options.expectedRevision)
  const item: TaskChecklistItem = {
    id: makeId('check', options.itemId), text, checked: false,
    checkedAt: null, position: task.checklist.length,
  }
  task.checklist.push(item)
  const now = commandTime(options.now)
  advanceTask(task, now)
  await persist(state, now)
  return structuredClone(item)
}

export async function setTaskChecklistItem(
  taskId: string,
  itemId: string,
  checked: boolean,
  now = new Date().toISOString(),
  expectedRevision?: number,
): Promise<TaskChecklistItem> {
  const state = await loadStudyState()
  const task = requireTask(state, taskId, expectedRevision)
  const item = task.checklist.find(({ id }) => id === itemId)
  if (!item) throw new Error(`Study checklist item not found: ${itemId}.`)
  item.checked = checked
  item.checkedAt = checked ? commandTime(now) : null
  advanceTask(task, commandTime(now))
  await persist(state, task.updatedAt)
  return structuredClone(item)
}

export async function reorderStudyTasks(
  taskIds: string[],
  options: Pick<TaskCommandOptions, 'now'> = {},
): Promise<StudyTask[]> {
  if (new Set(taskIds).size !== taskIds.length) {
    throw new Error('Study task order cannot contain duplicate ids.')
  }
  const state = await loadStudyState()
  const ordered = taskIds.map((id) => requireTask(state, id))
  const orderedIds = new Set(taskIds)
  let orderedIndex = 0
  state.tasks = state.tasks.map((task) =>
    orderedIds.has(task.id) ? ordered[orderedIndex++] : task,
  )
  const now = commandTime(options.now)
  for (const task of ordered) advanceTask(task, now)
  await persist(state, now)
  return structuredClone(ordered)
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
  const state = await loadStudyState()
  const task = requireTask(state, input.taskId, options.expectedRevision)
  if (task.status !== 'planned' && task.status !== 'in_progress') {
    throw new Error('Only a planned or in-progress Study task can be completed.')
  }
  const now = commandTime(options.now)
  const sessions = input.sessionId ? [requireSession(state, input.sessionId)] : []
  for (const session of sessions) {
    if (session.taskId !== task.id) throw new Error('Completion session belongs to another Study task.')
    if (session.state === 'running' && session.activeSince) session.elapsedSeconds += elapsedSeconds(session.activeSince, now)
    session.state = 'finished'
    session.activeSince = null
    session.updatedAt = now
  }
  const fromStatus = task.status
  task.status = 'completed'
  task.blockedReason = null
  advanceTask(task, now)
  const record: CompletionRecord = {
    id: makeId('completion', options.recordId), taskId: task.id, topicId: task.topicId,
    sessionIds: sessions.map(({ id }) => id), taskTitleSnapshot: task.title,
    learned: input.learned, evidence: input.evidence, blocker: input.blocker ?? '',
    nextAction: input.nextAction, mastery: input.mastery ?? null, completedAt: now,
    reviewStage: 0, nextReviewOn: nextReviewDate(now.slice(0, 10), 0),
    lastReviewResult: null, lastReviewedAt: null, createdAt: now, updatedAt: now,
    deletedAt: null,
  }
  state.completionRecords.push(record)
  appendEvent(state, task, 'completed', fromStatus, 'completed', options.eventId, now, undefined, record.id)
  await persist(state, now)
  return { task: structuredClone(task), record: structuredClone(record) }
}

export async function reviewCompletionRecord(
  recordId: string,
  result: ReviewResult,
  reviewedOn: string,
  options: TaskCommandOptions = {},
): Promise<CompletionRecord> {
  const state = await loadStudyState()
  const index = state.completionRecords.findIndex(({ id }) => id === recordId)
  if (index < 0) throw new Error(`Completion record not found: ${recordId}.`)
  const task = requireTask(state, state.completionRecords[index].taskId, options.expectedRevision)
  const now = commandTime(options.now)
  state.completionRecords[index] = applyReviewResult(state.completionRecords[index], result, reviewedOn, now)
  advanceTask(task, now)
  await persist(state, now)
  return structuredClone(state.completionRecords[index])
}

export async function createTaskFromNextAction(
  recordId: string,
  options: TaskCommandOptions & { taskId?: string; plannedOn?: string | null } = {},
): Promise<StudyTask> {
  const state = await loadStudyState()
  const record = state.completionRecords.find(({ id }) => id === recordId)
  if (!record || record.deletedAt) throw new Error(`Completion record not found: ${recordId}.`)
  requireTask(state, record.taskId, options.expectedRevision)
  const now = commandTime(options.now)
  const planned = options.plannedOn !== undefined
  const task: StudyTask = {
    id: makeId('task', options.taskId), revision: 1, topicId: record.topicId,
    title: record.nextAction, notes: '', status: planned ? 'planned' : 'inbox',
    plannedOn: options.plannedOn ?? null, dueOn: null, estimateMinutes: null,
    acceptanceCriteria: [], checklist: [], blockedReason: null,
    createdAt: now, updatedAt: now, deletedAt: null,
  }
  state.tasks.push(task)
  appendEvent(state, task, planned ? 'planned' : 'captured', null, task.status, options.eventId, now, `Created from completion ${recordId}.`)
  await persist(state, now)
  return structuredClone(task)
}

export async function exportStudyState(exportedAt?: string): Promise<string> {
  return JSON.stringify(createStudyExport(await loadStudyState(), exportedAt))
}

export async function importStudyState(content: string): Promise<StudyState> {
  const imported = parseStudyExport(content).state
  await saveStudyState(imported)
  return structuredClone(imported)
}

async function persist(state: StudyState, now: string): Promise<void> {
  const expectedUpdatedAt = state.updatedAt
  state.updatedAt = nextSnapshotUpdatedAt(expectedUpdatedAt, now)
  await saveStudyState(state, expectedUpdatedAt)
}

function nextSnapshotUpdatedAt(current: string, proposed: string): string {
  if (proposed !== current) return proposed
  const milliseconds = Date.parse(current)
  if (!Number.isFinite(milliseconds)) {
    throw new Error('Study snapshot updatedAt must be a valid timestamp.')
  }
  return new Date(milliseconds + 1).toISOString()
}

function advanceTask(task: StudyTask, now: string): void {
  task.revision += 1
  task.updatedAt = now
}

function requireTask(state: StudyState, taskId: string, expectedRevision?: number): StudyTask {
  const task = state.tasks.find(({ id, deletedAt }) => id === taskId && !deletedAt)
  if (!task) throw new Error(`Study task not found: ${taskId}.`)
  if (expectedRevision !== undefined && task.revision !== expectedRevision) {
    throw new Error(`Study task revision conflict: expected ${expectedRevision}, found ${task.revision}.`)
  }
  return task
}

function requireSession(state: StudyState, sessionId: string): StudySession {
  const session = state.sessions.find(({ id, deletedAt }) => id === sessionId && !deletedAt)
  if (!session) throw new Error(`Study session not found: ${sessionId}.`)
  return session
}

function assertNoActiveSession(state: StudyState, exceptId?: string): void {
  const active = state.sessions.find(({ id, state, deletedAt }) =>
    id !== exceptId && !deletedAt && (state === 'running' || state === 'paused'))
  if (active) throw new Error('Another Study session is already active.')
}

function appendEvent(
  state: StudyState,
  task: StudyTask,
  type: TaskEventType,
  fromStatus: StudyTaskStatus | null,
  toStatus: StudyTaskStatus | null,
  explicitId: string | undefined,
  occurredAt: string,
  reason?: string,
  completionRecordId?: string,
): void {
  const event: TaskEvent = {
    id: makeId('event', explicitId),
    sequence: state.taskEvents.reduce((max, item) => Math.max(max, item.sequence), 0) + 1,
    taskId: task.id, type, occurredAt, fromStatus, toStatus,
    reason: reason?.trim() || null, completionRecordId: completionRecordId ?? null,
  }
  state.taskEvents.push(event)
}

function commandTime(value = new Date().toISOString()): string {
  if (!value) throw new Error('Study command requires a timestamp.')
  return value
}

function elapsedSeconds(from: string, to: string): number {
  const milliseconds = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Study session elapsed time cannot be negative.')
  return Math.floor(milliseconds / 1000)
}

function finishSession(session: StudySession, now: string): void {
  if (session.state === 'running' && session.activeSince) {
    session.elapsedSeconds += elapsedSeconds(session.activeSince, now)
  }
  session.state = 'finished'
  session.activeSince = null
  session.updatedAt = now
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

function makeId(prefix: string, explicit?: string): string {
  return explicit ?? `${prefix}:${crypto.randomUUID()}`
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
