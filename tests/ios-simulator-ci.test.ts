import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildIosCiEvidence, selectIosSimulator } from '../scripts/ios-simulator-ci.mjs'

test('manual iOS workflow keeps unsigned simulator validation isolated and observable', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ios-simulator.yml', import.meta.url), 'utf8')
  assert.match(workflow, /on:\s*\r?\n\s+workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\b(?:push|pull_request|schedule):/)
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/)
  assert.match(workflow, /runs-on:\s*macos-15\b/)
  assert.doesNotMatch(workflow, /macos[_-]xl|secrets\.|SIGNING|certificate|provision/i)
  assert.match(workflow, /mobile:doctor/)
  assert.match(workflow, /mobile:ios:prepare -- aarch64-sim/)
  assert.match(workflow, /ios build --debug --target aarch64-sim --no-sign --ci/)
  assert.match(workflow, /smoke:ios-launch -- --device "\$\{\{ steps\.simulator\.outputs\.udid \}\}" --app "\$\{\{ steps\.app\.outputs\.path \}\}"/)
  assert.match(workflow, /github\.sha/)
  assert.match(workflow, /if:\s*always\(\)/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  const selectionStep = workflow.match(/- name: Select(?: and boot)? an available iPhone Simulator[\s\S]*?(?=\n\s+- name:)/)?.[0] ?? ''
  assert.ok(selectionStep)
  assert.doesNotMatch(selectionStep, /steps\.simulator\.outputs/, 'a step cannot consume its own outputs')
})

test('selects an available iPhone simulator and returns its explicit UDID', () => {
  const selected = selectIosSimulator({ devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
      { name: 'iPad Pro', udid: 'IPAD-UDID', isAvailable: true, state: 'Shutdown' },
      { name: 'iPhone 16 Pro', udid: 'IPHONE-UDID', isAvailable: true, state: 'Shutdown' },
    ],
  } })
  assert.deepEqual(selected, { name: 'iPhone 16 Pro', udid: 'IPHONE-UDID', runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-5' })
})

test('prefers a booted simulator, otherwise the newest numeric iOS runtime', () => {
  const selected = selectIosSimulator({ devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-9-0': [{ name: 'iPhone Old', udid: 'OLD', isAvailable: true, state: 'Shutdown' }],
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [{ name: 'iPhone New', udid: 'NEW', isAvailable: true, state: 'Shutdown' }],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ name: 'iPhone Booted', udid: 'BOOTED', isAvailable: true, state: 'Booted' }],
  } })
  assert.equal(selected.udid, 'BOOTED')

  const newest = selectIosSimulator({ devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-9-0': [{ name: 'iPhone Old', udid: 'OLD', isAvailable: true, state: 'Shutdown' }],
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [{ name: 'iPhone New', udid: 'NEW', isAvailable: true, state: 'Shutdown' }],
  } })
  assert.equal(newest.udid, 'NEW')
})

test('machine evidence binds the successful smoke to current SHA and preserves unverified boundaries', () => {
  const evidence = buildIosCiEvidence({
    sourceSha: 'a'.repeat(40),
    simulator: { name: 'iPhone 16 Pro', udid: 'IPHONE-UDID', runtime: 'iOS-18-5' },
    appPath: '/tmp/Shixue.app',
    launchReport: { success: true, device: 'IPHONE-UDID', app: '/tmp/Shixue.app', phases: { nativeHostReady: true, webviewCreated: true, vueMounted: true, workspaceReady: true, frontendReady: true } },
  })
  assert.equal(evidence.sourceSha, 'a'.repeat(40))
  assert.equal(evidence.simulator.udid, 'IPHONE-UDID')
  assert.equal(evidence.appPath, '/tmp/Shixue.app')
  assert.deepEqual(evidence.boundaries, { nativeBuild: 'pass', simulatorLaunch: 'pass', persistenceRestart: 'not-run', device: 'not-run', signing: 'not-run', distribution: 'not-run' })
})
