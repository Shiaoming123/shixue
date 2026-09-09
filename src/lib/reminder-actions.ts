import type { TaskCapabilityService } from '../domain/capabilities/types.ts'
import { reminderTarget } from '../domain/reminders/target.ts'

export function createReminderActionBridge(options: {
  service: TaskCapabilityService
  openTask(taskId: string): void | Promise<void>
  openEvent?(eventId: string, originalStart: string | null): void | Promise<void>
  completeTask(taskId: string, occurrenceId: string | null): void | Promise<void>
}) {
  return async (deliveryId: string, action: 'complete' | 'open' | 'snooze' | 'dismiss', until?: string) => {
    const state = await options.service.query({ type: 'workspace.snapshot' })
    const delivery = state.reminderDeliveries.find(({ id }) => id === deliveryId)
    const rule = state.reminderRules.find(({ id }) => id === delivery?.reminderRuleId)
    if (!delivery || !rule) throw new Error('提醒记录不存在。')
    const target = reminderTarget(rule)
    if (action === 'open') {
      if (target.kind === 'task') return options.openTask(target.taskId)
      if (!options.openEvent) throw new Error('日程详情入口暂不可用。')
      return options.openEvent(target.eventId, delivery.originalStart ?? null)
    }
    // Learning completion must retain the existing evidence form/capability boundary.
    if (action === 'complete') {
      if (target.kind !== 'task') throw new Error('日程提醒不能完成任务。')
      return options.completeTask(target.taskId, delivery.occurrenceId)
    }
    if (action === 'snooze' && !until) throw new Error('请选择稍后提醒时间。')
    return options.service.execute({
      protocolVersion: 1, source: 'notification', expectedWorkspaceRevision: state.revision,
      idempotencyKey: `reminder-action:${crypto.randomUUID()}`,
      command: action === 'snooze' ? { type: 'reminder.snooze', deliveryId, until: until! } : { type: 'reminder.dismiss', deliveryId },
    })
  }
}
