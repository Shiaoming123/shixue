import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tauriTargetRoot = resolve(projectRoot, 'src-tauri', 'target')
const smokeReportPath = resolve(tauriTargetRoot, 'windows-package-smoke-report.json')

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
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    platform: process.platform,
    automatedResult: 'NOT_RUN',
    stages: [
      ['package-build', 'Build an unsigned NSIS package for the current source.'],
      ['silent-install', 'Install the NSIS package into an isolated target directory.'],
      ['installed-launch', 'Launch the installed executable and observe that it stays alive for two seconds.'],
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

export function createNsisInstallArgs(_installerPath, installPath) {
  return ['/S', `/D=${installPath}`]
}

export function createNsisUninstallArgs() {
  return ['/S']
}

export function selectNsisInstaller(candidates, productName, version) {
  const matches = candidates.filter(
    (candidate) => candidate.startsWith(`${productName}_${version}_`) && candidate.endsWith('-setup.exe'),
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one NSIS installer for ${productName} ${version}, found ${matches.length}.`)
  }
  return matches[0]
}

export function resolveInstalledExecutable(installPath, binaryName) {
  return resolve(installPath, `${binaryName}.exe`)
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

async function listNsisInstallers(directory) {
  try {
    const entries = await readdir(directory)
    return entries.filter((entry) => entry.endsWith('-setup.exe'))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return []
    throw error
  }
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
  const appDataPath = assertSmokePath(smokeRoot, resolve(smokeRoot, 'appdata'))
  const localAppDataPath = assertSmokePath(smokeRoot, resolve(smokeRoot, 'localappdata'))
  let application
  let activeStage = 'package-build'

  try {
    await Promise.all([mkdir(installPath), mkdir(appDataPath), mkdir(localAppDataPath)])
    const tauriCli = resolve(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
    const nsisDirectory = resolve(tauriTargetRoot, 'release', 'bundle', 'nsis')
    const tauriConfig = JSON.parse(
      await readFile(resolve(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
    )
    const cargoManifest = await readFile(resolve(projectRoot, 'src-tauri', 'Cargo.toml'), 'utf8')
    const cargoPackageName = cargoManifest.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
    if (!cargoPackageName) throw new Error('Could not read the Cargo package name for the installed executable.')
    const binaryName = tauriConfig.mainBinaryName?.trim() || cargoPackageName
    await runCommand(process.execPath, [
      tauriCli,
      'build',
      '--bundles',
      'nsis',
      '--no-sign',
      '--config',
      '{"bundle":{"createUpdaterArtifacts":false}}',
    ])
    updateSmokeStage(report, 'package-build', 'PASS', 'Tauri returned exit code 0 for an unsigned NSIS build.')

    activeStage = 'silent-install'
    const installerName = selectNsisInstaller(
      await listNsisInstallers(nsisDirectory),
      tauriConfig.productName,
      tauriConfig.version,
    )
    const installerPath = resolve(nsisDirectory, installerName)
    await runCommand(installerPath, createNsisInstallArgs(installerPath, installPath))
    updateSmokeStage(report, 'silent-install', 'PASS', `Installed ${installerName} into the isolated smoke directory.`)

    activeStage = 'installed-launch'
    const executablePath = assertSmokePath(
      installPath,
      resolveInstalledExecutable(installPath, binaryName),
    )
    const executableStat = await stat(executablePath)
    if (!executableStat.isFile()) throw new Error(`Installed application is missing: ${executablePath}`)

    application = spawn(executablePath, [], {
      cwd: installPath,
      windowsHide: true,
      env: {
        ...process.env,
        APPDATA: appDataPath,
        LOCALAPPDATA: localAppDataPath,
      },
    })
    await waitForChildToStayAlive(application, 2_000)
    updateSmokeStage(report, 'installed-launch', 'PASS', 'The installed executable stayed alive for the two-second automated probe.')
    report.automatedResult = 'PASS'
    report.artifact = installerPath
    console.log(`Windows package automated smoke passed: ${installerPath}`)
  } catch (error) {
    updateSmokeStage(report, activeStage, 'FAIL', error instanceof Error ? error.message : String(error))
    report.automatedResult = 'FAIL'
    throw error
  } finally {
    report.finishedAt = new Date().toISOString()
    try {
      await writeFile(smokeReportPath, `${JSON.stringify(report, null, 2)}\n`)
      console.log(`Windows package smoke report: ${smokeReportPath}`)
    } finally {
      await terminateChild(application)
      await cleanupWindowsSmokeInstallation(tauriTargetRoot, smokeRoot, installPath)
    }
  }
}

export async function cleanupWindowsSmokeInstallation(
  targetRoot,
  smokeRoot,
  installPath,
  {
    exists = async (path) => stat(path).then((entry) => entry.isFile()).catch(() => false),
    uninstall = (path, args) => runCommand(path, args),
    remove = removeSmokeRoot,
  } = {},
) {
  const safeSmokeRoot = assertSmokePath(targetRoot, smokeRoot)
  const safeInstallPath = assertSmokePath(safeSmokeRoot, installPath)
  const uninstallerPath = assertSmokePath(safeSmokeRoot, resolve(safeInstallPath, 'uninstall.exe'))
  if (await exists(uninstallerPath)) {
    await uninstall(uninstallerPath, createNsisUninstallArgs())
  }
  await remove(targetRoot, safeSmokeRoot)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
