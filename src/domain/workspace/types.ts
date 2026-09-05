import type {
  CompletionRecord,
  StudySession,
  TaskChecklistItem,
  TaskEvent,
} from '../../storage/study/types.ts'

export const WORKSPACE_STATE_VERSION = 3 as const

export type TaskMode = 'general' | 'learning'
export type TaskStatus =
  | 'inbox'
  | 'planned'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'cancelled'
export type TaskPriority = 'none' | 'low' | 'medium' | 'high'

export interface ListGroup {
  id: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface TaskList {
  id: string
  groupId: string | null
  title: string
  position: number
  goal: string
  successCriteria: string[]
  weeklyTargetMinutes: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface ListSection {
  id: string
  listId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface Tag {
  id: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface TaskSchedule {
  startAt: string | null
  startOn: string | null
  estimateMinutes: number | null
}

export interface TaskDeadline {
  dueAt: string | null
  dueOn: string | null
}

export interface LearningTaskFields {
  acceptanceCriteria: string[]
  blockedReason: string | null
}

export interface Task {
  id: string
  revision: number
  mode: TaskMode
  listId: string
  sectionId: string | null
  tagIds: string[]
  title: string
  notes: string
  status: TaskStatus
  schedule: TaskSchedule
  deadline: TaskDeadline
  priority: TaskPriority
  checklist: TaskChecklistItem[]
  learning: LearningTaskFields | null
  recurrenceSeriesId: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type RecurrenceCadence =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: number[] }
  | { kind: 'monthly'; interval: number; dayOfMonth: number }
  | { kind: 'yearly'; interval: number; month: number; dayOfMonth: number }

export interface RecurrenceSeries {
  id: string
  taskId: string
  revision: number
  cadence: RecurrenceCadence
  basis: 'fixed_schedule' | 'after_completion'
  anchorAt: string
  end: { kind: 'never' } | { kind: 'on'; date: string } | { kind: 'after'; count: number }
  timezone: string
  createdThrough: string | null
  createdCount: number
}

export interface OccurrenceOverride {
  scheduledAt: string | null
  estimateMinutes: number | null
}

export interface TaskOccurrence {
  id: string
  seriesId: string
  ordinal: number
  scheduledAt: string
  status: 'pending' | 'completed' | 'skipped' | 'cancelled'
  override: OccurrenceOverride | null
  completedAt: string | null
  revision: number
}

export type ReminderTrigger =
  | { kind: 'at_start' }
  | { kind: 'before_start'; minutes: number }
  | { kind: 'before_due'; minutes: number }
  | { kind: 'absolute'; at: string }

export interface ReminderRule {
  id: string
  taskId: string
  occurrenceId: string | null
  trigger: ReminderTrigger
  enabled: boolean
  revision: number
}

export interface ReminderDelivery {
  id: string
  reminderRuleId: string
  occurrenceId: string | null
  scheduledFor: string
  status: 'pending' | 'delivered' | 'snoozed' | 'acted' | 'dismissed' | 'failed'
  snoozedUntil: string | null
  action: 'complete' | 'open' | null
}

export interface ReviewTaskLink {
  id: string
  completionRecordId: string
  reviewTaskId: string
  occurrenceId: string | null
  reviewStage: 0 | 1 | 2 | 3
  dueOn: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CommandSource = 'human-ui' | 'keyboard' | 'notification' | 'agent'
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface CommandReceipt {
  id: string
  idempotencyKey: string
  requestFingerprint: string | null
  commandType: string
  source: CommandSource
  workspaceRevision: number
  result: { [key: string]: JsonValue }
  createdAt: string
  expiresAt: string
}

export interface PreviewReceipt {
  id: string
  requestFingerprint: string
  expectedWorkspaceRevision: number
  commandType: string
  createdAt: string
  expiresAt: string
}

export interface WorkspaceStateV3 {
  version: typeof WORKSPACE_STATE_VERSION
  revision: number
  listGroups: ListGroup[]
  lists: TaskList[]
  sections: ListSection[]
  tags: Tag[]
  tasks: Task[]
  recurrenceSeries: RecurrenceSeries[]
  occurrences: TaskOccurrence[]
  reminderRules: ReminderRule[]
  reminderDeliveries: ReminderDelivery[]
  studySessions: StudySession[]
  taskEvents: TaskEvent[]
  completionRecords: CompletionRecord[]
  reviewTaskLinks: ReviewTaskLink[]
  commandReceipts: CommandReceipt[]
  previewReceipts: PreviewReceipt[]
  updatedAt: string
}

export type {
  CompletionRecord,
  StudySession,
  TaskChecklistItem,
  TaskEvent,
} from '../../storage/study/types.ts'
