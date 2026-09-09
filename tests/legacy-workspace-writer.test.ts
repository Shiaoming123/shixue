import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { openMeowDatabase } from '../src/storage/indexeddb/database.ts'
import { createIndexedDbStudyStore } from '../src/storage/study/indexeddb.ts'
import { createTauriSqliteStudyStore, type StudySqlDatabasePort } from '../src/storage/study/tauri-sqlite.ts'
import { createSeedStudyState } from '../src/storage/study/types.ts'

const NOW = '2026-09-09T00:00:00.000Z'
const seed = createSeedStudyState(NOW)

test('legacy IndexedDB writes allow only empty or V1/V2 records, with and without CAS', async () => {
  for (const version of [null, 1, 2, 3, 4, 999]) {
    for (const expectedUpdatedAt of [undefined, NOW]) {
      const databaseName = `legacy-writer-${crypto.randomUUID()}`
      const database = await openMeowDatabase(databaseName)
      const original = { version, updatedAt: NOW, opaque: 'synthetic future fields must survive' }
      if (version !== null) {
        // Persist an unknown future record exactly as an older binary would encounter it.
        await database.put('studyState', { key: 'current', state: original as never })
      }
      try {
        const store = createIndexedDbStudyStore({ databaseName, seed })
        if (version === null || version === 1 || version === 2) {
          await store.save(seed, expectedUpdatedAt)
          assert.deepEqual((await database.get('studyState', 'current'))?.state, seed)
        } else {
          await assert.rejects(store.save(seed, expectedUpdatedAt), new RegExp(`version ${version}`))
          assert.equal(JSON.stringify((await database.get('studyState', 'current'))?.state), JSON.stringify(original))
        }
      } finally {
        database.close()
      }
    }
  }
})

test('legacy SQLite guards preserve newer raw bytes even when the row changes after preflight', async () => {
  for (const version of [null, 1, 2, 3, 4, 999]) {
    for (const expectedUpdatedAt of [undefined, NOW]) {
      for (const race of version !== null && version >= 3 ? [false, true] : [false]) {
        const database = new DatabaseSync(':memory:')
        database.exec('CREATE TABLE study_state (id INTEGER PRIMARY KEY, version INTEGER, payload TEXT, updated_at TEXT)')
        const original = ` { "version": ${version}, "opaque": "synthetic future fields must survive" } `
        const insert = database.prepare('INSERT INTO study_state VALUES (1, ?, ?, ?)')
        if (version !== null) insert.run(race ? 2 : version, race ? JSON.stringify(seed) : original, NOW)
        let writes = 0
        const port: StudySqlDatabasePort = {
          async select<T>(sql: string): Promise<T> { return database.prepare(sql).all() as T },
          async execute(sql, binds = []) {
            writes += 1
            if (race) database.prepare('UPDATE study_state SET version = ?, payload = ? WHERE id = 1').run(version!, original)
            const parameters = Object.fromEntries(binds.map((value, index) => [`$${index + 1}`, value]))
            return { rowsAffected: Number(database.prepare(sql).run(parameters as never).changes) }
          },
        }
        try {
          const store = createTauriSqliteStudyStore(async () => port, seed)
          if (version === null || version === 1 || version === 2) {
            await store.save(seed, expectedUpdatedAt)
            assert.equal(database.prepare('SELECT payload FROM study_state WHERE id = 1').get()?.payload, JSON.stringify(seed))
          } else {
            await assert.rejects(store.save(seed, expectedUpdatedAt), race ? /snapshot conflict/ : new RegExp(`version ${version}`))
            assert.equal(writes, race ? 1 : 0)
            const row = database.prepare('SELECT version, payload FROM study_state WHERE id = 1').get()
            assert.equal(row?.version, version)
            assert.equal(row?.payload, original, 'Protected current payload must remain byte-identical')
          }
        } finally {
          database.close()
        }
      }
    }
  }
})
