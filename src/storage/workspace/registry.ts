import { createInMemoryWorkspaceStore } from '../study/in-memory.ts'
import type { WorkspaceStore } from './types.ts'

let current: WorkspaceStore = createInMemoryWorkspaceStore()

export function registerWorkspaceStore(store: WorkspaceStore): void {
  current = store
}

export function getWorkspaceStore(): WorkspaceStore {
  return current
}
