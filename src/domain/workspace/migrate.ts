import {
  parseStudyStateOrMigrate,
  type StudyState,
} from '../../storage/study/types.ts'
import { parseWorkspaceState } from './parse.ts'
import {
  WORKSPACE_STATE_VERSION,
  type ReviewTaskLink,
  type Task,
  type TaskEvent,
  type WorkspaceStateV3,
} from './types.ts'

export const SYSTEM_LEARNING_LIST_ID = 'list:system:learning'

export function parseWorkspaceStateOrMigrate(
  value: unknown,
  migratedAt = new Date().toISOString(),
): WorkspaceStateV3 {
  if (isRecord(value) && value.version === WORKSPACE_STATE_VERSION) {
    return parseWorkspaceState(value)
  }
  const study = parseStudyStateOrMigrate(value, migratedAt)
  return parseWorkspaceState(migrateStudyV2(study, migratedAt))
}

function migrateStudyV2(study: StudyState, migratedAt: string): WorkspaceStateV3 {
  const tasks: Task[] = study.tasks.map((task) => ({
    id: task.id,
    revision: task.revision,
    mode: 'learning',
    listId: task.topicId ?? SYSTEM_LEARNING_LIST_ID,
    sectionId: null,
    tagIds: [],
    title: task.title,
    notes: task.notes,
    status: task.status,
    schedule: {
      startAt: null,
      startOn: task.plannedOn,
      estimateMinutes: task.estimateMinutes,
    },
    deadline: { dueAt: null, dueOn: task.dueOn },
    priority: task.priority,
    checklist: structuredClone(task.checklist),
    learning: {
      acceptanceCriteria: [...task.acceptanceCriteria],
      blockedReason: task.blockedReason,
    },
    recurrenceSeriesId: null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    deletedAt: task.deletedAt,
  }))

  const sourceTasks = new Map(tasks.map((task) => [task.id, task]))
  const pendingRecords = study.completionRecords.filter(
    (record) => record.nextReviewOn !== null && record.deletedAt === null,
  )
  const reviewTasks: Task[] = pendingRecords.map((record) => {
    const source = sourceTasks.get(record.taskId)
    if (!source || !record.nextReviewOn) {
      throw new Error(`Completion ${record.id} cannot create a review task.`)
    }
    return {
      id: reviewTaskId(record.id),
      revision: 1,
      mode: 'learning',
      listId: source.listId,
      sectionId: null,
      tagIds: [],
      title: `复习 · ${record.taskTitleSnapshot}`,
      notes: '',
      status: 'planned',
      schedule: {
        startAt: null,
        startOn: record.nextReviewOn,
        estimateMinutes: null,
      },
      deadline: { dueAt: null, dueOn: record.nextReviewOn },
      priority: 'none',
      checklist: [],
      learning: { acceptanceCriteria: [], blockedReason: null },
      recurrenceSeriesId: null,
      createdAt: migratedAt,
      updatedAt: migratedAt,
      deletedAt: null,
    }
  })
  const reviewTaskLinks: ReviewTaskLink[] = pendingRecords.map((record) => ({
    id: `review-link:migrated:${record.id}`,
    completionRecordId: record.id,
    reviewTaskId: reviewTaskId(record.id),
    occurrenceId: null,
    reviewStage: record.reviewStage,
    dueOn: record.nextReviewOn as string,
    completedAt: null,
    createdAt: migratedAt,
    updatedAt: migratedAt,
  }))

  let sequence = study.taskEvents.reduce(
    (maximum, event) => Math.max(maximum, event.sequence),
    0,
  )
  const migrationEvents: TaskEvent[] = tasks.map((task) => ({
    id: `event:workspace-v3:${task.id}`,
    sequence: ++sequence,
    taskId: task.id,
    type: 'migrated',
    occurredAt: migratedAt,
    fromStatus: task.status,
    toStatus: task.status,
    reason: 'Migrated from StudyState v2 to WorkspaceState v3.',
    completionRecordId: null,
  }))
  migrationEvents.push(...reviewTasks.map((task) => ({
    id: `event:workspace-v3:${task.id}`,
    sequence: ++sequence,
    taskId: task.id,
    type: 'migrated' as const,
    occurredAt: migratedAt,
    fromStatus: null,
    toStatus: task.status,
    reason: 'Created from a pending legacy review during WorkspaceState v3 migration.',
    completionRecordId: null,
  })))

  return {
    version: WORKSPACE_STATE_VERSION,
    revision: 1,
    listGroups: structuredClone(study.listGroups ?? []),
    lists: [{
      id: SYSTEM_LEARNING_LIST_ID,
      groupId: null,
      title: '学习',
      position: 0,
      goal: '',
      successCriteria: [],
      weeklyTargetMinutes: null,
      createdAt: migratedAt,
      updatedAt: migratedAt,
      archivedAt: null,
    }, ...study.topics.map((topic, index) => ({
      id: topic.id,
      groupId: topic.groupId ?? null,
      title: topic.title,
      position: index + 1,
      goal: topic.goal,
      successCriteria: [...topic.successCriteria],
      weeklyTargetMinutes: topic.weeklyTargetMinutes,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
      archivedAt: topic.archivedAt,
    }))],
    sections: [],
    tags: [],
    tasks: [...tasks, ...reviewTasks],
    recurrenceSeries: [],
    occurrences: [],
    reminderRules: study.tasks.flatMap((task) => task.reminderAt ? [{
      id: `reminder:migrated:${task.id}`,
      taskId: task.id,
      occurrenceId: null,
      trigger: { kind: 'absolute' as const, at: task.reminderAt },
      enabled: true,
      revision: 1,
    }] : []),
    reminderDeliveries: [],
    studySessions: structuredClone(study.sessions),
    taskEvents: [...structuredClone(study.taskEvents), ...migrationEvents],
    completionRecords: structuredClone(study.completionRecords),
    reviewTaskLinks,
    commandReceipts: [],
    updatedAt: migratedAt,
  }
}

function reviewTaskId(completionRecordId: string): string {
  return `task:review:${completionRecordId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
