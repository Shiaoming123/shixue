import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'

const { runAndroidLaunchSmoke } = await import('../scripts/smoke-android-launch.mjs') as {
  runAndroidLaunchSmoke: (options: Record<string, unknown>) => Promise<{
    success: boolean
    phases: Record<string, boolean>
    foreground: boolean
    pid?: string
    commands: Array<{ command: string; args: string[] }>
    termination?: { output?: string }
    error?: string
  }>
}

const successEvidence = [
  '[shixue:smoke] run-1 webview-created',
  '[shixue:smoke] run-1 native-host-ready',
  '[shixue:smoke] run-1 vue-mounted',
  '[shixue:smoke] run-1 workspace-ready',
  '[shixue:smoke] run-1 frontend-ready',
].join('\n')
const absoluteApk = resolve('artifacts', 'app-x86_64-debug.apk')

test('Android launch smoke installs, seeds a unique run, launches the Activity, and requires readiness plus stable foreground liveness', async () => {
  const calls: Array<{ command: string; args: string[] }> = []
  const runCommand = async (command: string, args: string[]) => {
    calls.push({ command, args })
    const joined = args.join(' ')
    if (joined.includes('check-android-artifact.mjs')) return { status: 0, stdout: 'Android APK verified\n', stderr: '', signal: null }
    if (joined.includes('get-state')) return { status: 0, stdout: 'device\n', stderr: '', signal: null }
    if (joined.includes('ro.kernel.qemu')) return { status: 0, stdout: '1\n', stderr: '', signal: null }
    if (joined.includes('sys.boot_completed')) return { status: 0, stdout: '1\n', stderr: '', signal: null }
    if (joined.includes('pm list packages')) return { status: 0, stdout: '', stderr: '', signal: null }
    if (joined.includes('install -r -t')) return { status: 0, stdout: 'Success\n', stderr: '', signal: null }
    if (joined.includes('resolve-activity')) return { status: 0, stdout: 'com.shiaoming123.shixue/.MainActivity\n', stderr: '', signal: null }
    if (joined.includes('rm -f cache/')) return { status: 0, stdout: '', stderr: '', signal: null }
    if (joined.includes('printf %s run-1')) return { status: 0, stdout: '', stderr: '', signal: null }
    if (joined.includes('logcat -c')) return { status: 0, stdout: '', stderr: '', signal: null }
    if (joined.includes('am force-stop')) return { status: 0, stdout: '', stderr: '', signal: null }
    if (joined.includes('am start -W')) return { status: 0, stdout: 'Status: ok\nActivity: com.shiaoming123.shixue/.MainActivity\n', stderr: '', signal: null }
    if (joined.includes('cat cache/')) return { status: 0, stdout: successEvidence, stderr: '', signal: null }
    if (joined.includes('pidof')) return { status: 0, stdout: '4242\n', stderr: '', signal: null }
    if (joined.includes('dumpsys activity activities')) {
      return { status: 0, stdout: 'mResumedActivity: ActivityRecord{abc com.shiaoming123.shixue/.MainActivity}\n', stderr: '', signal: null }
    }
    throw new Error(`Unexpected command: ${command} ${joined}`)
  }

  const report = await runAndroidLaunchSmoke({
    device: 'emulator-5554',
    apk: absoluteApk,
    runCommand,
    runId: 'run-1',
    sleep: async () => undefined,
    stableAliveMs: 0,
  })

  assert.equal(report.success, true)
  assert.equal(report.foreground, true)
  assert.equal(report.pid, '4242')
  assert.deepEqual(report.phases, {
    nativeHostReady: true,
    webviewCreated: true,
    vueMounted: true,
    workspaceReady: true,
    frontendReady: true,
  })
  assert.ok(calls.some(({ args }) => args.includes('install') && args.includes(absoluteApk)))
  assert.ok(calls.some(({ args }) => args.join(' ').includes('printf %s run-1')))
  assert.ok(calls.some(({ args }) => args.join(' ').includes('am start -W -S -n com.shiaoming123.shixue/.MainActivity')))
})

test('Android launch smoke fails closed when the launched process exits before readiness', async () => {
  const report = await runAndroidLaunchSmoke({
    device: 'emulator-5554',
    apk: absoluteApk,
    runCommand: async (_command: string, args: string[]) => {
      const joined = args.join(' ')
      if (joined.includes('check-android-artifact.mjs')) return { status: 0, stdout: 'Android APK verified\n', stderr: '', signal: null }
      if (joined.includes('get-state')) return { status: 0, stdout: 'device\n', stderr: '', signal: null }
      if (joined.includes('ro.kernel.qemu') || joined.includes('sys.boot_completed')) return { status: 0, stdout: '1\n', stderr: '', signal: null }
      if (joined.includes('pm list packages')) return { status: 0, stdout: 'package:com.shiaoming123.shixue\n', stderr: '', signal: null }
      if (joined.includes('uninstall')) return { status: 0, stdout: 'Success\n', stderr: '', signal: null }
      if (joined.includes('resolve-activity')) return { status: 0, stdout: 'com.shiaoming123.shixue/.MainActivity\n', stderr: '', signal: null }
      if (joined.includes('install -r -t') || joined.includes('rm -f cache/') || joined.includes('printf %s run-2') || joined.includes('am force-stop') || joined.includes('logcat -c')) {
        return { status: 0, stdout: joined.includes('install') ? 'Success\n' : '', stderr: '', signal: null }
      }
      if (joined.includes('am start -W')) return { status: 0, stdout: 'Status: ok\n', stderr: '', signal: null }
      if (joined.includes('cat cache/')) return { status: 0, stdout: '[shixue:smoke] run-2 webview-created\n', stderr: '', signal: null }
      if (joined.includes('pidof')) return { status: 1, stdout: '', stderr: '', signal: null }
      if (joined.includes('dumpsys activity activities')) return { status: 0, stdout: '', stderr: '', signal: null }
      if (joined.includes('logcat -d')) return { status: 0, stdout: 'FATAL EXCEPTION: main\n', stderr: '', signal: null }
      throw new Error(`Unexpected command: ${joined}`)
    },
    runId: 'run-2',
    sleep: async () => undefined,
  })

  assert.equal(report.success, false)
  assert.match(report.error ?? '', /exited before readiness/)
  assert.match(report.termination?.output ?? '', /FATAL EXCEPTION/)
})

test('Android launch smoke rejects ambiguous targets before invoking adb', async () => {
  let invoked = false
  const runCommand = async () => {
    invoked = true
    return { status: 0, stdout: '', stderr: '', signal: null }
  }

  await assert.rejects(
    runAndroidLaunchSmoke({ device: '', apk: 'app.apk', runCommand }),
    /Missing required --device/,
  )
  await assert.rejects(
    runAndroidLaunchSmoke({ device: 'emulator-5554', apk: 'app.apk', runCommand }),
    /absolute path/,
  )
  assert.equal(invoked, false)
})

test('Android launch smoke does not accept readiness from another run id', async () => {
  let now = 0
  const report = await runAndroidLaunchSmoke({
    device: 'emulator-5554',
    apk: absoluteApk,
    runCommand: async (_command: string, args: string[]) => {
      const joined = args.join(' ')
      if (joined.includes('check-android-artifact.mjs')) return { status: 0, stdout: 'Android APK verified\n', stderr: '', signal: null }
      if (joined.includes('get-state')) return { status: 0, stdout: 'device\n', stderr: '', signal: null }
      if (joined.includes('ro.kernel.qemu') || joined.includes('sys.boot_completed')) return { status: 0, stdout: '1\n', stderr: '', signal: null }
      if (joined.includes('pm list packages')) return { status: 0, stdout: '', stderr: '', signal: null }
      if (joined.includes('resolve-activity')) return { status: 0, stdout: 'com.shiaoming123.shixue/.MainActivity\n', stderr: '', signal: null }
      if (joined.includes('install -r -t') || joined.includes('rm -f cache/') || joined.includes('printf %s run-3') || joined.includes('am force-stop') || joined.includes('logcat -c')) {
        return { status: 0, stdout: joined.includes('install') ? 'Success\n' : '', stderr: '', signal: null }
      }
      if (joined.includes('am start -W')) return { status: 0, stdout: 'Status: ok\n', stderr: '', signal: null }
      if (joined.includes('cat cache/')) return { status: 0, stdout: successEvidence, stderr: '', signal: null }
      if (joined.includes('pidof')) return { status: 0, stdout: '4242\n', stderr: '', signal: null }
      if (joined.includes('dumpsys activity activities')) return { status: 0, stdout: 'com.shiaoming123.shixue/.MainActivity\n', stderr: '', signal: null }
      throw new Error(`Unexpected command: ${joined}`)
    },
    runId: 'run-3',
    sleep: async () => { now += 10 },
    now: () => now,
    timeoutMs: 5,
  })

  assert.equal(report.success, false)
  assert.match(report.error ?? '', /Timed out waiting for Android readiness/)
  assert.equal(Object.values(report.phases).some(Boolean), false)
})
