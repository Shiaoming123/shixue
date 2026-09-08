import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

const { readMobileAppIdentity } = await import('../scripts/mobile-app-identity.mjs') as {
  readMobileAppIdentity: (projectRoot: string) => {
    identifier: string
    androidPackageId: string
  }
}

async function createProject(t: test.TestContext, config: unknown) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'shixue-mobile-identity-'))
  t.after(() => rm(projectRoot, { recursive: true, force: true }))
  await mkdir(join(projectRoot, 'src-tauri'))
  await writeFile(join(projectRoot, 'src-tauri', 'tauri.conf.json'), JSON.stringify(config))
  return projectRoot
}

test('mobile smoke identity comes from Tauri config and applies the existing Android package-name transform', async (t) => {
  const projectRoot = await createProject(t, { identifier: 'com.example.study-app' })

  assert.deepEqual(readMobileAppIdentity(projectRoot), {
    identifier: 'com.example.study-app',
    androidPackageId: 'com.example.study_app',
  })
})

test('mobile smoke identity fails closed for a missing or unsafe Tauri identifier', async (t) => {
  const missingRoot = await createProject(t, {})
  const unsafeRoot = await createProject(t, { identifier: 'com.example.study;rm' })
  const unsupportedRoot = await createProject(t, { identifier: 'com.example.study_app' })

  assert.throws(() => readMobileAppIdentity(missingRoot), /valid identifier/)
  assert.throws(() => readMobileAppIdentity(unsafeRoot), /valid identifier/)
  assert.throws(() => readMobileAppIdentity(unsupportedRoot), /valid identifier/)
})

test('mobile smoke entrypoints do not duplicate the configured product identifier', async () => {
  const scripts = [
    'smoke-android-launch.mjs',
    'smoke-android-persistence.mjs',
    'smoke-ios-launch.mjs',
  ]

  for (const script of scripts) {
    const source = await readFile(resolve('scripts', script), 'utf8')
    assert.doesNotMatch(source, /com\.shiaoming123\.shixue/, `${script} must read the Tauri app identity`)
    assert.match(source, /mobile-app-identity\.mjs/, `${script} must use the shared identity reader`)
  }
})
