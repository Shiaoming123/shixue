import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

class HostNode {
  children: HostNode[] = []
  parent: HostNode | null = null
  props: Record<string, unknown> = {}
  text = ''
  tagName: string
  constructor(tagName = 'DIV') { this.tagName = tagName }
}

const renderer = Vue.createRenderer<HostNode, HostNode>({
  createElement: (tag) => new HostNode(tag.toUpperCase()),
  createText: (text) => Object.assign(new HostNode('#TEXT'), { text }),
  createComment: () => new HostNode('#COMMENT'),
  insert(child, parent, anchor) {
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  },
  remove(child) {
    if (child.parent) child.parent.children = child.parent.children.filter((item) => item !== child)
  },
  setText(node, text) { node.text = text },
  setElementText(node, text) { node.text = text; node.children = [] },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp(node, key, _previous, value) { node.props[key] = value },
})

function loadComponent() {
  const sourceUrl = new URL('../src/components/study/LearningRhythmView.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(sourceUrl, 'utf8'))
  const code = ts.transpileModule(compileScript(descriptor, { id: 'learning-rhythm-view', inlineTemplate: true }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: any = {}
  const ButtonStub = Vue.defineComponent({
    emits: ['click'],
    setup(_props, { emit, slots }) {
      return () => Vue.h('button', { onClick: (event: unknown) => emit('click', event) }, slots.default?.())
    },
  })
  const PageHeaderStub = Vue.defineComponent({
    props: { title: String, subtitle: String },
    setup(props, { slots }) {
      return () => Vue.h('header', [
        Vue.h('h1', props.title),
        props.subtitle ? Vue.h('p', props.subtitle) : null,
        slots.actions?.(),
      ])
    },
  })
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue
    if (id === '../ui/Button.vue') return { default: ButtonStub }
    if (id === '../ui/PageHeader.vue') return { default: PageHeaderStub }
    throw new Error(`Unexpected component dependency: ${id}`)
  }, exported)
  return { Component: exported.default, descriptor }
}

function allText(node: HostNode): string {
  return [node.text, ...node.children.map(allText)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function findButtons(node: HostNode): HostNode[] {
  return [node, ...node.children.flatMap(findButtons)].filter((item) => item.tagName === 'BUTTON')
}

const item = {
  seriesId: 'series:english',
  taskId: 'task:shadowing',
  listId: 'list:english',
  title: '英语跟读',
  topic: '技术英语',
  cadenceLabel: '每周一、三、五',
  weekLabel: '9 月 7 日至 9 月 13 日',
  plannedCount: 3,
  completedWithEvidenceCount: 2,
  completedMissingEvidenceCount: 1,
  skippedCount: 1,
  cancelledCount: 0,
  streakCount: 4,
  nextOccurrenceId: 'occurrence:english:3',
  nextLabel: '今天 19:00',
  nextState: 'today',
  recentLearned: '重音比逐字发音更影响理解。',
} as const

test('renders evidence-backed weekly progress and calls out completions missing evidence', () => {
  const { Component } = loadComponent()
  const root = new HostNode()
  const app = renderer.createApp(Component, {
    items: [item],
    totals: { planned: 3, completedWithEvidence: 2, completedMissingEvidence: 1, skipped: 1, cancelled: 0 },
  })
  app.mount(root)

  const text = allText(root)
  assert.match(text, /本周节律/)
  assert.match(text, /按各节律时区统计/)
  assert.match(text, /有证据完成 2 \/ 计划 3 次/)
  assert.match(text, /英语跟读/)
  assert.match(text, /技术英语.*每周一、三、五.*9 月 7 日至 9 月 13 日/)
  assert.match(text, /本周 2 \/ 3 次/)
  assert.match(text, /跳过 1 次/)
  assert.match(text, /连续完成 4 次/)
  assert.match(text, /最近收获.*重音比逐字发音更影响理解/)
  assert.match(text, /1 次完成缺少学习证据，未计入进度/)
  assert.match(text, /今天.*今天 19:00/)
  app.unmount()
})

test('actions emit the exact occurrence and task identities from the display model', () => {
  const { Component } = loadComponent()
  const events: any[][] = []
  const root = new HostNode()
  const app = renderer.createApp(Component, {
    items: [item],
    totals: { planned: 3, completedWithEvidence: 2, completedMissingEvidence: 1, skipped: 1, cancelled: 0 },
    onOpenOccurrence: (id: string) => events.push(['openOccurrence', id]),
    onOpenTask: (id: string) => events.push(['openTask', id]),
    onEditTask: (id: string) => events.push(['editTask', id]),
  })
  app.mount(root)

  const buttons = new Map(findButtons(root).map((button) => [allText(button).trim(), button]))
  for (const label of ['继续本次', '查看任务', '编辑节律']) {
    const click = buttons.get(label)?.props.onClick as (() => void) | undefined
    assert.ok(click, `renders the ${label} action`)
    click()
  }
  assert.deepEqual(events, [
    ['openOccurrence', 'occurrence:english:3'],
    ['openTask', 'task:shadowing'],
    ['editTask', 'task:shadowing'],
  ])
  app.unmount()
})

test('renders one quiet empty state when no recurring learning items exist', () => {
  const { Component } = loadComponent()
  const root = new HostNode()
  const app = renderer.createApp(Component, {
    items: [],
    totals: { planned: 0, completedWithEvidence: 0, completedMissingEvidence: 0, skipped: 0, cancelled: 0 },
  })
  app.mount(root)
  const text = allText(root)
  assert.match(text, /还没有学习节律/)
  assert.match(text, /为学习任务设置重复后/)
  assert.doesNotMatch(text, /0 \/ 0/)
  assert.equal(findButtons(root).length, 0)
  app.unmount()
})

test('styles a single-column themed view for 820, 390, and 320px layouts with reachable actions', () => {
  const { descriptor } = loadComponent()
  const css = descriptor.styles.map(({ content }) => content).join('\n')
  assert.match(css, /width:\s*min\(100%,\s*820px\)/)
  assert.match(css, /min-height:\s*44px/)
  assert.match(css, /@media\s*\(max-width:\s*819px\)/)
  assert.match(css, /@media\s*\(max-width:\s*439px\)/)
  assert.match(css, /var\(--(?:surface|text|muted|accent|warning|border|hairline|control-fill)/)
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(/i)
  assert.match(descriptor.template?.content ?? '', /<Button\b/)
  assert.doesNotMatch(descriptor.template?.content ?? '', /<button\b/)
})

test('App formats the selector next schedule instead of dropping timed occurrence precision', () => {
  const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(appSource, /nextLabel:\s*item\.nextScheduled\s*\?\s*formatPlanDate\(item\.nextScheduled\)\s*:\s*''/)
})
