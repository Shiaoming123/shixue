import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

const sourceUrl = new URL('../src/components/study/TagManagerSheet.vue', import.meta.url)

function mount() {
  const { descriptor } = parse(readFileSync(sourceUrl, 'utf8'))
  const code = ts.transpileModule(compileScript(descriptor, { id: 'tag-manager' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : {}, exported)
  const props = Vue.reactive<any>({
    open: true, busy: false, error: '',
    tags: [
      { id: 'tag:second', title: 'Second', position: 2, archivedAt: null },
      { id: 'tag:first', title: 'First', position: 1, archivedAt: null },
      { id: 'tag:old', title: 'Old', position: 0, archivedAt: '2026-09-01T00:00:00.000Z' },
    ],
  })
  const events: any[][] = []
  let state: any
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const app = renderer.createApp({ setup() { state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => events.push(args) }); return () => Vue.h('div') } })
  app.mount({})
  return { props, state, events, unmount: () => app.unmount() }
}

test('tag manager keeps create and rename text local until a valid command is emitted', () => {
  const { props, state, events, unmount } = mount()
  assert.deepEqual(state.activeTags.value.map(({ id }: any) => id), ['tag:first', 'tag:second'])
  assert.deepEqual(state.archivedTags.value.map(({ id }: any) => id), ['tag:old'])

  state.createTitle.value = '  Protocol  '
  state.submitCreate()
  assert.deepEqual(events, [['create', 'Protocol']])
  assert.equal(state.createTitle.value, '  Protocol  ', 'a parent failure leaves the submitted title available for retry')
  state.created()
  assert.equal(state.createTitle.value, '')

  state.beginRename(props.tags[1])
  state.submitRename(props.tags[1])
  assert.equal(events.length, 1, 'unchanged names are not emitted')
  state.editingTitle.value = 'Foundation'
  state.submitRename(props.tags[1])
  assert.deepEqual(events[1], ['rename', 'tag:first', 'Foundation'])
  state.renamed()
  assert.equal(state.editingId.value, '')
  unmount()
})

test('tag manager exposes themed reversible archive and responsive touch targets', () => {
  const source = readFileSync(sourceUrl, 'utf8')
  assert.match(source, /<Sheet\b[^>]*label="管理标签"/)
  assert.match(source, /@click="emit\('archive', tag\.id\)"/)
  assert.match(source, /归档后历史关联仍会保留/)
  assert.match(source, /@media \(max-width: 819px\)/)
  assert.match(source, /\.icon-button \{ width: 44px; height: 44px; \}/)
})
