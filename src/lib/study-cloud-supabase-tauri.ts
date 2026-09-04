import type {
  StudyCloudAdapter,
  StudyCloudProviderConfig,
  StudyCloudSessionStatus,
} from './study-cloud-sync.ts'
import type { SyncMutation } from '../sync/types.ts'

type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>

export interface StudyCloudCredentials {
  email: string
  password: string
}

export interface StudyCloudSupabaseTauriAdapter extends StudyCloudAdapter {
  signIn(
    config: StudyCloudProviderConfig,
    credentials: StudyCloudCredentials,
  ): Promise<Extract<StudyCloudSessionStatus, { state: 'signed-in' }>>
  signOut(config: StudyCloudProviderConfig): Promise<{ state: 'signed-out' }>
}

export function createStudyCloudSupabaseTauriAdapter(
  invoke: Invoke = invokeTauri,
): StudyCloudSupabaseTauriAdapter {
  return {
    async signIn(config, credentials) {
      const safeConfig = validateStudyCloudSupabaseConfig(config)
      const safeCredentials = validateCredentials(credentials)
      const result = parseSessionStatus(
        await invoke('study_cloud_sign_in', {
          config: safeConfig,
          email: safeCredentials.email,
          password: safeCredentials.password,
        }),
      )
      if (result.state !== 'signed-in') throw new Error('Native sign-in returned invalid session result.')
      return result
    },
    async sessionStatus(config) {
      const safeConfig = validateStudyCloudSupabaseConfig(config)
      return parseSessionStatus(
        await invoke('study_cloud_session_status', { config: safeConfig }),
      )
    },
    async signOut(config) {
      const safeConfig = validateStudyCloudSupabaseConfig(config)
      const result = parseSessionStatus(
        await invoke('study_cloud_sign_out', { config: safeConfig }),
      )
      if (result.state !== 'signed-out') throw new Error('Native sign-out returned invalid session result.')
      return result
    },
    async pull(config) {
      const safeConfig = validateStudyCloudSupabaseConfig(config)
      const result = await invoke('study_cloud_pull', { config: safeConfig })
      if (result === null) return null
      return parseMutation(result)
    },
    async push(config, snapshot, expectedRevision) {
      const safeConfig = validateStudyCloudSupabaseConfig(config)
      const safeSnapshot = parseMutation(snapshot)
      if (expectedRevision !== undefined && !isBoundedString(expectedRevision, 1, 512)) {
        throw new Error('Supabase expected revision is invalid.')
      }
      const result = await invoke('study_cloud_push', {
        config: safeConfig,
        snapshot: safeSnapshot,
        expectedRevision,
      })
      if (!isExactRecord(result, ['applied']) || typeof result.applied !== 'boolean') {
        throw new Error('Native push returned invalid applied result.')
      }
      return { applied: result.applied }
    },
  }
}

export function validateStudyCloudSupabaseConfig(
  config: StudyCloudProviderConfig,
): StudyCloudProviderConfig {
  try {
    if (!isRecord(config) || config.provider !== 'supabase') throw new Error()
    const url = new URL(config.projectUrl)
    const host = url.hostname.toLowerCase()
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
    const hosted = host.endsWith('.supabase.co') && host !== '.supabase.co'
    const validScheme = hosted
      ? url.protocol === 'https:' && (url.port === '' || url.port === '443')
      : loopback && ['http:', 'https:'].includes(url.protocol)
    if (
      !validScheme ||
      (!hosted && !loopback) ||
      url.username !== '' ||
      url.password !== '' ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search !== '' ||
      url.hash !== '' ||
      !isBoundedString(config.publishableKey, 1, 16 * 1024) ||
      /\s/.test(config.publishableKey)
    ) {
      throw new Error()
    }
    return {
      provider: 'supabase',
      projectUrl: url.origin,
      publishableKey: config.publishableKey,
    }
  } catch {
    throw new Error('Supabase project configuration is invalid.')
  }
}

async function invokeTauri(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

function validateCredentials(credentials: StudyCloudCredentials): StudyCloudCredentials {
  const email = typeof credentials?.email === 'string' ? credentials.email.trim() : ''
  if (
    !isRecord(credentials) ||
    !isBoundedString(email, 3, 320) ||
    !email.includes('@') ||
    !isBoundedString(credentials.password, 1, 4096)
  ) {
    throw new Error('Supabase sign-in credentials are invalid.')
  }
  return { email, password: credentials.password }
}

function parseSessionStatus(value: unknown): StudyCloudSessionStatus {
  if (!isRecord(value) || typeof value.state !== 'string') {
    throw new Error('Native session returned invalid session result.')
  }
  if (value.state === 'signed-out' && isExactRecord(value, ['state'])) {
    return { state: 'signed-out' }
  }
  if (
    value.state === 'signed-in' &&
    hasOnlyKeys(value, ['state', 'email', 'userId']) &&
    (value.email === undefined || isBoundedString(value.email, 1, 320)) &&
    (value.userId === undefined || isBoundedString(value.userId, 1, 256))
  ) {
    return {
      state: 'signed-in',
      ...(value.email === undefined ? {} : { email: value.email }),
      ...(value.userId === undefined ? {} : { userId: value.userId }),
    }
  }
  throw new Error('Native session returned invalid session result.')
}

function parseMutation(value: unknown): SyncMutation {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'operationId',
      'collection',
      'recordId',
      'kind',
      'payload',
      'revision',
      'deviceId',
      'occurredAt',
    ]) ||
    !isBoundedString(value.operationId, 1, 1024) ||
    value.collection !== 'study_state' ||
    value.recordId !== 'current' ||
    value.kind !== 'upsert' ||
    !isRecord(value.payload) ||
    !isBoundedString(value.revision, 1, 512) ||
    !isBoundedString(value.deviceId, 1, 512) ||
    !isBoundedString(value.occurredAt, 1, 64)
  ) {
    throw new Error('Native boundary received an invalid study cloud mutation.')
  }
  return value as unknown as SyncMutation
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && hasOnlyKeys(value, keys)
}
