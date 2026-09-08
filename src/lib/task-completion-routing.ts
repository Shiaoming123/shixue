interface CompletionTaskCandidate {
  id: string
  title: string
  mode: 'general' | 'learning'
  status: string
}

interface CompletionReviewLinkCandidate {
  reviewTaskId: string
}

export interface TaskCompletionSnapshot {
  tasks: readonly CompletionTaskCandidate[]
  reviewTaskLinks: readonly CompletionReviewLinkCandidate[]
}

export function routeSingleTaskCompletion(
  snapshot: TaskCompletionSnapshot,
  taskId: string,
): 'evidence' | 'plan' | 'unblock' | 'toggle' {
  const task = snapshot.tasks.find(({ id }) => id === taskId)
  if (!task) throw new Error(`Task not found: ${taskId}.`)
  const linkedReview = snapshot.reviewTaskLinks.some(({ reviewTaskId }) => reviewTaskId === taskId)
  if (task.mode !== 'learning' || task.status === 'completed' || linkedReview) return 'toggle'
  if (task.status === 'inbox') return 'plan'
  if (task.status === 'blocked') return 'unblock'
  return 'evidence'
}

export function learningBatchBlockers(
  snapshot: TaskCompletionSnapshot,
  taskIds: readonly string[],
): Array<{ id: string; title: string }> {
  const selected = new Set(taskIds)
  return snapshot.tasks
    .filter(({ id, mode, status }) => selected.has(id) && mode === 'learning' && status !== 'completed' && status !== 'cancelled')
    .map(({ id, title }) => ({ id, title }))
}
