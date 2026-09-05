import { parseWorkspaceState } from '../workspace/parse.ts'
import type { CommandReceipt, JsonValue, Task, TaskEvent, WorkspaceStateV3 } from '../workspace/types.ts'
import type { WorkspaceStore } from '../../storage/workspace/types.ts'
import { getCommandDescriptor, getPreviewConfirmation } from './catalog.ts'
import { applyLiveCompatibilityCommand } from './live-commands.ts'
import { applyRecurrenceCommand } from './recurrence-commands.ts'
import { applyTaskCommand } from './task-commands.ts'
import {
  CAPABILITY_PROTOCOL_VERSION,
  COMMAND_RECEIPT_LIMIT,
  COMMAND_RECEIPT_TTL_DAYS,
  DomainCommandError,
  type CapabilityClock,
  type CapabilityCommand,
  type CapabilityCommandContext,
  type CapabilityIdGenerator,
  type CapabilityQuery,
  type CommandApplication,
  type CommandEnvelope,
  type CommandPreview,
  type CommandResult,
  type DomainError,
  type EntityRef,
  type LiveCompatibilityCommand,
  type RecurrenceCapabilityCommand,
  type QueryResult,
  type TaskCapabilityCommand,
  type TaskCapabilityService,
  type UndoApplyCommand,
  type WorkspaceImportCommand,
} from './types.ts'

export function createTaskCapabilityService(
  store: WorkspaceStore,
  clock: CapabilityClock,
  ids: CapabilityIdGenerator,
): TaskCapabilityService {
  return {
    async query<Q extends CapabilityQuery>(query: Q): Promise<QueryResult<Q>> {
      const state = await store.load()
      if (query.type === 'workspace.snapshot') return structuredClone(state) as QueryResult<Q>
      if (query.type === 'task.get') {
        const task = state.tasks.find(({ id }) => id === query.taskId) ?? null
        return structuredClone(task && (!task.deletedAt || query.includeDeleted) ? task : null) as QueryResult<Q>
      }
      if (query.type === 'task.list') {
        const tasks = state.tasks.filter((task) =>
          (query.includeDeleted || task.deletedAt === null) &&
          (query.listId === undefined || task.listId === query.listId) &&
          (query.statuses === undefined || query.statuses.includes(task.status)))
        return structuredClone(tasks) as QueryResult<Q>
      }
      if (query.type === 'task.search') {
        const text = query.text.trim().toLocaleLowerCase()
        const tasks = state.tasks.filter((task) =>
          (query.includeDeleted || task.deletedAt === null) &&
          [task.title, task.notes, ...(task.learning?.acceptanceCriteria ?? []), ...task.checklist.map(({ text }) => text)]
            .some((value) => value.toLocaleLowerCase().includes(text)))
        return structuredClone(tasks) as QueryResult<Q>
      }
      if (query.type === 'command.describe') return getCommandDescriptor(query.commandType) as QueryResult<Q>
      if (query.type === 'audit.list') {
        const matching = query.commandType === undefined
          ? state.commandReceipts
          : state.commandReceipts.filter(({ commandType }) => commandType === query.commandType)
        const limit = query.limit === undefined ? matching.length : Math.max(0, Math.floor(query.limit))
        const receipts = limit === 0 ? [] : matching.slice(-limit)
        const eventIds = new Set(receipts.flatMap(({ result }) => receiptEventIds(result.events)))
        const events = state.taskEvents.filter(({ id }) => eventIds.has(id))
        return structuredClone({ receipts, events }) as QueryResult<Q>
      }
      throw new DomainCommandError('COMMAND_NOT_FOUND', 'Query is not implemented.')
    },

    async preview(envelope: CommandEnvelope): Promise<CommandPreview> {
      const descriptor = getCommandDescriptor(envelope.command.type)
      const confirmation = getPreviewConfirmation(descriptor)
      const current = await store.load()
      const affected = previewAffected(current, envelope.command)
      try {
        assertEnvelope(current, envelope)
        const draft = structuredClone(current)
        const previewIds = createPreviewIdGenerator(current)
        const application = applyCapabilityCommand(
          draft,
          envelope.command,
          { now: clock(), id: previewIds },
        )
        parseWorkspaceState(draft)
        const impact = publicPreviewImpact(envelope.command, application)
        return {
          accepted: true,
          descriptor,
          affected: impact.affected,
          changes: impact.changes,
          validationErrors: [],
          confirmation,
        }
      } catch (error) {
        return {
          accepted: false,
          descriptor,
          affected,
          changes: [],
          validationErrors: [domainError(error)],
          confirmation,
        }
      }
    },

    async execute(envelope: CommandEnvelope): Promise<CommandResult> {
      const current = await store.load()
      const now = clock()
      const requestFingerprint = await fingerprintRequest(envelope)
      const cached = current.commandReceipts.find(({ idempotencyKey, expiresAt }) =>
        idempotencyKey === envelope.idempotencyKey && Date.parse(expiresAt) > Date.parse(now))
      if (cached) {
        if (cached.requestFingerprint === null || cached.requestFingerprint !== requestFingerprint) {
          throw new DomainCommandError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key belongs to a different request.', {
            idempotencyKey: envelope.idempotencyKey,
          })
        }
        return structuredClone(cached.result) as unknown as CommandResult
      }
      assertEnvelope(current, envelope)

      const draft = structuredClone(current)
      const application = applyCapabilityCommand(draft, envelope.command, { now, id: ids })
      draft.revision = current.revision + 1
      draft.updatedAt = nextUpdatedAt(current.updatedAt, now)
      application.affected = application.affected.map((entity) =>
        entity.type === 'workspace' ? { ...entity, revision: draft.revision } : entity)

      const receiptId = ids('receipt')
      const undoToken = application.compensation === null ? null : {
        protocolVersion: CAPABILITY_PROTOCOL_VERSION,
        id: ids('undo'),
        commandReceiptId: receiptId,
        expectedWorkspaceRevision: draft.revision,
        compensation: application.compensation,
      }
      const result: CommandResult = {
        receiptId,
        workspaceRevision: draft.revision,
        affected: application.affected,
        events: application.events,
        undoToken,
        data: application.data,
      }
      const receipt: CommandReceipt = {
        id: receiptId,
        idempotencyKey: envelope.idempotencyKey,
        requestFingerprint,
        commandType: envelope.command.type,
        source: envelope.source,
        workspaceRevision: draft.revision,
        result: structuredClone(result) as unknown as Record<string, JsonValue>,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + COMMAND_RECEIPT_TTL_DAYS * 86_400_000).toISOString(),
      }
      draft.commandReceipts = pruneReceipts(
        draft.commandReceipts.filter(({ idempotencyKey }) => idempotencyKey !== envelope.idempotencyKey),
        now,
        COMMAND_RECEIPT_LIMIT - 1,
      )
      draft.commandReceipts.push(receipt)

      let validated: WorkspaceStateV3
      try {
        validated = parseWorkspaceState(draft)
      } catch (error) {
        if (error instanceof DomainCommandError) throw error
        throw new DomainCommandError('VALIDATION_ERROR', errorMessage(error))
      }
      try {
        await store.save(validated, current.updatedAt)
      } catch (error) {
        throw new DomainCommandError('WORKSPACE_SAVE_CONFLICT', errorMessage(error), {
          expectedUpdatedAt: current.updatedAt,
        })
      }
      return structuredClone(result)
    },
  }
}

function applyCapabilityCommand(
  state: WorkspaceStateV3,
  command: CapabilityCommand,
  context: CapabilityCommandContext,
): CommandApplication {
  if (isCoreTaskCommand(command)) return applyTaskCommand(state, command, context)
  if (isRecurrenceCommand(command)) return applyRecurrenceCommand(state, command, context)
  if (isLiveCompatibilityCommand(command)) return applyLiveCompatibilityCommand(state, command, context)
  if (command.type === 'workspace.import') return applyWorkspaceImport(state, command)
  if (command.type === 'undo.apply') return applyUndo(state, command, context)
  const commandType = (command as { type: string }).type
  throw new DomainCommandError('COMMAND_NOT_FOUND', `Command is not implemented: ${commandType}.`)
}

function applyWorkspaceImport(state: WorkspaceStateV3, command: WorkspaceImportCommand): CommandApplication {
  let imported: WorkspaceStateV3
  try {
    imported = parseWorkspaceState(command.state)
  } catch (error) {
    throw new DomainCommandError('IMPORT_INVALID', errorMessage(error))
  }
  imported.commandReceipts = []
  const currentRevision = state.revision
  Object.assign(state, structuredClone(imported))
  const affected: EntityRef = { type: 'workspace', id: 'workspace', revision: currentRevision }
  return {
    affected: [affected],
    changes: [{ entity: affected, operation: 'replace', fields: ['workspace'] }],
    events: [],
    compensation: null,
    data: { importedVersion: imported.version },
  }
}

function applyUndo(
  state: WorkspaceStateV3,
  command: UndoApplyCommand,
  context: CapabilityCommandContext,
): CommandApplication {
  const token = command.token
  const original = state.commandReceipts.find(({ id }) => id === token.commandReceiptId)
  const storedToken = original?.result.undoToken
  if (!original || original.requestFingerprint === null || !sameJson(storedToken, token)) {
    throw new DomainCommandError('UNDO_TOKEN_NOT_FOUND', `Undo token is not backed by its command receipt: ${token.id}.`, {
      undoTokenId: token.id,
    })
  }
  const consumed = state.commandReceipts.some(({ commandType, result }) =>
    commandType === 'undo.apply' && undoResultTokenId(result.data) === token.id)
  if (consumed) {
    throw new DomainCommandError('UNDO_ALREADY_APPLIED', `Undo token was already applied: ${token.id}.`, {
      undoTokenId: token.id,
    })
  }
  if (token.expectedWorkspaceRevision !== state.revision) {
    throw new DomainCommandError('UNDO_REVISION_CONFLICT', 'Undo token workspace revision conflict.', {
      undoTokenId: token.id,
      expectedRevision: token.expectedWorkspaceRevision,
      actualRevision: state.revision,
    })
  }

  const events: TaskEvent[] = []
  const restored: EntityRef[] = []
  if (token.compensation.type === 'task.remove_created') {
    const tasks = token.compensation.taskIds.map((taskId) => {
      const task = state.tasks.find(({ id }) => id === taskId)
      if (!task) throw new DomainCommandError('TASK_NOT_FOUND', `Task not found for undo: ${taskId}.`, { taskId })
      if (task.deletedAt !== null) throw new DomainCommandError('TASK_ALREADY_DELETED', `Task is already deleted: ${taskId}.`, { taskId })
      return task
    })
    for (const task of tasks) {
      task.deletedAt = context.now
      task.updatedAt = context.now
      task.revision += 1
      events.push(appendUndoEvent(state, task, 'deleted', task.status, context, original.id))
      restored.push(taskRef(task))
    }
  } else if (token.compensation.type === 'task.restore') {
    const targets = token.compensation.tasks.map((prior) => {
      const index = state.tasks.findIndex(({ id }) => id === prior.id)
      if (index < 0) throw new DomainCommandError('TASK_NOT_FOUND', `Task not found for undo: ${prior.id}.`, { taskId: prior.id })
      return { prior, index, current: state.tasks[index]! }
    })
    for (const session of token.compensation.sessions) {
      if (!state.studySessions.some(({ id }) => id === session.id)) {
        throw new DomainCommandError('VALIDATION_ERROR', `Study session not found for undo: ${session.id}.`)
      }
    }
    for (const recordId of token.compensation.completionRecordIds) {
      if (!state.completionRecords.some(({ id }) => id === recordId)) {
        throw new DomainCommandError('VALIDATION_ERROR', `Completion record not found for undo: ${recordId}.`)
      }
    }
    for (const { prior, index, current } of targets) {
      const restoredTask = structuredClone(prior)
      restoredTask.revision = current.revision + 1
      restoredTask.updatedAt = context.now
      state.tasks[index] = restoredTask
      if (current.status !== restoredTask.status) {
        events.push(appendUndoEvent(
          state,
          restoredTask,
          eventTypeForRestore(current.status, restoredTask.status),
          current.status,
          context,
          original.id,
        ))
      }
      restored.push(taskRef(restoredTask))
    }
    for (const prior of token.compensation.sessions) {
      const index = state.studySessions.findIndex(({ id }) => id === prior.id)
      state.studySessions[index] = structuredClone(prior)
    }
    if (token.compensation.reminderRules !== undefined) {
      const taskIds = new Set(token.compensation.tasks.map(({ id }) => id))
      const revisions = new Map(state.reminderRules.map(({ id, revision }) => [id, revision]))
      state.reminderRules = state.reminderRules.filter(({ taskId }) => !taskIds.has(taskId))
      state.reminderRules.push(...token.compensation.reminderRules.map((prior) => ({
        ...structuredClone(prior),
        revision: Math.max(prior.revision, revisions.get(prior.id) ?? 0) + 1,
      })))
    }
    for (const recordId of token.compensation.completionRecordIds) {
      const record = state.completionRecords.find(({ id }) => id === recordId)!
      record.deletedAt = context.now
      record.updatedAt = context.now
    }
  } else if (token.compensation.type === 'recurrence.restore') {
    const taskIds = new Set(token.compensation.tasks.map(({ id }) => id))
    const seriesIds = new Set([
      ...token.compensation.recurrenceSeries.map(({ id }) => id),
      ...token.compensation.createdSeriesIds,
    ])
    const occurrenceIds = new Set([
      ...token.compensation.occurrenceSnapshots.map(({ id }) => id),
      ...token.compensation.createdOccurrenceIds,
    ])
    const restoredTasks = token.compensation.tasks.map((task) => ({
      ...structuredClone(task),
      updatedAt: context.now,
      revision: task.revision + 1,
    }))
    state.tasks = state.tasks.filter((task) => !taskIds.has(task.id))
    state.tasks.push(...restoredTasks)
    state.recurrenceSeries = state.recurrenceSeries.filter((series) => !seriesIds.has(series.id))
    state.recurrenceSeries.push(...token.compensation.recurrenceSeries.map((series) => structuredClone(series)))
    state.occurrences = state.occurrences.filter((occurrence) => !occurrenceIds.has(occurrence.id))
    state.occurrences.push(...token.compensation.occurrenceSnapshots.map((occurrence) => structuredClone(occurrence)))
    restored.push(
      ...restoredTasks.map(taskRef),
      ...token.compensation.recurrenceSeries.map(({ id, revision }) => ({ type: 'recurrence_series' as const, id, revision })),
      ...token.compensation.occurrenceSnapshots.map(({ id, revision }) => ({ type: 'occurrence' as const, id, revision })),
    )
  }

  return {
    affected: restored,
    changes: restored.map((entity) => ({ entity, operation: 'restore', fields: ['state'] })),
    events,
    compensation: null,
    data: {
      undoTokenId: token.id,
      restoredTaskIds: restored.filter(({ type }) => type === 'task').map(({ id }) => id),
      restoredIds: restored.map(({ id }) => id),
    },
  }
}

function assertEnvelope(current: { revision: number }, envelope: CommandEnvelope): void {
  if (!envelope.idempotencyKey.trim()) {
    throw new DomainCommandError('IDEMPOTENCY_KEY_REQUIRED', 'Command idempotency key is required.')
  }
  if (envelope.protocolVersion !== CAPABILITY_PROTOCOL_VERSION) {
    throw new DomainCommandError('UNSUPPORTED_PROTOCOL_VERSION', `Protocol version ${envelope.protocolVersion} is not supported.`)
  }
  if (current.revision !== envelope.expectedWorkspaceRevision) {
    throw new DomainCommandError('WORKSPACE_REVISION_CONFLICT', 'Workspace revision conflict.', {
      expectedRevision: envelope.expectedWorkspaceRevision,
      actualRevision: current.revision,
    })
  }
}

function previewAffected(
  state: { revision: number; tasks: { id: string; revision: number }[] },
  command: CommandEnvelope['command'],
): EntityRef[] {
  if (command.type === 'workspace.import' || command.type === 'workspace.reset') {
    return [{ type: 'workspace', id: 'workspace', revision: state.revision }]
  }
  if (command.type === 'undo.apply') return command.token.compensation.type === 'task.remove_created'
    ? command.token.compensation.taskIds.map((id) => ({ type: 'task', id }))
    : command.token.compensation.type === 'task.restore'
      ? command.token.compensation.tasks.map(({ id, revision }) => ({ type: 'task', id, revision }))
      : [
          ...command.token.compensation.tasks.map(({ id, revision }) => ({ type: 'task' as const, id, revision })),
          ...command.token.compensation.recurrenceSeries.map(({ id, revision }) => ({ type: 'recurrence_series' as const, id, revision })),
          ...command.token.compensation.occurrenceSnapshots.map(({ id, revision }) => ({ type: 'occurrence' as const, id, revision })),
        ]
  if (command.type === 'recurrence.create') return [{ type: 'task', id: command.taskId }]
  if (
    command.type === 'recurrence.update' ||
    command.type === 'recurrence.complete' ||
    command.type === 'recurrence.skip'
  ) return [{ type: 'occurrence', id: command.occurrenceId }]
  if (command.type === 'task.create') return [{ type: 'task', id: command.taskId ?? 'pending' }]
  if (command.type === 'list.upsert') return [{ type: 'list', id: command.list.id }]
  if (command.type === 'list_group.upsert') return [{ type: 'list_group', id: command.group.id }]
  if (command.type === 'list_group.archive') return [{ type: 'list_group', id: command.groupId }]
  if (
    command.type === 'session.pause' ||
    command.type === 'session.resume' ||
    command.type === 'session.scratchpad.update'
  ) return [{ type: 'session', id: command.sessionId }]
  if (command.type === 'completion.review') return [{ type: 'completion_record', id: command.recordId }]
  if (command.type === 'completion.create_next_action') {
    return [{ type: 'task', id: command.taskId ?? 'pending' }]
  }
  const taskIds = command.type === 'task.reorder' ||
    command.type === 'task.batch_reschedule' ||
    command.type === 'task.batch_cancel' ||
    command.type === 'task.batch_delete'
    ? command.taskIds
    : 'taskId' in command ? [command.taskId] : []
  return taskIds.map((id) => {
    const revision = state.tasks.find((task) => task.id === id)?.revision
    return revision === undefined ? { type: 'task', id } : { type: 'task', id, revision }
  })
}

function isCoreTaskCommand(command: CapabilityCommand): command is TaskCapabilityCommand {
  return command.type === 'task.create' ||
    command.type === 'task.update' ||
    command.type === 'task.delete' ||
    command.type === 'task.complete' ||
    command.type === 'task.reopen' ||
    command.type === 'task.reschedule' ||
    command.type === 'task.batch_reschedule' ||
    command.type === 'task.batch_cancel' ||
    command.type === 'task.batch_delete'
}

function isRecurrenceCommand(command: CapabilityCommand): command is RecurrenceCapabilityCommand {
  return command.type === 'recurrence.create' ||
    command.type === 'recurrence.update' ||
    command.type === 'recurrence.complete' ||
    command.type === 'recurrence.skip'
}

function isLiveCompatibilityCommand(command: CapabilityCommand): command is LiveCompatibilityCommand {
  return command.type === 'list.upsert' ||
    command.type === 'list_group.upsert' ||
    command.type === 'list_group.archive' ||
    command.type === 'task.plan' ||
    command.type === 'task.transition' ||
    command.type === 'task.start' ||
    command.type === 'task.switch' ||
    command.type === 'session.pause' ||
    command.type === 'session.resume' ||
    command.type === 'session.scratchpad.update' ||
    command.type === 'task.checklist.add' ||
    command.type === 'task.checklist.set' ||
    command.type === 'task.reorder' ||
    command.type === 'task.toggle_completion' ||
    command.type === 'completion.review' ||
    command.type === 'completion.create_next_action' ||
    command.type === 'workspace.reset'
}

function publicPreviewImpact(
  command: CommandEnvelope['command'],
  application: CommandApplication,
): Pick<CommandApplication, 'affected' | 'changes'> {
  if (command.type !== 'task.create' || command.taskId !== undefined) {
    return { affected: application.affected, changes: application.changes }
  }
  const entity: EntityRef = { type: 'task', id: 'new' }
  return {
    affected: [entity],
    changes: [{ entity, operation: 'create', fields: ['task'] }],
  }
}

function createPreviewIdGenerator(state: WorkspaceStateV3): CapabilityIdGenerator {
  const used = new Set<string>()
  for (const collection of Object.values(state)) {
    if (!Array.isArray(collection)) continue
    for (const item of collection) {
      if (isRecord(item) && typeof item.id === 'string') used.add(item.id)
    }
  }
  let sequence = 0
  return (kind) => {
    let candidate: string
    do candidate = `preview:${kind}:${++sequence}`
    while (used.has(candidate))
    used.add(candidate)
    return candidate
  }
}

function appendUndoEvent(
  state: WorkspaceStateV3,
  task: Task,
  type: TaskEvent['type'],
  fromStatus: TaskEvent['fromStatus'],
  context: CapabilityCommandContext,
  receiptId: string,
): TaskEvent {
  const event: TaskEvent = {
    id: context.id('event'), sequence: state.taskEvents.length + 1, taskId: task.id, type,
    occurredAt: context.now, fromStatus, toStatus: task.status,
    reason: `Undo command receipt ${receiptId}.`, completionRecordId: null,
  }
  state.taskEvents.push(event)
  return event
}

function eventTypeForRestore(fromStatus: Task['status'], toStatus: Task['status']): TaskEvent['type'] {
  if (toStatus === 'completed') return 'completed'
  if (toStatus === 'cancelled') return 'cancelled'
  if (fromStatus === 'completed' || fromStatus === 'cancelled') return 'reopened'
  if (toStatus === 'planned') return 'rescheduled'
  if (toStatus === 'in_progress') return 'resumed'
  if (toStatus === 'blocked') return 'blocked'
  return 'reopened'
}

function taskRef(task: Task): { type: 'task'; id: string; revision: number } {
  return { type: 'task', id: task.id, revision: task.revision }
}

function pruneReceipts(receipts: readonly CommandReceipt[], now: string, limit: number): CommandReceipt[] {
  const active = receipts
    .map((receipt, index) => ({ receipt, index }))
    .filter(({ receipt }) => Date.parse(receipt.expiresAt) > Date.parse(now))
    .sort((left, right) => (
      Date.parse(left.receipt.createdAt) - Date.parse(right.receipt.createdAt)
      || left.receipt.id.localeCompare(right.receipt.id)
      || left.index - right.index
    ))
    .slice(-limit)
    .map(({ receipt }) => receipt)
  return structuredClone(active)
}

function domainError(error: unknown): DomainError {
  if (error instanceof DomainCommandError) return error.toJSON()
  return new DomainCommandError('VALIDATION_ERROR', errorMessage(error)).toJSON()
}

function receiptEventIds(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((event) => {
    if (!isRecord(event)) return []
    return typeof event.id === 'string' ? [event.id] : []
  })
}

function undoResultTokenId(value: JsonValue | undefined): string | null {
  return isRecord(value) && typeof value.undoTokenId === 'string' ? value.undoTokenId : null
}

function sameJson(left: JsonValue | undefined, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

async function fingerprintRequest(envelope: CommandEnvelope): Promise<string> {
  let request: string
  try {
    request = canonicalJson({
      protocolVersion: envelope.protocolVersion,
      source: envelope.source,
      expectedWorkspaceRevision: envelope.expectedWorkspaceRevision,
      command: envelope.command,
    })
  } catch (error) {
    if (error instanceof DomainCommandError) throw error
    throw jsonSafetyError()
  }
  const bytes = new TextEncoder().encode(request)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw jsonSafetyError()
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw jsonSafetyError()
  if (ancestors.has(value)) throw jsonSafetyError()
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw jsonSafetyError()
      }
      return `[${value.map((entry) => canonicalJson(entry, ancestors)).join(',')}]`
    }
    if (!isRecord(value)) throw jsonSafetyError()
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`).join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

function jsonSafetyError(): DomainCommandError {
  return new DomainCommandError('VALIDATION_ERROR', 'Command request must be JSON-safe.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function nextUpdatedAt(current: string, requested: string): string {
  if (Date.parse(requested) > Date.parse(current)) return requested
  return new Date(Date.parse(current) + 1).toISOString()
}
