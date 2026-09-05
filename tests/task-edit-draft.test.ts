import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

const { descriptor } = parse(readFileSync(new URL('../src/components/study/TaskEditSheet.vue', import.meta.url), 'utf8'))
const code = ts.transpileModule(compileScript(descriptor, { id: 'edit-draft-test' }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const exported: any = {}
new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : id.endsWith('use-overlay') ? { useModalOverlay: () => ({ layerId: 'test' }) } : {}, exported)
const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
const task = (id = 'one', title = 'Stored title') => ({ id, title, notes: 'Stored notes', topicId: null, plannedOn: '2026-09-05', dueOn: null, reminderAt: null, status: 'planned', priority: 'none', estimateMinutes: 15, acceptanceCriteria: [] })
function mount() {
  const props = Vue.reactive<any>({ open: true, task: task(), topics: [], recurrenceRule: null, plannedAt: null, dueAt: null })
  let state: any
  const app = renderer.createApp({ setup() { state = exported.default.setup(props, { expose() {}, emit() {} }); return () => Vue.h('div') } })
  app.mount({})
  return { props, state, unmount: () => app.unmount() }
}

test('runtime snapshot and reminder-rule refresh cannot overwrite an unsaved task draft', async () => {
  const { props, state, unmount } = mount()
  state.title.value = 'Unsaved title'
  state.notes.value = 'Unsaved notes'
  state.plannedOn.value = '2026-09-10'
  state.priority.value = 'high'
  props.task = task()
  props.reminderRules = [{ id: 'new-rule' }]
  await Vue.nextTick()
  assert.equal(state.title.value, 'Unsaved title')
  assert.equal(state.notes.value, 'Unsaved notes')
  assert.equal(state.plannedOn.value, '2026-09-10')
  assert.equal(state.priority.value, 'high')
  props.recurrenceRule = { cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', end: { kind: 'never' } }
  await Vue.nextTick()
  assert.equal(state.title.value, 'Unsaved title', 'recurrence persistence feedback must only update its own field')
  assert.equal(state.recurrenceRule.value.cadence.kind, 'daily')
  unmount()
})

test('switching task identity and closing then reopening each initialize fresh persisted fields', async () => {
  const { props, state, unmount } = mount()
  state.title.value = 'Do not carry to next task'
  props.task = task('two', 'Second task')
  await Vue.nextTick()
  assert.equal(state.title.value, 'Second task')
  state.title.value = 'Discard on cancel'
  props.open = false
  await Vue.nextTick()
  props.task = task('two', 'Fresh persisted second task')
  await Vue.nextTick()
  props.open = true
  await Vue.nextTick()
  assert.equal(state.title.value, 'Fresh persisted second task')
  assert.equal(state.notes.value, 'Stored notes')
  unmount()
})
