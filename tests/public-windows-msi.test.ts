import assert from 'node:assert/strict'
import test from 'node:test'
import { assertHostedWindows, validatePublicMsiRelease, validatePublicMsiTag, validatePublicMsiBytes, PUBLIC_MSI } from '../scripts/stage-public-windows-msi.mjs'

const release = () => ({
  tag_name: PUBLIC_MSI.tag, target_commitish: PUBLIC_MSI.source, draft: false, prerelease: false,
  assets: [{ id: PUBLIC_MSI.assetId, name: PUBLIC_MSI.file, size: PUBLIC_MSI.bytes,
    digest: `sha256:${PUBLIC_MSI.sha256}`, browser_download_url: PUBLIC_MSI.url, state: 'uploaded' }],
})

test('only the pinned public final MSI may become the smoke candidate', () => {
  assert.equal(validatePublicMsiRelease(release()).id, PUBLIC_MSI.assetId)
  for (const change of [{ tag_name: 'v0.3.1' }, { target_commitish: 'main' }, { draft: true }, { prerelease: true }]) {
    assert.throws(() => validatePublicMsiRelease({ ...release(), ...change }))
  }
  for (const change of [{ id: 1 }, { name: '../other.msi' }, { size: 1 }, { digest: 'sha256:wrong' }, { browser_download_url: 'https://example.com/other.msi' }, { state: 'new' }]) {
    const value = release()
    Object.assign(value.assets[0], change)
    assert.throws(() => validatePublicMsiRelease(value))
  }
  assert.throws(() => validatePublicMsiRelease({ ...release(), assets: [] }))
  assert.throws(() => validatePublicMsiRelease({ ...release(), assets: [...release().assets, ...release().assets] }))
})

test('download bytes must match the published size and SHA-256, even with valid metadata', () => {
  assert.throws(() => validatePublicMsiBytes(Buffer.from('wrong')), /size/)
  assert.throws(() => validatePublicMsiBytes(Buffer.alloc(PUBLIC_MSI.bytes)), /SHA-256/)
})

test('a moved release tag cannot inherit acceptance of the original source', () => {
  const ref = { object: { type: 'tag', sha: PUBLIC_MSI.tagObject } }
  const tag = { tag: PUBLIC_MSI.tag, object: { type: 'commit', sha: PUBLIC_MSI.source } }
  assert.doesNotThrow(() => validatePublicMsiTag(ref, tag))
  assert.throws(() => validatePublicMsiTag({ object: { type: 'tag', sha: 'other' } }, tag))
  assert.throws(() => validatePublicMsiTag(ref, { ...tag, object: { type: 'commit', sha: 'other' } }))
})

test('staging refuses local, self-hosted and non-Windows execution before any writes', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'Shiaoming123/shixue', GITHUB_TOKEN: 'test-token' }
  assert.doesNotThrow(() => assertHostedWindows('win32', env))
  assert.throws(() => assertHostedWindows('linux', env))
  for (const key of Object.keys(env).filter((key) => key !== 'GITHUB_REF_NAME')) {
    assert.throws(() => assertHostedWindows('win32', { ...env, [key]: '' }))
  }
  assert.throws(() => assertHostedWindows('win32', { ...env, RUNNER_ENVIRONMENT: 'self-hosted' }))
  assert.doesNotThrow(() => assertHostedWindows('win32', { ...env, GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'ci/public-windows-msi-smoke' }))
  assert.throws(() => assertHostedWindows('win32', { ...env, GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'other' }))
})
