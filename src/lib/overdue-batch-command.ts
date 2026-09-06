import type {
  CapabilityCommand,
  CommandEnvelope,
  CommandPreview,
  CommandResult,
} from '../domain/capabilities/types.ts'
import { CAPABILITY_PROTOCOL_VERSION } from '../domain/capabilities/types.ts'
import type { WorkspaceStateV3 } from '../domain/workspace/types.ts'
import {
  calendarCommandErrorDetail,
  runCalendarCommand,
  type CalendarNoticeAction,
} from './calendar-command-handler.ts'

type BatchRescheduleCommand = Extract<CapabilityCommand, { type: 'task.batch_reschedule' }>
type BatchRescheduleEnvelope = CommandEnvelope<BatchRescheduleCommand>

export interface OverdueBatchRuntime {
  snapshot(): Promise<WorkspaceStateV3>
  preview(envelope: BatchRescheduleEnvelope): Promise<CommandPreview>
  execute(envelope: BatchRescheduleEnvelope): Promise<CommandResult>
  refresh(): Promise<void>
  notify(message: string, action?: CalendarNoticeAction): void
  successAction(result: CommandResult): CalendarNoticeAction | undefined
  createId(): string
}

export async function runOverdueBatchMove(
  taskIds: readonly string[],
  today: string,
  runtime: OverdueBatchRuntime,
): Promise<CommandResult | null> {
  let workspace: WorkspaceStateV3
  try {
    workspace = await runtime.snapshot()
  } catch (error) {
    runtime.notify(`无法读取最新任务，未执行调整：${calendarCommandErrorDetail(error)}`)
    return null
  }
  const requested = new Set(taskIds)
  const tasks = workspace.tasks.filter((task) =>
    requested.has(task.id) &&
    task.deletedAt === null &&
    task.status !== 'completed' &&
    task.status !== 'cancelled' &&
    task.recurrenceSeriesId === null)
  if (!tasks.length) {
    runtime.notify('所选逾期项需要逐项处理。')
    return null
  }

  const command: BatchRescheduleCommand = {
    type: 'task.batch_reschedule',
    taskIds: tasks.map(({ id }) => id),
    startOn: today,
    expectedRevisions: Object.fromEntries(tasks.map(({ id, revision }) => [id, revision])),
    eventIds: Object.fromEntries(tasks.map(({ id }) => [id, runtime.createId()])),
    reason: '从逾期分组批量移到今天',
  }
  const envelope: BatchRescheduleEnvelope = {
    protocolVersion: CAPABILITY_PROTOCOL_VERSION,
    idempotencyKey: `overdue-ui:${runtime.createId()}`,
    source: 'human-ui',
    expectedWorkspaceRevision: workspace.revision,
    command,
  }
  try {
    const preview = await runtime.preview(envelope)
    if (!preview.accepted) {
      runtime.notify(`批量调整未通过预演：${preview.validationErrors[0]?.message ?? '未知原因'}`)
      return null
    }
  } catch (error) {
    runtime.notify(`批量调整预演失败：${calendarCommandErrorDetail(error)}`)
    return null
  }

  try {
    return await runCalendarCommand({
      preflight: async () => workspace.revision,
      execute: () => runtime.execute(envelope),
      refresh: runtime.refresh,
      notify: runtime.notify,
      successAction: runtime.successAction,
      successMessage: `已把 ${tasks.length} 项移到今天。`,
    })
  } catch {
    return null
  }
}
