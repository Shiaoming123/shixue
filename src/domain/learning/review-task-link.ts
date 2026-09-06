import type { CompletionRecord, ReviewTaskLink, Task, WorkspaceStateV3 } from '../workspace/types.ts'
import type { ReviewResult } from '../../storage/study/types.ts'
import { DomainCommandError, type CapabilityCommandContext } from '../capabilities/types.ts'

export interface EnsuredReviewTask {
  task: Task
  link: ReviewTaskLink
  created: boolean
}

export function ensureReviewTask(
  state: WorkspaceStateV3,
  completionRecordId: string,
  dueOn: string,
  context: CapabilityCommandContext,
  occurrenceId: string | null = null,
): EnsuredReviewTask {
  const record = state.completionRecords.find(({ id, deletedAt }) => id === completionRecordId && deletedAt === null)
  if (!record) throw new DomainCommandError('COMPLETION_RECORD_NOT_FOUND', `Completion record not found: ${completionRecordId}.`, { completionRecordId })
  const existing = state.reviewTaskLinks.find((link) =>
    link.completionRecordId === completionRecordId &&
    link.reviewStage === record.reviewStage &&
    link.dueOn === dueOn &&
    link.occurrenceId === occurrenceId)
  if (existing) {
    const task = state.tasks.find(({ id }) => id === existing.reviewTaskId)
    if (!task) throw new DomainCommandError('TASK_NOT_FOUND', `Review task not found: ${existing.reviewTaskId}.`, { taskId: existing.reviewTaskId })
    return { task, link: existing, created: false }
  }
  const source = requireSourceTask(state, record)
  const suffix = `${record.id}:${record.reviewStage}:${dueOn}${occurrenceId ? `:${occurrenceId}` : ''}`
  const task: Task = {
    id: `task:review:${suffix}`,
    revision: 1,
    mode: 'learning',
    listId: source.listId,
    sectionId: null,
    tagIds: [],
    title: `复习 · ${record.taskTitleSnapshot}`,
    notes: '',
    status: 'planned',
    schedule: { startAt: null, startOn: dueOn, estimateMinutes: null },
    deadline: { dueAt: null, dueOn },
    priority: 'none',
    checklist: [],
    learning: { acceptanceCriteria: [], blockedReason: null },
    recurrenceSeriesId: null,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
  }
  const link: ReviewTaskLink = {
    id: `review-link:${suffix}`,
    completionRecordId: record.id,
    reviewTaskId: task.id,
    occurrenceId,
    reviewStage: record.reviewStage,
    dueOn,
    completedAt: null,
    completion: null,
    createdAt: context.now,
    updatedAt: context.now,
  }
  if (state.tasks.some(({ id }) => id === task.id) || state.reviewTaskLinks.some(({ id }) => id === link.id)) {
    throw new DomainCommandError('VALIDATION_ERROR', `Review task identity conflict: ${link.id}.`, { linkId: link.id })
  }
  state.tasks.push(task)
  state.reviewTaskLinks.push(link)
  state.taskEvents.push({
    id: context.id('event'),
    sequence: state.taskEvents.length + 1,
    taskId: task.id,
    type: 'captured',
    occurredAt: context.now,
    fromStatus: null,
    toStatus: task.status,
    reason: `Scheduled review for completion ${record.id}.`,
    completionRecordId: null,
  })
  return { task, link, created: true }
}

export function pendingReviewLinkForRecord(state: WorkspaceStateV3, recordId: string): ReviewTaskLink | null {
  const record = state.completionRecords.find(({ id, deletedAt }) => id === recordId && deletedAt === null)
  if (!record || !record.nextReviewOn) return null
  return state.reviewTaskLinks.find((link) =>
    link.completionRecordId === record.id && link.completedAt === null &&
    link.reviewStage === record.reviewStage && link.dueOn === record.nextReviewOn) ?? null
}

export function resolveLegacyReviewLink(
  state: WorkspaceStateV3,
  recordId: string,
  result: ReviewResult,
  reviewedOn: string,
): ReviewTaskLink | null {
  const links = state.reviewTaskLinks.filter((link) => link.completionRecordId === recordId)
  const replays = links.filter((link) => link.completion?.result === result && link.completion.reviewedOn === reviewedOn)
  if (replays.length > 1) throw new DomainCommandError('VALIDATION_ERROR', 'Legacy review replay is ambiguous.', { recordId })
  if (replays.length === 1) return replays[0]!
  if (links.some((link) => link.completedAt !== null && link.completion === null)) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Legacy review history has no completion outcome; use an exact review link.', { recordId })
  }
  const record = state.completionRecords.find(({ id, deletedAt }) => id === recordId && deletedAt === null)
  if (!record) return null
  if (!record.nextReviewOn) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Completion record has no active linked review.', { recordId })
  }
  const current = state.reviewTaskLinks.filter((link) =>
    link.completionRecordId === record.id && link.completedAt === null &&
    link.reviewStage === record.reviewStage && link.dueOn === record.nextReviewOn)
  if (current.length !== 1) throw new DomainCommandError('VALIDATION_ERROR', 'Legacy review target is ambiguous.', { recordId })
  return current[0]!
}

export function pendingReviewLinkForTarget(
  state: WorkspaceStateV3,
  taskId: string,
  occurrenceId: string | null = null,
): ReviewTaskLink | null {
  return state.reviewTaskLinks.find((link) =>
    link.reviewTaskId === taskId && link.occurrenceId === occurrenceId) ?? null
}

function requireSourceTask(state: WorkspaceStateV3, record: CompletionRecord): Task {
  const task = state.tasks.find(({ id, deletedAt }) => id === record.taskId && deletedAt === null)
  if (!task) throw new DomainCommandError('TASK_NOT_FOUND', `Source task not found: ${record.taskId}.`, { taskId: record.taskId })
  return task
}
