import type { ReminderRule, Task, TaskOccurrence, WorkspaceStateV3 } from '../workspace/types.ts'

export function deliveryKey(ruleId: string, occurrenceId: string | null, scheduledFor: string): string {
  return JSON.stringify([ruleId, occurrenceId, new Date(scheduledFor).toISOString()])
}

export function resolveReminderInstant(rule: ReminderRule, task: Task, occurrence: TaskOccurrence | null): string | null {
  if (!rule.enabled || task.deletedAt || task.status === 'completed' || task.status === 'cancelled') return null
  if (occurrence && occurrence.status !== 'pending') return null
  if (rule.occurrenceId !== null && rule.occurrenceId !== occurrence?.id) return null
  const trigger = rule.trigger
  const anchor = trigger.kind === 'absolute' ? trigger.at
    : trigger.kind === 'before_due' ? (occurrence ? null : task.deadline.dueAt)
      : occurrence ? (occurrence.override?.scheduledOn ? null : occurrence.override?.scheduledAt ?? occurrence.scheduledAt) : task.schedule.startAt
  if (!anchor) return null
  const offset = trigger.kind === 'before_start' || trigger.kind === 'before_due' ? trigger.minutes * 60_000 : 0
  return new Date(Date.parse(anchor) - offset).toISOString()
}

export function reconcileReminderDeliveries(state: WorkspaceStateV3, createPending = true): void {
  const desired = new Map<string, { ruleId: string; occurrenceId: string | null; at: string }>()
  for (const rule of state.reminderRules) {
    const task = state.tasks.find(({ id }) => id === rule.taskId)
    if (!task) continue
    const occurrences = rule.occurrenceId !== null ? state.occurrences.filter(({ id }) => id === rule.occurrenceId)
      : task.recurrenceSeriesId && rule.trigger.kind !== 'absolute' ? state.occurrences.filter(({ seriesId }) => seriesId === task.recurrenceSeriesId) : [null]
    for (const occurrence of occurrences) {
      const at = resolveReminderInstant(rule, task, occurrence)
      if (at) desired.set(deliveryKey(rule.id, occurrence?.id ?? null, at), { ruleId: rule.id, occurrenceId: occurrence?.id ?? null, at })
    }
  }
  for (const delivery of state.reminderDeliveries) {
    const key = deliveryKey(delivery.reminderRuleId, delivery.occurrenceId, delivery.scheduledFor)
    if (!desired.has(key) && (delivery.status === 'pending' || delivery.status === 'snoozed')) {
      delivery.status = 'cancelled'
      delivery.revision = (delivery.revision ?? 1) + 1
    } else if (desired.has(key) && delivery.status === 'cancelled') {
      delivery.status = delivery.snoozedUntil ? 'snoozed' : 'pending'
      delivery.revision = (delivery.revision ?? 1) + 1
    }
    desired.delete(key)
  }
  if (createPending) for (const [key, entry] of desired) state.reminderDeliveries.push({
    id: `delivery:${key}`, reminderRuleId: entry.ruleId, occurrenceId: entry.occurrenceId,
    scheduledFor: entry.at, status: 'pending', snoozedUntil: null, action: null,
  })
}
