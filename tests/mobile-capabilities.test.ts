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

test('keeps updater permission desktop-only while mobile retains its core capability', () => {
  const defaultCapability = capabilities.find(({ identifier }) => identifier === 'default')
  const updaterCapability = capabilities.find(({ identifier }) => identifier === 'updater-desktop')
  const shortcutCapability = capabilities.find(({ identifier }) => identifier === 'shortcut-desktop')

  assert.ok(defaultCapability)
  assert.equal(defaultCapability.permissions.includes('updater:default'), false)
  assert.equal(defaultCapability.permissions.includes('global-shortcut:allow-register'), false)
  assert.deepEqual(updaterCapability?.platforms, ['linux', 'macOS', 'windows'])
  assert.deepEqual(updaterCapability?.permissions, ['updater:default'])
  assert.deepEqual(shortcutCapability?.platforms, ['linux', 'macOS', 'windows'])
  assert.deepEqual(shortcutCapability?.permissions, [
    'global-shortcut:allow-register',
    'global-shortcut:allow-unregister',
  ])
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
  assert.match(entry, /generate_handler!\[greet, runtime_platform\]/)
})

test('does not enable Tauri desktop defaults for the shared mobile dependency', () => {
  const manifest = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
  const desktopDependencies = manifest.slice(manifest.indexOf('[target.'))

  assert.match(
    manifest,
    /tauri = \{ version = "2", default-features = false, features = \["image-png"\] \}/,
  )
  assert.match(desktopDependencies, /tauri-plugin-autostart = \{ version = "2", optional = true \}/)
})
