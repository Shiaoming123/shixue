import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { normalizeQuickAddTime } from '../src/domain/quick-add/time.ts'

// Execute the actual SFC setup, replacing only rendering dependencies; no browser or generated source files.
const path = new URL('../src/components/ui/DateTimePicker.vue', import.meta.url)
const { descriptor } = parse(readFileSync(path, 'utf8'))
const script = compileScript(descriptor, { id: 'date-time-test' }).content
const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const exported: { default?: { setup: Function } } = {}
new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : id.endsWith('/time') ? { normalizeQuickAddTime } : {}, exported)

test('datetime apply rejects invalid and empty drafts without changing reminder value', async () => {
  const writes: unknown[][] = []
  const props = Vue.reactive({ modelValue: '2026-09-05T10:30', mode: 'datetime', disabled: false, label: '提醒' })
  const component = exported.default!
  let state: any
  const renderer = Vue.createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {},
  })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit: (...args: unknown[]) => writes.push(args) })
    return () => Vue.h('div')
  } })
  app.mount({})
  await state.setOpen(true)
  for (const invalid of ['abc', '99:99', '24:00', '09:60', '']) {
    state.draftTime.value = invalid
    state.normalizeTime()
    state.applyDateTime()
    assert.equal(state.draftTime.value, invalid, 'an error must preserve what the user typed')
    assert.notEqual(state.timeError.value, '')
    assert.equal(writes.length, 0, 'invalid drafts must never update the reminder')
    assert.equal(state.open.value, true)
  }
  state.draftTime.value = '9:00'
  state.applyDateTime()
  assert.deepEqual(writes, [['update:modelValue', '2026-09-05T09:00']])
  assert.equal(state.open.value, false)
  await state.setOpen(true)
  state.draftTime.value = '18:00'
  state.close()
  assert.equal(writes.length, 1, 'cancel must discard the edited time')
  app.unmount()
})
