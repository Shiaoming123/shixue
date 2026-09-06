import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const { runIosLaunchSmoke } = await import('../scripts/smoke-ios-launch.mjs') as {
  runIosLaunchSmoke: (options: Record<string, unknown>) => Promise<{
    success: boolean
    phases: Record<string, boolean>
    commands: Array<{ command: string; args: string[] }>
    termination?: { signal?: string | null }
    error?: string
  }>
}

test('iOS launch smoke installs, launches, polls process state, captures native markers, and requires readiness', async () => {
  const calls: Array<{ command: string; args: string[] }> = []
  const runCommand = async (command: string, args: string[]) => {
    calls.push({ command, args })
    if (args[1] === 'install') return { status: 0, stdout: '', stderr: '', signal: null }
    if (args[1] === 'launch') return { status: 0, stdout: 'com.shiaoming123.shixue: 4242\n', stderr: '', signal: null }
    if (command === '/bin/ps') return { status: 0, stdout: '4242 S Shixue\n', stderr: '', signal: null }
    if (args[1] === 'get_app_container') return { status: 0, stdout: '/tmp/shixue-data\n', stderr: '', signal: null }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  }

  const report = await runIosLaunchSmoke({
    device: 'SIMULATOR-UDID',
    app: '/tmp/Shixue.app',
    runCommand,
    readEvidence: async () => '[shixue:smoke] run-1 webview-created\n[shixue:smoke] run-1 native-host-ready\n[shixue:smoke] run-1 vue-mounted\n[shixue:smoke] run-1 workspace-ready\n[shixue:smoke] run-1 frontend-ready\n',
    runId: 'run-1',
    sleep: async () => undefined,
    stableAliveMs: 0,
  })

  assert.equal(report.success, true)
  assert.deepEqual(report.phases, {
    nativeHostReady: true,
    webviewCreated: true,
    vueMounted: true,
    workspaceReady: true,
    frontendReady: true,
  })
  assert.deepEqual(calls[0], {
    command: 'xcrun',
    args: ['simctl', 'install', 'SIMULATOR-UDID', '/tmp/Shixue.app'],
  })
  assert.deepEqual(calls.find(({ args }) => args[1] === 'launch'), {
    command: 'xcrun',
    args: ['simctl', 'launch', '--terminate-running-process', 'SIMULATOR-UDID', 'com.shiaoming123.shixue'],
  })
  assert.ok(calls.some(({ command }) => command === '/bin/ps'))
  assert.ok(calls.some(({ args }) => args[1] === 'get_app_container'))
})

test('iOS launch smoke fails when the app exits before readiness', async () => {
  const report = await runIosLaunchSmoke({
    device: 'SIMULATOR-UDID',
    app: '/tmp/Shixue.app',
    runCommand: async (_command: string, args: string[]) => {
      if (args[1] === 'install') return { status: 0, stdout: '', stderr: '', signal: null }
      if (args[1] === 'launch') return { status: 0, stdout: 'com.shiaoming123.shixue: 4242\n', stderr: '', signal: null }
      if (args[1] === 'get_app_container') return { status: 0, stdout: '/tmp/shixue-data\n', stderr: '', signal: null }
      if (args[0] === '-p') return { status: 1, stdout: '', stderr: '', signal: null }
      if (args[1] === 'spawn' && args[3] === 'log') return { status: 0, stdout: 'Terminated due to signal: SIGTRAP\n', stderr: '', signal: null }
      throw new Error(`Unexpected command: ${args.join(' ')}`)
    },
    readEvidence: async () => '',
    runId: 'run-2',
    sleep: async () => undefined,
  })

  assert.equal(report.success, false)
  assert.equal(report.phases.workspaceReady, false)
  assert.equal(report.termination?.signal, 'SIGTRAP')
})

test('iOS launch smoke reports an unreadable native marker file without throwing', async () => {
  const report = await runIosLaunchSmoke({
    device: 'SIMULATOR-UDID',
    app: '/tmp/Shixue.app',
    runCommand: async (command: string, args: string[]) => {
      if (args[1] === 'install') return { status: 0, stdout: '', stderr: '', signal: null }
      if (args[1] === 'get_app_container') return { status: 0, stdout: '/tmp/shixue-data\n', stderr: '', signal: null }
      if (args[1] === 'launch') return { status: 0, stdout: 'com.shiaoming123.shixue: 4242\n', stderr: '', signal: null }
      if (command === '/bin/ps') return { status: 0, stdout: '4242 S Shixue\n', stderr: '', signal: null }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
    },
    readEvidence: async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    },
    runId: 'run-3',
  })

  assert.equal(report.success, false)
  assert.match(report.error ?? '', /Could not read iOS smoke evidence.*permission denied/)
})

test('application emits separate WebView, host, Vue, workspace, and frontend readiness markers', () => {
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const nativeSource = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')

  assert.match(mainSource, /reportSmokePhase\('webview-created'\)/)
  assert.match(mainSource, /reportSmokePhase\('native-host-ready'\)/)
  assert.match(mainSource, /reportSmokePhase\('vue-mounted'\)/)
  assert.match(appSource, /reportSmokePhase\('workspace-ready'\)/)
  assert.match(appSource, /reportSmokePhase\('frontend-ready'\)/)
  assert.match(nativeSource, /fn report_ios_smoke_phase/)
  assert.match(nativeSource, /cfg\(all\(target_os = "ios", debug_assertions\)\)/)
})
