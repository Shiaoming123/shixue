import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import {
  assertSmokePath,
  appendManualWindowsStages,
  cleanupWindowsSmokeInstallation,
  createSmokeBundleConfig,
  createWindowsSmokeReport,
  createNsisInstallArgs,
  createNsisUninstallArgs,
  removeSmokeRoot,
  resolveInstalledExecutable,
  selectNsisInstaller,
  updateSmokeStage,
} from '../scripts/smoke-windows-package.mjs'

test('reports automated and manual Windows evidence without promoting unobserved stages', () => {
  const report = appendManualWindowsStages(createWindowsSmokeReport(new Date('2026-09-05T00:00:00.000Z')))
  updateSmokeStage(report, 'package-build', 'PASS', 'exit code 0')
  assert.equal(report.generatedAt, '2026-09-05T00:00:00.000Z')
  assert.deepEqual(report.stages.map((stage) => stage.id), [
    'package-build', 'silent-install', 'installed-launch',
    'permission-first-reminder', 'two-reminders-one-task', 'snooze-one', 'complete-one',
    'hide-to-tray', 'reopen-from-tray', 'quit-from-tray', 'no-delivery-after-quit',
    'windows-display-scaling-200', 'native-notification-action-buttons',
  ])
  assert.equal(report.stages.find((stage) => stage.id === 'package-build')?.status, 'PASS')
  assert.equal(report.stages.find((stage) => stage.id === 'permission-first-reminder')?.status, 'NOT_RUN')
  assert.equal(report.stages.find((stage) => stage.id === 'windows-display-scaling-200')?.verification, 'manual')
  assert.equal(report.stages.find((stage) => stage.id === 'native-notification-action-buttons')?.status, 'UNSUPPORTED')
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

test('uses a separate Windows identity for the package smoke app', () => {
  assert.deepEqual(createSmokeBundleConfig({
    productName: '拾学',
    identifier: 'com.shiaoming123.shixue',
  }), {
    productName: '拾学 Package Smoke',
    identifier: 'com.shiaoming123.shixue.package-smoke',
    bundle: { createUpdaterArtifacts: false },
  })
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

test('selects the single installer for the configured product and version', () => {
  assert.equal(
    selectNsisInstaller(
      ['Meow Starter_0.0.9_x64-setup.exe', 'Meow Starter_0.1.0_x64-setup.exe'],
      'Meow Starter',
      '0.1.0',
    ),
    'Meow Starter_0.1.0_x64-setup.exe',
  )
  assert.throws(
    () => selectNsisInstaller(['Meow Starter_0.1.0_x64-setup.exe', 'copy.exe'], 'Meow Starter', '0.2.0'),
    /Expected one NSIS installer/,
  )
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
