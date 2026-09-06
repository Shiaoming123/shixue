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
