import { createInMemoryStudyStore } from './in-memory.ts'
import type { StudyStore } from './types.ts'

let current: StudyStore = createInMemoryStudyStore()

export function registerStudyStore(store: StudyStore): void {
  current = store
}

export function getStudyStore(): StudyStore {
  return current
}
