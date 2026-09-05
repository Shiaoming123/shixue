import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (name: string) => readFileSync(new URL(`../src/components/ui/${name}`, import.meta.url), 'utf8')

test('overlay primitives defer teleport resolution until the app-level host is mounted', () => {
  for (const component of ['Dialog.vue', 'Popover.vue', 'ToastRegion.vue']) {
    assert.match(source(component), /<Teleport\b[^>]*\bdefer\b[^>]*\bto="#ui-overlay-host"/)
  }
})
