import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultOutputRoot = resolve(projectRoot, 'src-tauri', 'target', 'android-persistence')
const packageId = 'com.shiaoming123.shixue'
const requestFile = 'cache/shixue-android-persistence-smoke-request.json'
const evidenceFile = 'cache/shixue-android-persistence-smoke.jsonl'

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

function extractPid(result) {
  if (result.status !== 0) return null
  return resultText(result).match(/\b(\d+)\b/)?.[1] ?? null
}

function isForeground(result, activity) {
  return result.status === 0 && resultText(result).includes(activity)
}

function safeToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function runAndroidPersistenceSmoke({
  device,
  launchReport,
  adb = 'adb',
  readLaunchReport = readJson,
  runCommand = runProcess,
  runId = randomUUID(),
  sleep = delay,
  now = () => Date.now(),
  timeoutMs = 30_000,
  pollIntervalMs = 250,
  stableAliveMs = 1_500,
} = {}) {
  if (!device) throw new Error('Missing required --device <serial>.')
  if (!launchReport || !isAbsolute(launchReport)) throw new Error('--launch-report must be an absolute JSON path.')
  if (!safeToken(device)) throw new Error('Device serial contains unsupported characters.')
  if (!safeToken(runId)) throw new Error('Run id contains unsupported characters.')
  if (timeoutMs <= 0 || stableAliveMs < 0) throw new Error('Smoke timeouts must be non-negative, with timeoutMs > 0.')

  const taskId = `task:android-persistence:${runId}`
  const title = `Android persistence smoke ${runId}`
  const stages = { writeConfirmed: false, restartConfirmed: false }
  const commands = []
  const report = {
    schemaVersion: 1,
    runId,
    packageId,
    device,
    launchReport,
    apk: undefined,
    activity: undefined,
    taskId,
    title,
    success: false,
    terminatedBetweenLaunches: false,
    stages,
    firstPid: undefined,
    secondPid: undefined,
    evidence: [],
    termination: undefined,
    error: undefined,
    commands,
  }
  const invoke = async (args) => {
    commands.push({ command: adb, args: [...args] })
    return runCommand(adb, args, { cwd: projectRoot })
  }
  const onDevice = (args) => invoke(['-s', device, ...args])

  let launch
  try {
    launch = await readLaunchReport(launchReport)
  } catch (error) {
    report.error = `Could not read Android launch report: ${error instanceof Error ? error.message : String(error)}`
    return report
  }
  if (
    launch?.schemaVersion !== 1 ||
    launch?.success !== true ||
    launch?.device !== device ||
    launch?.packageId !== packageId ||
    typeof launch?.activity !== 'string' ||
    !launch.activity.startsWith(`${packageId}/`) ||
    typeof launch?.apk !== 'string' ||
    !isAbsolute(launch.apk) ||
    !launch.apk.toLowerCase().endsWith('.apk')
  ) {
    report.error = 'Android launch report does not match the requested device, package, Activity, and exact APK.'
    return report
  }
  report.apk = launch.apk
  report.activity = launch.activity

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
  const installed = await onDevice(['shell', 'pm', 'list', 'packages', '--user', '0', packageId])
  if (installed.status !== 0 || !installed.stdout.split(/\r?\n/).some((line) => line.trim() === `package:${packageId}`)) {
    report.error = 'The APK proven by the launch report is not installed on the requested emulator.'
    return report
  }
  const resolved = await onDevice(['shell', 'cmd', 'package', 'resolve-activity', '--brief', packageId])
  const resolvedActivity = resultText(resolved).split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith(`${packageId}/`))
  if (resolved.status !== 0 || resolvedActivity !== launch.activity) {
    report.error = 'The installed Android launcher Activity does not match the launch report.'
    return report
  }

  let requestSeeded = false
  const captureLogs = async () => {
    const logs = await onDevice(['logcat', '-d', '-t', '500'])
    return resultText(logs).trim()
  }
  const applyEvidence = (source) => {
    for (const line of source.split(/\r?\n/).filter(Boolean)) {
      let item
      try { item = JSON.parse(line) } catch { continue }
      if (
        item?.schemaVersion !== 1 ||
        item?.runId !== runId ||
        item?.taskId !== taskId ||
        item?.title !== title ||
        !Number.isInteger(item?.workspaceRevision) ||
        item.workspaceRevision < 1
      ) continue
      if (item.stage === 'write-confirmed') stages.writeConfirmed = true
      if (item.stage === 'restart-confirmed') stages.restartConfirmed = true
      if ((item.stage === 'write-confirmed' || item.stage === 'restart-confirmed') &&
          !report.evidence.some((entry) => entry.stage === item.stage)) {
        report.evidence.push(item)
      }
    }
  }
  const waitForStage = async (stage, requireStable) => {
    const deadline = now() + timeoutMs
    let readySince
    let observedProcess = false
    while (now() <= deadline) {
      const [evidence, processState, activityState] = await Promise.all([
        onDevice(['exec-out', 'run-as', packageId, 'cat', evidenceFile]),
        onDevice(['shell', 'pidof', '-s', packageId]),
        onDevice(['shell', 'dumpsys', 'activity', 'activities']),
      ])
      if (evidence.status === 0) applyEvidence(evidence.stdout)
      const pid = extractPid(processState)
      if (pid) observedProcess = true
      if (!pid && observedProcess) {
        report.termination = { status: processState.status, signal: processState.signal ?? null, output: await captureLogs() }
        report.error = `Android process exited before ${stage}.`
        return null
      }
      const stageReady = stage === 'write-confirmed' ? stages.writeConfirmed : stages.restartConfirmed
      if (pid && stageReady && isForeground(activityState, launch.activity)) {
        readySince ??= now()
        if (!requireStable || now() - readySince >= stableAliveMs) return pid
      } else {
        readySince = undefined
      }
      await sleep(pollIntervalMs)
    }
    report.termination = { status: 1, signal: null, output: await captureLogs() }
    report.error = `Timed out waiting for Android persistence stage ${stage}.`
    return null
  }

  try {
    const clear = await onDevice(['shell', `run-as ${packageId} rm -f ${requestFile} ${evidenceFile}`])
    if (clear.status !== 0) {
      report.error = `Could not clear Android persistence smoke state: ${resultText(clear).trim()}`
      return report
    }
    const request = Buffer.from(JSON.stringify({ schemaVersion: 1, runId, taskId, title }), 'utf8').toString('base64')
    const seed = await onDevice(['shell', `run-as ${packageId} sh -c 'printf %s ${request} | base64 -d > ${requestFile}'`])
    if (seed.status !== 0) {
      report.error = `Could not seed Android persistence smoke request: ${resultText(seed).trim()}`
      return report
    }
    requestSeeded = true
    const clearLogs = await onDevice(['logcat', '-c'])
    if (clearLogs.status !== 0) {
      report.error = `Could not clear Android logcat: ${resultText(clearLogs).trim()}`
      return report
    }
    const firstStop = await onDevice(['shell', 'am', 'force-stop', packageId])
    if (firstStop.status !== 0) {
      report.error = `adb force-stop failed before the persistence write: ${resultText(firstStop).trim()}`
      return report
    }
    const firstLaunch = await onDevice(['shell', 'am', 'start', '-W', '-S', '-n', launch.activity])
    if (firstLaunch.status !== 0 || /(?:Error|Exception):/i.test(resultText(firstLaunch))) {
      report.error = `First Android persistence launch failed: ${resultText(firstLaunch).trim()}`
      return report
    }
    report.firstPid = await waitForStage('write-confirmed', false) ?? undefined
    if (!report.firstPid) return report

    const stop = await onDevice(['shell', 'am', 'force-stop', packageId])
    if (stop.status !== 0) {
      report.error = `adb force-stop failed between persistence launches: ${resultText(stop).trim()}`
      return report
    }
    const deathDeadline = now() + timeoutMs
    while (now() <= deathDeadline) {
      const processState = await onDevice(['shell', 'pidof', '-s', packageId])
      if (!extractPid(processState)) {
        report.terminatedBetweenLaunches = true
        break
      }
      await sleep(pollIntervalMs)
    }
    if (!report.terminatedBetweenLaunches) {
      report.error = 'Android process did not terminate between persistence launches.'
      return report
    }

    const secondLaunch = await onDevice(['shell', 'am', 'start', '-W', '-S', '-n', launch.activity])
    if (secondLaunch.status !== 0 || /(?:Error|Exception):/i.test(resultText(secondLaunch))) {
      report.error = `Second Android persistence launch failed: ${resultText(secondLaunch).trim()}`
      return report
    }
    report.secondPid = await waitForStage('restart-confirmed', true) ?? undefined
    if (!report.secondPid) return report
    report.success = true
    return report
  } finally {
    if (requestSeeded) {
      await onDevice(['shell', `run-as ${packageId} rm -f ${requestFile}`])
    }
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--device') options.device = argv[++index]
    else if (arg === '--launch-report') options.launchReport = argv[++index]
    else if (arg === '--adb') options.adb = argv[++index]
    else if (arg === '--output') options.output = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const report = await runAndroidPersistenceSmoke(options)
  const output = options.output ? resolve(options.output) : resolve(defaultOutputRoot, `restart-${Date.now()}.json`)
  await mkdir(resolve(output, '..'), { recursive: true })
  const finalReport = { ...report, evidencePath: output }
  await writeFile(output, `${JSON.stringify(finalReport, null, 2)}\n`)
  console.log(JSON.stringify(finalReport, null, 2))
  if (!report.success) process.exitCode = 1
  return finalReport
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
