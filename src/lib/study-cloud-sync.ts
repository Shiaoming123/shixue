import { createAllowlistSyncPolicy } from '../sync/policy.ts'
import type { SyncMutation } from '../sync/types.ts'
import { CAPABILITY_PROTOCOL_VERSION } from '../domain/capabilities/types.ts'
import { createTaskCapabilityService } from '../domain/capabilities/service.ts'
import { parseWorkspaceStateOrMigrate } from '../domain/workspace/migrate.ts'
import type { WorkspaceStateV3 } from '../domain/workspace/types.ts'
import { createWorkspaceExport, parseWorkspaceExport } from '../storage/workspace/data-port.ts'
import type { WorkspaceStore } from '../storage/workspace/types.ts'

export const STUDY_CLOUD_COLLECTION = 'study_state' as const
export const STUDY_CLOUD_RECORD_ID = 'current' as const

export interface StudyCloudProviderConfig {
  provider: 'supabase'
  projectUrl: string
  /** Supabase publishable/legacy anon key. This is public project configuration, not a user token. */
  publishableKey: string
}
export type StudyCloudSessionStatus =
  | { state: 'signed-out' }
  | { state: 'signed-in'; userId?: string; email?: string }

export interface StudyCloudAdapter {
  /** Must inspect native keyring state only and must not perform network I/O. */
  sessionStatus(config: StudyCloudProviderConfig): Promise<StudyCloudSessionStatus>
  pull(config: StudyCloudProviderConfig): Promise<SyncMutation | null>
  push(
    config: StudyCloudProviderConfig,
    snapshot: SyncMutation,
    expectedRevision?: string,
  ): Promise<{ applied: boolean }>
}

export interface StudyCloudSnapshotOrder {
  updatedAt: string
  digest: string
}

export type StudyCloudSyncResult =
  | {
      state: 'skipped'
      reason: 'disabled' | 'unconfigured' | 'signed-out'
      localPreserved: true
    }
  | {
      state: 'success'
      action: 'unchanged' | 'uploaded' | 'downloaded'
      revision: string
      localPreserved: boolean
    }
  | {
      state: 'conflict'
      reason: 'remote-changed'
      localPreserved: true
    }
  | {
      state: 'failed'
      reason:
        | 'session-status'
        | 'local-read'
        | 'remote-read'
        | 'remote-invalid'
        | 'remote-write'
        | 'local-conflict'
      localPreserved: true
    }

export interface StudyCloudSyncController {
  getStatus(): StudyCloudSyncResult | { state: 'idle' | 'syncing' }
  syncOnce(): Promise<StudyCloudSyncResult>
}

export interface StudyCloudSyncControllerOptions {
  enabled: boolean
  config?: StudyCloudProviderConfig
  deviceId: string
  store: WorkspaceStore
  adapter: StudyCloudAdapter
}

interface ParsedStudyCloudSnapshot {
  mutation: SyncMutation
  state: WorkspaceStateV3
  updatedAt: string
  digest: string
}

const policy = createAllowlistSyncPolicy([STUDY_CLOUD_COLLECTION])

export function compareStudyCloudSnapshots(
  left: StudyCloudSnapshotOrder,
  right: StudyCloudSnapshotOrder,
): -1 | 0 | 1 {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? -1 : 1
  if (left.digest === right.digest) return 0
  return left.digest < right.digest ? -1 : 1
}

export async function createStudyCloudSnapshot(
  state: WorkspaceStateV3,
  deviceId: string,
): Promise<SyncMutation> {
  if (!deviceId.trim()) throw new Error('Study cloud snapshot requires a deviceId.')
  const workspace = createWorkspaceExport(state, state.updatedAt)
  const parsed = workspace.state
  assertIsoTimestamp(parsed.updatedAt)
  const digest = await sha256(canonicalJson(parsed))
  const revision = `${parsed.updatedAt}|${digest}`
  return {
    operationId: `${STUDY_CLOUD_COLLECTION}:${revision}`,
    collection: STUDY_CLOUD_COLLECTION,
    recordId: STUDY_CLOUD_RECORD_ID,
    kind: 'upsert',
    payload: { workspace, digest },
    revision,
    deviceId,
    occurredAt: parsed.updatedAt,
  }
}

export function createStudyCloudSyncController(
  options: StudyCloudSyncControllerOptions,
): StudyCloudSyncController {
  let status: StudyCloudSyncController['getStatus'] extends () => infer T ? T : never =
    { state: 'idle' }

  const finish = (result: StudyCloudSyncResult): StudyCloudSyncResult => {
    status = result
    return result
  }

  return {
    getStatus() {
      return status
    },
    async syncOnce() {
      if (!options.enabled) {
        return finish({ state: 'skipped', reason: 'disabled', localPreserved: true })
      }
      if (!options.config) {
        return finish({ state: 'skipped', reason: 'unconfigured', localPreserved: true })
      }

      status = { state: 'syncing' }
      let session: StudyCloudSessionStatus
      try {
        session = await options.adapter.sessionStatus(options.config)
      } catch {
        return finish({ state: 'failed', reason: 'session-status', localPreserved: true })
      }
      if (session.state === 'signed-out') {
        return finish({ state: 'skipped', reason: 'signed-out', localPreserved: true })
      }

      let localState: WorkspaceStateV3
      let local: ParsedStudyCloudSnapshot
      try {
        localState = await options.store.load()
        local = await parseCloudSnapshot(
          await createStudyCloudSnapshot(localState, options.deviceId),
        )
      } catch {
        return finish({ state: 'failed', reason: 'local-read', localPreserved: true })
      }

      let pulled: SyncMutation | null
      try {
        pulled = await options.adapter.pull(options.config)
      } catch {
        return finish({ state: 'failed', reason: 'remote-read', localPreserved: true })
      }

      if (pulled === null) {
        try {
          const pushed = await options.adapter.push(options.config, local.mutation)
          if (!pushed.applied) {
            return finish({ state: 'conflict', reason: 'remote-changed', localPreserved: true })
          }
          return finish({
            state: 'success',
            action: 'uploaded',
            revision: local.mutation.revision,
            localPreserved: true,
          })
        } catch {
          return finish({ state: 'failed', reason: 'remote-write', localPreserved: true })
        }
      }

      let remote: ParsedStudyCloudSnapshot
      try {
        remote = await parseCloudSnapshot(pulled)
      } catch {
        return finish({ state: 'failed', reason: 'remote-invalid', localPreserved: true })
      }

      // Import advances local CAS metadata and replaces foreign receipts. Those
      // local transaction details must not turn a download into another upload.
      const sameContent = workspaceContent(local.state) === workspaceContent(remote.state)
      const order = sameContent ? 0 : compareStudyCloudSnapshots(local, remote)
      if (order === 0) {
        return finish({
          state: 'success',
          action: 'unchanged',
          revision: remote.mutation.revision,
          localPreserved: true,
        })
      }
      if (order > 0) {
        try {
          const pushed = await options.adapter.push(
            options.config,
            local.mutation,
            remote.mutation.revision,
          )
          if (!pushed.applied) {
            return finish({ state: 'conflict', reason: 'remote-changed', localPreserved: true })
          }
          return finish({
            state: 'success',
            action: 'uploaded',
            revision: local.mutation.revision,
            localPreserved: true,
          })
        } catch {
          return finish({ state: 'failed', reason: 'remote-write', localPreserved: true })
        }
      }

      try {
        const service = createTaskCapabilityService(
          options.store,
          () => new Date().toISOString(),
          (kind) => `${kind}:${crypto.randomUUID()}`,
        )
        await service.execute({
          protocolVersion: CAPABILITY_PROTOCOL_VERSION,
          idempotencyKey: `cloud:${remote.mutation.revision}`,
          source: 'human-ui',
          expectedWorkspaceRevision: localState.revision,
          command: { type: 'workspace.import', state: remote.state },
        })
      } catch {
        return finish({ state: 'failed', reason: 'local-conflict', localPreserved: true })
      }
      return finish({
        state: 'success',
        action: 'downloaded',
        revision: remote.mutation.revision,
        localPreserved: false,
      })
    },
  }
}

async function parseCloudSnapshot(value: SyncMutation): Promise<ParsedStudyCloudSnapshot> {
  if (
    !policy.allows(value.collection) ||
    value.recordId !== STUDY_CLOUD_RECORD_ID ||
    value.kind !== 'upsert' ||
    !isRecord(value.payload) ||
    typeof value.payload.digest !== 'string'
  ) {
    throw new Error('Invalid Study cloud snapshot envelope.')
  }
  const exported = value.payload.workspace === undefined
    ? null
    : parseWorkspaceExport(value.payload.workspace)
  const legacyState = exported === null ? value.payload.state : undefined
  if (exported === null && legacyState === undefined) {
    throw new Error('Invalid Study cloud snapshot payload.')
  }
  const state = exported?.state ?? parseWorkspaceStateOrMigrate(legacyState, value.occurredAt)
  assertIsoTimestamp(state.updatedAt)
  const digestSource = exported === null ? legacyState : state
  const digest = await sha256(canonicalJson(digestSource))
  const revisionUpdatedAt = exported === null && isRecord(legacyState) && typeof legacyState.updatedAt === 'string'
    ? legacyState.updatedAt
    : state.updatedAt
  assertIsoTimestamp(revisionUpdatedAt)
  const revision = `${revisionUpdatedAt}|${digest}`
  if (
    value.payload.digest !== digest ||
    value.revision !== revision ||
    value.occurredAt !== state.updatedAt ||
    !value.deviceId.trim()
  ) {
    throw new Error('Invalid Study cloud snapshot revision.')
  }
  return { mutation: value, state, updatedAt: state.updatedAt, digest }
}

function workspaceContent(state: WorkspaceStateV3): string {
  const { revision, updatedAt, commandReceipts, ...content } = state
  return canonicalJson(content)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assertIsoTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error('Study cloud snapshot updatedAt must be an ISO UTC timestamp.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
