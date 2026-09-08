import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MOBILE_APP_IDENTITY } from './mobile-app-identity.mjs'

export const ANDROID_PACKAGE_ID = MOBILE_APP_IDENTITY.androidPackageId
export const ANDROID_ACTIVITY = `${ANDROID_PACKAGE_ID}/.MainActivity`

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultOutputRoot = resolve(projectRoot, 'src-tauri', 'target', 'android-launch')
const artifactCheckScript = resolve(projectRoot, 'scripts', 'check-android-artifact.mjs')
const markerFile = 'cache/shixue-android-launch-smoke.log'
const runIdFile = 'cache/shixue-android-smoke-run-id'
const readinessMarkers = {
  nativeHostReady: 'native-host-ready',
  webviewCreated: 'webview-created',
  vueMounted: 'vue-mounted',
  workspaceReady: 'workspace-ready',
  frontendReady: 'frontend-ready',
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function runProcess(command, args, options = {}) {
  return new Promise((resolveCommand) => {
    execFile(command, args, { cwd: projectRoot, encoding: 'utf8', ...options }, (error, stdout = '', stderr = '') => {
      resolveCommand({
        status: error?.code === undefined ? 0 : Number.isInteger(error.code) ? error.code : 1,
        stdout,
        stderr,
        signal: error?.signal ?? null,
      })
    })
  })
}

function resultText(result) {
  return `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
}

function applyMarkers(phases, text, runId) {
  for (const [phase, marker] of Object.entries(readinessMarkers)) {
    if (text.includes(`[shixue:smoke] ${runId} ${marker}`)) phases[phase] = true
  }
}

function hasReadiness(phases) {
  return Object.values(phases).every(Boolean)
}

function extractPid(result) {
  if (result.status !== 0) return null
  return resultText(result).match(/\b(\d+)\b/)?.[1] ?? null
}

function isForeground(result, activity) {
  return result.status === 0 && resultText(result).includes(activity)
}

function validateSafeToken(label, value) {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters.`)
  }
}

export async function runAndroidLaunchSmoke({
  device,
  apk,
  adb = 'adb',
  runCommand = runProcess,
  runId = randomUUID(),
  sleep = delay,
  now = () => Date.now(),
  timeoutMs = 30_000,
  pollIntervalMs = 250,
  stableAliveMs = 1_500,
} = {}) {
  if (!device) throw new Error('Missing required --device <serial>.')
  if (!apk || !isAbsolute(apk)) throw new Error('--apk must be an absolute path to a built APK.')
  if (!apk.toLowerCase().endsWith('.apk')) throw new Error('--apk must point to an APK file.')
  if (timeoutMs <= 0 || stableAliveMs < 0) throw new Error('Smoke timeouts must be non-negative, with timeoutMs > 0.')
  validateSafeToken('Device serial', device)
  validateSafeToken('Run id', runId)

  const commands = []
  const phases = {
    nativeHostReady: false,
    webviewCreated: false,
    vueMounted: false,
    workspaceReady: false,
    frontendReady: false,
  }
  const report = {
    schemaVersion: 1,
    runId,
    packageId: ANDROID_PACKAGE_ID,
    activity: ANDROID_ACTIVITY,
    device,
    apk,
    success: false,
    foreground: false,
    phases,
    commands,
    logs: '',
    pid: undefined,
    termination: undefined,
    error: undefined,
  }
  const invoke = async (args) => {
    commands.push({ command: adb, args: [...args] })
    return runCommand(adb, args, { cwd: projectRoot })
  }
  const onDevice = (args) => invoke(['-s', device, ...args])

  const artifactCheck = await runCommand(process.execPath, [artifactCheckScript, '--apk', apk], { cwd: projectRoot })
  commands.push({ command: process.execPath, args: [artifactCheckScript, '--apk', apk] })
  if (artifactCheck.status !== 0) {
    report.error = `Android artifact validation failed: ${resultText(artifactCheck).trim()}`
    return report
  }

  const state = await onDevice(['get-state'])
  if (state.status !== 0 || state.stdout.trim() !== 'device') {
    report.error = `Android target is not ready: ${resultText(state).trim() || device}`
    return report
  }

  const emulator = await onDevice(['shell', 'getprop', 'ro.kernel.qemu'])
  if (emulator.status !== 0 || emulator.stdout.trim() !== '1') {
    report.error = `Android target is not an emulator: ${resultText(emulator).trim() || device}`
    return report
  }

  const bootDeadline = now() + timeoutMs
  let booted = false
  while (now() <= bootDeadline) {
    const bootState = await onDevice(['shell', 'getprop', 'sys.boot_completed'])
    if (bootState.status === 0 && bootState.stdout.trim() === '1') {
      booted = true
      break
    }
    await sleep(pollIntervalMs)
  }
  if (!booted) {
    report.error = 'Timed out waiting for the Android emulator to finish booting.'
    return report
  }

  const installedPackage = await onDevice(['shell', 'pm', 'list', 'packages', '--user', '0', ANDROID_PACKAGE_ID])
  if (installedPackage.status !== 0) {
    report.error = `Could not inspect the installed Android package: ${resultText(installedPackage).trim()}`
    return report
  }
  if (installedPackage.stdout.split(/\r?\n/).some((line) => line.trim() === `package:${ANDROID_PACKAGE_ID}`)) {
    const uninstall = await onDevice(['uninstall', ANDROID_PACKAGE_ID])
    if (uninstall.status !== 0 || !/\bSuccess\b/.test(resultText(uninstall))) {
      report.error = `adb uninstall failed: ${resultText(uninstall).trim()}`
      return report
    }
  }

  const install = await onDevice(['install', '-r', '-t', apk])
  if (install.status !== 0 || !/\bSuccess\b/.test(resultText(install))) {
    report.error = `adb install failed: ${resultText(install).trim()}`
    return report
  }

  const resolvedActivity = await onDevice(['shell', 'cmd', 'package', 'resolve-activity', '--brief', ANDROID_PACKAGE_ID])
  const activity = resultText(resolvedActivity)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${ANDROID_PACKAGE_ID}/`))
  if (resolvedActivity.status !== 0 || !activity) {
    report.error = `Could not resolve the Android launcher Activity: ${resultText(resolvedActivity).trim()}`
    return report
  }
  report.activity = activity

  const reset = await onDevice(['shell', `run-as ${ANDROID_PACKAGE_ID} rm -f ${markerFile} ${runIdFile}`])
  if (reset.status !== 0) {
    report.error = `Could not clear Android smoke evidence: ${resultText(reset).trim()}`
    return report
  }
  const seed = await onDevice(['shell', `run-as ${ANDROID_PACKAGE_ID} sh -c 'printf %s ${runId} > ${runIdFile}'`])
  if (seed.status !== 0) {
    report.error = `Could not seed Android smoke run id: ${resultText(seed).trim()}`
    return report
  }

  const clearLogs = await onDevice(['logcat', '-c'])
  if (clearLogs.status !== 0) {
    report.error = `Could not clear Android logcat: ${resultText(clearLogs).trim()}`
    return report
  }

  const stop = await onDevice(['shell', 'am', 'force-stop', ANDROID_PACKAGE_ID])
  if (stop.status !== 0) {
    report.error = `adb force-stop failed: ${resultText(stop).trim()}`
    return report
  }
  const launch = await onDevice(['shell', 'am', 'start', '-W', '-S', '-n', activity])
  if (launch.status !== 0 || /(?:Error|Exception):/i.test(resultText(launch))) {
    report.error = `adb Activity launch failed: ${resultText(launch).trim()}`
    return report
  }

  const deadline = now() + timeoutMs
  let readySince
  let observedProcess = false
  while (now() <= deadline) {
    const [evidence, processState, activityState] = await Promise.all([
      onDevice(['exec-out', 'run-as', ANDROID_PACKAGE_ID, 'cat', markerFile]),
      onDevice(['shell', 'pidof', '-s', ANDROID_PACKAGE_ID]),
      onDevice(['shell', 'dumpsys', 'activity', 'activities']),
    ])
    if (evidence.status === 0) {
      report.logs = evidence.stdout
        .split(/\r?\n/)
        .filter((line) => line.includes(`[shixue:smoke] ${runId} `))
        .join('\n')
      applyMarkers(phases, report.logs, runId)
    }
    const pid = extractPid(processState)
    report.foreground = isForeground(activityState, activity)
    if (pid) {
      observedProcess = true
      report.pid = pid
    } else if (observedProcess || launch.status === 0) {
      const logs = await onDevice(['logcat', '-d', '-t', '500'])
      report.error = `Android process exited before readiness for ${ANDROID_PACKAGE_ID}.`
      report.termination = { status: processState.status, signal: processState.signal ?? null, output: resultText(logs).trim() }
      return report
    }

    if (pid && report.foreground && hasReadiness(phases)) {
      readySince ??= now()
      if (now() - readySince >= stableAliveMs) {
        report.success = true
        return report
      }
    } else {
      readySince = undefined
    }
    await sleep(pollIntervalMs)
  }

  report.error = `Timed out waiting for Android readiness, foreground Activity, and stable process liveness.`
  report.termination = { status: report.pid ? 0 : 1, signal: null, output: report.pid ? `pid ${report.pid} still alive` : 'process not observed' }
  return report
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--device') options.device = argv[++index]
    else if (arg === '--apk') options.apk = argv[++index]
    else if (arg === '--adb') options.adb = argv[++index]
    else if (arg === '--output') options.output = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const report = await runAndroidLaunchSmoke(options)
  const output = options.output ? resolve(options.output) : resolve(defaultOutputRoot, `launch-${Date.now()}.json`)
  await mkdir(resolve(output, '..'), { recursive: true })
  const finalReport = { ...report, evidencePath: output }
  await writeFile(output, `${JSON.stringify(finalReport, null, 2)}\n`)
  console.log(JSON.stringify(finalReport, null, 2))
  if (!report.success) process.exitCode = 1
  return report
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
