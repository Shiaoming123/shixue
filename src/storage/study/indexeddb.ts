import { DEFAULT_WEB_DATABASE_NAME, openMeowDatabase } from '../indexeddb/database.ts'
import {
  createSeedStudyState,
  parseStudyState,
  parseStudyStateOrMigrate,
  type StudyState,
  type StudyStore,
} from './types.ts'

const CURRENT_STUDY_STATE = 'current'
export const V1_STUDY_STATE_BACKUP_KEY = 'backup-v1-before-v2'

export interface IndexedDbStudyStoreOptions {
  databaseName?: string
  seed?: StudyState
}

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
