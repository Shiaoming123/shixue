import type {
  CompletionRecord,
  JsonValue,
  StudySession,
  Task,
  TaskChecklistItem,
  TaskEvent,
  TaskPriority,
  TaskStatus,
  WorkspaceStateV3,
} from '../workspace/types.ts'

export const CAPABILITY_PROTOCOL_VERSION = 1 as const
export const COMMAND_RECEIPT_LIMIT = 500 as const
export const COMMAND_RECEIPT_TTL_DAYS = 30 as const

export type CommandRisk = 'low' | 'medium' | 'high'
export type CommandScope = 'single' | 'batch' | 'series' | 'workspace' | 'external'
export type Reversibility = 'reversible' | 'compensating' | 'irreversible'
export type PreviewConfirmation = 'none' | 'review' | 'explicit'
export type EntityType = 'workspace' | 'task' | 'completion_record'
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
  | 'LIST_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'TAG_NOT_FOUND'
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
}

export interface TaskUpdateCommand {
  type: 'task.update'
  taskId: string
  expectedRevision?: number
  patch: TaskUpdatePatch
}

export interface TaskDeleteCommand {
  type: 'task.delete'
  taskId: string
  expectedRevision?: number
  reason?: string
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
}

export interface TaskReopenCommand {
  type: 'task.reopen'
  taskId: string
  expectedRevision?: number
}

export interface TaskRescheduleCommand {
  type: 'task.reschedule'
  taskId: string
  expectedRevision?: number
  startAt?: string | null
  startOn?: string | null
  reason?: string
}

export interface TaskBatchCommandTargetRevisions {
  expectedRevisions?: Record<string, number>
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

export interface WorkspaceImportCommand {
  type: 'workspace.import'
  state: unknown
}

export type UndoCompensation =
  | { type: 'task.remove_created'; taskIds: string[] }
  | {
      type: 'task.restore'
      tasks: Task[]
      sessions: StudySession[]
      completionRecordIds: string[]
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

export type CapabilityCommand = TaskCapabilityCommand | WorkspaceImportCommand | UndoApplyCommand

export interface CommandEnvelope<C extends CapabilityCommand = CapabilityCommand> {
  protocolVersion: typeof CAPABILITY_PROTOCOL_VERSION
  idempotencyKey: string
  source: 'human-ui' | 'keyboard' | 'notification' | 'agent'
  expectedWorkspaceRevision: number
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
export type CapabilityIdGenerator = (kind: 'task' | 'event' | 'receipt' | 'undo' | 'completion') => string

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
