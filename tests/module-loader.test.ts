import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { App } from 'vue'
import { moduleContracts, type ModuleId } from '../src/modules/contract.ts'
import { moduleRegistry, type ModuleConfig } from '../src/modules/config.ts'
import { mountModules } from '../src/modules/loader.ts'
import { createShortcutModule } from '../src/modules/shortcut/index.ts'

const webRuntime = {
  platform: 'web' as const,
  capabilities: ['web-storage'] as const,
}

const desktopRuntime = {
  platform: 'desktop' as const,
  capabilities: ['system-tray', 'global-shortcut'] as const,
}

test('module failure still mounts the Vue shell after storage selection', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(source, /mountModules\(app\)[\s\S]*\.catch\([\s\S]*\.finally\(/)
  assert.match(source, /\.finally\(\(\) => \{[\s\S]*app\.mount\("#app"\)/)
})

function testModule(id: ModuleId): Module {
  const contract = moduleContracts[id]
  return {
    id: contract.id,
    name: contract.name,
    dependencies: [...contract.dependencies],
    platforms: contract.platforms ? [...contract.platforms] : undefined,
    requiredCapabilities: contract.requiredCapabilities
      ? [...contract.requiredCapabilities]
      : undefined,
  }
}

test('Web never invokes native-only module loaders', async () => {
  const originalRegistry = { ...moduleRegistry }
  const loaded: string[] = []
  const moduleKeys = Object.keys(moduleRegistry) as (keyof ModuleConfig)[]

  try {
    for (const key of moduleKeys) {
      moduleRegistry[key] = async () => {
        loaded.push(key)
        return { default: testModule(key) }
      }
    }

    await mountModules({} as App, undefined, webRuntime)
  } finally {
    Object.assign(moduleRegistry, originalRegistry)
  }

  assert.equal(loaded.includes('tray'), false)
  assert.equal(loaded.includes('shortcut'), false)
  assert.equal(loaded.includes('notification'), false)
})

test('loader rejects a dynamic module that differs from its static contract', async () => {
  const originalRegistry = { ...moduleRegistry }
  const moduleKeys = Object.keys(moduleRegistry) as (keyof ModuleConfig)[]

  try {
    for (const key of moduleKeys) {
      moduleRegistry[key] = async () => ({ default: testModule(key) })
    }
    moduleRegistry.core = async () => ({
      default: { ...testModule('core'), id: 'wrong-core' },
    })

    await assert.rejects(
      mountModules({} as App, undefined, webRuntime),
      /does not match its compatibility contract/,
    )
  } finally {
    Object.assign(moduleRegistry, originalRegistry)
  }
})

test('loader surfaces native shortcut registration failures after its tray bridge dependency', async () => {
  const loaded: string[] = []
  const config = Object.fromEntries(
    Object.keys(moduleRegistry).map((id) => [id, ['core', 'storage', 'tray', 'shortcut'].includes(id)]),
  ) as unknown as ModuleConfig
  const registry = { ...moduleRegistry }
  registry.core = async () => ({ default: { ...testModule('core'), setup: () => { loaded.push('core') } } })
  registry.storage = async () => ({ default: { ...testModule('storage'), setup: () => { loaded.push('storage') } } })
  registry.tray = async () => ({ default: { ...testModule('tray'), setup: () => { loaded.push('tray') } } })
  registry.shortcut = async () => ({
    default: createShortcutModule(async () => ({
      setEnabled: async () => {
        loaded.push('shortcut')
        throw new Error('shortcut conflict')
      },
    })),
  })

  await assert.rejects(
    mountModules({} as App, config, desktopRuntime, registry),
    /shortcut conflict/,
  )
  assert.deepEqual(loaded, ['core', 'storage', 'tray', 'shortcut'])
})
