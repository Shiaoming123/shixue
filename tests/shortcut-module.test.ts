import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { sortModules } from '../src/modules/topology.ts'

test('shortcut frontend module is declarative because native setup cannot block the Vue shell', async () => {
  const module = await import('../src/modules/shortcut/index.ts')
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

  assert.equal(module.default.id, 'shortcut')
  assert.deepEqual(module.default.dependencies, ['tray'])
  assert.equal(module.default.setup, undefined)
  assert.equal(module.default.teardown, undefined)
  assert.throws(
    () => sortModules([module.default]),
    /Module "shortcut" requires disabled or missing module "tray"/,
  )
  assert.match(main, /\.catch\([\s\S]*\.finally\(\(\) => \{[\s\S]*app\.mount\("#app"\)/)
})
