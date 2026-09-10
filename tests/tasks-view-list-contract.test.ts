import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/study/TasksView.vue', import.meta.url), 'utf8')
const occurrenceSource = readFileSync(new URL('../src/components/study/OccurrenceRow.vue', import.meta.url), 'utf8')
const template = source.slice(source.indexOf('<template>', source.indexOf('</script>')), source.indexOf('<style scoped>'))
const style = source.split('<style scoped>')[1]!.split('</style>')[0]!
const occurrenceStyle = occurrenceSource.split('<style scoped>')[1]!.split('</style>')[0]!

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(style)?.[1] ?? ''
}

function occurrenceRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(occurrenceStyle)?.[1] ?? ''
}

function mountBatchLogic() {
  const { descriptor } = parse(source)
  const code = ts.transpileModule(compileScript(descriptor, { id: 'tasks-view-batch' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue
    if (id.includes('quick-add-shortcut-state')) return { isQuickAddEditableTarget: () => false }
    if (id.includes('use-overlay')) return { hasActiveOverlay: () => false }
    return {}
  }, exported)
  const props = Vue.reactive({
    tasks: [{ id: 'one' }, { id: 'two' }], occurrences: [], topics: [], title: '任务', subtitle: '2 项',
    smartView: 'all', search: '', topicFilter: 'all', priorityFilter: 'all', sort: 'manual', quickAddDestinationListId: 'inbox',
  })
  const events: any[][] = []
  let state: any
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const originalWindow = (globalThis as any).window
  ;(globalThis as any).window = { addEventListener() {}, removeEventListener() {} }
  const app = renderer.createApp({ setup() { state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => events.push(args) }); return () => Vue.h('div') } })
  app.mount({})
  return { state, events, unmount() { app.unmount(); (globalThis as any).window = originalWindow } }
}

test('task groups render as flat sections separated by rows', () => {
  const section = rule('.task-section')
  assert.match(section, /padding:\s*0/)
  assert.match(section, /border:\s*0/)
  assert.match(section, /border-radius:\s*0/)
  assert.match(section, /background:\s*transparent/)
  assert.match(section, /box-shadow:\s*none/)
  assert.match(rule('.task-list'), /border-top:\s*1px solid var\(--hairline\)/)
  assert.match(style, /\.task-list :deep\(\.occurrence-row\)\s*\{[^}]*border-radius:\s*0[^}]*box-shadow:\s*none/)
})

test('batch mode explains selection and exposes its complete lifecycle', () => {
  assert.match(template, /已选择\s*\{\{\s*selectedIds\.length\s*\}\}\s*项/)
  assert.match(template, /allTasksSelected\s*\?\s*'取消全选'\s*:\s*'全选'/)
  assert.match(template, />退出多选<\/button>/)
  assert.match(source, /const allTasksSelected = computed\(/)
  assert.match(source, /function toggleAllTasks\(\)/)
  assert.match(source, /function exitBatchMode\(\)/)
  assert.match(source, /function requestBatchDelete\(\)/)
  assert.equal(template.match(/:disabled="!selectedIds\.length"/g)?.length, 3)
  for (const action of ['complete', 'today', 'delete']) assert.match(source, new RegExp(`finishBatch\\('${action}'\\)`))
})

test('batch selection, actions and delete confirmation preserve their behavior', () => {
  const h = mountBatchLogic()
  try {
    assert.equal(h.state.allTasksSelected.value, false)
    h.state.toggleAllTasks()
    assert.deepEqual(h.state.selectedIds.value, ['one', 'two'])
    assert.equal(h.state.allTasksSelected.value, true)
    h.state.toggleAllTasks()
    assert.deepEqual(h.state.selectedIds.value, [])

    h.state.toggleSelection('one')
    h.state.finishBatch('complete')
    assert.deepEqual(h.events.pop(), ['bulkComplete', ['one']])
    assert.deepEqual(h.state.selectedIds.value, [])

    h.state.toggleSelection('two')
    h.state.finishBatch('today')
    assert.deepEqual(h.events.pop(), ['bulkMoveToToday', ['two']])

    h.state.batchMode.value = true
    h.state.toggleAllTasks()
    h.state.requestBatchDelete()
    assert.deepEqual(h.state.confirmDeleteIds.value, ['one', 'two'])
    assert.equal(h.events.some(([name]) => name === 'bulkDelete'), false)
    h.state.finishBatch('delete')
    assert.deepEqual(h.events.pop(), ['bulkDelete', ['one', 'two']])
    assert.equal(h.state.batchMode.value, false)
    assert.deepEqual(h.state.confirmDeleteIds.value, [])

    h.state.batchMode.value = true
    h.state.toggleSelection('one')
    h.state.requestBatchDelete()
    h.state.exitBatchMode()
    assert.equal(h.state.batchMode.value, false)
    assert.deepEqual(h.state.selectedIds.value, [])
    assert.deepEqual(h.state.confirmDeleteIds.value, [])
  } finally { h.unmount() }
})

test('task copy clips before fixed priority and disclosure columns', () => {
  assert.match(rule('.task-main'), /grid-template-columns:\s*minmax\(0, 1fr\) 22px 20px/)
  assert.match(rule('.task-main'), /overflow:\s*hidden/)
  assert.match(rule('.task-copy'), /overflow:\s*hidden/)
  assert.match(rule('.task-copy small span'), /min-width:\s*0/)
  assert.match(rule('.task-copy small span'), /text-overflow:\s*ellipsis/)
  assert.match(style, /\.priority, \.chevron\s*\{[^}]*justify-self:\s*center/)

  assert.match(template, /<TransitionGroup name="task-list"/)
  assert.match(style, /\.task-list-move, \.task-list-enter-active, \.task-list-leave-active/)
  const mobileStyle = style.slice(style.indexOf('@media (max-width: 819px)'), style.indexOf('\n.task-list'))
  assert.match(mobileStyle, /\.batch-bar\s*\{[^}]*flex-wrap:\s*wrap/)
  assert.match(mobileStyle, /\.batch-bar > div\s*\{[^}]*width:\s*100%/)
})

test('occurrence copy clips before fixed action columns', () => {
  assert.match(occurrenceRule('.occurrence-main'), /min-width:\s*0/)
  assert.match(occurrenceRule('.occurrence-copy'), /display:\s*(?:block|grid)/)
  assert.match(occurrenceRule('.occurrence-copy'), /min-width:\s*0/)
  assert.match(occurrenceRule('.occurrence-copy'), /overflow:\s*hidden/)
  assert.match(occurrenceRule('.occurrence-row strong'), /text-overflow:\s*ellipsis/)
  assert.match(occurrenceRule('.occurrence-row small'), /text-overflow:\s*ellipsis/)
  assert.match(occurrenceRule('.actions'), /flex:\s*0 0 auto/)
})
