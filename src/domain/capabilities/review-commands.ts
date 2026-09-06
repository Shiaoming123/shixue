import { applyReviewResult } from '../../storage/study/types.ts'
import { ensureReviewTask } from '../learning/review-task-link.ts'
import type { TaskEvent, WorkspaceStateV3 } from '../workspace/types.ts'
import {
  DomainCommandError,
  type CapabilityCommandContext,
  type CommandApplication,
  type ReviewCapabilityCommand,
} from './types.ts'

export function applyReviewCommand(
  state: WorkspaceStateV3,
  command: ReviewCapabilityCommand,
  context: CapabilityCommandContext,
): CommandApplication {
  if (command.type === 'review.schedule') return scheduleReview(state, command, context)
  return completeReview(state, command, context)
}

function scheduleReview(
  state: WorkspaceStateV3,
  command: Extract<ReviewCapabilityCommand, { type: 'review.schedule' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const ensured = ensureReviewTask(state, command.completionRecordId, command.dueOn, context, command.occurrenceId ?? null)
  const task = { type: 'task' as const, id: ensured.task.id, revision: ensured.task.revision }
  const link = { type: 'completion_record' as const, id: ensured.link.completionRecordId }
  return {
    affected: [task, link],
    changes: ensured.created
      ? [{ entity: task, operation: 'create', fields: ['task'] }, { entity: link, operation: 'create', fields: ['link'] }]
      : [],
    events: [], compensation: null, data: { taskId: ensured.task.id, linkId: ensured.link.id, created: ensured.created },
  }
}

function completeReview(
  state: WorkspaceStateV3,
  command: Extract<ReviewCapabilityCommand, { type: 'review.complete' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const link = state.reviewTaskLinks.find(({ id }) => id === command.linkId)
  if (!link) throw new DomainCommandError('VALIDATION_ERROR', `Review task link not found: ${command.linkId}.`, { linkId: command.linkId })
  const recordIndex = state.completionRecords.findIndex(({ id, deletedAt }) => id === link.completionRecordId && deletedAt === null)
  if (recordIndex < 0) throw new DomainCommandError('COMPLETION_RECORD_NOT_FOUND', `Completion record not found: ${link.completionRecordId}.`, { recordId: link.completionRecordId })
  const record = state.completionRecords[recordIndex]!
  const reviewTask = state.tasks.find(({ id, deletedAt }) => id === link.reviewTaskId && deletedAt === null)
  if (!reviewTask) throw new DomainCommandError('TASK_NOT_FOUND', `Review task not found: ${link.reviewTaskId}.`, { taskId: link.reviewTaskId })
  if (link.completedAt !== null) {
    if (link.completion?.result !== command.result || link.completion.reviewedOn !== command.reviewedOn) {
      throw new DomainCommandError('VALIDATION_ERROR', 'Completed review link does not match this review outcome.', { linkId: link.id })
    }
    return { affected: [], changes: [], events: [], compensation: null, data: { completionRecordId: record.id, linkId: link.id, result: command.result, reviewedOn: command.reviewedOn, completed: false } }
  }
  const occurrence = link.occurrenceId === null ? null : state.occurrences.find(({ id }) => id === link.occurrenceId)
  if (link.occurrenceId !== null && (!occurrence || occurrence.status !== 'pending')) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Review task link requires a pending occurrence.', { linkId: link.id, occurrenceId: link.occurrenceId })
  }
  if (link.reviewStage !== record.reviewStage || link.dueOn !== record.nextReviewOn) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Review link no longer matches the active review stage.', { linkId: link.id })
  }
  if (command.expectedReviewTaskRevision !== undefined && reviewTask.revision !== command.expectedReviewTaskRevision) {
    throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Review task revision conflict.', { taskId: reviewTask.id })
  }
  if (occurrence) {
    if (command.expectedOccurrenceRevision !== undefined && occurrence.revision !== command.expectedOccurrenceRevision) {
      throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Review occurrence revision conflict.', { occurrenceId: occurrence.id })
    }
    if (occurrence.status === 'pending') { occurrence.status = 'completed'; occurrence.completedAt = context.now; occurrence.revision += 1 }
  }
  const effectiveReviewedOn = command.result === 'fuzzy' && link.dueOn > command.reviewedOn ? link.dueOn : command.reviewedOn
  state.completionRecords[recordIndex] = applyReviewResult(record, command.result, effectiveReviewedOn, context.now)
  link.completedAt = context.now
  link.completion = { result: command.result, reviewedOn: command.reviewedOn }
  link.updatedAt = context.now
  const events: TaskEvent[] = []
  if (reviewTask.status !== 'completed' && reviewTask.status !== 'cancelled') {
    const fromStatus = reviewTask.status
    for (const session of state.studySessions.filter(({ taskId, state: sessionState, deletedAt }) => taskId === reviewTask.id && sessionState !== 'finished' && deletedAt === null)) {
      session.state = 'finished'; session.activeSince = null; session.updatedAt = context.now
    }
    reviewTask.status = 'completed'
    reviewTask.revision += 1
    reviewTask.updatedAt = context.now
    const event: TaskEvent = {
      id: context.id('event'), sequence: state.taskEvents.length + 1, taskId: reviewTask.id,
      occurrenceId: link.occurrenceId, type: 'completed', occurredAt: context.now,
      fromStatus, toStatus: 'completed', reason: `Reviewed completion ${record.id}.`, completionRecordId: null,
    }
    state.taskEvents.push(event)
    events.push(event)
  }
  const updated = state.completionRecords[recordIndex]!
  const next = updated.nextReviewOn ? ensureReviewTask(state, updated.id, updated.nextReviewOn, context) : null
  const affected = [
    { type: 'completion_record' as const, id: updated.id },
    { type: 'completion_record' as const, id: link.completionRecordId },
    { type: 'task' as const, id: reviewTask.id, revision: reviewTask.revision },
    ...(next ? [
      { type: 'task' as const, id: next.task.id, revision: next.task.revision },
      { type: 'completion_record' as const, id: next.link.completionRecordId },
    ] : []),
  ]
  return {
    affected,
    changes: affected.map((entity) => ({ entity, operation: 'update' as const, fields: ['review'] })),
    events, compensation: null,
    data: structuredClone({ completionRecordId: updated.id, linkId: link.id, result: command.result, reviewedOn: command.reviewedOn, record: updated, link, nextLinkId: next?.link.id ?? null }) as never,
  }
}
