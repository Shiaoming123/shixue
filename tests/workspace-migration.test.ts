import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteDB, openDB } from 'idb'
import {
  parseWorkspaceStateOrMigrate,
} from '../src/domain/workspace/migrate.ts'
import {
  createWorkspaceExport,
  parseWorkspaceExport,
  WORKSPACE_EXPORT_FORMAT,
} from '../src/storage/workspace/data-port.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import {
  createIndexedDbStudyStore,
  createIndexedDbWorkspaceStore,
  V2_WORKSPACE_STATE_BACKUP_KEY,
} from '../src/storage/study/indexeddb.ts'
import {
  BACKUP_LEGACY_WORKSPACE_STATE_SQL,
  createTauriSqliteStudyStore,
  createTauriSqliteWorkspaceStore,
  REPLACE_LEGACY_AFTER_BACKUP_SQL,
  VERIFY_LEGACY_WORKSPACE_STATE_BACKUP_SQL,
} from '../src/storage/study/tauri-sqlite.ts'
import type {
  CompletionRecord,
  StudyState,
  StudyStateV1,
} from '../src/storage/study/types.ts'
import type { WorkspaceStore } from '../src/storage/workspace/types.ts'

const MIGRATED_AT = '2026-09-04T12:00:00.000Z'

function v2Fixture(): StudyState {
  const completedAt = '2026-09-03T10:45:00.000Z'
  const completion = (
    id: string,
    nextReviewOn: string | null,
  ): CompletionRecord => ({
    id,
    taskId: 'task-1',
    topicId: 'topic-1',
    sessionIds: ['session-1'],
    taskTitleSnapshot: 'Persist workflow state',
    learned: 'A thread id resumes the workflow.',
    evidence: 'The restart test passed.',
    blocker: '',
    nextAction: 'Test a rejected approval.',
    mastery: 3,
    completedAt,
    reviewStage: nextReviewOn ? 0 : 3,
    nextReviewOn,
    lastReviewResult: nextReviewOn ? null : 'clear',
    lastReviewedAt: nextReviewOn ? null : '2026-09-04T10:00:00.000Z',
    createdAt: completedAt,
    updatedAt: completedAt,
    deletedAt: null,
  })
  return {
    version: 2,
    listGroups: [{
      id: 'group-1', title: 'Agents', position: 2,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z', archivedAt: null,
    }],
    topics: [{
      id: 'topic-1', groupId: 'group-1', title: 'LangGraph',
      goal: 'Resume workflows', successCriteria: ['Restart resumes'],
      weeklyTargetMinutes: 120,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z', archivedAt: null,
    }],
    tasks: [{
      id: 'task-1', revision: 4, topicId: 'topic-1',
      title: 'Persist workflow state', notes: 'Keep the checkpoint.', status: 'completed',
      plannedOn: '2026-09-03', dueOn: '2026-09-05',
      reminderAt: '2026-09-03T09:30:00.000Z', priority: 'high', estimateMinutes: 45,
      acceptanceCriteria: ['Restart resumes'], checklist: [{
        id: 'check-1', text: 'Add restart test', checked: true,
        checkedAt: completedAt, position: 0,
      }], blockedReason: null,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: completedAt, deletedAt: null,
    }, {
      id: 'task-unassigned', revision: 1, topicId: null,
      title: 'Sort the inbox', notes: '', status: 'planned',
      plannedOn: null, dueOn: null, reminderAt: null,
      priority: 'none', estimateMinutes: null,
      acceptanceCriteria: [], checklist: [], blockedReason: null,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z', deletedAt: null,
    }],
    sessions: [{
      id: 'session-1', taskId: 'task-1', state: 'finished',
      startedAt: '2026-09-03T10:00:00.000Z', activeSince: null,
      elapsedSeconds: 2700, scratchpad: 'checkpoint note',
      createdAt: '2026-09-03T10:00:00.000Z', updatedAt: completedAt, deletedAt: null,
    }],
    taskEvents: [{
      id: 'event-1', sequence: 1, taskId: 'task-1', type: 'captured',
      occurredAt: '2026-09-01T00:00:00.000Z', fromStatus: null, toStatus: 'planned',
      reason: null, completionRecordId: null,
    }, {
      id: 'event-2', sequence: 2, taskId: 'task-1', type: 'completed',
      occurredAt: completedAt, fromStatus: 'planned', toStatus: 'completed',
      reason: null, completionRecordId: 'completion-pending',
    }, {
      id: 'event-3', sequence: 3, taskId: 'task-unassigned', type: 'captured',
      occurredAt: '2026-09-02T00:00:00.000Z', fromStatus: null, toStatus: 'planned',
      reason: null, completionRecordId: null,
    }],
    completionRecords: [
      completion('completion-pending', '2026-09-06'),
      completion('completion-finished', null),
    ],
    updatedAt: completedAt,
  }
}

function v1Fixture(): StudyStateV1 {
  return {
    version: 1,
    topics: [{
      id: 'legacy-topic', title: 'Legacy topic', goal: 'Keep history',
      successCriteria: ['IDs survive'], weeklyTargetMinutes: 60,
      steps: [{
        id: 'legacy-step', title: 'Legacy task',
        acceptanceCriteria: ['Migration passes'], estimateMinutes: 30,
        scheduledOn: '2026-09-05',
      }],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z', archivedAt: null,
    }],
    sessions: [],
    updatedAt: '2026-09-02T00:00:00.000Z',
  }
}

async function replaceFromImport(store: WorkspaceStore, value: unknown): Promise<void> {
  const imported = parseWorkspaceExport(value)
  await store.save(imported.state)
}

test('v2 migration preserves legacy ids and maps every learning field', () => {
  const old = v2Fixture()
  const next = parseWorkspaceStateOrMigrate(old, MIGRATED_AT)

  assert.equal(next.version, 3)
  assert.equal(next.revision, 1)
  assert.deepEqual(next.listGroups, old.listGroups)
  assert.equal(next.lists.find(({ id }) => id === 'topic-1')?.groupId, 'group-1')
  assert.equal(next.lists.find(({ id }) => id === 'topic-1')?.weeklyTargetMinutes, 120)
  assert.equal(next.lists.find(({ title }) => title === '学习')?.id, 'list:system:learning')

  const task = next.tasks.find(({ id }) => id === 'task-1')
  assert.equal(task?.mode, 'learning')
  assert.equal(task?.revision, 4)
  assert.equal(task?.listId, 'topic-1')
  assert.deepEqual(task?.schedule, {
    startAt: null, startOn: '2026-09-03', estimateMinutes: 45,
  })
  assert.deepEqual(task?.deadline, { dueAt: null, dueOn: '2026-09-05' })
  assert.deepEqual(task?.learning, {
    acceptanceCriteria: ['Restart resumes'], blockedReason: null,
  })
  assert.equal(
    next.tasks.find(({ id }) => id === 'task-unassigned')?.listId,
    'list:system:learning',
  )
  assert.deepEqual(next.studySessions, old.sessions)
  assert.deepEqual(next.completionRecords, old.completionRecords)
  assert.equal(next.studySessions[0].taskId, old.tasks[0].id)
  assert.equal(next.completionRecords[0].taskId, old.tasks[0].id)
  assert.deepEqual(next.reminderRules, [{
    id: 'reminder:migrated:task-1', taskId: 'task-1', occurrenceId: null,
    trigger: { kind: 'absolute', at: '2026-09-03T09:30:00.000Z' },
    enabled: true, revision: 1,
  }])
})

test('migration keeps old event order and appends deterministic migration events', () => {
  const old = v2Fixture()
  const next = parseWorkspaceStateOrMigrate(old, MIGRATED_AT)

  assert.deepEqual(next.taskEvents.slice(0, old.taskEvents.length), old.taskEvents)
  assert.deepEqual(
    next.taskEvents.map(({ sequence }) => sequence),
    Array.from({ length: next.taskEvents.length }, (_, index) => index + 1),
  )
  assert.deepEqual(
    next.taskEvents.slice(old.taskEvents.length).map(({ id }) => id),
    [
      'event:workspace-v3:task-1',
      'event:workspace-v3:task-unassigned',
      'event:workspace-v3:task:review:completion-pending',
    ],
  )
})

test('pending reviews create one visible deterministic task and link, while completed history does not', () => {
  const next = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
  const reviewTask = next.tasks.find(({ id }) => id === 'task:review:completion-pending')

  assert.equal(reviewTask?.title, '复习 · Persist workflow state')
  assert.equal(reviewTask?.status, 'planned')
  assert.equal(reviewTask?.schedule.startOn, '2026-09-06')
  assert.equal(reviewTask?.deadline.dueOn, '2026-09-06')
  assert.deepEqual(next.reviewTaskLinks, [{
    id: 'review-link:migrated:completion-pending',
    completionRecordId: 'completion-pending',
    reviewTaskId: 'task:review:completion-pending', occurrenceId: null,
    reviewStage: 0, dueOn: '2026-09-06', completedAt: null,
    completion: null,
    createdAt: MIGRATED_AT, updatedAt: MIGRATED_AT,
  }])
  assert.notEqual(next.reviewTaskLinks[0].reviewTaskId, next.completionRecords[0].taskId)
  assert.equal(next.tasks.some(({ id }) => id === 'task:review:completion-finished'), false)
})

test('v3 input is idempotent and ignores a new migration timestamp', () => {
  const migrated = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
  assert.deepEqual(
    parseWorkspaceStateOrMigrate(migrated, '2030-01-01T00:00:00.000Z'),
    migrated,
  )
})

test('v1 input migrates through v2 and always starts workspace revision at one', () => {
  const next = parseWorkspaceStateOrMigrate(v1Fixture(), MIGRATED_AT)
  assert.equal(next.revision, 1)
  assert.equal(next.lists.some(({ id }) => id === 'legacy-topic'), true)
  assert.equal(next.tasks.some(({ id }) => id === 'legacy-step'), true)
})

test('workspace export is v3 and imports legacy study envelopes only after full migration', () => {
  const workspace = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
  const payload = createWorkspaceExport(workspace, '2026-09-05T00:00:00.000Z')
  assert.equal(payload.format, WORKSPACE_EXPORT_FORMAT)
  assert.equal(payload.version, 3)
  assert.deepEqual(parseWorkspaceExport(JSON.stringify(payload)).state, workspace)

  for (const [version, state] of [[1, v1Fixture()], [2, v2Fixture()]] as const) {
    const imported = parseWorkspaceExport({
      format: 'meow-study/study-export', version,
      exportedAt: MIGRATED_AT, state,
    })
    assert.equal(imported.format, WORKSPACE_EXPORT_FORMAT)
    assert.equal(imported.version, 3)
    assert.equal(imported.state.version, 3)
  }
})

test('legacy v1 envelope rejects an inner v2 state', () => {
  assert.throws(() => parseWorkspaceExport({
    format: 'meow-study/study-export',
    version: 1,
    exportedAt: MIGRATED_AT,
    state: v2Fixture(),
  }), /envelope version.*state version/i)
})

test('legacy v2 envelope rejects an inner v1 state', () => {
  assert.throws(() => parseWorkspaceExport({
    format: 'meow-study/study-export',
    version: 2,
    exportedAt: MIGRATED_AT,
    state: v1Fixture(),
  }), /envelope version.*state version/i)
})

test('malformed import leaves the destination snapshot byte-for-byte unchanged', async () => {
  const original = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
  const store = createInMemoryWorkspaceStore(original)
  const before = JSON.stringify(await store.load())
  const invalid = createWorkspaceExport(original, '2026-09-05T00:00:00.000Z')
  invalid.state.tasks[0].listId = 'missing-list'

  await assert.rejects(replaceFromImport(store, invalid), /unknown listId/i)
  assert.equal(JSON.stringify(await store.load()), before)
})

test('IndexedDB backs up v2 before replacing the same physical current record with v3', async () => {
  const databaseName = `meow-workspace-v3-${Date.now()}`
  await deleteDB(databaseName)
  const database = await openDB(databaseName, 2, {
    upgrade(db) {
      const todos = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      todos.createIndex('by-created-at', 'created_at')
      db.createObjectStore('studyState', { keyPath: 'key' })
    },
  })
  const legacy = v2Fixture()
  await database.put('studyState', { key: 'current', state: legacy })
  database.close()

  const loaded = await createIndexedDbWorkspaceStore({ databaseName }).load()
  assert.equal(loaded.version, 3)
  const verification = await openDB(databaseName, 2)
  assert.equal((await verification.get('studyState', 'current')).state.version, 3)
  assert.deepEqual(
    (await verification.get('studyState', V2_WORKSPACE_STATE_BACKUP_KEY)).state,
    legacy,
  )
  verification.close()
})

test('IndexedDB validation failure neither creates a backup nor replaces the v2 payload', async () => {
  const databaseName = `meow-workspace-invalid-${Date.now()}`
  await deleteDB(databaseName)
  const database = await openDB(databaseName, 2, {
    upgrade(db) {
      const todos = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      todos.createIndex('by-created-at', 'created_at')
      db.createObjectStore('studyState', { keyPath: 'key' })
    },
  })
  const invalid = v2Fixture()
  invalid.tasks[0].topicId = 'missing-topic'
  await database.put('studyState', { key: 'current', state: invalid })
  database.close()

  await assert.rejects(createIndexedDbWorkspaceStore({ databaseName }).load(), /topicId/i)
  const verification = await openDB(databaseName, 2)
  assert.deepEqual((await verification.get('studyState', 'current')).state, invalid)
  assert.equal(await verification.get('studyState', V2_WORKSPACE_STATE_BACKUP_KEY), undefined)
  verification.close()
})

test('legacy IndexedDB facade rejects v3 without rewriting it as v2', async () => {
  const databaseName = `meow-legacy-reader-v3-${Date.now()}`
  await deleteDB(databaseName)
  const database = await openDB(databaseName, 2, {
    upgrade(db) {
      const todos = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      todos.createIndex('by-created-at', 'created_at')
      db.createObjectStore('studyState', { keyPath: 'key' })
    },
  })
  const workspace = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
  await database.put('studyState', { key: 'current', state: workspace })
  database.close()

  await assert.rejects(createIndexedDbStudyStore({ databaseName }).load(), /version 2/i)
  const verification = await openDB(databaseName, 2)
  assert.deepEqual((await verification.get('studyState', 'current')).state, workspace)
  verification.close()
})

test('legacy IndexedDB save rejects a current v3 snapshot with and without CAS', async () => {
  for (const expectedUpdatedAt of [undefined, MIGRATED_AT]) {
    const suffix = expectedUpdatedAt === undefined ? 'unconditional' : 'cas'
    const databaseName = `meow-legacy-save-v3-${suffix}-${Date.now()}`
    await deleteDB(databaseName)
    const database = await openDB(databaseName, 2, {
      upgrade(db) {
        const todos = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
        todos.createIndex('by-created-at', 'created_at')
        db.createObjectStore('studyState', { keyPath: 'key' })
      },
    })
    const workspace = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
    const original = JSON.stringify(workspace)
    await database.put('studyState', { key: 'current', state: workspace })
    database.close()

    const store = createIndexedDbStudyStore({ databaseName, seed: v2Fixture() })
    await assert.rejects(store.save(v2Fixture(), expectedUpdatedAt), /version 3/i)

    const verification = await openDB(databaseName, 2)
    assert.equal(
      JSON.stringify((await verification.get('studyState', 'current')).state),
      original,
    )
    verification.close()
  }
})

test('IndexedDB save refuses to bypass legacy migration and its backup', async () => {
  const databaseName = `meow-workspace-save-legacy-${Date.now()}`
  await deleteDB(databaseName)
  const database = await openDB(databaseName, 2, {
    upgrade(db) {
      const todos = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      todos.createIndex('by-created-at', 'created_at')
      db.createObjectStore('studyState', { keyPath: 'key' })
    },
  })
  const legacy = v2Fixture()
  await database.put('studyState', { key: 'current', state: legacy })
  database.close()
  const workspace = parseWorkspaceStateOrMigrate(legacy, MIGRATED_AT)

  await assert.rejects(
    createIndexedDbWorkspaceStore({ databaseName }).save(workspace),
    /load and migrate/i,
  )
  const verification = await openDB(databaseName, 2)
  assert.deepEqual((await verification.get('studyState', 'current')).state, legacy)
  assert.equal(await verification.get('studyState', V2_WORKSPACE_STATE_BACKUP_KEY), undefined)
  verification.close()
})

test('SQLite replaces v2 only after a byte-identical backup is independently verified', async () => {
  const originalPayload = JSON.stringify(v2Fixture())
  let current = { version: 2, payload: originalPayload }
  const backups = new Map<string, { version: number; payload: string }>()
  const calls: Array<{ sql: string; binds?: unknown[] }> = []
  const store = createTauriSqliteWorkspaceStore(async () => ({
    async select<T>(sql: string, binds?: unknown[]): Promise<T> {
      if (sql === VERIFY_LEGACY_WORKSPACE_STATE_BACKUP_SQL) {
        const backup = backups.get(String(binds?.[0]))
        return (backup ? [backup] : []) as T
      }
      return [current] as T
    },
    async execute(sql: string, binds?: unknown[]) {
      calls.push({ sql, binds })
      if (sql === BACKUP_LEGACY_WORKSPACE_STATE_SQL) {
        backups.set(String(binds?.[0]), {
          version: Number(binds?.[1]), payload: String(binds?.[2]),
        })
        return { rowsAffected: 1 }
      }
      if (sql === REPLACE_LEGACY_AFTER_BACKUP_SQL) {
        const backup = backups.get(String(binds?.[0]))
        if (!backup || backup.version !== current.version || backup.payload !== current.payload) {
          return { rowsAffected: 0 }
        }
        current = { version: Number(binds?.[3]), payload: String(binds?.[4]) }
        return { rowsAffected: 1 }
      }
      return { rowsAffected: 0 }
    },
  }), undefined, () => MIGRATED_AT)

  assert.equal((await store.load()).version, 3)
  assert.equal(calls[0].sql, BACKUP_LEGACY_WORKSPACE_STATE_SQL)
  assert.equal(calls[0].binds?.[2], originalPayload)
  assert.equal(calls[1].sql, REPLACE_LEGACY_AFTER_BACKUP_SQL)
  assert.equal(backups.get(String(calls[0].binds?.[0]))?.payload, originalPayload)
  assert.equal(current.version, 3)
})

test('SQLite refuses replacement when the inserted backup cannot be read back exactly', async () => {
  const originalPayload = JSON.stringify(v2Fixture())
  let executions = 0
  const store = createTauriSqliteWorkspaceStore(async () => ({
    async select<T>(sql: string): Promise<T> {
      if (sql === VERIFY_LEGACY_WORKSPACE_STATE_BACKUP_SQL) return [] as T
      return [{ version: 2, payload: originalPayload }] as T
    },
    async execute() {
      executions += 1
      return { rowsAffected: 1 }
    },
  }), undefined, () => MIGRATED_AT)

  await assert.rejects(store.load(), /backup proof/i)
  assert.equal(executions, 1)
})

test('SQLite backup failure leaves the original v2 payload unchanged and never replaces it', async () => {
  const originalPayload = JSON.stringify(v2Fixture())
  let executions = 0
  const store = createTauriSqliteWorkspaceStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 2, payload: originalPayload }] as T
    },
    async execute() {
      executions += 1
      return { rowsAffected: 0 }
    },
  }), undefined, () => MIGRATED_AT)

  await assert.rejects(store.load(), /backup insert/i)
  assert.equal(executions, 1)
})

test('SQLite replacement failure is loud after backup and leaves the original row unchanged', async () => {
  const originalPayload = JSON.stringify(v2Fixture())
  let currentPayload = originalPayload
  let executions = 0
  const store = createTauriSqliteWorkspaceStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 2, payload: currentPayload }] as T
    },
    async execute() {
      executions += 1
      return { rowsAffected: executions === 1 ? 1 : 0 }
    },
  }), undefined, () => MIGRATED_AT)

  await assert.rejects(store.load(), /not replaced/i)
  assert.equal(executions, 2)
  assert.equal(currentPayload, originalPayload)
})

test('SQLite save refuses to bypass legacy migration and its backup', async () => {
  const originalPayload = JSON.stringify(v2Fixture())
  let executions = 0
  const workspace = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
  const store = createTauriSqliteWorkspaceStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 2, payload: originalPayload }] as T
    },
    async execute() {
      executions += 1
      return { rowsAffected: 1 }
    },
  }))

  await assert.rejects(store.save(workspace), /load and migrate/i)
  assert.equal(executions, 0)
})

test('SQLite rejects a row whose version does not match its JSON before backup or replacement', async () => {
  let executions = 0
  const store = createTauriSqliteWorkspaceStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 2, payload: JSON.stringify(v1Fixture()) }] as T
    },
    async execute() {
      executions += 1
      return { rowsAffected: 1 }
    },
  }))

  await assert.rejects(store.load(), /version does not match/i)
  assert.equal(executions, 0)
})

test('legacy SQLite facade rejects v3 without executing a v2 overwrite', async () => {
  let executions = 0
  const workspace = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
  const store = createTauriSqliteStudyStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 3, payload: JSON.stringify(workspace) }] as T
    },
    async execute() {
      executions += 1
      return { rowsAffected: 1 }
    },
  }), v2Fixture())

  await assert.rejects(store.load(), /Unsupported stored Study state version: 3/)
  assert.equal(executions, 0)
})

test('legacy SQLite save rejects a current v3 row with and without CAS', async () => {
  for (const expectedUpdatedAt of [undefined, MIGRATED_AT]) {
    const workspace = parseWorkspaceStateOrMigrate(v2Fixture(), MIGRATED_AT)
    const originalPayload = JSON.stringify(workspace)
    let currentPayload = originalPayload
    let executions = 0
    const store = createTauriSqliteStudyStore(async () => ({
      async select<T>(): Promise<T> {
        return [{ version: 3, payload: currentPayload }] as T
      },
      async execute(_sql: string, binds?: unknown[]) {
        executions += 1
        currentPayload = String(binds?.[1])
        return { rowsAffected: 1 }
      },
    }), v2Fixture())

    await assert.rejects(store.save(v2Fixture(), expectedUpdatedAt), /version 3/i)
    assert.equal(executions, 0)
    assert.equal(currentPayload, originalPayload)
  }
})
