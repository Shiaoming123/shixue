import { DEFAULT_WEB_DATABASE_NAME, openMeowDatabase } from '../indexeddb/database.ts'
import { parseWorkspaceStateOrMigrate } from '../../domain/workspace/migrate.ts'
import { parseWorkspaceState } from '../../domain/workspace/parse.ts'
import {
  createSeedStudyState,
  parseStudyState,
  parseStudyStateOrMigrate,
  type StudyState,
  type StudyStore,
} from './types.ts'
import type { WorkspaceStore } from '../workspace/types.ts'

const CURRENT_STUDY_STATE = 'current'
export const V1_STUDY_STATE_BACKUP_KEY = 'backup-v1-before-v2'
export const V1_WORKSPACE_STATE_BACKUP_KEY = 'backup-v1-before-v3'
export const V2_WORKSPACE_STATE_BACKUP_KEY = 'backup-v2-before-v3'

export interface IndexedDbStudyStoreOptions {
  databaseName?: string
  seed?: StudyState
}

export interface IndexedDbWorkspaceStoreOptions {
  databaseName?: string
  seed?: unknown
}

/** @deprecated Use createIndexedDbWorkspaceStore after the v3 writer cutover. */
export function createIndexedDbStudyStore(
  options: IndexedDbStudyStoreOptions = {},
): StudyStore {
  const databaseName = options.databaseName ?? DEFAULT_WEB_DATABASE_NAME
  const seed = parseStudyState(options.seed ?? createSeedStudyState())

  return {
    async load() {
      const database = await openMeowDatabase(databaseName)
      const transaction = database.transaction('studyState', 'readwrite')
      const record = await transaction.store.get(CURRENT_STUDY_STATE)
      if (!record) {
        await transaction.done
        return structuredClone(seed)
      }
      if (record.state.version === 1) {
        const migrated = parseStudyStateOrMigrate(record.state)
        const existingBackup = await transaction.store.get(V1_STUDY_STATE_BACKUP_KEY)
        if (!existingBackup) {
          await transaction.store.put({ key: V1_STUDY_STATE_BACKUP_KEY, state: record.state })
        }
        await transaction.store.put({ key: CURRENT_STUDY_STATE, state: migrated })
        await transaction.done
        return migrated
      }
      await transaction.done
      return parseStudyState(record.state)
    },
    async save(state, expectedUpdatedAt) {
      const database = await openMeowDatabase(databaseName)
      const validated = parseStudyState(state)
      const transaction = database.transaction('studyState', 'readwrite')
      const current = await transaction.store.get(CURRENT_STUDY_STATE)
      if (current?.state.version === 3) {
        throw new Error('Legacy StudyStore cannot save over Workspace state version 3.')
      }
      const actualUpdatedAt = current?.state.updatedAt ?? seed.updatedAt
      if (expectedUpdatedAt !== undefined && actualUpdatedAt !== expectedUpdatedAt) {
        throw new Error('Study snapshot conflict: the stored state changed before save.')
      }
      await transaction.store.put({
        key: CURRENT_STUDY_STATE,
        state: validated,
      })
      await transaction.done
    },
  }
}

export function createIndexedDbWorkspaceStore(
  options: IndexedDbWorkspaceStoreOptions = {},
): WorkspaceStore {
  const databaseName = options.databaseName ?? DEFAULT_WEB_DATABASE_NAME
  const seed = parseWorkspaceStateOrMigrate(options.seed ?? createSeedStudyState())

  return {
    async load() {
      const database = await openMeowDatabase(databaseName)
      const transaction = database.transaction('studyState', 'readwrite')
      const record = await transaction.store.get(CURRENT_STUDY_STATE)
      if (!record) {
        await transaction.done
        return structuredClone(seed)
      }
      if (record.state.version === 3) {
        await transaction.done
        return parseWorkspaceState(record.state)
      }

      const original = structuredClone(record.state)
      const migrated = parseWorkspaceStateOrMigrate(original)
      const backupKey = record.state.version === 1
        ? V1_WORKSPACE_STATE_BACKUP_KEY
        : V2_WORKSPACE_STATE_BACKUP_KEY
      const existingBackup = await transaction.store.get(backupKey)
      if (existingBackup && !sameValue(existingBackup.state, original)) {
        throw new Error('Workspace migration backup key contains a different payload.')
      }
      if (!existingBackup) {
        await transaction.store.put({ key: backupKey, state: original })
      }
      const backup = await transaction.store.get(backupKey)
      if (!backup || !sameValue(backup.state, original)) {
        throw new Error('Workspace migration backup proof does not match the stored payload.')
      }
      await transaction.store.put({ key: CURRENT_STUDY_STATE, state: migrated })
      await transaction.done
      return migrated
    },
    async save(state, expectedUpdatedAt) {
      const database = await openMeowDatabase(databaseName)
      const validated = parseWorkspaceState(state)
      const transaction = database.transaction('studyState', 'readwrite')
      const current = await transaction.store.get(CURRENT_STUDY_STATE)
      if (current && current.state.version !== 3) {
        throw new Error('Workspace storage must load and migrate legacy state before save.')
      }
      const actualUpdatedAt = current?.state.updatedAt ?? seed.updatedAt
      if (expectedUpdatedAt !== undefined && actualUpdatedAt !== expectedUpdatedAt) {
        throw new Error('Workspace snapshot conflict: the stored state changed before save.')
      }
      await transaction.store.put({ key: CURRENT_STUDY_STATE, state: validated })
      await transaction.done
    },
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
