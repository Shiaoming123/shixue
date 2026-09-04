import { createInMemoryStudyStore } from './in-memory.ts'
import type { StudyStore } from './types.ts'

let current: StudyStore = createInMemoryStudyStore()

/** @deprecated Use registerWorkspaceStore after the v3 writer cutover. */
export function registerStudyStore(store: StudyStore): void {
  current = store
}

/** @deprecated Use getWorkspaceStore after the v3 writer cutover. */
export function getStudyStore(): StudyStore {
  return current
}

export {
  getWorkspaceStore,
  registerWorkspaceStore,
} from '../workspace/registry.ts'
