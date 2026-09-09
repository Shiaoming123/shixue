import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { openMeowDatabase } from '../src/storage/indexeddb/database.ts'
import { createIndexedDbWorkspaceStore, V3_WORKSPACE_STATE_BACKUP_KEY } from '../src/storage/study/indexeddb.ts'
import { BACKUP_LEGACY_WORKSPACE_STATE_SQL, STAGE_WORKSPACE_MIGRATION_SQL, REPLACE_LEGACY_AFTER_BACKUP_SQL, VERIFY_LEGACY_WORKSPACE_STATE_BACKUP_SQL, createTauriSqliteWorkspaceStore, type StudySqlDatabasePort } from '../src/storage/study/tauri-sqlite.ts'
import { parseWorkspaceStateV4 } from '../src/domain/workspace/parse.ts'

const legacy = JSON.parse(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')).state
const NOW = '2026-09-10T00:00:00.000Z'

test('IndexedDB V3 migration preserves the original and persists a valid reloadable V4 only after backup proof', async () => {
  for (const failure of [null, 'conflicting-backup', 'invalid-candidate', 'candidate-readback']) {
    const databaseName = `workspace-v4-${crypto.randomUUID()}`
    const database = await openMeowDatabase(databaseName)
    const original = structuredClone(legacy)
    if (failure === 'invalid-candidate') original.tasks[0].listId = 'missing-list'
    await database.put('studyState', { key: 'current', state: original })
    if (failure === 'conflicting-backup') await database.put('studyState', { key: V3_WORKSPACE_STATE_BACKUP_KEY, state: { ...original, revision: 999 } })
    const originalGet = IDBObjectStore.prototype.get
    if (failure === 'candidate-readback') {
      IDBObjectStore.prototype.get = function (key) {
        const request = originalGet.call(this, key)
        request.addEventListener('success', () => {
          const value = request.result
          if (key === 'current' && value?.state.version === 4) Object.defineProperty(request, 'result', { value: { ...value, state: { ...value.state, revision: 999 } } })
        })
        return request
      }
    }
    try {
      const store = createIndexedDbWorkspaceStore({ databaseName, seed: legacy })
      if (failure) {
        await assert.rejects(store.load(), failure === 'conflicting-backup' ? /backup key/ : failure === 'candidate-readback' ? /candidate read-back/ : /unknown listId/)
        IDBObjectStore.prototype.get = originalGet
        assert.equal(JSON.stringify((await database.get('studyState', 'current'))?.state), JSON.stringify(original))
        if (failure === 'invalid-candidate') assert.equal(await database.get('studyState', V3_WORKSPACE_STATE_BACKUP_KEY), undefined)
      } else {
        const loaded = await store.load()
        assert.equal(loaded.version, 4)
        assert.deepEqual((await database.get('studyState', V3_WORKSPACE_STATE_BACKUP_KEY))?.state, original)
        assert.deepEqual(parseWorkspaceStateV4((await database.get('studyState', 'current'))?.state), loaded)
        assert.deepEqual(await store.load(), loaded, 'Reload must not repeat migration')
        const edited = structuredClone(loaded)
        edited.calendarSources[0].title = 'Synthetic updated source'
        edited.updatedAt = NOW
        await store.save(edited, loaded.updatedAt)
        assert.deepEqual(await store.load(), edited)
        await assert.rejects(store.save(loaded, loaded.updatedAt), /snapshot conflict/)
        assert.deepEqual(await store.load(), edited)
      }
    } finally { IDBObjectStore.prototype.get = originalGet; database.close() }
  }
})

test('real SQLite V3 migration verifies backup bytes, rejects failed proofs and reloads the V4 candidate', async () => {
  for (const failure of [null, 'backup-insert', 'backup-proof', 'candidate-insert', 'candidate-proof', 'replacement', 'final-readback']) {
    const database = new DatabaseSync(':memory:')
    database.exec('CREATE TABLE study_state (id INTEGER PRIMARY KEY, version INTEGER, payload TEXT, updated_at TEXT); CREATE TABLE study_state_backups (backup_key TEXT PRIMARY KEY, version INTEGER, payload TEXT, created_at TEXT)')
    const original = ` ${JSON.stringify(legacy)}\n`
    database.prepare('INSERT INTO study_state VALUES (1, 3, ?, ?)').run(original, legacy.updatedAt)
    let replaced = false
    const port: StudySqlDatabasePort = {
      async select<T>(sql: string, binds = []): Promise<T> {
        const candidateRead = String(binds[0]).startsWith('workspace-state-v4-candidate:')
        if (failure === 'backup-proof' && sql === VERIFY_LEGACY_WORKSPACE_STATE_BACKUP_SQL && !candidateRead) return [{ version: 3, payload: `${original} ` }] as T
        if (failure === 'candidate-proof' && candidateRead) return [{ version: 4, payload: '{}' }] as T
        if (failure === 'final-readback' && replaced) throw new Error('Synthetic read failure')
        const parameters = Object.fromEntries(binds.map((value, index) => [`$${index + 1}`, value]))
        return database.prepare(sql).all(parameters as never) as T
      },
      async execute(sql, binds = []) {
        if ((failure === 'backup-insert' && sql === BACKUP_LEGACY_WORKSPACE_STATE_SQL) || (failure === 'candidate-insert' && sql === STAGE_WORKSPACE_MIGRATION_SQL) || (failure === 'replacement' && sql === REPLACE_LEGACY_AFTER_BACKUP_SQL)) return { rowsAffected: 0 }
        const parameters = Object.fromEntries(binds.map((value, index) => [`$${index + 1}`, value]))
        const result = { rowsAffected: Number(database.prepare(sql).run(parameters as never).changes) }
        if (sql === REPLACE_LEGACY_AFTER_BACKUP_SQL) replaced = result.rowsAffected > 0
        return result
      },
    }
    try {
      const store = createTauriSqliteWorkspaceStore(async () => port, legacy, () => NOW)
      if (failure) {
        await assert.rejects(store.load(), failure === 'final-readback' ? /was saved but read-back confirmation failed/ : failure === 'replacement' ? /not replaced/ : failure.startsWith('candidate') ? /candidate/ : /backup/)
        if (failure === 'final-readback') {
          assert.equal(database.prepare('SELECT version FROM study_state').get()?.version, 4)
          assert.equal(database.prepare('SELECT payload FROM study_state_backups WHERE version = 3').get()?.payload, original)
        } else assert.equal(database.prepare('SELECT payload FROM study_state').get()?.payload, original)
      } else {
        const loaded = await store.load()
        assert.equal(database.prepare('SELECT payload FROM study_state_backups').get()?.payload, original)
        assert.equal(loaded.version, 4)
        assert.deepEqual(await store.load(), loaded)
        const edited = structuredClone(loaded)
        edited.calendarSources[0].title = 'Synthetic updated source'
        edited.updatedAt = NOW
        await store.save(edited, loaded.updatedAt)
        assert.deepEqual(await store.load(), edited)
        await assert.rejects(store.save(loaded, loaded.updatedAt), /snapshot conflict/)
        assert.deepEqual(await store.load(), edited)
      }
    } finally { database.close() }
  }
})
