import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const { runAndroidPersistenceSmoke } = await import('../scripts/smoke-android-persistence.mjs') as {
  runAndroidPersistenceSmoke: (options: Record<string, unknown>) => Promise<{
    success: boolean
    firstPid?: string
    secondPid?: string
    terminatedBetweenLaunches: boolean
    stages: { writeConfirmed: boolean; restartConfirmed: boolean }
    error?: string
    commands: Array<{ command: string; args: string[] }>
  }>
}

const launchReportPath = resolve('src-tauri', 'target', 'android-launch', 'ci.json')
const launchReport = {
  schemaVersion: 1,
  success: true,
  device: 'emulator-5554',
  packageId: 'com.shiaoming123.shixue',
  activity: 'com.shiaoming123.shixue/.MainActivity',
  apk: resolve('artifacts', 'app-x86_64-debug.apk'),
}

function evidence(runId: string, stage: 'write-confirmed' | 'restart-confirmed', revision: number) {
  return JSON.stringify({
    schemaVersion: 1,
    runId,
    stage,
    taskId: `task:android-persistence:${runId}`,
    title: `Android persistence smoke ${runId}`,
    workspaceRevision: revision,
  })
}

test('Android persistence smoke binds the passed launch evidence and proves write, process death, and restart read-back', async () => {
  const calls: Array<{ command: string; args: string[] }> = []
  let starts = 0
  let stops = 0
  const runCommand = async (command: string, args: string[]) => {
    calls.push({ command, args })
    const joined = args.join(' ')
    if (joined.includes('get-state')) return result('device\n')
    if (joined.includes('ro.kernel.qemu')) return result('1\n')
    if (joined.includes('pm list packages')) return result('package:com.shiaoming123.shixue\n')
    if (joined.includes('resolve-activity')) return result('com.shiaoming123.shixue/.MainActivity\n')
    if (joined.includes('rm -f cache/')) return result('')
    if (joined.includes('base64 -d')) return result('')
    if (joined.includes('logcat -c')) return result('')
    if (joined.includes('am force-stop')) { stops += 1; return result('') }
    if (joined.includes('am start -W')) { starts += 1; return result('Status: ok\n') }
    if (joined.includes('cat cache/shixue-android-persistence-smoke.jsonl')) {
      const lines = [evidence('run-1', 'write-confirmed', 2)]
      if (starts >= 2) lines.push(evidence('run-1', 'restart-confirmed', 2))
      return result(`${lines.join('\n')}\n`)
    }
    if (joined.includes('pidof')) {
      if (stops >= 2 && starts === 1) return { ...result(''), status: 1 }
      return result(starts >= 2 ? '5252\n' : '4242\n')
    }
    if (joined.includes('dumpsys activity activities')) return result('com.shiaoming123.shixue/.MainActivity\n')
    if (joined.includes('logcat -d')) return result('')
    throw new Error(`Unexpected command: ${command} ${joined}`)
  }

  const report = await runAndroidPersistenceSmoke({
    device: 'emulator-5554',
    launchReport: launchReportPath,
    readLaunchReport: async () => launchReport,
    runCommand,
    runId: 'run-1',
    sleep: async () => undefined,
    stableAliveMs: 0,
  })

  assert.equal(report.success, true)
  assert.equal(report.firstPid, '4242')
  assert.equal(report.secondPid, '5252')
  assert.equal(report.terminatedBetweenLaunches, true)
  assert.deepEqual(report.stages, { writeConfirmed: true, restartConfirmed: true })
  assert.equal(calls.filter(({ args }) => args.join(' ').includes('am start -W')).length, 2)
  assert.ok(calls.some(({ args }) => args.join(' ').includes('base64 -d')))
})

test('Android persistence smoke rejects a launch report for another device before invoking adb', async () => {
  let invoked = false
  const report = await runAndroidPersistenceSmoke({
    device: 'emulator-5554',
    launchReport: launchReportPath,
    readLaunchReport: async () => ({ ...launchReport, device: 'emulator-5556' }),
    runCommand: async () => { invoked = true; return result('') },
    runId: 'run-2',
  })

  assert.equal(report.success, false)
  assert.match(report.error ?? '', /launch report does not match/)
  assert.equal(invoked, false)
})

test('Android persistence smoke does not accept evidence from another run id', async () => {
  let now = 0
  let starts = 0
  const report = await runAndroidPersistenceSmoke({
    device: 'emulator-5554',
    launchReport: launchReportPath,
    readLaunchReport: async () => launchReport,
    runCommand: async (_command: string, args: string[]) => {
      const joined = args.join(' ')
      if (joined.includes('get-state')) return result('device\n')
      if (joined.includes('ro.kernel.qemu')) return result('1\n')
      if (joined.includes('pm list packages')) return result('package:com.shiaoming123.shixue\n')
      if (joined.includes('resolve-activity')) return result('com.shiaoming123.shixue/.MainActivity\n')
      if (joined.includes('rm -f cache/') || joined.includes('base64 -d') || joined.includes('logcat -c') || joined.includes('am force-stop')) return result('')
      if (joined.includes('am start -W')) { starts += 1; return result('Status: ok\n') }
      if (joined.includes('cat cache/')) return result(`${evidence('old-run', 'write-confirmed', 2)}\n`)
      if (joined.includes('pidof')) return result(starts ? '4242\n' : '')
      if (joined.includes('dumpsys activity activities')) return result('com.shiaoming123.shixue/.MainActivity\n')
      if (joined.includes('logcat -d')) return result('')
      throw new Error(`Unexpected command: ${joined}`)
    },
    runId: 'run-3',
    sleep: async () => { now += 10 },
    now: () => now,
    timeoutMs: 5,
  })

  assert.equal(report.success, false)
  assert.match(report.error ?? '', /write-confirmed/)
  assert.equal(report.stages.writeConfirmed, false)
})

function result(stdout: string) {
  return { status: 0, stdout, stderr: '', signal: null }
}

test('Android CI runs restart persistence after launch evidence and uploads both reports', () => {
  const workflow = readFileSync(new URL('../.github/workflows/android-debug.yml', import.meta.url), 'utf8')
  const launchIndex = workflow.indexOf('npm run smoke:android-launch')
  const persistenceIndex = workflow.indexOf('npm run smoke:android-persistence')

  assert.ok(launchIndex >= 0)
  assert.ok(persistenceIndex > launchIndex)
  assert.match(workflow, /--launch-report "\$GITHUB_WORKSPACE\/src-tauri\/target\/android-launch\/ci\.json"/)
  assert.match(workflow, /src-tauri\/target\/android-persistence\//)
})
