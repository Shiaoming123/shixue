import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import * as cloud from '../src/lib/study-cloud-sync.ts'
import { parseWorkspaceStateOrMigrate } from '../src/domain/workspace/migrate.ts'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'
import type { WorkspaceStateV3 } from '../src/domain/workspace/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import {
  createSeedStudyState,
  parseStudyState,
  type StudyState,
} from '../src/storage/study/types.ts'

const config = {
  provider: 'supabase' as const,
  projectUrl: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_test',
}

function legacyStateAt(updatedAt: string, notes: string): StudyState {
  const state = createSeedStudyState(updatedAt)
  state.updatedAt = updatedAt
  state.tasks[0].notes = notes
  state.tasks[0].updatedAt = updatedAt
  return parseStudyState(state)
}

function stateAt(updatedAt: string, notes: string): WorkspaceStateV3 {
  const state = parseWorkspaceStateOrMigrate(legacyStateAt(updatedAt, notes), updatedAt)
  return parseWorkspaceState(state)
}

function legacySnapshot(state: StudyState, deviceId: string) {
  const digest = createHash('sha256').update(canonicalJson(state)).digest('hex')
  const revision = `${state.updatedAt}|${digest}`
  return {
    operationId: `study_state:${revision}`,
    collection: 'study_state' as const,
    recordId: 'current',
    kind: 'upsert' as const,
    payload: { state, digest },
    revision,
    deviceId,
    occurredAt: state.updatedAt,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`
}

function requiredFunction(name: string): (...args: any[]) => any {
  const value = (cloud as Record<string, unknown>)[name]
  assert.equal(typeof value, 'function', `${name} must be exported by the sync module`)
  return value as (...args: any[]) => any
}

test('disabled and unconfigured cloud sync never touches the adapter or local store', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const calls: string[] = []
  const adapter = {
    async sessionStatus() { calls.push('session'); return { state: 'signed-in' } },
    async pull() { calls.push('pull'); return null },
    async push() { calls.push('push'); return { applied: true } },
  }
  const store = {
    async load() { calls.push('load'); return stateAt('2026-09-04T10:00:00.000Z', 'local') },
    async save() { calls.push('save') },
  }

  const disabled = createController({
    enabled: false,
    config,
    adapter,
    store,
    deviceId: 'device-a',
  })
  assert.deepEqual(await disabled.syncOnce(), {
    state: 'skipped',
    reason: 'disabled',
    localPreserved: true,
  })

  const unconfigured = createController({
    enabled: true,
    adapter,
    store,
    deviceId: 'device-a',
  })
  assert.deepEqual(await unconfigured.syncOnce(), {
    state: 'skipped',
    reason: 'unconfigured',
    localPreserved: true,
  })
  assert.deepEqual(calls, [])
})

test('signed-out cloud sync checks only local session status and never performs network work', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const calls: string[] = []
  const controller = createController({
    enabled: true,
    config,
    deviceId: 'device-a',
    store: createInMemoryWorkspaceStore(stateAt('2026-09-04T10:00:00.000Z', 'local')),
    adapter: {
      async sessionStatus() { calls.push('session'); return { state: 'signed-out' } },
      async pull() { calls.push('pull'); return null },
      async push() { calls.push('push'); return { applied: true } },
    },
  })

  assert.deepEqual(await controller.syncOnce(), {
    state: 'skipped',
    reason: 'signed-out',
    localPreserved: true,
  })
  assert.deepEqual(calls, ['session'])
})

test('snapshot ordering uses updatedAt first and digest as a deterministic tie-breaker', () => {
  const compare = requiredFunction('compareStudyCloudSnapshots')
  const local = { updatedAt: '2026-09-04T10:00:00.000Z', digest: 'aaa' }
  const remoteNewer = { updatedAt: '2026-09-04T10:00:01.000Z', digest: '000' }
  const remoteTieWinner = { updatedAt: local.updatedAt, digest: 'bbb' }

  assert.equal(compare(local, remoteNewer), -1)
  assert.equal(compare(remoteNewer, local), 1)
  assert.equal(compare(local, remoteTieWinner), -1)
  assert.equal(compare(remoteTieWinner, local), 1)
  assert.equal(compare(local, { ...local }), 0)
})

test('newer local snapshot is uploaded with the observed remote revision', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const createSnapshot = requiredFunction('createStudyCloudSnapshot')
  const local = stateAt('2026-09-04T10:00:02.000Z', 'local newer')
  const remote = await createSnapshot(
    stateAt('2026-09-04T10:00:01.000Z', 'remote older'),
    'device-b',
  )
  const pushed: Array<{ snapshot: any; expectedRevision?: string }> = []
  const controller = createController({
    enabled: true,
    config,
    deviceId: 'device-a',
    store: createInMemoryWorkspaceStore(local),
    adapter: {
      async sessionStatus() { return { state: 'signed-in', userId: 'user-1' } },
      async pull() { return remote },
      async push(_config: unknown, snapshot: any, expectedRevision?: string) {
        pushed.push({ snapshot, expectedRevision })
        return { applied: true }
      },
    },
  })

  const result = await controller.syncOnce()
  assert.equal(result.state, 'success')
  assert.equal(result.action, 'uploaded')
  assert.equal(pushed.length, 1)
  assert.equal(pushed[0].expectedRevision, remote.revision)
  assert.equal(pushed[0].snapshot.payload.workspace.version, 3)
  assert.equal(pushed[0].snapshot.payload.workspace.state.updatedAt, local.updatedAt)
})

test('newer remote snapshot crosses workspace.import and strips foreign receipt authority', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const createSnapshot = requiredFunction('createStudyCloudSnapshot')
  const local = stateAt('2026-09-04T10:00:01.000Z', 'local older')
  const remoteState = stateAt('2026-09-04T10:00:02.000Z', 'remote newer')
  remoteState.commandReceipts = [{
    id: 'foreign-receipt',
    idempotencyKey: 'foreign-command',
    requestFingerprint: 'foreign-fingerprint',
    commandType: 'task.create',
    source: 'agent',
    workspaceRevision: remoteState.revision,
    result: {},
    createdAt: '2026-09-04T09:00:00.000Z',
    expiresAt: '2026-10-04T09:00:00.000Z',
  }]
  const store = createInMemoryWorkspaceStore(local)
  const remote = await createSnapshot(remoteState, 'device-b')
  let pushes = 0
  const controller = createController({
    enabled: true,
    config,
    deviceId: 'device-a',
    store,
    adapter: {
      async sessionStatus() { return { state: 'signed-in', userId: 'user-1' } },
      async pull() { return remote },
      async push() { pushes += 1; return { applied: true } },
    },
  })

  assert.deepEqual(await controller.syncOnce(), {
    state: 'success',
    action: 'downloaded',
    revision: remote.revision,
    localPreserved: false,
  })
  const saved = await store.load()
  assert.equal(saved.tasks[0].notes, 'remote newer')
  assert.equal(saved.commandReceipts.some(({ id }) => id === 'foreign-receipt'), false)
  assert.deepEqual(saved.commandReceipts.map(({ commandType }) => commandType), ['workspace.import'])
  assert.equal(pushes, 0)
})

test('newer legacy v2 remote snapshot migrates before workspace import', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const local = stateAt('2026-09-04T10:00:01.000Z', 'local older')
  const remote = legacySnapshot(
    legacyStateAt('2026-09-04T10:00:02.000Z', 'legacy remote newer'),
    'device-b',
  )
  const store = createInMemoryWorkspaceStore(local)
  const controller = createController({
    enabled: true,
    config,
    deviceId: 'device-a',
    store,
    adapter: {
      async sessionStatus() { return { state: 'signed-in', userId: 'user-1' } },
      async pull() { return remote },
      async push() { return { applied: true } },
    },
  })

  assert.equal((await controller.syncOnce()).state, 'success')
  const saved = await store.load()
  assert.equal(saved.version, 3)
  assert.equal(saved.tasks[0].notes, 'legacy remote newer')
})

test('remote CAS rejection is an explicit conflict and never reports success', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const createSnapshot = requiredFunction('createStudyCloudSnapshot')
  const local = stateAt('2026-09-04T10:00:02.000Z', 'local newer')
  const remote = await createSnapshot(
    stateAt('2026-09-04T10:00:01.000Z', 'remote older'),
    'device-b',
  )
  const store = createInMemoryWorkspaceStore(local)
  const controller = createController({
    enabled: true,
    config,
    deviceId: 'device-a',
    store,
    adapter: {
      async sessionStatus() { return { state: 'signed-in' } },
      async pull() { return remote },
      async push() { return { applied: false } },
    },
  })

  assert.deepEqual(await controller.syncOnce(), {
    state: 'conflict',
    reason: 'remote-changed',
    localPreserved: true,
  })
  assert.equal((await store.load()).tasks[0].notes, 'local newer')
})

test('remote read and local CAS failures keep the current local snapshot', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const createSnapshot = requiredFunction('createStudyCloudSnapshot')
  const local = stateAt('2026-09-04T10:00:01.000Z', 'local remains')
  const remote = await createSnapshot(
    stateAt('2026-09-04T10:00:02.000Z', 'remote newer'),
    'device-b',
  )
  const failingRead = createController({
    enabled: true,
    config,
    deviceId: 'device-a',
    store: createInMemoryWorkspaceStore(local),
    adapter: {
      async sessionStatus() { return { state: 'signed-in' } },
      async pull() { throw new Error('private-token-must-not-surface') },
      async push() { return { applied: true } },
    },
  })
  assert.deepEqual(await failingRead.syncOnce(), {
    state: 'failed',
    reason: 'remote-read',
    localPreserved: true,
  })

  const store = {
    async load() { return structuredClone(local) },
    async save() { throw new Error('Study snapshot conflict') },
  }
  const failingSave = createController({
    enabled: true,
    config,
    deviceId: 'device-a',
    store,
    adapter: {
      async sessionStatus() { return { state: 'signed-in' } },
      async pull() { return remote },
      async push() { return { applied: true } },
    },
  })
  assert.deepEqual(await failingSave.syncOnce(), {
    state: 'failed',
    reason: 'local-conflict',
    localPreserved: true,
  })
  assert.equal((await store.load()).tasks[0].notes, 'local remains')
})
