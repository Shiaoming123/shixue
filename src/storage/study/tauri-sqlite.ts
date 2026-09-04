import {
  createSeedStudyState,
  migrateStudyStateV1ToV2,
  parseStudyState,
  type StudyState,
  type StudyStore,
} from './types.ts'

const DB_URL = 'sqlite:study.db'

export const BACKUP_V1_STUDY_STATE_SQL = `INSERT INTO study_state_backups
  (backup_key, version, payload, created_at)
  SELECT $1, version, payload, $3 FROM study_state
  WHERE id = 1 AND version = $2
  ON CONFLICT(backup_key) DO NOTHING`

export const REPLACE_V1_AFTER_BACKUP_SQL = `INSERT INTO study_state
  (id, version, payload, updated_at)
  SELECT 1, $2, $3, $4
  WHERE EXISTS (
    SELECT 1 FROM study_state_backups
    WHERE backup_key = $1 AND version = 1
  )
    AND EXISTS (
      SELECT 1 FROM study_state
      WHERE id = 1 AND version = 1
    )
  ON CONFLICT(id) DO UPDATE SET
    version = excluded.version,
    payload = excluded.payload,
    updated_at = excluded.updated_at`

export const SAVE_STUDY_STATE_WITH_CAS_SQL = `INSERT INTO study_state
  (id, version, payload, updated_at)
  SELECT 1, $1, $2, $3
  WHERE (NOT EXISTS (SELECT 1 FROM study_state WHERE id = 1) AND $4 = $5)
     OR EXISTS (SELECT 1 FROM study_state WHERE id = 1 AND updated_at = $4)
  ON CONFLICT(id) DO UPDATE SET
    version = excluded.version,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  WHERE study_state.updated_at = $4`

interface StudyStateRow {
  version: number
  payload: string
}

interface SqlExecuteResult {
  rowsAffected?: number
}

export interface StudySqlDatabasePort {
  select<T>(sql: string, bindValues?: unknown[]): Promise<T>
  execute(sql: string, bindValues?: unknown[]): Promise<unknown>
}

export type LoadStudySqlDatabase = () => Promise<StudySqlDatabasePort>

let connection: Promise<StudySqlDatabasePort> | undefined

async function loadTauriDatabase(): Promise<StudySqlDatabasePort> {
  if (!connection) {
    connection = import('@tauri-apps/plugin-sql').then(({ default: Database }) =>
      Database.load(DB_URL),
    )
  }
  return connection
}

export function createTauriSqliteStudyStore(
  loadDatabase: LoadStudySqlDatabase = loadTauriDatabase,
  seed: StudyState = createSeedStudyState(),
  now: () => string = () => new Date().toISOString(),
): StudyStore {
  const initial = parseStudyState(seed)

  return {
    async load() {
      const database = await loadDatabase()
      const rows = await database.select<StudyStateRow[]>(
        'SELECT version, payload FROM study_state WHERE id = 1',
      )
      if (rows.length === 0) return structuredClone(initial)
      const stored = parsePayload(rows[0].payload)
      if (rows[0].version === 2) return parseStudyState(stored)
      if (rows[0].version !== 1) {
        throw new Error(`Unsupported stored Study state version: ${rows[0].version}.`)
      }

      const migratedAt = now()
      const migrated = migrateStudyStateV1ToV2(stored, migratedAt)
      const backupKey = `study-state-v1:${crypto.randomUUID()}`
      const backup = await database.execute(BACKUP_V1_STUDY_STATE_SQL, [
        backupKey,
        1,
        migratedAt,
      ])
      if (rowsAffected(backup) < 1) {
        throw new Error('Study state v1 migration backup insert failed.')
      }
      const replaced = await database.execute(REPLACE_V1_AFTER_BACKUP_SQL, [
        backupKey,
        2,
        JSON.stringify(migrated),
        migrated.updatedAt,
      ])
      if (rowsAffected(replaced) < 1) {
        throw new Error('Study state v1 migration was not replaced because its backup is missing.')
      }
      return migrated
    },
    async save(state, expectedUpdatedAt) {
      const database = await loadDatabase()
      const validated = parseStudyState(state)
      if (expectedUpdatedAt === undefined) {
        await database.execute(
          `INSERT INTO study_state (id, version, payload, updated_at)
         VALUES (1, $1, $2, $3)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
          [validated.version, JSON.stringify(validated), validated.updatedAt],
        )
        return
      }
      const saved = await database.execute(SAVE_STUDY_STATE_WITH_CAS_SQL, [
        validated.version,
        JSON.stringify(validated),
        validated.updatedAt,
        expectedUpdatedAt,
        initial.updatedAt,
      ])
      if (rowsAffected(saved) < 1) {
        throw new Error('Study snapshot conflict: the stored state changed before save.')
      }
    },
  }
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload)
  } catch {
    throw new Error('Stored Study state contains invalid JSON.')
  }
}

function rowsAffected(result: unknown): number {
  if (typeof result !== 'object' || result === null) return 0
  const value = (result as SqlExecuteResult).rowsAffected
  return typeof value === 'number' && Number.isInteger(value) ? value : 0
}
