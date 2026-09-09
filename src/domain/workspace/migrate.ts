import {
  parseStudyStateOrMigrate,
  type StudyState,
} from '../../storage/study/types.ts'
import { parseWorkspaceState, parseWorkspaceStateV4 } from './parse.ts'
import {
  WORKSPACE_STATE_VERSION,
  type ReviewTaskLink,
  type Task,
  type TaskEvent,
  type WorkspaceStateV3,
  type WorkspaceStateV4,
} from './types.ts'

export const SYSTEM_LEARNING_LIST_ID = 'list:system:learning'

export function migrateWorkspaceV4(value: unknown): WorkspaceStateV4 {
  if (isRecord(value) && value.version === 4) return parseWorkspaceStateV4(value)
  const state = parseWorkspaceState(value)
  const usedIds = new Set(Object.values(state).filter(Array.isArray).flatMap((items) => items.map((item: { id: string }) => item.id)))
  let sourceId = 'calendar:local'
  for (let suffix = 1; usedIds.has(sourceId); suffix++) sourceId = `calendar:local:${suffix}`
  return parseWorkspaceStateV4({
    ...state, version: 4,
    calendarSources: [{
      id: sourceId, revision: 1, provider: 'local', title: '个人日历', color: '#668575',
      group: null, permission: 'write', selected: true, hidden: false, timezone: 'UTC',
      createdAt: state.updatedAt, updatedAt: state.updatedAt, archivedAt: null,
    }],
    calendarEvents: [], calendarEventLinks: [], eventOutcomes: [],
  })
}

export function parseWorkspaceStateOrMigrate(
  value: unknown,
  migratedAt = new Date().toISOString(),
): WorkspaceStateV4 {
  if (isRecord(value) && value.version === WORKSPACE_STATE_VERSION) {
    return parseWorkspaceStateV4(value)
  }
  if (isRecord(value) && value.version === 3) return migrateWorkspaceV4(value)
  const study = parseStudyStateOrMigrate(value, migratedAt)
  return migrateWorkspaceV4(migrateStudyV2(study, migratedAt))
}

export function repairLegacyDeletedPendingReviewTasks(
  value: unknown,
  repairedAt = new Date().toISOString(),
): WorkspaceStateV3 | null {
  if (!isRecord(value) || value.version !== 3) return null
  if (!Array.isArray(value.tasks) || !Array.isArray(value.completionRecords) || !Array.isArray(value.reviewTaskLinks)) return null
  if (!Number.isInteger(value.revision)) return null

  const probe = structuredClone(value) as Record<string, unknown>
  const probeTasks = probe.tasks as unknown[]
  const probeRecords = probe.completionRecords as unknown[]
  const probeLinks = probe.reviewTaskLinks as unknown[]
  const tasks = new Map(probeTasks.filter(isRecord).map((task) => [task.id, task]))
  const records = new Map(probeRecords.filter(isRecord).map((record) => [record.id, record]))
  const repairedTaskIds = new Set<unknown>()

  for (const link of probeLinks.filter(isRecord)) {
    if (link.completedAt !== null || (link.completion ?? null) !== null) continue
    const task = tasks.get(link.reviewTaskId)
    const record = records.get(link.completionRecordId)
    if (!task || !record || record.deletedAt !== null || typeof task.deletedAt !== 'string') continue
    if (record.nextReviewOn !== link.dueOn || record.reviewStage !== link.reviewStage) continue
    if (task.mode !== 'learning' || task.id === record.taskId) continue
    const pendingForRecord = probeLinks.filter((item) =>
      isRecord(item) && item.completionRecordId === link.completionRecordId && item.completedAt === null)
    const linksForTarget = probeLinks.filter((item) =>
      isRecord(item) && (item.occurrenceId ?? item.reviewTaskId) === (link.occurrenceId ?? link.reviewTaskId))
    if (pendingForRecord.length !== 1 || linksForTarget.length !== 1) continue
    if (!isIsoDateTime(task.deletedAt)) continue

    task.deletedAt = null
    repairedTaskIds.add(task.id)
  }

  if (repairedTaskIds.size === 0) return null
  const candidate = parseWorkspaceState(probe)
  for (const task of candidate.tasks) {
    if (!repairedTaskIds.has(task.id)) continue
    task.updatedAt = repairedAt
    task.revision += 1
  }
  candidate.revision += 1
  candidate.updatedAt = repairedAt
  return parseWorkspaceState(candidate)
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
    completion: null,
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
    version: 3,
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

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  const date = value.slice(0, 10)
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === date && Number.isFinite(Date.parse(value))
}
