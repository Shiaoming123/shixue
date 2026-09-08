import assert from 'node:assert/strict'
import test from 'node:test'
import { runAndroidLearningLoop } from '../scripts/smoke-android-learning-loop.mjs'

const launch = { schemaVersion: 1, success: true, runId: 'run-one', device: 'emulator-5554', packageId: 'com.shiaoming123.shixue', activity: 'com.shiaoming123.shixue/.MainActivity', apk: 'D:/build/app.apk' }
function harness(overrides = {}) {
  const calls: string[] = []
  const device = {
    serial: () => launch.device,
    shell: async (command: string) => { calls.push(command); return Buffer.from(command.includes('ro.kernel.qemu') ? '1' : command.includes('run-id') ? launch.runId : '') },
    close: async () => {},
  }
  return { calls, options: { device: launch.device, launch, android: { devices: async () => [device] }, exercise: async () => ({ recordId: 'record:one', reviewTitle: '复习 · one' }), ...overrides } }
}

test('binds UI evidence to the exact emulator, package and native launch run', async () => {
  const { options, calls } = harness()
  const report = await runAndroidLearningLoop(options)
  assert.equal(report.success, true)
  assert.equal(report.launchRunId, launch.runId)
  assert.equal(report.packageId, launch.packageId)
  assert.equal(report.apk, launch.apk)
  assert.match(calls.join('\n'), /run-as com\.shiaoming123\.shixue cat cache\/shixue-android-smoke-run-id/)
})

test('rejects mismatched report, missing serial, physical device and stale native run before UI writes', async () => {
  for (const override of [
    { launch: { ...launch, success: false } },
    { launch: { ...launch, packageId: 'other.package' } },
    { launch: { ...launch, device: 'emulator-5556' } },
    { android: { devices: async () => [] } },
    { android: { devices: async () => [{ serial: () => launch.device, shell: async () => Buffer.from('0'), close: async () => {} }] } },
    { android: { devices: async () => [{ serial: () => launch.device, shell: async () => Buffer.from('1'), close: async () => {} }] } },
  ]) {
    let exercised = false
    const { options } = harness({ ...override, exercise: async () => { exercised = true } })
    assert.equal((await runAndroidLearningLoop(options)).success, false)
    assert.equal(exercised, false)
  }
})

test('a missing UI selector cannot produce successful native evidence', async () => {
  const { options } = harness({ exercise: async () => { throw new Error('学习任务 button timed out') } })
  const report = await runAndroidLearningLoop(options)
  assert.equal(report.success, false)
  assert.match(report.error, /学习任务 button timed out/)
})

test('errors already buffered while attaching fail before any UI action', async () => {
  for (const bufferedKind of ['console', 'pageerror']) {
    const { options } = harness({ exercise: undefined })
    const [device] = await options.android.devices()
    let uiActions = 0
    const page = {
      setDefaultTimeout: () => {},
      on: () => {},
      consoleMessages: async () => bufferedKind === 'console' ? [{ type: () => 'error', text: () => 'buffered console failure' }] : [],
      pageErrors: async () => bufferedKind === 'pageerror' ? [new Error('buffered page failure')] : [],
      locator: () => ({ waitFor: async () => {} }),
      getByRole: () => { uiActions++; throw new Error('UI must not run') },
    }
    options.android.devices = async () => [{ ...device, webView: async () => ({ page: async () => page }) }]
    const report = await runAndroidLearningLoop(options)
    assert.equal(report.success, false)
    assert.match(report.error, /buffered (console|page) failure/)
    assert.equal(uiActions, 0)
    assert.match(report.errorCoverage, /not guaranteed before attachment/)
  }
})
