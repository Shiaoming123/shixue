import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { RuntimeInfo } from '../src/lib/platform.ts'

const platformModule = await import('../src/lib/platform.ts') as {
  runtimeInfoForNativePlatform?: (platform: string) => RuntimeInfo
}

const capabilities = JSON.parse(
  readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
) as Array<{ identifier: string; permissions: string[]; platforms?: string[] }>

const autostartCapability = JSON.parse(
  readFileSync(new URL('../src-tauri/capabilities/autostart.json', import.meta.url), 'utf8'),
) as { identifier: string; permissions: string[]; platforms?: string[] }

test('keeps updater permission desktop-only while mobile retains its core capability', () => {
  const defaultCapability = capabilities.find(({ identifier }) => identifier === 'default')
  const updaterCapability = capabilities.find(({ identifier }) => identifier === 'updater-desktop')
  const shortcutCapability = capabilities.find(({ identifier }) => identifier === 'shortcut-desktop')

  assert.ok(defaultCapability)
  assert.equal(defaultCapability.permissions.includes('updater:default'), false)
  assert.equal(defaultCapability.permissions.includes('global-shortcut:allow-register'), false)
  assert.equal(defaultCapability.permissions.includes('autostart:default'), false)
  assert.deepEqual(updaterCapability?.platforms, ['linux', 'macOS', 'windows'])
  assert.deepEqual(updaterCapability?.permissions, ['updater:default'])
  assert.equal(shortcutCapability, undefined)
  assert.deepEqual(autostartCapability?.platforms, ['linux', 'macOS', 'windows'])
  assert.deepEqual(autostartCapability?.permissions, ['autostart:default'])
})

test('desktop runtime keeps optional clipboard routing available without reopening shortcut permissions', () => {
  const runtime = platformModule.runtimeInfoForNativePlatform?.('windows')

  assert.equal(runtime?.capabilities.includes('native-clipboard'), true)
  assert.equal(
    capabilities.some(({ permissions }) => permissions.some((permission) => permission.startsWith('global-shortcut:'))),
    false,
  )
})

test('iOS runtime exposes only capabilities compiled and authorized for the mobile target', () => {
  assert.deepEqual(platformModule.runtimeInfoForNativePlatform?.('ios'), {
    platform: 'mobile',
    capabilities: ['native-sql', 'native-notification'],
  })
})

test('native runtime platform is exposed to the WebView before module routing', () => {
  const entry = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')

  assert.match(entry, /fn runtime_platform\(\)/)
  assert.match(entry, /generate_handler!\[\s*greet,\s*runtime_platform,\s*report_native_smoke_phase,\s*read_legacy_reminder_deliveries,\s*set_quick_add_shortcut\s*\]/)
})

test('keeps shared Tauri defaults disabled and restores the mobile wry runtime', () => {
  const manifest = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
  const desktopDependencies = manifest.slice(manifest.indexOf('[target.'))

  assert.match(
    manifest,
    /tauri = \{ version = "2", default-features = false, features = \["image-png"\] \}/,
  )
  assert.match(
    manifest,
    /\[target\.'cfg\(any\(target_os = "android", target_os = "ios"\)\)'\.dependencies\]\s+tauri = \{ version = "2", features = \["wry"\] \}/,
  )
  assert.match(desktopDependencies, /tauri-plugin-autostart = \{ version = "2", optional = true \}/)
})

test('excludes optional autostart permissions when the Cargo feature is disabled', () => {
  const buildScript = readFileSync(new URL('../src-tauri/build.rs', import.meta.url), 'utf8')

  assert.match(buildScript, /!cfg!\(feature = "autostart"\)/)
  assert.match(buildScript, /attributes\.plugin\(\s*"autostart"/)
  assert.match(buildScript, /!cfg!\(feature = "notification"\)/)
  assert.match(buildScript, /attributes\.plugin\(\s*"notification"/)
})
