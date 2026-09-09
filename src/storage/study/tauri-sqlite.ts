import {
  createSeedStudyState,
  migrateStudyStateV1ToV2,
  parseStudyState,
  type StudyState,
  type StudyStore,
} from './types.ts'
import {
  parseWorkspaceStateOrMigrate,
  repairLegacyDeletedPendingReviewTasks,
  migrateWorkspaceV4,
} from '../../domain/workspace/migrate.ts'
import { parseWorkspaceStateV4 } from '../../domain/workspace/parse.ts'
import type { WorkspaceStore } from '../workspace/types.ts'

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
     OR EXISTS (SELECT 1 FROM study_state WHERE id = 1 AND version IN (1, 2) AND updated_at = $4)
  ON CONFLICT(id) DO UPDATE SET
    version = excluded.version,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  WHERE study_state.version IN (1, 2) AND study_state.updated_at = $4`

export const SAVE_STUDY_STATE_WITH_VERSION_GUARD_SQL = `INSERT INTO study_state
  (id, version, payload, updated_at)
  SELECT 1, $1, $2, $3
  WHERE NOT EXISTS (SELECT 1 FROM study_state WHERE id = 1)
     OR EXISTS (SELECT 1 FROM study_state WHERE id = 1 AND version IN (1, 2))
  ON CONFLICT(id) DO UPDATE SET
    version = excluded.version,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  WHERE study_state.version IN (1, 2)`

export const SAVE_WORKSPACE_STATE_WITH_CAS_SQL = `INSERT INTO study_state
  (id, version, payload, updated_at)
  SELECT 1, $1, $2, $3
  WHERE (NOT EXISTS (SELECT 1 FROM study_state WHERE id = 1) AND $4 = $5)
     OR EXISTS (SELECT 1 FROM study_state WHERE id = 1 AND version = 4 AND updated_at = $4)
  ON CONFLICT(id) DO UPDATE SET
    version = excluded.version,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  WHERE study_state.version = 4 AND study_state.updated_at = $4`

export const BACKUP_LEGACY_WORKSPACE_STATE_SQL = `INSERT INTO study_state_backups
  (backup_key, version, payload, created_at)
  SELECT $1, version, payload, $4 FROM study_state
  WHERE id = 1 AND version = $2 AND payload = $3
  ON CONFLICT(backup_key) DO NOTHING`

export const VERIFY_LEGACY_WORKSPACE_STATE_BACKUP_SQL = `SELECT version, payload
  FROM study_state_backups
  WHERE backup_key = $1`

export const STAGE_WORKSPACE_MIGRATION_SQL = `INSERT INTO study_state_backups
  (backup_key, version, payload, created_at)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT(backup_key) DO NOTHING`

export const REPLACE_LEGACY_AFTER_BACKUP_SQL = `INSERT INTO study_state
  (id, version, payload, updated_at)
  SELECT 1, $4, $5, $6
  WHERE EXISTS (
    SELECT 1 FROM study_state_backups
    WHERE backup_key = $1 AND version = $2 AND payload = $3
  )
    AND EXISTS (
      SELECT 1 FROM study_state
      WHERE id = 1 AND version = $2 AND payload = $3
    )
  ON CONFLICT(id) DO UPDATE SET
    version = excluded.version,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  WHERE study_state.version = $2 AND study_state.payload = $3`

interface StudyStateRow {
  version: number
  payload: string
}

interface StudyStateBackupRow {
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
      const rows = await database.select<StudyStateRow[]>(
        'SELECT version, payload FROM study_state WHERE id = 1',
      )
      if (rows[0] && rows[0].version !== 1 && rows[0].version !== 2) {
        throw new Error(`Legacy StudyStore cannot save over Workspace state version ${rows[0].version}.`)
      }
      if (expectedUpdatedAt === undefined) {
        const saved = await database.execute(
          SAVE_STUDY_STATE_WITH_VERSION_GUARD_SQL,
          [validated.version, JSON.stringify(validated), validated.updatedAt],
        )
        if (rowsAffected(saved) < 1) {
          throw new Error('Study snapshot conflict: the stored state changed before save.')
        }
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

export function createTauriSqliteWorkspaceStore(
  loadDatabase: LoadStudySqlDatabase = loadTauriDatabase,
  seed: unknown = createSeedStudyState(),
  now: () => string = () => new Date().toISOString(),
): WorkspaceStore {
  const initial = parseWorkspaceStateOrMigrate(seed)

  return {
    async load() {
      const database = await loadDatabase()
      const rows = await database.select<StudyStateRow[]>(
        'SELECT version, payload FROM study_state WHERE id = 1',
      )
      if (rows.length === 0) return structuredClone(initial)
      const stored = parsePayload(rows[0].payload)
      assertPayloadVersion(stored, rows[0].version)
      if (rows[0].version === 4) return parseWorkspaceStateV4(stored)
      if (rows[0].version !== 1 && rows[0].version !== 2 && rows[0].version !== 3) {
        throw new Error(`Unsupported stored Workspace state version: ${rows[0].version}.`)
      }

      const migratedAt = now()
      const sourceVersion = rows[0].version
      const sourcePayload = rows[0].payload
      let backupKey = `workspace-state-v${sourceVersion}:${crypto.randomUUID()}`
      let migrated
      try {
        migrated = parseWorkspaceStateOrMigrate(stored, migratedAt)
      } catch (originalError) {
        const repaired = repairLegacyDeletedPendingReviewTasks(stored, migratedAt)
        if (!repaired) throw originalError
        migrated = migrateWorkspaceV4(repaired)
        backupKey = `workspace-state-v3-review-repair:${crypto.randomUUID()}`
      }
      const backup = await database.execute(BACKUP_LEGACY_WORKSPACE_STATE_SQL, [
        backupKey,
        sourceVersion,
        sourcePayload,
        migratedAt,
      ])
      if (rowsAffected(backup) < 1) {
        throw new Error('Workspace state migration backup insert failed.')
      }
      const proof = await database.select<StudyStateBackupRow[]>(
        VERIFY_LEGACY_WORKSPACE_STATE_BACKUP_SQL,
        [backupKey],
      )
      if (
        proof.length !== 1 ||
        proof[0].version !== sourceVersion ||
        proof[0].payload !== sourcePayload
      ) {
        throw new Error('Workspace state migration backup proof is missing or mismatched.')
      }
      const candidatePayload = JSON.stringify(migrated)
      const candidateKey = `workspace-state-v4-candidate:${crypto.randomUUID()}`
      const staged = await database.execute(STAGE_WORKSPACE_MIGRATION_SQL, [
        candidateKey, migrated.version, candidatePayload, migratedAt,
      ])
      if (rowsAffected(staged) < 1) throw new Error('Workspace migration candidate insert failed; current was not replaced.')
      const candidateProof = await database.select<StudyStateBackupRow[]>(VERIFY_LEGACY_WORKSPACE_STATE_BACKUP_SQL, [candidateKey])
      if (candidateProof.length !== 1 || candidateProof[0].version !== 4 || candidateProof[0].payload !== candidatePayload) {
        throw new Error('Workspace migration candidate proof is missing or mismatched; current was not replaced.')
      }
      parseWorkspaceStateV4(parsePayload(candidateProof[0].payload))
      const replaced = await database.execute(REPLACE_LEGACY_AFTER_BACKUP_SQL, [
        backupKey,
        sourceVersion,
        sourcePayload,
        migrated.version,
        candidatePayload,
        migrated.updatedAt,
      ])
      if (rowsAffected(replaced) < 1) {
        throw new Error('Workspace state migration was not replaced after backup proof.')
      }
      try {
        const written = await database.select<StudyStateRow[]>('SELECT version, payload FROM study_state WHERE id = 1')
        if (written.length !== 1 || written[0].version !== 4 || written[0].payload !== candidatePayload) {
          throw new Error('Workspace migration read-back mismatch.')
        }
        return parseWorkspaceStateV4(parsePayload(written[0].payload))
      } catch {
        throw new Error(`Workspace migration was saved but read-back confirmation failed; original backup retained at ${backupKey}.`)
      }
    },
    async save(state, expectedUpdatedAt) {
      const database = await loadDatabase()
      const validated = parseWorkspaceStateV4(state)
      const rows = await database.select<StudyStateRow[]>(
        'SELECT version, payload FROM study_state WHERE id = 1',
      )
      if (rows.length > 0 && rows[0].version !== 4) {
        throw new Error('Workspace storage must load and migrate legacy state before save.')
      }
      if (expectedUpdatedAt === undefined) {
        const saved = await database.execute(
          `INSERT INTO study_state (id, version, payload, updated_at)
         SELECT 1, $1, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM study_state WHERE id = 1)
            OR EXISTS (SELECT 1 FROM study_state WHERE id = 1 AND version = 4)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           payload = excluded.payload,
           updated_at = excluded.updated_at
         WHERE study_state.version = 4`,
          [validated.version, JSON.stringify(validated), validated.updatedAt],
        )
        if (rowsAffected(saved) < 1) {
          throw new Error('Study snapshot conflict: the stored state changed before save.')
        }
        return
      }
      const saved = await database.execute(SAVE_WORKSPACE_STATE_WITH_CAS_SQL, [
        validated.version,
        JSON.stringify(validated),
        validated.updatedAt,
        expectedUpdatedAt,
        initial.updatedAt,
      ])
      if (rowsAffected(saved) < 1) {
        throw new Error('Workspace snapshot conflict: the stored state changed before save.')
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

function assertPayloadVersion(value: unknown, rowVersion: number): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).version !== rowVersion
  ) {
    throw new Error('Stored Workspace state row version does not match its JSON payload.')
  }
}

function rowsAffected(result: unknown): number {
  if (typeof result !== 'object' || result === null) return 0
  const value = (result as SqlExecuteResult).rowsAffected
  return typeof value === 'number' && Number.isInteger(value) ? value : 0
}
