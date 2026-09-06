import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('shortcut frontend module is declarative because native setup cannot block the Vue shell', async () => {
  const module = await import('../src/modules/shortcut/index.ts')
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

  assert.equal(module.default.id, 'shortcut')
  assert.equal(module.default.setup, undefined)
  assert.equal(module.default.teardown, undefined)
  assert.match(main, /\.catch\([\s\S]*\.finally\(\(\) => \{[\s\S]*app\.mount\("#app"\)/)
})
