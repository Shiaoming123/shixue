import type { ReminderCapabilityCommand } from './reminder-commands.ts'
import type { CalendarCapabilityCommand } from './calendar-commands.ts'
import type {
  CompletionRecord,
  JsonValue,
  ListGroup,
  RecurrenceCadence,
  RecurrenceSeries,
  ReminderRule,
  StudySession,
  Task,
  TaskChecklistItem,
  TaskEvent,
  TaskOccurrence,
  TaskList,
  TaskPriority,
  TaskStatus,
  WorkspaceStateV3,
} from '../workspace/types.ts'

export const CAPABILITY_PROTOCOL_VERSION = 1 as const
export const COMMAND_RECEIPT_LIMIT = 500 as const
export const COMMAND_RECEIPT_TTL_DAYS = 30 as const
export const PREVIEW_RECEIPT_LIMIT = 100 as const
export const PREVIEW_RECEIPT_TTL_MINUTES = 15 as const

export type CommandRisk = 'low' | 'medium' | 'high'
export type CommandScope = 'single' | 'batch' | 'series' | 'workspace' | 'external'
export type Reversibility = 'reversible' | 'compensating' | 'irreversible'
export type PreviewConfirmation = 'none' | 'review' | 'explicit'
export type EntityType =
  | 'workspace'
  | 'list_group'
  | 'list'
  | 'task'
  | 'recurrence_series'
  | 'occurrence'
  | 'session'
  | 'checklist_item'
  | 'completion_record'
export type ChangeOperation = 'create' | 'update' | 'delete' | 'replace' | 'restore'

export interface EntityRef {
  type: EntityType
  id: string
  revision?: number
}

export interface ChangeSummary {
  entity: EntityRef
  operation: ChangeOperation
  fields: string[]
}

export type DomainErrorCode =
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'COMMAND_NOT_FOUND'
  | 'WORKSPACE_REVISION_CONFLICT'
  | 'ENTITY_REVISION_CONFLICT'
  | 'WORKSPACE_SAVE_CONFLICT'
  | 'TASK_NOT_FOUND'
  | 'TASK_ALREADY_EXISTS'
  | 'TASK_ALREADY_DELETED'
  | 'TASK_INVALID_TRANSITION'
  | 'LIST_GROUP_NOT_FOUND'
  | 'LIST_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'TAG_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'CHECKLIST_ITEM_NOT_FOUND'
  | 'COMPLETION_RECORD_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNDO_TOKEN_NOT_FOUND'
  | 'UNDO_ALREADY_APPLIED'
  | 'UNDO_REVISION_CONFLICT'
  | 'IMPORT_INVALID'

export interface DomainError {
  code: DomainErrorCode
  message: string
  details: Record<string, JsonValue>
}

export class DomainCommandError extends Error implements DomainError {
  readonly code: DomainErrorCode
  readonly details: Record<string, JsonValue>

  constructor(code: DomainErrorCode, message: string, details: Record<string, JsonValue> = {}) {
    super(`[${code}] ${message}`)
    this.name = 'DomainCommandError'
    this.code = code
    this.details = details
  }

  toJSON(): DomainError {
    return { code: this.code, message: this.message, details: structuredClone(this.details) }
  }
}

export interface TaskCreateCommand {
  type: 'task.create'
  taskId?: string
  eventId?: string
  reminderRuleId?: string
  listId: string
  mode?: 'general' | 'learning'
  sectionId?: string | null
  tagIds?: string[]
  title: string
  notes?: string
  startAt?: string | null
  startOn?: string | null
  estimateMinutes?: number | null
  dueAt?: string | null
  dueOn?: string | null
  priority?: TaskPriority
  checklist?: TaskChecklistItem[]
  acceptanceCriteria?: string[]
  reminderAt?: string | null
  recurrence?: {
    seriesId?: string
    occurrenceId?: string
    cadence: RecurrenceCadence
    basis: RecurrenceSeries['basis']
    anchorAt?: string | null
    anchorOn?: string | null
    end: RecurrenceSeries['end']
    timezone: string
    estimateMinutes?: number | null
  }
}

export interface TaskUpdatePatch {
  listId?: string
  sectionId?: string | null
  tagIds?: string[]
  title?: string
  notes?: string
  startAt?: string | null
  startOn?: string | null
  estimateMinutes?: number | null
  dueAt?: string | null
  dueOn?: string | null
  priority?: TaskPriority
  checklist?: TaskChecklistItem[]
  acceptanceCriteria?: string[]
  blockedReason?: string | null
  reminderAt?: string | null
}

export interface TaskUpdateCommand {
  type: 'task.update'
  taskId: string
  expectedRevision?: number
  patch: TaskUpdatePatch
  reminderRuleId?: string
}

export interface TaskDeleteCommand {
  type: 'task.delete'
  taskId: string
  expectedRevision?: number
  reason?: string
  eventId?: string
}

export interface TaskCompleteCommand {
  type: 'task.complete'
  taskId: string
  expectedRevision?: number
  sessionId?: string
  learned?: string
  evidence?: string
  blocker?: string
  nextAction?: string
  mastery?: CompletionRecord['mastery']
  eventId?: string
  recordId?: string
}

export interface TaskReopenCommand {
  type: 'task.reopen'
  taskId: string
  expectedRevision?: number
  eventId?: string
}

export interface TaskRescheduleCommand {
  type: 'task.reschedule'
  taskId: string
  expectedRevision?: number
  startAt?: string | null
  startOn?: string | null
  estimateMinutes?: number
  reason?: string
  eventId?: string
}

export interface TaskBatchCommandTargetRevisions {
  expectedRevisions?: Record<string, number>
  eventIds?: Record<string, string>
}

export interface TaskBatchRescheduleCommand extends TaskBatchCommandTargetRevisions {
  type: 'task.batch_reschedule'
  taskIds: string[]
  startAt?: string | null
  startOn?: string | null
  reason?: string
}

export interface TaskBatchCancelCommand extends TaskBatchCommandTargetRevisions {
  type: 'task.batch_cancel'
  taskIds: string[]
  reason?: string
}

export interface TaskBatchDeleteCommand extends TaskBatchCommandTargetRevisions {
  type: 'task.batch_delete'
  taskIds: string[]
  reason?: string
}

export interface RecurrenceCreateCommand {
  type: 'recurrence.create'
  taskId: string
  expectedTaskRevision?: number
  seriesId?: string
  occurrenceId?: string
  cadence: RecurrenceCadence
  basis: RecurrenceSeries['basis']
  anchorAt?: string | null
  anchorOn?: string | null
  end: RecurrenceSeries['end']
  timezone: string
  estimateMinutes?: number | null
}

export interface RecurrenceUpdatePatch {
  cadence?: RecurrenceCadence
  basis?: RecurrenceSeries['basis']
  anchorAt?: string | null
  anchorOn?: string | null
  end?: RecurrenceSeries['end']
  timezone?: string
  scheduledAt?: string | null
  scheduledOn?: string | null
  estimateMinutes?: number | null
}

export interface RecurrenceUpdateCommand {
  type: 'recurrence.update'
  occurrenceId: string
  expectedOccurrenceRevision?: number
  scope: 'occurrence' | 'future' | 'series'
  patch: RecurrenceUpdatePatch
}

export interface RecurrenceCompleteCommand extends Pick<TaskCompleteCommand, 'learned' | 'evidence' | 'blocker' | 'nextAction' | 'mastery' | 'recordId'> {
  expectedTaskRevision?: number
  type: 'recurrence.complete'
  occurrenceId: string
  expectedOccurrenceRevision?: number
}

export interface RecurrenceSkipCommand {
  type: 'recurrence.skip'
  occurrenceId: string
  expectedOccurrenceRevision?: number
}

export interface WorkspaceImportCommand {
  type: 'workspace.import'
  state: unknown
}

export interface ListUpsertCommand {
  type: 'list.upsert'
  list: TaskList
}

export interface ListGroupUpsertCommand {
  type: 'list_group.upsert'
  group: ListGroup
}

export interface ListGroupArchiveCommand {
  type: 'list_group.archive'
  groupId: string
}

export interface TaskPlanCommand {
  type: 'task.plan'
  taskId: string
  expectedRevision?: number
  patch: TaskUpdatePatch
  eventId?: string
  reminderRuleId?: string
}

export interface TaskTransitionCommand {
  type: 'task.transition'
  taskId: string
  expectedRevision?: number
  toStatus: 'planned' | 'blocked' | 'cancelled'
  reason?: string
  eventId?: string
}

export interface TaskStartCommand {
  type: 'task.start'
  taskId: string
  expectedRevision?: number
  sessionId?: string
  eventId?: string
}

export interface TaskSwitchCommand {
  type: 'task.switch'
  taskId: string
  expectedRevision?: number
  sessionId?: string
  pausedEventId?: string
  eventId?: string
  reason?: string
}

export interface SessionPauseCommand {
  type: 'session.pause'
  sessionId: string
  expectedTaskRevision?: number
  eventId?: string
}

export interface SessionResumeCommand {
  type: 'session.resume'
  sessionId: string
  expectedTaskRevision?: number
  eventId?: string
}

export interface SessionScratchpadUpdateCommand {
  type: 'session.scratchpad.update'
  sessionId: string
  expectedTaskRevision?: number
  scratchpad: string
}

export interface TaskChecklistAddCommand {
  type: 'task.checklist.add'
  taskId: string
  expectedRevision?: number
  itemId?: string
  text: string
}

export interface TaskChecklistSetCommand {
  type: 'task.checklist.set'
  taskId: string
  expectedRevision?: number
  itemId: string
  checked: boolean
}

export interface TaskReorderCommand {
  type: 'task.reorder'
  taskIds: string[]
}

export interface TaskToggleCompletionCommand {
  type: 'task.toggle_completion'
  taskId: string
  expectedRevision?: number
  eventId?: string
}

export interface CompletionReviewCommand {
  type: 'completion.review'
  recordId: string
  result: Exclude<CompletionRecord['lastReviewResult'], null>
  reviewedOn: string
  expectedTaskRevision?: number
}

export interface CompletionCreateNextActionCommand {
  type: 'completion.create_next_action'
  recordId: string
  expectedTaskRevision?: number
  taskId?: string
  eventId?: string
  startOn?: string | null
}

export interface WorkspaceResetCommand {
  type: 'workspace.reset'
}

export type UndoCompensation =
  | {
      type: 'task.remove_created'
      taskIds: string[]
      recurrenceSeriesIds?: string[]
      occurrenceIds?: string[]
    }
  | {
      type: 'task.restore'
      tasks: Task[]
      sessions: StudySession[]
      completionRecordIds: string[]
      reminderRules?: ReminderRule[]
    }
  | {
      type: 'recurrence.restore'
      completionRecordIds?: string[]
      tasks: Task[]
      recurrenceSeries: RecurrenceSeries[]
      occurrenceSnapshots: TaskOccurrence[]
      createdSeriesIds: string[]
      createdOccurrenceIds: string[]
    }

export interface UndoToken {
  protocolVersion: typeof CAPABILITY_PROTOCOL_VERSION
  id: string
  commandReceiptId: string
  expectedWorkspaceRevision: number
  compensation: UndoCompensation
}

export interface UndoApplyCommand {
  type: 'undo.apply'
  token: UndoToken
}

export type TaskCapabilityCommand =
  | TaskCreateCommand
  | TaskUpdateCommand
  | TaskDeleteCommand
  | TaskCompleteCommand
  | TaskReopenCommand
  | TaskRescheduleCommand
  | TaskBatchRescheduleCommand
  | TaskBatchCancelCommand
  | TaskBatchDeleteCommand

export type RecurrenceCapabilityCommand =
  | RecurrenceCreateCommand
  | RecurrenceUpdateCommand
  | RecurrenceCompleteCommand
  | RecurrenceSkipCommand

export type LiveCompatibilityCommand =
  | ListUpsertCommand
  | ListGroupUpsertCommand
  | ListGroupArchiveCommand
  | TaskPlanCommand
  | TaskTransitionCommand
  | TaskStartCommand
  | TaskSwitchCommand
  | SessionPauseCommand
  | SessionResumeCommand
  | SessionScratchpadUpdateCommand
  | TaskChecklistAddCommand
  | TaskChecklistSetCommand
  | TaskReorderCommand
  | TaskToggleCompletionCommand
  | CompletionReviewCommand
  | CompletionCreateNextActionCommand
  | WorkspaceResetCommand

export type CapabilityCommand =
  | CalendarCapabilityCommand
  | ReminderCapabilityCommand
  | TaskCapabilityCommand
  | RecurrenceCapabilityCommand
  | LiveCompatibilityCommand
  | WorkspaceImportCommand
  | UndoApplyCommand

export interface CommandEnvelope<C extends CapabilityCommand = CapabilityCommand> {
  protocolVersion: typeof CAPABILITY_PROTOCOL_VERSION
  idempotencyKey: string
  source: 'human-ui' | 'keyboard' | 'notification' | 'agent'
  expectedWorkspaceRevision: number
  explicitConfirmation?: {
    previewReceiptId: string
    confirmedAt: string
  }
  command: C
}

export interface CommandDescriptor {
  type: CapabilityCommand['type']
  risk: CommandRisk
  scope: CommandScope
  reversibility: Reversibility
  requiresPreview: boolean
}

export interface CommandPreview {
  accepted: boolean
  descriptor: CommandDescriptor
  affected: EntityRef[]
  changes: ChangeSummary[]
  validationErrors: DomainError[]
  confirmation: PreviewConfirmation
  previewReceiptId: string | null
}

export interface CommandResult {
  receiptId: string
  workspaceRevision: number
  affected: EntityRef[]
  events: TaskEvent[]
  undoToken: UndoToken | null
  data: JsonValue
}

export type CapabilityQuery =
  | { type: 'workspace.snapshot' }
  | { type: 'task.get'; taskId: string; includeDeleted?: boolean }
  | { type: 'task.list'; listId?: string; statuses?: TaskStatus[]; includeDeleted?: boolean }
  | { type: 'task.search'; text: string; includeDeleted?: boolean }
  | { type: 'command.describe'; commandType: CapabilityCommand['type'] }
  | { type: 'audit.list'; commandType?: CapabilityCommand['type']; limit?: number }

export interface AuditListResult {
  receipts: WorkspaceStateV3['commandReceipts']
  events: TaskEvent[]
}

export type QueryResult<Q extends CapabilityQuery> =
  Q extends { type: 'workspace.snapshot' } ? WorkspaceStateV3
    : Q extends { type: 'task.get' } ? Task | null
      : Q extends { type: 'task.list' | 'task.search' } ? Task[]
        : Q extends { type: 'command.describe' } ? CommandDescriptor
          : Q extends { type: 'audit.list' } ? AuditListResult
            : never

export type CapabilityClock = () => string
export type CapabilityIdGenerator = (kind:
  | 'task'
  | 'event'
  | 'receipt'
  | 'undo'
  | 'completion'
  | 'session'
  | 'checklist'
  | 'reminder'
  | 'recurrence_series'
  | 'occurrence'
) => string

export interface CommandApplication {
  affected: EntityRef[]
  changes: ChangeSummary[]
  events: TaskEvent[]
  compensation: UndoCompensation | null
  data: JsonValue
}

export interface CapabilityCommandContext {
  now: string
  id: CapabilityIdGenerator
}

export interface TaskCapabilityService {
  query<Q extends CapabilityQuery>(query: Q): Promise<QueryResult<Q>>
  preview(command: CommandEnvelope): Promise<CommandPreview>
  execute(command: CommandEnvelope): Promise<CommandResult>
}
