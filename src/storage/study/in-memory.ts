import { createSeedStudyState, parseStudyState, type StudyState, type StudyStore } from './types.ts'

export function createInMemoryStudyStore(
  seed: StudyState = createSeedStudyState(),
): StudyStore {
  let current = parseStudyState(seed)

  return {
    async load() {
      return structuredClone(current)
    },
    async save(state, expectedUpdatedAt) {
      if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
        throw new Error('Study snapshot conflict: the stored state changed before save.')
      }
      current = parseStudyState(state)
    },
  }
}
