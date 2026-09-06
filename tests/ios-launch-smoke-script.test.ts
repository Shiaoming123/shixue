import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const { runIosLaunchSmoke } = await import('../scripts/smoke-ios-launch.mjs') as {
  runIosLaunchSmoke: (options: Record<string, unknown>) => Promise<{
    success: boolean
    phases: Record<string, boolean>
    commands: Array<{ command: string; args: string[] }>
    termination?: { signal?: string | null }
  }>
}

test('iOS launch smoke installs, launches, polls process state, captures logs, and requires readiness', async () => {
  const calls: Array<{ command: string; args: string[] }> = []
  const runCommand = async (command: string, args: string[]) => {
    calls.push({ command, args })
    if (args[1] === 'install') return { status: 0, stdout: '', stderr: '', signal: null }
    if (args[1] === 'launch') return { status: 0, stdout: 'com.shiaoming123.shixue: 4242\n', stderr: '', signal: null }
    if (args[1] === 'spawn' && args[3] === 'ps') return { status: 0, stdout: '4242 S 拾学\n', stderr: '', signal: null }
    if (args[1] === 'spawn' && args[3] === 'log') {
      return {
        status: 0,
        stdout: '[shixue:smoke] webview-created\n[shixue:smoke] native-host-ready\n[shixue:smoke] vue-mounted\n[shixue:smoke] workspace-ready\n[shixue:smoke] frontend-ready\n',
        stderr: '',
        signal: null,
      }
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  }

  const report = await runIosLaunchSmoke({
    device: 'SIMULATOR-UDID',
    app: '/tmp/拾学.app',
    runCommand,
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
    args: ['simctl', 'install', 'SIMULATOR-UDID', '/tmp/拾学.app'],
  })
  assert.deepEqual(calls[1], {
    command: 'xcrun',
    args: ['simctl', 'launch', 'SIMULATOR-UDID', 'com.shiaoming123.shixue'],
  })
  assert.ok(calls.some(({ args }) => args[1] === 'spawn' && args[3] === 'ps'))
  assert.ok(calls.some(({ args }) => args[1] === 'spawn' && args[3] === 'log'))
})

test('iOS launch smoke fails when the app exits before readiness', async () => {
  const report = await runIosLaunchSmoke({
    device: 'SIMULATOR-UDID',
    app: '/tmp/拾学.app',
    runCommand: async (_command: string, args: string[]) => {
      if (args[1] === 'install') return { status: 0, stdout: '', stderr: '', signal: null }
      if (args[1] === 'launch') return { status: 0, stdout: 'com.shiaoming123.shixue: 4242\n', stderr: '', signal: null }
      if (args[1] === 'spawn' && args[3] === 'ps') return { status: 1, stdout: '', stderr: 'Terminated due to signal: SIGTRAP', signal: 'SIGTRAP' }
      if (args[1] === 'spawn' && args[3] === 'log') return { status: 0, stdout: 'Terminated due to signal: SIGTRAP\n', stderr: '', signal: null }
      throw new Error(`Unexpected command: ${args.join(' ')}`)
    },
    sleep: async () => undefined,
  })

  assert.equal(report.success, false)
  assert.equal(report.phases.workspaceReady, false)
  assert.equal(report.termination?.signal, 'SIGTRAP')
})

test('application emits separate WebView, host, Vue, workspace, and frontend readiness markers', () => {
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(mainSource, /console\.info\("\[shixue:smoke\] webview-created"\)/)
  assert.match(mainSource, /console\.info\("\[shixue:smoke\] native-host-ready"\)/)
  assert.match(mainSource, /console\.info\("\[shixue:smoke\] vue-mounted"\)/)
  assert.match(appSource, /console\.info\('\[shixue:smoke\] workspace-ready'\)/)
  assert.match(appSource, /console\.info\('\[shixue:smoke\] frontend-ready'\)/)
})
