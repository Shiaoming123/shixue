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
