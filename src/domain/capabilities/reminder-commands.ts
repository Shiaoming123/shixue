import { applyDeliveryCommand, type DeliveryCommand } from '../reminders/delivery-commands.ts'
import type { ReminderRule, ReminderTarget, WorkspaceStateV4 } from '../workspace/types.ts'
import { reminderTarget } from '../reminders/target.ts'
import { isCalendarEventOccurrenceStart } from '../calendar/event-occurrences.ts'
import { DomainCommandError, type CapabilityCommandContext, type CommandApplication } from './types.ts'

export type ReminderCapabilityCommand =
  | { type: 'reminder.reconcile' }
  | DeliveryCommand
  | ({ type: 'reminder.set'; ruleId: string; trigger: ReminderRule['trigger']; enabled: boolean; expectedRevision?: number } & ({ target: ReminderTarget } | { taskId: string; occurrenceId: string | null }))
  | { type: 'reminder.snooze'; deliveryId: string; until: string }
  | { type: 'reminder.dismiss'; deliveryId: string }

export function applyReminderCommand(state: WorkspaceStateV4, command: ReminderCapabilityCommand, context: CapabilityCommandContext): CommandApplication {
  let data: CommandApplication['data'] = null
  let compensation: CommandApplication['compensation'] = null
  if (command.type === 'reminder.reconcile') {
    data = { reconciled: true }
  } else if (command.type === 'reminder.claim' || command.type === 'reminder.ack' || command.type === 'reminder.migrate' || command.type === 'reminder.recover' || command.type === 'reminder.retry') {
    data = applyDeliveryCommand(state, command, context.now)
  } else if (command.type === 'reminder.set') {
    const target = reminderTarget(command)
    if ('target' in command && ('taskId' in command || 'occurrenceId' in command)) throw new DomainCommandError('VALIDATION_ERROR', 'Reminder command must have one target.')
    if (target.kind === 'task') {
      const task = state.tasks.find(({ id, deletedAt }) => id === target.taskId && deletedAt === null)
      if (!task) throw new DomainCommandError('TASK_NOT_FOUND', 'Reminder task does not exist.')
    } else {
      const event = state.calendarEvents.find(({ id, deletedAt }) => id === target.eventId && deletedAt === null)
      if (!event) throw new DomainCommandError('VALIDATION_ERROR', 'Reminder event does not exist.')
      if (command.trigger.kind === 'before_due') throw new DomainCommandError('VALIDATION_ERROR', 'Events do not have task deadlines.')
      if (target.originalStart !== null && !isCalendarEventOccurrenceStart(event, target.originalStart)) throw new DomainCommandError('VALIDATION_ERROR', 'Reminder event occurrence does not exist.')
    }
    const existing = state.reminderRules.find(({ id }) => id === command.ruleId)
    if (existing && JSON.stringify(reminderTarget(existing)) !== JSON.stringify(target)) throw new DomainCommandError('VALIDATION_ERROR', 'Reminder ownership cannot change.')
    if (command.expectedRevision !== undefined && existing?.revision !== command.expectedRevision) throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Reminder revision changed.')
    compensation = { type: 'reminder.restore', ruleId: command.ruleId, rule: existing ? structuredClone(existing) : null }
    const rule: ReminderRule = { owner: 'user', id: command.ruleId, target: structuredClone(target), trigger: structuredClone(command.trigger), enabled: command.enabled, revision: (existing?.revision ?? 0) + 1 }
    if (existing) state.reminderRules[state.reminderRules.indexOf(existing)] = rule
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
  return { affected: [entity], changes: [{ entity, operation: 'update', fields: ['reminderRules', 'reminderDeliveries'] }], events: [], compensation, data }
}
