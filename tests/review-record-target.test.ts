import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

test('a repeated global-search target always switches Review to records and expands the exact id', async () => {
  const source = readFileSync(new URL('../src/components/study/ReviewView.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const code = ts.transpileModule(compileScript(descriptor, { id: 'review-record-target' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : {}, exported)
  const props = Vue.reactive<any>({
    item: undefined, remaining: 0, revealed: false, weeklyCompleted: 0, weeklyMinutes: 0,
    weeklyHighlight: '', weeklyBlocker: '', weeklyNext: '', records: [], topics: [], initialMode: 'review',
    recordTarget: { id: 'record:exact', requestId: 1 },
  })
  let state: any
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const app = renderer.createApp({ setup() { state = exported.default.setup(props, { expose() {}, emit() {} }); return () => Vue.h('div') } })
  app.mount({})
  await Vue.nextTick()
  assert.equal(state.mode.value, 'records')
  assert.equal(state.selectedRecordId.value, 'record:exact')
  state.mode.value = 'review'
  state.selectedRecordId.value = ''
  props.recordTarget = { id: 'record:exact', requestId: 2 }
  await Vue.nextTick()
  assert.equal(state.mode.value, 'records')
  assert.equal(state.selectedRecordId.value, 'record:exact')
  app.unmount()
})

test('App resets Review on navigation before assigning a new search target', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /function setDestination\([^)]*\)[^{]*\{\s*recordTarget\.value = undefined\s*reviewMode\.value = 'review'/)
  assert.match(app, /function openSearchRecord[\s\S]*setDestination\(\{ kind: 'learning', section: 'review' \}\)\s*reviewMode\.value = 'records'\s*recordTarget\.value =/)
})
