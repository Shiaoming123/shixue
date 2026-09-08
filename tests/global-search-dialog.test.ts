import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { formatInTimeZone } from '../src/domain/recurrence/timezone.ts'
import { compareText } from '../src/lib/text-order.ts'

const sourceUrl = new URL('../src/components/study/GlobalSearchDialog.vue', import.meta.url)

function mountDialog() {
  const { descriptor } = parse(readFileSync(sourceUrl, 'utf8'))
  const code = ts.transpileModule(compileScript(descriptor, { id: 'global-search-dialog' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const calls: any[][] = []
  const searchWorkspace = (...args: any[]) => {
    calls.push(args)
    if (args[1]?.text === 'many') {
      return {
        tasks: Array.from({ length: 125 }, (_, index) => ({ id: `task:${index}` })),
        completionRecords: Array.from({ length: 125 }, (_, index) => ({ id: `record:${index}` })),
      }
    }
    return { tasks: [], completionRecords: [] }
  }
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue
    if (id.endsWith('/workspace-search.ts')) return { searchWorkspace }
    if (id.endsWith('/recurrence/timezone.ts')) return { formatInTimeZone }
    if (id.endsWith('/text-order.ts')) return { compareText }
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

test('empty search is idle and broad results render only a bounded first page', () => {
  const { state, calls, unmount } = mountDialog()
  const initialCalls = calls.length
  assert.deepEqual(state.results.value, { tasks: [], completionRecords: [] })
  assert.equal(calls.length, initialCalls, 'opening the dialog must not scan the whole workspace before intent exists')

  state.text.value = 'many'
  assert.equal(state.results.value.tasks.length, 125)
  assert.equal(state.results.value.completionRecords.length, 125)
  assert.equal(state.visibleTasks.value.length, 100)
  assert.equal(state.visibleCompletionRecords.value.length, 100)
  assert.equal(state.resultsTruncated.value, true)
  unmount()
})

test('task summaries expose the matching acceptance criterion or checklist item', () => {
  const { state, unmount } = mountDialog()
  state.text.value = 'checkpoint'
  assert.equal(state.taskSummary({
    task: { notes: '', learning: { acceptanceCriteria: ['阅读文档', '验证 checkpoint'] }, checklist: [] },
    matchedFields: ['acceptance_criteria'],
  }), '验证 checkpoint')
  assert.equal(state.taskSummary({
    task: { notes: '', checklist: [{ text: '准备环境' }, { text: 'Checkpoint 截图' }] },
    matchedFields: ['checklist'],
  }), 'Checkpoint 截图')
  unmount()
})

test('task dates use the selected timezone while invalid instants stay hidden', () => {
  const { state, unmount } = mountDialog()
  assert.equal(state.localDate('2026-09-04T18:30:00.000Z'), '2026-09-05')
  assert.equal(state.localDate('not-a-date'), '')
  assert.equal(state.localDate(null), '')
  unmount()
})

test('equal-position search facets keep raw id order', () => {
  const { props, state, unmount } = mountDialog()
  props.workspace.lists[1].position = 0
  assert.deepEqual(state.orderedLists.value.map(({ id }: { id: string }) => id), [
    'list:system:learning',
    'topic:one',
  ])
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
  assert.match(source, /<Dialog\b[\s\S]*?size="xl"/)
  assert.doesNotMatch(source, /<Dialog\b[\s\S]*?class="global-search-dialog"/)
  assert.match(source, /ref="searchInput"[\s\S]*?autofocus[\s\S]*?aria-label="搜索任务与完成记录"/)
  assert.match(source, /<h3>任务 <span>\{\{ results\.tasks\.length \}\}<\/span><\/h3>/)
  assert.match(source, /<h3>完成记录 <span>\{\{ results\.completionRecords\.length \}\}<\/span><\/h3>/)
  assert.match(source, /@click="selectTask\(hit\.id\)"/)
  assert.match(source, /@click="selectRecord\(hit\.id\)"/)
  assert.match(source, /<Button variant="ghost" size="sm" @click="openTagManager">管理标签<\/Button>/)
  assert.match(source, /@media \(max-width: 819px\)/)
  assert.match(source, /import DateTimePicker from '..\/ui\/DateTimePicker\.vue'/)
  assert.match(source, /<DateTimePicker v-model="from" label="开始日期"/)
  assert.match(source, /<DateTimePicker v-model="to" label="结束日期"/)
  assert.match(source, /MAX_VISIBLE_RESULTS_PER_KIND = 100/)
  assert.match(source, /v-for="hit in visibleTasks"/)
  assert.match(source, /v-for="hit in visibleCompletionRecords"/)
  assert.doesNotMatch(source, /<Input\b[^>]*type="date"/, 'date fields must use the themed date picker')
})
