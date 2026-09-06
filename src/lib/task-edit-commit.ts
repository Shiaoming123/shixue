import type { ReminderCapabilityCommand } from '../domain/capabilities/reminder-commands'
import type { ReminderRule, RecurrenceCadence } from '../domain/workspace/types'

export async function runTaskEditCommit<Reminder, Recurrence>(input: {
  reminders: readonly Reminder[]
  recurrence?: Recurrence
}, steps: {
  saveTask(): Promise<void>
  saveReminder(reminder: Reminder): Promise<void>
  saveRecurrence(recurrence: Recurrence): Promise<void>
}) {
  await steps.saveTask()
  for (const reminder of input.reminders) await steps.saveReminder(reminder)
  if (input.recurrence !== undefined) await steps.saveRecurrence(input.recurrence)
}

type TaskEditSemantic = {
  title: string
  notes: string
  topicId: string | null
  plannedOn?: string | null
  plannedAt?: string | null
  dueOn?: string | null
  dueAt?: string | null
  priority: string
  estimateMinutes: number | null
  acceptanceCriteria?: string[]
}

function semanticKey(value: TaskEditSemantic) {
  return JSON.stringify({
    title: value.title,
    notes: value.notes,
    topicId: value.topicId,
    schedule: value.plannedAt !== undefined ? { at: instantKey(value.plannedAt), on: null } : { at: null, on: value.plannedOn ?? null },
    deadline: value.dueAt !== undefined ? { at: instantKey(value.dueAt), on: null } : { at: null, on: value.dueOn ?? null },
    priority: value.priority,
    estimateMinutes: value.estimateMinutes,
    acceptanceCriteria: value.acceptanceCriteria ?? null,
  })
}

function instantKey(value: string | null): string | null {
  if (value === null) return null
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? value : instant.toISOString()
}

export function resolveTaskEditWrite(current: TaskEditSemantic, base: TaskEditSemantic, desired: TaskEditSemantic): 'noop' | 'write' | 'conflict' {
  const currentKey = semanticKey(current)
  if (currentKey === semanticKey(desired)) return 'noop'
  if (currentKey === semanticKey(base)) return 'write'
  return 'conflict'
}

type ReminderSetCommand = Extract<ReminderCapabilityCommand, { type: 'reminder.set' }>

function reminderKey(value: ReminderRule | ReminderSetCommand | undefined): string | null {
  if (!value) return null
  const trigger = value.trigger.kind === 'absolute'
    ? { kind: value.trigger.kind, at: instantKey(value.trigger.at) }
    : { ...value.trigger }
  return JSON.stringify({ id: 'id' in value ? value.id : value.ruleId, taskId: value.taskId, occurrenceId: value.occurrenceId, trigger, enabled: value.enabled })
}

export function resolveReminderEditWrite(
  current: ReminderRule | undefined,
  base: ReminderRule | undefined,
  desired: ReminderSetCommand,
): { decision: 'noop' } | { decision: 'write'; command: ReminderSetCommand } | { decision: 'conflict' } {
  const currentKey = reminderKey(current)
  if (currentKey === reminderKey(desired)) return { decision: 'noop' }
  if (currentKey !== reminderKey(base)) return { decision: 'conflict' }
  if (!current) {
    const { expectedRevision: _staleRevision, ...command } = desired
    return { decision: 'write', command }
  }
  return { decision: 'write', command: { ...desired, expectedRevision: current.revision } }
}

type RecurrenceRuleSemantic = {
  cadence: RecurrenceCadence
  basis: 'fixed_schedule' | 'after_completion'
  end: { kind: 'never' } | { kind: 'on'; date: string } | { kind: 'after'; count: number }
}

function recurrenceKey(value: RecurrenceRuleSemantic | null): string | null {
  if (!value) return null
  const cadence = value.cadence.kind === 'weekly'
    ? { ...value.cadence, weekdays: [...value.cadence.weekdays].sort((left, right) => left - right) }
    : value.cadence
  return JSON.stringify({ cadence, basis: value.basis, end: value.end })
}

export function resolveRecurrenceEditWrite(current: RecurrenceRuleSemantic | null, base: RecurrenceRuleSemantic | null, desired: RecurrenceRuleSemantic): 'noop' | 'write' | 'conflict' {
  const currentKey = recurrenceKey(current)
  if (currentKey === recurrenceKey(desired)) return 'noop'
  if (currentKey === recurrenceKey(base)) return 'write'
  return 'conflict'
}
