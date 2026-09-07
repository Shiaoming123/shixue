import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import type { AndroidPersistenceSmokeResult } from '../src/lib/android-persistence-smoke.ts'
import { handleAndroidPersistenceSmokeRequest } from '../src/lib/android-persistence-smoke.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'

const request = {
  schemaVersion: 1 as const,
  runId: 'run-1',
  taskId: 'task:android-persistence:run-1',
  title: 'Android persistence smoke run-1',
}

test('Android persistence smoke writes through the capability service and a restarted service reads the same task', async () => {
  const store = createInMemoryWorkspaceStore()
  const writes: AndroidPersistenceSmokeResult[] = []
  const firstProcess = createTaskCapabilityService(store, () => '2026-09-07T13:00:00.000Z', (kind) => `${kind}:first`)

  await handleAndroidPersistenceSmokeRequest(firstProcess, request, async (result) => writes.push(result))

  const persisted = await store.load()
  const task = persisted.tasks.find(({ id }) => id === request.taskId)
  assert.equal(task?.title, request.title)
  assert.equal(task?.status, 'inbox')
  assert.equal(writes[0]?.stage, 'write-confirmed')
  assert.equal(writes[0]?.workspaceRevision, persisted.revision)

  const restartReads: AndroidPersistenceSmokeResult[] = []
  const restartedProcess = createTaskCapabilityService(store, () => '2026-09-07T13:01:00.000Z', (kind) => `${kind}:restart`)
  await handleAndroidPersistenceSmokeRequest(restartedProcess, request, async (result) => restartReads.push(result))

  assert.deepEqual(restartReads, [{
    schemaVersion: 1,
    runId: request.runId,
    stage: 'restart-confirmed',
    taskId: request.taskId,
    title: request.title,
    workspaceRevision: persisted.revision,
  }])
})

test('Android persistence smoke rejects a forged request before reporting evidence', async () => {
  const store = createInMemoryWorkspaceStore()
  const service = createTaskCapabilityService(store, () => '2026-09-07T13:00:00.000Z', (kind) => `${kind}:missing`)
  let reported = false

  await assert.rejects(
    handleAndroidPersistenceSmokeRequest(service, { ...request, title: 'forged title' }, async () => { reported = true }),
    /Invalid Android persistence smoke request/,
  )
  assert.equal(reported, false)
})

test('application exposes the persistence probe only through the Android debug native bridge', () => {
  const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const nativeSource = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')

  assert.match(appSource, /runNativeAndroidPersistenceSmoke\(capabilityService\)/)
  assert.match(nativeSource, /fn read_android_persistence_smoke_request/)
  assert.match(nativeSource, /fn report_android_persistence_smoke_result/)
  assert.match(nativeSource, /cfg\(all\(target_os = "android", debug_assertions\)\)/)
  assert.match(nativeSource, /sync_all\(\)/)
})
