import type { TaskCapabilityService } from '../domain/capabilities/types.ts'

export function createReminderActionBridge(options: {
  service: TaskCapabilityService
  openTask(taskId: string): void | Promise<void>
  completeTask(taskId: string, occurrenceId: string | null): void | Promise<void>
}) {
  return async (deliveryId: string, action: 'complete' | 'open' | 'snooze' | 'dismiss', until?: string) => {
    const state = await options.service.query({ type: 'workspace.snapshot' })
    const delivery = state.reminderDeliveries.find(({ id }) => id === deliveryId)
    const rule = state.reminderRules.find(({ id }) => id === delivery?.reminderRuleId)
    if (!delivery || !rule) throw new Error('提醒记录不存在。')
    if (action === 'open') return options.openTask(rule.taskId)
    // Learning completion must retain the existing evidence form/capability boundary.
    if (action === 'complete') return options.completeTask(rule.taskId, delivery.occurrenceId)
    if (action === 'snooze' && !until) throw new Error('请选择稍后提醒时间。')
    return options.service.execute({
      protocolVersion: 1, source: 'notification', expectedWorkspaceRevision: state.revision,
      idempotencyKey: `reminder-action:${crypto.randomUUID()}`,
      command: action === 'snooze' ? { type: 'reminder.snooze', deliveryId, until: until! } : { type: 'reminder.dismiss', deliveryId },
    })
  }
}
