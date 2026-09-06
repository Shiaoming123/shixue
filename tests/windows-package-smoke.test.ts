import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as windowsSmoke from '../scripts/smoke-windows-package.mjs'
import {
  assertSmokePath,
  appendManualWindowsStages,
  cleanupWindowsSmokeInstallation,
  createWindowsSmokeReport,
  createNsisInstallArgs,
  createNsisUninstallArgs,
  removeSmokeRoot,
  resolveInstalledExecutable,
  loadCandidateNsisArtifact,
  waitForFileRemoval,
  updateSmokeStage,
} from '../scripts/smoke-windows-package.mjs'

test('reports automated and manual Windows evidence without promoting unobserved stages', () => {
  const report = appendManualWindowsStages(createWindowsSmokeReport(new Date('2026-09-05T00:00:00.000Z')))
  updateSmokeStage(report, 'manifest-audit', 'PASS', 'checksum verified')
  assert.equal(report.generatedAt, '2026-09-05T00:00:00.000Z')
  assert.deepEqual(report.stages.map((stage) => stage.id), [
    'manifest-audit', 'silent-install', 'installed-launch', 'installed-relaunch', 'silent-uninstall', 'cleanup',
    'permission-first-reminder', 'two-reminders-one-task', 'snooze-one', 'complete-one',
    'hide-to-tray', 'reopen-from-tray', 'quit-from-tray', 'no-delivery-after-quit',
    'windows-display-scaling-200', 'native-notification-action-buttons',
  ])
  assert.equal(report.stages.find((stage) => stage.id === 'manifest-audit')?.status, 'PASS')
  assert.equal(report.stages.find((stage) => stage.id === 'permission-first-reminder')?.status, 'NOT_RUN')
  assert.equal(report.stages.find((stage) => stage.id === 'windows-display-scaling-200')?.verification, 'manual')
  assert.equal(report.stages.find((stage) => stage.id === 'native-notification-action-buttons')?.status, 'UNSUPPORTED')
})

test('waits for the NSIS uninstaller to remove the installed executable', async () => {
  let checks = 0
  await waitForFileRemoval('D:/install/meow-study.exe', {
    attempts: 3,
    delay: async () => {},
    exists: async () => ++checks < 3,
  })
  assert.equal(checks, 3)

  await assert.rejects(waitForFileRemoval('D:/install/meow-study.exe', {
    attempts: 2,
    delay: async () => {},
    exists: async () => true,
  }), /remains after uninstall/)
})

test('loads the exact manifest NSIS bytes and rejects a checksum mismatch', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'shixue-candidate-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = resolve(root, 'release-artifacts', 'windows', '0.3.0')
  await mkdir(directory, { recursive: true })
  const file = 'Shixue_0.3.0_x64_Setup.exe'
  await writeFile(resolve(directory, file), 'candidate bytes')
  const manifest = {
    schemaVersion: 1,
    version: '0.3.0',
    platform: 'windows',
    identifier: 'com.shiaoming123.shixue',
    signing: 'unsigned-local',
    artifacts: [{ kind: 'nsis', file, bytes: 15, sha256: '732d058fadd90c70f22429227ab5d9c74919217099efe737aa46835ce3a60856' }],
  }
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest))

  const artifact = await loadCandidateNsisArtifact(root, '0.3.0')
  assert.equal(artifact.path, resolve(directory, file))
  assert.equal(artifact.sha256, manifest.artifacts[0].sha256)

  manifest.artifacts[0].sha256 = '0'.repeat(64)
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest))
  await assert.rejects(loadCandidateNsisArtifact(root, '0.3.0'), /checksum mismatch/i)
})

test('rejects cleanup outside the dedicated target subtree', () => {
  const targetRoot = resolve('D:/repo/src-tauri/target')
  assert.throws(() => assertSmokePath(targetRoot, 'D:/repo/outside'), /must stay inside/)
  assert.equal(
    assertSmokePath(targetRoot, 'D:/repo/src-tauri/target/meow-windows-package-smoke-a/install'),
    resolve('D:/repo/src-tauri/target/meow-windows-package-smoke-a/install'),
  )
})

test('keeps the NSIS destination argument last', () => {
  assert.deepEqual(
    createNsisInstallArgs(
      'D:/bundle/setup.exe',
      'D:/repo/src-tauri/target/meow-windows-package-smoke-a/install',
    ),
    ['/S', '/D=D:/repo/src-tauri/target/meow-windows-package-smoke-a/install'],
  )
  assert.deepEqual(createNsisUninstallArgs(), ['/S'])
})

test('uninstalls the isolated NSIS app before removing its smoke root', async () => {
  const calls: string[] = []
  const targetRoot = resolve('D:/repo/src-tauri/target')
  const smokeRoot = resolve(targetRoot, 'meow-windows-package-smoke-a')
  const installPath = resolve(smokeRoot, 'install')

  await cleanupWindowsSmokeInstallation(targetRoot, smokeRoot, installPath, {
    exists: async () => true,
    registryKey: 'HKCU\\Software\\shiaoming123\\拾学 Package Smoke',
    uninstall: async (path: string, args: string[]) => { calls.push(`uninstall:${path}:${args.join(' ')}`) },
    removeRegistry: async (key: string) => { calls.push(`registry:${key}`) },
    remove: async (_root: string, path: string) => { calls.push(`remove:${path}`) },
  })

  assert.deepEqual(calls, [
    `uninstall:${resolve(installPath, 'uninstall.exe')}:/S`,
    'registry:HKCU\\Software\\shiaoming123\\拾学 Package Smoke',
    `remove:${smokeRoot}`,
  ])
})

test('uses the Cargo binary name for the installed executable', () => {
  assert.equal(
    resolveInstalledExecutable('D:/repo/src-tauri/target/meow-windows-package-smoke-a/install', 'meow-starter'),
    resolve('D:/repo/src-tauri/target/meow-windows-package-smoke-a/install/meow-starter.exe'),
  )
})

test('retries a temporary Windows directory lock before cleanup succeeds', async () => {
  let attempts = 0
  await removeSmokeRoot('D:/repo/src-tauri/target', 'D:/repo/src-tauri/target/meow-windows-package-smoke-a', {
    delay: async () => {},
    remove: async () => {
      attempts += 1
      if (attempts === 1) {
        const error = new Error('locked') as NodeJS.ErrnoException
        error.code = 'EBUSY'
        throw error
      }
    },
  })
  assert.equal(attempts, 2)
})

test('configures an NSIS post-uninstall hook that removes only product metadata outside update mode', async () => {
  const config = JSON.parse(await readFile(resolve('src-tauri', 'tauri.conf.json'), 'utf8'))
  assert.equal(config.bundle.windows.nsis.installerHooks, 'installer-hooks.nsh')

  const hooks = await readFile(resolve('src-tauri', config.bundle.windows.nsis.installerHooks), 'utf8')
  assert.match(hooks, /!macro NSIS_HOOK_POSTUNINSTALL/)
  assert.match(hooks, /\$UpdateMode <> 1/)
  assert.match(hooks, /DeleteRegKey SHCTX "\$\{MANUPRODUCTKEY\}"/)
  assert.match(hooks, /DeleteRegKey \/ifempty SHCTX "\$\{MANUKEY\}"/)
})

test('rejects a successful uninstall while the NSIS product metadata key remains', async () => {
  const key = 'HKCU\\Software\\Shiaoming123\\拾学'
  await windowsSmoke.assertWindowsInstallerRegistryKeyAbsent(key, { query: async () => 1 })
  await assert.rejects(
    windowsSmoke.assertWindowsInstallerRegistryKeyAbsent(key, { query: async () => 0 }),
    /product registry key remains after uninstall/i,
  )
  await assert.rejects(
    windowsSmoke.assertWindowsInstallerRegistryKeyAbsent(key, { query: async () => 2 }),
    /could not inspect Windows installer registry key/i,
  )
  await assert.rejects(
    windowsSmoke.assertWindowsInstallerRegistryKeyAbsent('HKLM\\Software\\Shiaoming123\\拾学', { query: async () => 1 }),
    /unexpected Windows installer registry key/i,
  )
})
