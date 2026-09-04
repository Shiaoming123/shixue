import assert from 'node:assert/strict'
import test from 'node:test'
import * as cloud from '../src/lib/study-cloud-sync.ts'
import { createInMemoryStudyStore } from '../src/storage/study/in-memory.ts'
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

function stateAt(updatedAt: string, notes: string): StudyState {
  const state = createSeedStudyState(updatedAt)
  state.updatedAt = updatedAt
  state.tasks[0].notes = notes
  state.tasks[0].updatedAt = updatedAt
  return parseStudyState(state)
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
    store: createInMemoryStudyStore(stateAt('2026-09-04T10:00:00.000Z', 'local')),
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
    store: createInMemoryStudyStore(local),
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
  assert.equal(pushed[0].snapshot.payload.state.updatedAt, local.updatedAt)
})

test('newer remote snapshot replaces local state through StudyStore CAS', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const createSnapshot = requiredFunction('createStudyCloudSnapshot')
  const local = stateAt('2026-09-04T10:00:01.000Z', 'local older')
  const remoteState = stateAt('2026-09-04T10:00:02.000Z', 'remote newer')
  const store = createInMemoryStudyStore(local)
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
  assert.equal((await store.load()).tasks[0].notes, 'remote newer')
  assert.equal(pushes, 0)
})

test('remote CAS rejection is an explicit conflict and never reports success', async () => {
  const createController = requiredFunction('createStudyCloudSyncController')
  const createSnapshot = requiredFunction('createStudyCloudSnapshot')
  const local = stateAt('2026-09-04T10:00:02.000Z', 'local newer')
  const remote = await createSnapshot(
    stateAt('2026-09-04T10:00:01.000Z', 'remote older'),
    'device-b',
  )
  const store = createInMemoryStudyStore(local)
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
    store: createInMemoryStudyStore(local),
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
