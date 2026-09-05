import { applyDeliveryCommand, type DeliveryCommand } from '../reminders/delivery-commands.ts'
import type { ReminderRule, WorkspaceStateV3 } from '../workspace/types.ts'
import { DomainCommandError, type CapabilityCommandContext, type CommandApplication } from './types.ts'

export type ReminderCapabilityCommand =
  | { type: 'reminder.reconcile' }
  | DeliveryCommand
  | { type: 'reminder.set'; ruleId: string; taskId: string; occurrenceId: string | null; trigger: ReminderRule['trigger']; enabled: boolean; expectedRevision?: number }
  | { type: 'reminder.snooze'; deliveryId: string; until: string }
  | { type: 'reminder.dismiss'; deliveryId: string }

export function applyReminderCommand(state: WorkspaceStateV3, command: ReminderCapabilityCommand, context: CapabilityCommandContext): CommandApplication {
  let data: CommandApplication['data'] = null
  if (command.type === 'reminder.reconcile') {
    data = { reconciled: true }
  } else if (command.type === 'reminder.claim' || command.type === 'reminder.ack' || command.type === 'reminder.migrate' || command.type === 'reminder.recover' || command.type === 'reminder.retry') {
    data = applyDeliveryCommand(state, command, context.now)
  } else if (command.type === 'reminder.set') {
    const task = state.tasks.find(({ id, deletedAt }) => id === command.taskId && deletedAt === null)
    if (!task) throw new DomainCommandError('TASK_NOT_FOUND', 'Reminder task does not exist.')
    const existing = state.reminderRules.find(({ id }) => id === command.ruleId)
    if (existing && (existing.taskId !== command.taskId || existing.occurrenceId !== command.occurrenceId)) throw new DomainCommandError('VALIDATION_ERROR', 'Reminder ownership cannot change.')
    if (command.expectedRevision !== undefined && existing?.revision !== command.expectedRevision) throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Reminder revision changed.')
    const rule: ReminderRule = { owner: 'user', id: command.ruleId, taskId: command.taskId, occurrenceId: command.occurrenceId, trigger: structuredClone(command.trigger), enabled: command.enabled, revision: (existing?.revision ?? 0) + 1 }
    if (existing) Object.assign(existing, rule)
    else state.reminderRules.push(rule)
  } else {
    const delivery = state.reminderDeliveries.find(({ id }) => id === command.deliveryId)
    if (!delivery) throw new DomainCommandError('VALIDATION_ERROR', 'Reminder delivery does not exist.')
    if (command.type === 'reminder.snooze') {
      if (!['pending', 'delivered', 'snoozed'].includes(delivery.status)) throw new DomainCommandError('VALIDATION_ERROR', 'This delivery cannot be snoozed.')
      if (!Number.isFinite(Date.parse(command.until)) || Date.parse(command.until) <= Date.parse(context.now)) throw new DomainCommandError('VALIDATION_ERROR', 'Snooze must end in the future.')
      delivery.revision = (delivery.revision ?? 1) + 1
      delivery.status = 'snoozed'
      delivery.snoozedUntil = new Date(command.until).toISOString()
    } else if (delivery.status !== 'acted') {
      delivery.revision = (delivery.revision ?? 1) + 1
      delivery.status = 'dismissed'
    }
  }
  const entity = { type: 'workspace' as const, id: 'workspace', revision: state.revision }
  return { affected: [entity], changes: [{ entity, operation: 'update', fields: ['reminderRules', 'reminderDeliveries'] }], events: [], compensation: null, data }
}
