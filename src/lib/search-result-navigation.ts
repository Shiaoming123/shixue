import { SYSTEM_LEARNING_LIST_ID } from '../domain/workspace/migrate.ts'
import type { Task } from '../domain/workspace/types.ts'
import type { WorkspaceView } from './workspace-view.ts'

export function destinationForSearchTask(task: Task, activeListIds: readonly string[]): WorkspaceView {
  if (task.status === 'inbox') return { kind: 'inbox' }
  if (task.status === 'completed') return { kind: 'completed' }
  if (task.listId !== SYSTEM_LEARNING_LIST_ID && activeListIds.includes(task.listId)) {
    return { kind: 'list', listId: task.listId }
  }
  return { kind: 'lists' }
}
