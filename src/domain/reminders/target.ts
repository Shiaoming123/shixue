import type { ReminderTarget } from '../workspace/types.ts'

/** One compatibility cycle for task-only callers; persisted V4 writes use target. */
export function reminderTarget(rule: { target: ReminderTarget } | { taskId: string; occurrenceId: string | null }): ReminderTarget {
  const target = 'target' in rule ? rule.target : { kind: 'task' as const, taskId: rule.taskId, occurrenceId: rule.occurrenceId }
  if (target.kind === 'task') return { kind: 'task', taskId: target.taskId, occurrenceId: target.occurrenceId }
  return { kind: 'event', eventId: target.eventId, originalStart: target.originalStart !== null && /(?:Z|[+-]\d{2}:\d{2})$/.test(target.originalStart) ? new Date(target.originalStart).toISOString() : target.originalStart }
}
