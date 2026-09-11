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
  loadCandidateMsiArtifact,
  createMsiInstallArgs,
  createMsiUninstallArgs,
  assertWindowsMsiProductAbsent,
  waitForFileRemoval,
  updateSmokeStage,
} from '../scripts/smoke-windows-package.mjs'

test('reports automated and manual Windows evidence without promoting unobserved stages', () => {
  const report = appendManualWindowsStages(createWindowsSmokeReport(new Date('2026-09-05T00:00:00.000Z')))
  updateSmokeStage(report, 'manifest-audit', 'PASS', 'checksum verified')
  assert.equal(report.generatedAt, '2026-09-05T00:00:00.000Z')
  assert.deepEqual(report.stages.map((stage) => stage.id), [
    'manifest-audit', 'product-data-preflight', 'silent-install', 'installed-launch', 'installed-relaunch', 'silent-uninstall', 'cleanup',
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

test('loads the exact manifest MSI bytes and uses a quiet per-user lifecycle', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'shixue-msi-candidate-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = resolve(root, 'release-artifacts', 'windows', '0.3.0')
  await mkdir(directory, { recursive: true })
  const file = 'Shixue_0.3.0_x64_Installer.msi'
  await writeFile(resolve(directory, file), 'candidate bytes')
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({
    version: '0.3.0', platform: 'windows', identifier: 'com.shiaoming123.shixue',
    artifacts: [{ kind: 'msi', file, bytes: 15, sha256: '732d058fadd90c70f22429227ab5d9c74919217099efe737aa46835ce3a60856' }],
  }))

  const artifact = await loadCandidateMsiArtifact(root, '0.3.0')
  assert.equal(artifact.path, resolve(directory, file))
  assert.deepEqual(createMsiInstallArgs(artifact.path, 'D:/owned/install'), [
    '/i', artifact.path, '/qn', '/norestart', 'ALLUSERS=2', 'MSIINSTALLPERUSER=1', 'INSTALLDIR=D:/owned/install',
  ])
  assert.deepEqual(createMsiUninstallArgs(artifact.path), ['/x', artifact.path, '/qn', '/norestart'])
})

test('blocks MSI lifecycle when the product is already installed', async () => {
  await assert.rejects(assertWindowsMsiProductAbsent('拾学', { query: async () => 10 }), /BLOCKED: 拾学 is already installed/)
  await assertWindowsMsiProductAbsent('拾学', { query: async () => 0 })
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

test('uses the real Windows product data locations and blocks an existing identity', async () => {
  const paths = windowsSmoke.resolveWindowsProductDataPaths(
    'C:/Users/test/AppData/Roaming',
    'C:/Users/test/AppData/Local',
    'com.shiaoming123.shixue',
  )
  assert.deepEqual(paths, {
    identifier: 'com.shiaoming123.shixue',
    roamingRoot: resolve('C:/Users/test/AppData/Roaming'),
    localRoot: resolve('C:/Users/test/AppData/Local'),
    roaming: resolve('C:/Users/test/AppData/Roaming/com.shiaoming123.shixue'),
    local: resolve('C:/Users/test/AppData/Local/com.shiaoming123.shixue'),
  })
  await assert.rejects(
    windowsSmoke.assertWindowsProductDataAbsent(paths, {
      exists: async (path: string) => path === paths.roaming,
    }),
    /BLOCKED: existing product data/i,
  )
  await windowsSmoke.assertWindowsProductDataAbsent(paths, { exists: async () => false })
  assert.throws(
    () => windowsSmoke.resolveWindowsProductDataPaths('C:/Users/test/AppData/Roaming', 'C:/Users/test/AppData/Local', '../escape'),
    /invalid Windows product identifier/i,
  )
})

test('loads product data roots from Windows Known Folders', async () => {
  const requested: string[] = []
  const roots = await windowsSmoke.loadWindowsKnownFolderRoots({
    query: async (name: string) => {
      requested.push(name)
      return name === 'ApplicationData'
        ? 'C:/Users/test/AppData/Roaming'
        : 'C:/Users/test/AppData/Local'
    },
  })
  assert.deepEqual(requested, ['ApplicationData', 'LocalApplicationData'])
  assert.deepEqual(roots, {
    roaming: 'C:/Users/test/AppData/Roaming',
    local: 'C:/Users/test/AppData/Local',
  })
})

test('removes only the exact product data directories owned by a fresh smoke run', async () => {
  const paths = windowsSmoke.resolveWindowsProductDataPaths(
    'C:/Users/test/AppData/Roaming',
    'C:/Users/test/AppData/Local',
    'com.shiaoming123.shixue',
  )
  const removed: string[] = []
  await windowsSmoke.removeWindowsProductData(paths, {
    remove: async (path: string) => { removed.push(path) },
  })
  assert.deepEqual(removed, [paths.roaming, paths.local])
})

test('claims both product data directories atomically and rolls back a partial claim', async () => {
  const paths = windowsSmoke.resolveWindowsProductDataPaths(
    'C:/Users/test/AppData/Roaming',
    'C:/Users/test/AppData/Local',
    'com.shiaoming123.shixue',
  )
  const created: string[] = []
  const removed: string[] = []
  await assert.rejects(windowsSmoke.claimWindowsProductData(paths, {
    create: async (path: string) => {
      if (path === paths.local) {
        const error = new Error('exists') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      }
      created.push(path)
    },
    remove: async (path: string) => { removed.push(path) },
  }), /BLOCKED: existing product data/i)
  assert.deepEqual(created, [paths.roaming])
  assert.deepEqual(removed, [paths.roaming])
})
