import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { sortModules } from '../src/modules/topology.ts'
import { createShortcutModule } from '../src/modules/shortcut/index.ts'

test('shortcut setup controls native registration without exposing the plugin callback channel', async () => {
  const module = await import('../src/modules/shortcut/index.ts')
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

  assert.equal(module.default.id, 'shortcut')
  assert.deepEqual(module.default.dependencies, ['tray'])
  assert.throws(
    () => sortModules([module.default]),
    /Module "shortcut" requires disabled or missing module "tray"/,
  )
  assert.match(main, /\.catch\([\s\S]*\.finally\(\(\) => \{[\s\S]*app\.mount\("#app"\)/)

  const transitions: boolean[] = []
  const configured = createShortcutModule(async () => ({
    setEnabled: async (enabled) => { transitions.push(enabled) },
  }))
  await configured.setup?.({} as never)
  await configured.teardown?.({} as never)
  assert.deepEqual(transitions, [true, false])
})

test('shortcut registration failure reaches the module loader error boundary', async () => {
  const module = createShortcutModule(async () => ({
    setEnabled: async () => { throw new Error('shortcut conflict') },
  }))
  await assert.rejects(module.setup?.({} as never), /shortcut conflict/)
})
