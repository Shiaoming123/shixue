import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { openSettingsWindow } from '../src/lib/settings-window.ts'

test('desktop settings window is singleton, resizable, and focuses an existing window', async () => {
  const calls: string[] = []
  const existing = { show: async () => { calls.push('show') }, setFocus: async () => { calls.push('focus') } }
  assert.equal(await openSettingsWindow(async () => ({ getByLabel: async () => existing, create: () => { throw Error('must not create') } })), 'focused')
  assert.deepEqual(calls, ['show', 'focus'])

  let options: Record<string, unknown> = {}
  assert.equal(await openSettingsWindow(async () => ({ getByLabel: async () => null, create: (_label, value) => (options = value, existing) })), 'created')
  assert.deepEqual({ width: options.width, height: options.height, minWidth: options.minWidth, minHeight: options.minHeight, resizable: options.resizable }, { width: 960, height: 680, minWidth: 760, minHeight: 560, resizable: true })
})

test('settings content uses one category rail and one bounded content column', () => {
  const settings = readFileSync(new URL('../src/components/study/SettingsView.vue', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(settings, /class="settings-navigation"/)
  assert.match(settings, /grid-template-columns:\s*224px minmax\(0, 1fr\)/)
  assert.match(settings, /\.settings-content \{[^}]*width:\s*min\(100%, 820px\)/)
  assert.match(settings, /\.settings-section \{[^}]*border:\s*1px solid var\(--hairline\)[^}]*border-radius:\s*var\(--radius-lg\)/)
  assert.doesNotMatch(settings, /\.settings-section \{[^}]*box-shadow/)
  assert.match(app, /@navigate="navigateShell"/)
  assert.match(app, /!settingsWindow/)
  const capabilities = readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8')
  assert.match(capabilities, /"windows": \["main", "settings"\]/)
  assert.match(capabilities, /core:webview:allow-create-webview-window/)
})
