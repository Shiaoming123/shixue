import { createSeedStudyState, parseStudyState, type StudyState, type StudyStore } from './types.ts'
import { parseWorkspaceStateOrMigrate } from '../../domain/workspace/migrate.ts'
import { parseWorkspaceState } from '../../domain/workspace/parse.ts'
import type { WorkspaceStore } from '../workspace/types.ts'

/** @deprecated Use createInMemoryWorkspaceStore after the v3 writer cutover. */
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

export function createInMemoryWorkspaceStore(
  seed: unknown = createSeedStudyState(),
): WorkspaceStore {
  let current = parseWorkspaceStateOrMigrate(seed)

  return {
    async load() {
      return structuredClone(current)
    },
    async save(state, expectedUpdatedAt) {
      if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
        throw new Error('Workspace snapshot conflict: the stored state changed before save.')
      }
      current = parseWorkspaceState(state)
    },
  }
}
