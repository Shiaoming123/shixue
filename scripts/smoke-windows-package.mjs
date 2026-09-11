import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tauriTargetRoot = resolve(projectRoot, 'src-tauri', 'target')
const installerKind = process.argv.includes('--msi') ? 'msi' : 'nsis'
const smokeReportPath = resolve(tauriTargetRoot, installerKind === 'msi' ? 'windows-msi-smoke-report.json' : 'windows-package-smoke-report.json')

const manualStages = [
  ['permission-first-reminder', 'Observe that startup stays silent and the first enabled reminder requests permission.'],
  ['two-reminders-one-task', 'Create one task with two reminder rules and observe both due cards or notifications.'],
  ['snooze-one', 'Snooze one due delivery and verify that the task schedule is unchanged.'],
  ['complete-one', 'Complete one due delivery and verify that a repeated action is idempotent.'],
  ['hide-to-tray', 'Close using the tray preference and verify that the process and scheduler remain running.'],
  ['reopen-from-tray', 'Reopen the hidden main window from the tray.'],
  ['quit-from-tray', 'Use the tray Quit action and verify that the process exits without another prompt.'],
  ['no-delivery-after-quit', 'Wait past a due time after Quit and verify that no delivery is observed.'],
  ['windows-display-scaling-200', 'Repeat the representative flow with Windows display scaling set to 200%.'],
]

export function createWindowsSmokeReport(now = new Date()) {
  const installerLabel = installerKind === 'msi' ? 'MSI' : 'NSIS'
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    platform: process.platform,
    automatedResult: 'NOT_RUN',
    stages: [
      ['manifest-audit', `Load the versioned candidate manifest and verify the exact ${installerLabel} bytes by SHA-256.`],
      ['product-data-preflight', 'Verify the real Windows product data directories are absent before launch.'],
      ['silent-install', `Install the manifest-selected ${installerLabel} package into a dedicated target directory.`],
      ['installed-launch', 'Launch the installed executable and observe that it stays alive for two seconds.'],
      ['installed-relaunch', 'Launch the same installed executable again after the first process exits.'],
      ['silent-uninstall', 'Run the installed candidate uninstaller and verify the executable is removed.'],
      ['cleanup', 'Remove the owned smoke directory, product data, and installer registry residue.'],
    ].map(([id, description]) => ({ id, verification: 'automated', status: 'NOT_RUN', description })),
  }
}

export function appendManualWindowsStages(report) {
  report.stages.push(...manualStages.map(([id, description]) => ({
    id,
    verification: 'manual',
    status: 'NOT_RUN',
    description,
    reason: 'The package smoke script cannot observe Windows notification UI, tray interaction, or system display settings.',
  })))
  report.stages.push({
    id: 'native-notification-action-buttons',
    verification: 'manual',
    status: 'UNSUPPORTED',
    description: 'Invoke Complete, Snooze, and Open from native Windows notification buttons.',
    reason: 'The current adapter uses the in-app reminder card fallback and does not register native Windows action buttons.',
  })
  return report
}

export function updateSmokeStage(report, id, status, evidence) {
  const stage = report.stages.find((candidate) => candidate.id === id)
  if (!stage) throw new Error(`Unknown Windows smoke stage: ${id}`)
  stage.status = status
  if (evidence) stage.evidence = evidence
}

export function assertSmokePath(targetRoot, candidate) {
  const resolvedRoot = resolve(targetRoot)
  const resolvedCandidate = resolve(candidate)
  if (!resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Smoke path must stay inside ${resolvedRoot}: ${resolvedCandidate}`)
  }
  return resolvedCandidate
}

export function resolveWindowsProductDataPaths(roamingRoot, localRoot, identifier) {
  if (typeof roamingRoot !== 'string' || !roamingRoot.trim() || typeof localRoot !== 'string' || !localRoot.trim()) {
    throw new Error('Windows product data roots are unavailable.')
  }
  if (typeof identifier !== 'string' || !identifier.trim() || identifier !== identifier.trim() || /[\\/]/.test(identifier) || identifier === '.' || identifier === '..') {
    throw new Error(`Invalid Windows product identifier: ${identifier}`)
  }
  const resolvedRoamingRoot = resolve(roamingRoot)
  const resolvedLocalRoot = resolve(localRoot)
  return {
    identifier,
    roamingRoot: resolvedRoamingRoot,
    localRoot: resolvedLocalRoot,
    roaming: resolve(resolvedRoamingRoot, identifier),
    local: resolve(resolvedLocalRoot, identifier),
  }
}

function queryWindowsKnownFolder(name) {
  if (!['ApplicationData', 'LocalApplicationData'].includes(name)) {
    return Promise.reject(new Error(`Unsupported Windows Known Folder: ${name}`))
  }
  return new Promise((resolveFolder, rejectFolder) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `[Environment]::GetFolderPath('${name}')`,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', rejectFolder)
    child.once('exit', (code, signal) => {
      if (code !== 0) {
        rejectFolder(new Error(`Could not resolve Windows Known Folder ${name}: ${stderr.trim() || signal || code}`))
        return
      }
      const path = stdout.trim()
      if (!path) rejectFolder(new Error(`Windows Known Folder ${name} is empty.`))
      else resolveFolder(path)
    })
  })
}

export async function loadWindowsKnownFolderRoots({ query = queryWindowsKnownFolder } = {}) {
  const roaming = await query('ApplicationData')
  const local = await query('LocalApplicationData')
  if (typeof roaming !== 'string' || !roaming.trim() || typeof local !== 'string' || !local.trim()) {
    throw new Error('Windows Known Folder roots are unavailable.')
  }
  return { roaming: roaming.trim(), local: local.trim() }
}

function assertWindowsProductDataPath(paths, candidate, root) {
  const expected = resolve(root, paths.identifier)
  const resolvedCandidate = resolve(candidate)
  if (resolvedCandidate !== expected) {
    throw new Error(`Windows product data path must match the exact application identity: ${resolvedCandidate}`)
  }
  return resolvedCandidate
}

export async function assertWindowsProductDataAbsent(
  paths,
  { exists = async (path) => {
    try {
      await stat(path)
      return true
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') return false
      throw error
    }
  } } = {},
) {
  for (const [candidate, root] of [[paths.roaming, paths.roamingRoot], [paths.local, paths.localRoot]]) {
    const exact = assertWindowsProductDataPath(paths, candidate, root)
    if (await exists(exact)) {
      throw new Error(`BLOCKED: existing product data must be preserved before Windows package smoke: ${exact}`)
    }
  }
}

export async function claimWindowsProductData(
  paths,
  {
    create = (path) => mkdir(path),
    remove = (path) => rm(path, { recursive: true, force: true }),
  } = {},
) {
  const created = []
  try {
    for (const [candidate, root] of [[paths.roaming, paths.roamingRoot], [paths.local, paths.localRoot]]) {
      const exact = assertWindowsProductDataPath(paths, candidate, root)
      await create(exact)
      created.push(exact)
    }
  } catch (error) {
    for (const path of [...created].reverse()) await remove(path)
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error('BLOCKED: existing product data appeared during Windows package smoke preflight.')
    }
    throw error
  }
}

export async function removeWindowsProductData(
  paths,
  { remove = (path) => rm(path, { recursive: true, force: true }) } = {},
) {
  await remove(assertWindowsProductDataPath(paths, paths.roaming, paths.roamingRoot))
  await remove(assertWindowsProductDataPath(paths, paths.local, paths.localRoot))
}

async function loadCandidateWindowsArtifact(root, version, kind, label) {
  const directory = resolve(root, 'release-artifacts', 'windows', version)
  const manifestPath = assertSmokePath(resolve(root, 'release-artifacts', 'windows'), resolve(directory, 'manifest.json'))
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.version !== version || manifest.platform !== 'windows') {
    throw new Error(`Windows candidate manifest must describe version ${version} for Windows.`)
  }
  const matches = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.filter((artifact) => artifact?.kind === kind)
    : []
  if (matches.length !== 1) throw new Error(`Windows candidate manifest must contain exactly one ${label} artifact; found ${matches.length}.`)
  const artifact = matches[0]
  if (typeof artifact.file !== 'string' || !artifact.file || typeof artifact.sha256 !== 'string') {
    throw new Error(`Windows candidate ${label} metadata is incomplete.`)
  }
  const path = assertSmokePath(directory, resolve(directory, artifact.file))
  const [contents, artifactStat] = await Promise.all([readFile(path), stat(path)])
  if (!artifactStat.isFile() || artifactStat.size !== artifact.bytes) {
    throw new Error(`Windows candidate ${label} size mismatch: ${artifact.file}`)
  }
  const digest = createHash('sha256').update(contents).digest('hex')
  if (digest !== artifact.sha256) throw new Error(`Windows candidate ${label} checksum mismatch: ${artifact.file}`)
  return { ...artifact, path, manifestPath, manifest }
}

export function loadCandidateNsisArtifact(root, version) {
  return loadCandidateWindowsArtifact(root, version, 'nsis', 'NSIS')
}

export function loadCandidateMsiArtifact(root, version) {
  return loadCandidateWindowsArtifact(root, version, 'msi', 'MSI')
}

export function createNsisInstallArgs(_installerPath, installPath) {
  return ['/S', `/D=${installPath}`]
}

export function createNsisUninstallArgs() {
  return ['/S']
}

export function createMsiInstallArgs(installerPath, installPath) {
  return ['/i', installerPath, '/qn', '/norestart', 'ALLUSERS=2', 'MSIINSTALLPERUSER=1', `INSTALLDIR=${installPath}`]
}

export function createMsiUninstallArgs(installerPath) {
  return ['/x', installerPath, '/qn', '/norestart']
}

export function resolveInstalledExecutable(installPath, binaryName) {
  return resolve(installPath, `${binaryName}.exe`)
}

export async function waitForFileRemoval(path, {
  attempts = 20,
  exists = async (candidate) => stat(candidate).then((entry) => entry.isFile()).catch(() => false),
  delay = async () => new Promise((resolveDelay) => setTimeout(resolveDelay, 250)),
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!await exists(path)) return
    if (attempt + 1 < attempts) await delay()
  }
  throw new Error(`Installed executable remains after uninstall: ${path}`)
}

export async function removeSmokeRoot(
  targetRoot,
  candidate,
  {
    remove = (path) => rm(path, { recursive: true, force: true }),
    delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  } = {},
) {
  const smokeRoot = assertSmokePath(targetRoot, candidate)
  const retryDelays = [250, 500, 1_000]
  for (let attempt = 0; ; attempt += 1) {
    try {
      await remove(smokeRoot)
      return
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code) || attempt === retryDelays.length) {
        throw error
      }
      await delay(retryDelays[attempt])
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', windowsHide: true, ...options })
    child.once('error', rejectCommand)
    child.once('exit', (code, signal) => {
      if (code === 0) return resolveCommand()
      rejectCommand(new Error(`${command} exited with ${signal ?? code}`))
    })
  })
}

async function waitForChildToStayAlive(child, durationMs) {
  await new Promise((resolveWait, rejectWait) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolveWait()
    }, durationMs)
    const onExit = (code, signal) => {
      clearTimeout(timer)
      rejectWait(new Error(`Installed application exited before smoke probe completed (${signal ?? code}).`))
    }
    child.once('exit', onExit)
  })
}

async function terminateChild(child) {
  if (!child?.pid || child.exitCode !== null) return
  await runCommand('taskkill', ['/pid', String(child.pid), '/t', '/f'])
  if (child.exitCode === null) await once(child, 'exit')
}

async function runRegistryCommand(args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn('reg.exe', args, { stdio: 'ignore', windowsHide: true })
    child.once('error', rejectCommand)
    child.once('exit', (code, signal) => {
      if (signal) return rejectCommand(new Error(`reg.exe exited with ${signal}`))
      resolveCommand(code)
    })
  })
}

function queryInstalledMsiProduct(productName) {
  const escaped = productName.replaceAll("'", "''")
  const command = `$found = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq '${escaped}' }; if ($found) { exit 10 }`
  return new Promise((resolveQuery, rejectQuery) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'ignore', windowsHide: true })
    child.once('error', rejectQuery)
    child.once('exit', (code, signal) => signal ? rejectQuery(new Error(`MSI identity query exited with ${signal}`)) : resolveQuery(code))
  })
}

export async function assertWindowsMsiProductAbsent(productName, { query = queryInstalledMsiProduct } = {}) {
  if (typeof productName !== 'string' || !productName.trim()) throw new Error('Windows MSI product name is unavailable.')
  const code = await query(productName)
  if (code === 10) throw new Error(`BLOCKED: ${productName} is already installed; refusing to replace an existing MSI product.`)
  if (code !== 0) throw new Error(`Could not audit the installed MSI identity for ${productName}.`)
}

async function removeWindowsInstallerRegistryKey(key) {
  if (!key?.startsWith('HKCU\\Software\\')) {
    throw new Error(`Refusing to remove an unexpected Windows installer registry key: ${key}`)
  }
  const queryCode = await runRegistryCommand(['query', key])
  if (queryCode === 1) return
  if (queryCode !== 0) throw new Error(`Could not inspect Windows installer registry key: ${key}`)
  const deleteCode = await runRegistryCommand(['delete', key, '/f'])
  if (deleteCode !== 0) throw new Error(`Could not remove Windows installer registry key: ${key}`)
}

export async function assertWindowsInstallerRegistryKeyAbsent(
  key,
  { query = (args) => runRegistryCommand(args) } = {},
) {
  if (!key?.startsWith('HKCU\\Software\\')) {
    throw new Error(`Refusing to inspect an unexpected Windows installer registry key: ${key}`)
  }
  const queryCode = await query(['query', key])
  if (queryCode === 1) return
  if (queryCode === 0) throw new Error(`NSIS product registry key remains after uninstall: ${key}`)
  throw new Error(`Could not inspect Windows installer registry key: ${key}`)
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Windows package smoke only runs on Windows.')
  }

  await mkdir(tauriTargetRoot, { recursive: true })
  const report = appendManualWindowsStages(createWindowsSmokeReport())
  const smokeRoot = assertSmokePath(
    tauriTargetRoot,
    await mkdtemp(resolve(tauriTargetRoot, 'meow-windows-package-smoke-')),
  )
  const installPath = assertSmokePath(smokeRoot, resolve(smokeRoot, 'install'))
  let application
  let installerRegistryKey
  let executablePath
  let productDataPaths
  let ownsProductData = false
  let msiCandidatePath
  let msiInstalled = false
  let activeStage = 'manifest-audit'
  let failure

  try {
    const [tauriConfig, packageJson, cargoManifest] = await Promise.all([
      readFile(resolve(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8').then(JSON.parse),
      readFile(resolve(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
      readFile(resolve(projectRoot, 'src-tauri', 'Cargo.toml'), 'utf8'),
    ])
    const cargoPackageName = cargoManifest.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
    if (!cargoPackageName) throw new Error('Could not read the Cargo package name for the installed executable.')
    if (typeof packageJson.author !== 'string' || !packageJson.author.trim()) {
      throw new Error('Could not read the package author for Windows installer cleanup.')
    }
    const binaryName = tauriConfig.mainBinaryName?.trim() || cargoPackageName
    const candidate = installerKind === 'msi'
      ? await loadCandidateMsiArtifact(projectRoot, packageJson.version)
      : await loadCandidateNsisArtifact(projectRoot, packageJson.version)
    if (installerKind === 'msi') msiCandidatePath = candidate.path
    if (candidate.manifest.identifier !== tauriConfig.identifier) {
      throw new Error('Windows candidate manifest identifier does not match the current Tauri identity.')
    }
    const candidateRegistryKey = `HKCU\\Software\\${packageJson.author}\\${tauriConfig.productName}`
    if (installerKind === 'msi') {
      await assertWindowsMsiProductAbsent(tauriConfig.productName)
    } else {
      const installedIdentity = await runRegistryCommand(['query', candidateRegistryKey])
      if (installedIdentity === 0) throw new Error(`BLOCKED: ${candidateRegistryKey} is already installed; refusing to overwrite the real application identity.`)
      if (installedIdentity !== 1) throw new Error(`Could not audit installed Windows identity: ${candidateRegistryKey}`)
      installerRegistryKey = candidateRegistryKey
    }
    report.artifact = {
      path: candidate.path,
      manifest: candidate.manifestPath,
      sha256: candidate.sha256,
      version: candidate.manifest.version,
      identifier: candidate.manifest.identifier,
      signing: candidate.manifest.signing,
    }
    updateSmokeStage(report, 'manifest-audit', 'PASS', `Verified ${candidate.file} SHA-256 ${candidate.sha256}.`)

    activeStage = 'product-data-preflight'
    const knownFolders = await loadWindowsKnownFolderRoots()
    productDataPaths = resolveWindowsProductDataPaths(knownFolders.roaming, knownFolders.local, candidate.manifest.identifier)
    await assertWindowsProductDataAbsent(productDataPaths)
    await claimWindowsProductData(productDataPaths)
    ownsProductData = true
    updateSmokeStage(report, 'product-data-preflight', 'PASS', 'The real Windows product data directories were absent; this smoke run owns any directories it creates there.')

    activeStage = 'silent-install'
    await mkdir(installPath)
    if (installerKind === 'msi') {
      msiInstalled = true
      await runCommand('msiexec.exe', createMsiInstallArgs(candidate.path, installPath))
    }
    else await runCommand(candidate.path, createNsisInstallArgs(candidate.path, installPath))
    updateSmokeStage(report, 'silent-install', 'PASS', `Installed ${candidate.file} into the isolated smoke directory.`)

    activeStage = 'installed-launch'
    executablePath = assertSmokePath(
      installPath,
      resolveInstalledExecutable(installPath, binaryName),
    )
    const executableStat = await stat(executablePath)
    if (!executableStat.isFile()) throw new Error(`Installed application is missing: ${executablePath}`)

    application = spawn(executablePath, [], {
      cwd: installPath,
      windowsHide: true,
      env: { ...process.env },
    })
    await waitForChildToStayAlive(application, 2_000)
    updateSmokeStage(report, 'installed-launch', 'PASS', 'The installed executable stayed alive for the two-second automated probe.')
    await terminateChild(application)
    application = undefined

    activeStage = 'installed-relaunch'
    application = spawn(executablePath, [], {
      cwd: installPath,
      windowsHide: true,
      env: { ...process.env },
    })
    await waitForChildToStayAlive(application, 2_000)
    updateSmokeStage(report, 'installed-relaunch', 'PASS', 'The same installed executable stayed alive after relaunch.')
    await terminateChild(application)
    application = undefined

    activeStage = 'silent-uninstall'
    if (installerKind === 'msi') {
      await runCommand('msiexec.exe', createMsiUninstallArgs(candidate.path))
      msiInstalled = false
    } else {
      const uninstallerPath = assertSmokePath(smokeRoot, resolve(installPath, 'uninstall.exe'))
      const uninstallerStat = await stat(uninstallerPath)
      if (!uninstallerStat.isFile()) throw new Error(`Installed uninstaller is missing: ${uninstallerPath}`)
      await runCommand(uninstallerPath, createNsisUninstallArgs())
    }
    await waitForFileRemoval(executablePath)
    if (installerKind === 'msi') await assertWindowsMsiProductAbsent(tauriConfig.productName)
    else await assertWindowsInstallerRegistryKeyAbsent(installerRegistryKey)
    updateSmokeStage(report, 'silent-uninstall', 'PASS', 'The candidate uninstaller removed the installed executable and product registry metadata.')

    activeStage = 'cleanup'
    if (installerKind === 'msi') await removeSmokeRoot(tauriTargetRoot, smokeRoot)
    else await cleanupWindowsSmokeInstallation(tauriTargetRoot, smokeRoot, installPath, { registryKey: installerRegistryKey, exists: async () => false })
    if (ownsProductData) await removeWindowsProductData(productDataPaths)
    ownsProductData = false
    updateSmokeStage(report, 'cleanup', 'PASS', 'Removed the owned smoke root, product data, and installer registry residue.')
    report.automatedResult = 'PASS'
    console.log(`Windows package automated smoke passed: ${candidate.path}`)
  } catch (error) {
    const status = error instanceof Error && error.message.startsWith('BLOCKED:') ? 'BLOCKED' : 'FAIL'
    updateSmokeStage(report, activeStage, status, error instanceof Error ? error.message : String(error))
    report.automatedResult = status
    failure = error
  } finally {
    try {
      await terminateChild(application)
      if (msiInstalled && msiCandidatePath) {
        await runCommand('msiexec.exe', createMsiUninstallArgs(msiCandidatePath))
        msiInstalled = false
      }
      if (report.stages.find((stage) => stage.id === 'cleanup')?.status !== 'PASS') {
        if (installerKind === 'msi') await removeSmokeRoot(tauriTargetRoot, smokeRoot)
        else await cleanupWindowsSmokeInstallation(tauriTargetRoot, smokeRoot, installPath, { registryKey: installerRegistryKey })
        if (ownsProductData) await removeWindowsProductData(productDataPaths)
        ownsProductData = false
        if (activeStage !== 'cleanup') updateSmokeStage(report, 'cleanup', 'PASS', 'Cleaned the owned smoke state after an earlier stage failed.')
      }
    } catch (cleanupError) {
      updateSmokeStage(report, 'cleanup', 'FAIL', cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
      failure ??= cleanupError
    }
    report.finishedAt = new Date().toISOString()
    await writeFile(smokeReportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Windows package smoke report: ${smokeReportPath}`)
  }
  if (failure) throw failure
}

export async function cleanupWindowsSmokeInstallation(
  targetRoot,
  smokeRoot,
  installPath,
  {
    exists = async (path) => stat(path).then((entry) => entry.isFile()).catch(() => false),
    registryKey,
    uninstall = (path, args) => runCommand(path, args),
    removeRegistry = removeWindowsInstallerRegistryKey,
    remove = removeSmokeRoot,
  } = {},
) {
  const safeSmokeRoot = assertSmokePath(targetRoot, smokeRoot)
  const safeInstallPath = assertSmokePath(safeSmokeRoot, installPath)
  const uninstallerPath = assertSmokePath(safeSmokeRoot, resolve(safeInstallPath, 'uninstall.exe'))
  if (await exists(uninstallerPath)) {
    await uninstall(uninstallerPath, createNsisUninstallArgs())
  }
  if (registryKey) await removeRegistry(registryKey)
  await remove(targetRoot, safeSmokeRoot)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
