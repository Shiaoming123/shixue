import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

const sourceUrl = new URL('../src/components/study/GlobalSearchDialog.vue', import.meta.url)

function mountDialog() {
  const { descriptor } = parse(readFileSync(sourceUrl, 'utf8'))
  const code = ts.transpileModule(compileScript(descriptor, { id: 'global-search-dialog' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const calls: any[][] = []
  const searchWorkspace = (...args: any[]) => {
    calls.push(args)
    return { tasks: [], completionRecords: [] }
  }
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue
    if (id.endsWith('/workspace-search.ts')) return { searchWorkspace }
    return {}
  }, exported)
  const workspace = {
    lists: [
      { id: 'list:system:learning', title: '学习', position: 0, archivedAt: null },
      { id: 'topic:one', title: 'Agent 基础', position: 1, archivedAt: null },
    ],
    tags: [
      { id: 'tag:reading', title: '阅读', position: 0, archivedAt: null },
      { id: 'tag:output', title: '输出', position: 1, archivedAt: null },
      { id: 'tag:old', title: '旧标签', position: 2, archivedAt: '2026-09-01T00:00:00.000Z' },
    ],
    tasks: [], completionRecords: [],
  }
  const props = Vue.reactive<any>({ open: false, workspace, timezone: 'Asia/Shanghai' })
  const events: any[][] = []
  let state: any
  const renderer = Vue.createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {},
    setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {},
  })
  const app = renderer.createApp({ setup() {
    state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => events.push(args) })
    return () => Vue.h('div')
  } })
  app.mount({})
  return { props, state, calls, events, unmount: () => app.unmount() }
}

test('global search composes one canonical query and keeps tag selection as an AND facet', () => {
  const { state, calls, unmount } = mountDialog()
  state.text.value = '  checkpoint  '
  state.kind.value = 'task'
  state.topic.value = 'id:topic:one'
  state.status.value = 'blocked'
  state.from.value = '2026-09-01'
  state.to.value = '2026-09-07'
  state.toggleTag('tag:reading')
  state.toggleTag('tag:output')

  void state.results.value
  assert.deepEqual(calls.at(-1)?.[1], {
    text: '  checkpoint  ',
    kinds: ['task'],
    topicIds: ['topic:one'],
    tagIds: ['tag:reading', 'tag:output'],
    statuses: ['blocked'],
    date: { from: '2026-09-01', to: '2026-09-07', timezone: 'Asia/Shanghai' },
  })

  state.topic.value = 'learning'
  assert.deepEqual(state.query.value.topicIds, [null], 'the Learning option addresses the canonical null topic')
  state.clearFilters()
  assert.equal(state.text.value, '')
  assert.equal(state.kind.value, '')
  assert.equal(state.topic.value, '')
  assert.equal(state.status.value, '')
  assert.deepEqual(state.selectedTagIds.value, [])
  assert.equal(state.from.value, '')
  assert.equal(state.to.value, '')
  unmount()
})

test('invalid date ranges stay recoverable and opening focuses the search field', async () => {
  const { props, state, calls, unmount } = mountDialog()
  let focused = 0
  state.searchInput.value = { focus: () => { focused += 1 } }
  props.open = true
  await Vue.nextTick()
  await Vue.nextTick()
  assert.equal(focused, 1)

  state.from.value = '2026-09-08'
  state.to.value = '2026-09-07'
  const callCount = calls.length
  assert.match(state.dateError.value, /开始日期/)
  assert.deepEqual(state.results.value, { tasks: [], completionRecords: [] })
  assert.equal(calls.length, callCount, 'an invalid range must not call the domain search with a throwing query')
  unmount()
})

test('choosing either result returns its exact canonical id and closes the dialog', () => {
  const { state, events, unmount } = mountDialog()
  state.selectTask('task:exact')
  assert.deepEqual(events, [
    ['openTask', 'task:exact'],
    ['update:open', false],
    ['close'],
  ])
  events.length = 0
  state.selectRecord('record:exact')
  assert.deepEqual(events, [
    ['openRecord', 'record:exact'],
    ['update:open', false],
    ['close'],
  ])
  unmount()
})

test('tag management leaves search only after handing the exact intent to the app', () => {
  const { state, events, unmount } = mountDialog()
  state.openTagManager()
  assert.deepEqual(events, [
    ['manageTags'],
    ['update:open', false],
    ['close'],
  ])
  unmount()
})

test('dialog source uses the shared search semantics and exposes responsive grouped results', () => {
  const source = readFileSync(sourceUrl, 'utf8')
  assert.match(source, /import \{ searchWorkspace, type WorkspaceSearchQuery, type WorkspaceSearchResult \} from '..\/..\/domain\/search\/workspace-search\.ts'/)
  assert.match(source, /<Dialog\b/)
  assert.match(source, /ref="searchInput"[\s\S]*?autofocus[\s\S]*?aria-label="搜索任务与完成记录"/)
  assert.match(source, /<h3>任务 <span>\{\{ results\.tasks\.length \}\}<\/span><\/h3>/)
  assert.match(source, /<h3>完成记录 <span>\{\{ results\.completionRecords\.length \}\}<\/span><\/h3>/)
  assert.match(source, /@click="selectTask\(hit\.id\)"/)
  assert.match(source, /@click="selectRecord\(hit\.id\)"/)
  assert.match(source, /<Button variant="ghost" size="sm" @click="openTagManager">管理标签<\/Button>/)
  assert.match(source, /@media \(max-width: 819px\)/)
  assert.doesNotMatch(source, /<input[^>]*type="date"/, 'date fields must use the themed Input primitive')
})
