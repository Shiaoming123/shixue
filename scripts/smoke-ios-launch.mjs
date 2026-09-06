import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const IOS_BUNDLE_ID = 'com.shiaoming123.shixue'
const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultOutputRoot = resolve(projectRoot, 'src-tauri', 'target', 'ios-launch')
const readinessMarkers = {
  nativeHostReady: '[shixue:smoke] native-host-ready',
  webviewCreated: '[shixue:smoke] webview-created',
  vueMounted: '[shixue:smoke] vue-mounted',
  workspaceReady: '[shixue:smoke] workspace-ready',
  frontendReady: '[shixue:smoke] frontend-ready',
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function runXcrun(_command, args, options = {}) {
  return new Promise((resolveCommand) => {
    execFile('xcrun', args, { cwd: projectRoot, encoding: 'utf8', ...options }, (error, stdout = '', stderr = '') => {
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

function extractPid(text) {
  const match = text.match(/:\s*(\d+)\s*$/m) ?? text.match(/\b(\d+)\b/)
  return match?.[1] ?? null
}

function extractSignal(text) {
  return text.match(/\b(SIG[A-Z0-9]+)\b/)?.[1] ?? null
}

function processIsAlive(result, pid) {
  if (result.status !== 0) return false
  return new RegExp(`^\\s*${pid}\\b`, 'm').test(resultText(result))
}

function applyMarkers(phases, text) {
  for (const [phase, marker] of Object.entries(readinessMarkers)) {
    if (text.includes(marker)) phases[phase] = true
  }
}

function hasReadiness(phases) {
  return Object.values(phases).every(Boolean)
}

export async function runIosLaunchSmoke({
  device,
  app,
  runCommand = runXcrun,
  sleep = delay,
  now = () => Date.now(),
  timeoutMs = 30_000,
  pollIntervalMs = 250,
  stableAliveMs = 1_500,
  logWindow = '2m',
} = {}) {
  if (!device) throw new Error('Missing required --device <UDID>.')
  if (!app || !isAbsolute(app)) throw new Error('--app must be an absolute path to a built .app.')
  if (timeoutMs <= 0 || stableAliveMs < 0) throw new Error('Smoke timeouts must be non-negative, with timeoutMs > 0.')

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
    bundleId: IOS_BUNDLE_ID,
    device,
    app,
    success: false,
    phases,
    commands,
    logs: '',
    termination: undefined,
    error: undefined,
  }
  const invoke = async (args) => {
    commands.push({ command: 'xcrun', args: [...args] })
    return runCommand('xcrun', args, { cwd: projectRoot })
  }

  const install = await invoke(['simctl', 'install', device, app])
  if (install.status !== 0) {
    report.error = `simctl install failed: ${resultText(install).trim()}`
    return report
  }

  const launch = await invoke(['simctl', 'launch', device, IOS_BUNDLE_ID])
  if (launch.status !== 0) {
    report.error = `simctl launch failed: ${resultText(launch).trim()}`
    return report
  }
  const pid = extractPid(resultText(launch))
  if (!pid) {
    report.error = `Could not parse the launched process id: ${resultText(launch).trim()}`
    return report
  }

  const deadline = now() + timeoutMs
  let readySince
  while (now() <= deadline) {
    const processState = await invoke(['simctl', 'spawn', device, 'ps', '-p', pid, '-o', 'pid=,stat=,comm='])
    const logs = await invoke([
      'simctl', 'spawn', device, 'log', 'show', '--last', logWindow, '--style', 'compact',
      '--predicate', 'eventMessage CONTAINS[c] "shixue:smoke" OR eventMessage CONTAINS[c] "SIGTRAP" OR process == "拾学" OR process == "meow-study"',
    ])
    report.logs = resultText(logs).trim()
    applyMarkers(phases, resultText(logs))

    if (!processIsAlive(processState, pid)) {
      report.termination = {
        status: processState.status,
        signal: processState.signal ?? extractSignal(`${resultText(processState)}\n${report.logs}`),
        output: resultText(processState).trim(),
      }
      return report
    }

    if (hasReadiness(phases)) {
      readySince ??= now()
      if (now() - readySince >= stableAliveMs) {
        report.success = true
        return report
      }
    }

    await sleep(pollIntervalMs)
  }

  report.error = `Timed out waiting for readiness markers while process ${pid} remained alive.`
  report.termination = { status: 0, signal: null, output: `pid ${pid} still alive` }
  return report
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--device') options.device = argv[++index]
    else if (arg === '--app') options.app = argv[++index]
    else if (arg === '--output') options.output = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const report = await runIosLaunchSmoke(options)
  const output = options.output ? resolve(options.output) : resolve(defaultOutputRoot, `launch-${Date.now()}.json`)
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify({ ...report, evidencePath: output }, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, evidencePath: output }, null, 2))
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
