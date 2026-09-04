import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStudyCloudSupabaseTauriAdapter,
  validateStudyCloudSupabaseConfig,
} from '../src/lib/study-cloud-supabase-tauri.ts'
import type { SyncMutation } from '../src/sync/types.ts'

const config = {
  provider: 'supabase' as const,
  projectUrl: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_test',
}

const mutation: SyncMutation = {
  operationId: 'study_state:revision-1',
  collection: 'study_state',
  recordId: 'current',
  kind: 'upsert',
  payload: { state: { version: 2 }, digest: 'abc' },
  revision: '2026-09-04T10:00:00.000Z|abc',
  deviceId: 'device-a',
  occurredAt: '2026-09-04T10:00:00.000Z',
}

test('validates a fixed Supabase origin and permits only explicit loopback development origins', () => {
  assert.deepEqual(validateStudyCloudSupabaseConfig(config), config)
  assert.equal(
    validateStudyCloudSupabaseConfig({
      ...config,
      projectUrl: 'http://127.0.0.1:54321',
    }).projectUrl,
    'http://127.0.0.1:54321',
  )
  assert.equal(
    validateStudyCloudSupabaseConfig({
      ...config,
      projectUrl: 'http://localhost:54321/',
    }).projectUrl,
    'http://localhost:54321',
  )

  for (const projectUrl of [
    'http://example.supabase.co',
    'https://supabase.co',
    'https://example.supabase.co.evil.test',
    'https://example.supabase.co:444',
    'https://user:pass@example.supabase.co',
    'https://example.supabase.co/rest/v1',
    'https://example.supabase.co?token=secret',
    'file:///tmp/supabase',
  ]) {
    assert.throws(
      () => validateStudyCloudSupabaseConfig({ ...config, projectUrl }),
      /Supabase project configuration is invalid/,
      projectUrl,
    )
  }
})

test('sign in sends the password once and exposes only safe signed-in identity fields', async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const adapter = createStudyCloudSupabaseTauriAdapter(async (command, args) => {
    calls.push({ command, args })
    return { state: 'signed-in', email: 'learner@example.com', userId: 'user-1' }
  })

  assert.deepEqual(
    await adapter.signIn(config, {
      email: 'learner@example.com',
      password: 'one-time-password',
    }),
    { state: 'signed-in', email: 'learner@example.com', userId: 'user-1' },
  )
  assert.deepEqual(calls, [
    {
      command: 'study_cloud_sign_in',
      args: {
        config,
        email: 'learner@example.com',
        password: 'one-time-password',
      },
    },
  ])
})

test('session, sign out, pull, and CAS push use the native command boundary', async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const adapter = createStudyCloudSupabaseTauriAdapter(async (command, args) => {
    calls.push({ command, args })
    if (command === 'study_cloud_session_status') return { state: 'signed-out' }
    if (command === 'study_cloud_sign_out') return { state: 'signed-out' }
    if (command === 'study_cloud_pull') return mutation
    if (command === 'study_cloud_push') return { applied: false }
    throw new Error('unexpected command')
  })

  assert.deepEqual(await adapter.sessionStatus(config), { state: 'signed-out' })
  assert.deepEqual(await adapter.signOut(config), { state: 'signed-out' })
  assert.deepEqual(await adapter.pull(config), mutation)
  assert.deepEqual(await adapter.push(config, mutation, 'remote-revision'), {
    applied: false,
  })
  assert.deepEqual(
    calls.map(({ command }) => command),
    [
      'study_cloud_session_status',
      'study_cloud_sign_out',
      'study_cloud_pull',
      'study_cloud_push',
    ],
  )
  assert.deepEqual(calls[3].args, {
    config,
    snapshot: mutation,
    expectedRevision: 'remote-revision',
  })
})

test('rejects secret-bearing or malformed native results and invalid mutations', async () => {
  let calls = 0
  const leaking = createStudyCloudSupabaseTauriAdapter(async () => {
    calls += 1
    return { state: 'signed-in', userId: 'user-1', accessToken: 'must-not-cross-ipc' }
  })
  await assert.rejects(() => leaking.sessionStatus(config), /invalid session result/)

  const malformed = createStudyCloudSupabaseTauriAdapter(async () => {
    calls += 1
    return { applied: 'yes' }
  })
  await assert.rejects(
    () => malformed.push(config, { ...mutation, collection: 'private_notes' }),
    /invalid study cloud mutation/,
  )
  assert.equal(calls, 1, 'invalid input must be rejected before IPC')
})

test('does not include a password in validation errors', async () => {
  const password = 'never-echo-this-password'
  const adapter = createStudyCloudSupabaseTauriAdapter(async () => ({
    state: 'signed-out',
  }))
  await assert.rejects(
    () => adapter.signIn(config, { email: 'not-an-email', password }),
    (error: unknown) => {
      assert.equal(String(error).includes(password), false)
      return true
    },
  )
  await assert.rejects(
    () => adapter.signIn(config, { email: '  @  ', password }),
    /credentials are invalid/,
  )
})
