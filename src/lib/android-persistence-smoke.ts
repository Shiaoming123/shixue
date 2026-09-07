import { invoke } from '@tauri-apps/api/core'
import { SYSTEM_LEARNING_LIST_ID } from '../domain/workspace/migrate.ts'
import {
  CAPABILITY_PROTOCOL_VERSION,
  type TaskCapabilityService,
} from '../domain/capabilities/types.ts'
import { isTauri } from './platform.ts'

export interface AndroidPersistenceSmokeRequest {
  schemaVersion: 1
  runId: string
  taskId: string
  title: string
}

export interface AndroidPersistenceSmokeResult extends AndroidPersistenceSmokeRequest {
  stage: 'write-confirmed' | 'restart-confirmed'
  workspaceRevision: number
}

type ReportPersistenceSmokeResult = (result: AndroidPersistenceSmokeResult) => Promise<void>

export async function handleAndroidPersistenceSmokeRequest(
  service: TaskCapabilityService,
  request: AndroidPersistenceSmokeRequest,
  report: ReportPersistenceSmokeResult,
): Promise<AndroidPersistenceSmokeResult> {
  assertRequest(request)
  const existing = await service.query({ type: 'task.get', taskId: request.taskId })
  let stage: AndroidPersistenceSmokeResult['stage']

  if (existing === null) {
    const workspace = await service.query({ type: 'workspace.snapshot' })
    await service.execute({
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      idempotencyKey: idempotencyKey(request.runId),
      source: 'human-ui',
      expectedWorkspaceRevision: workspace.revision,
      command: {
        type: 'task.create',
        taskId: request.taskId,
        eventId: eventId(request.runId),
        listId: SYSTEM_LEARNING_LIST_ID,
        mode: 'general',
        title: request.title,
        notes: `Android emulator SQLite restart smoke ${request.runId}.`,
      },
    })
    stage = 'write-confirmed'
  } else {
    if (existing.title !== request.title || existing.deletedAt !== null) {
      throw new Error('Android persistence smoke found a conflicting task identity.')
    }
    stage = 'restart-confirmed'
  }

  const [task, audit, workspace] = await Promise.all([
    service.query({ type: 'task.get', taskId: request.taskId }),
    service.query({ type: 'audit.list', commandType: 'task.create' }),
    service.query({ type: 'workspace.snapshot' }),
  ])
  if (!task || task.title !== request.title || task.deletedAt !== null) {
    throw new Error(stage === 'write-confirmed'
      ? 'Android persistence smoke first pass must create the task.'
      : 'Android persistence smoke did not recover the requested task.')
  }
  if (!audit.receipts.some((receipt) =>
    receipt.idempotencyKey === idempotencyKey(request.runId) && receipt.commandType === 'task.create')) {
    throw new Error('Android persistence smoke could not recover the task creation receipt.')
  }
  if (!audit.events.some((event) => event.id === eventId(request.runId) && event.taskId === request.taskId)) {
    throw new Error('Android persistence smoke could not recover the task creation event.')
  }

  const result: AndroidPersistenceSmokeResult = {
    schemaVersion: 1,
    runId: request.runId,
    stage,
    taskId: request.taskId,
    title: request.title,
    workspaceRevision: workspace.revision,
  }
  await report(result)
  return result
}

export async function runNativeAndroidPersistenceSmoke(
  service: TaskCapabilityService,
): Promise<AndroidPersistenceSmokeResult | null> {
  if (!isTauri()) return null
  const request = await invoke<AndroidPersistenceSmokeRequest | null>('read_android_persistence_smoke_request')
  if (!request) return null
  return handleAndroidPersistenceSmokeRequest(service, request, async (result) => {
    await invoke('report_android_persistence_smoke_result', { result })
  })
}

function assertRequest(request: AndroidPersistenceSmokeRequest): void {
  if (
    request.schemaVersion !== 1 ||
    !safeToken(request.runId) ||
    request.taskId !== `task:android-persistence:${request.runId}` ||
    request.title !== `Android persistence smoke ${request.runId}`
  ) {
    throw new Error('Invalid Android persistence smoke request.')
  }
}

function safeToken(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value)
}

function idempotencyKey(runId: string): string {
  return `android-persistence-smoke:${runId}`
}

function eventId(runId: string): string {
  return `event:android-persistence:${runId}`
}
