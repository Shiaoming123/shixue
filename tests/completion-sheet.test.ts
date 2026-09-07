import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

class ElementStub extends EventTarget {
  tabIndex = 0
  children: ElementStub[] = []
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  contains(target: unknown): boolean { return target === this || this.children.some((child) => child.contains(target)) }
  querySelectorAll() { return this.children }
  querySelector() { return null }
  matches() { return false }
  closest() { return null }
  getClientRects() { return [{}] }
  focus() { doc.activeElement = this }
}
const doc = Object.assign(new EventTarget(), { body: new ElementStub(), activeElement: null as ElementStub | null, querySelector: () => null })
Object.assign(globalThis, { document: doc, HTMLElement: ElementStub, Node: ElementStub })

function mountSheet() {
  const { descriptor } = parse(readFileSync(new URL('../src/components/study/CompletionSheet.vue', import.meta.url), 'utf8'))
  const code = ts.transpileModule(compileScript(descriptor, { id: 'completion' }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : id === '../ui/use-overlay' ? { useModalOverlay } : {}, exported)
  const renderer = Vue.createRenderer<ElementStub, ElementStub>({
    createElement: () => new ElementStub(), createText: () => new ElementStub(), createComment: () => new ElementStub(),
    insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {},
  })
  const props = Vue.reactive({ open: false, contextId: 'delivery:first', taskTitle: '同一重复学习任务', scratchpad: '第一条随手记', busy: false })
  const events: any[][] = []
  let state: any
  const app = renderer.createApp({ setup() {
    state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => { events.push(args); if (args[0] === 'close') props.open = false } })
    return () => Vue.h('div')
  } })
  app.mount(new ElementStub())
  return { props, state, events, unmount: async () => {
    app.unmount()
    await Vue.nextTick()
    await Promise.resolve()
    doc.body.children = []
  } }
}

test('same-title next occurrence starts fresh, while a failed save retains the current evidence draft', async (t) => {
  const sheet = mountSheet()
  t.after(() => sheet.unmount())
  sheet.props.open = true
  await Vue.nextTick(); await Vue.nextTick()
  assert.equal(sheet.state.learned.value, '第一条随手记')
  sheet.state.evidence.value = 'first-proof'
  sheet.state.nextAction.value = 'next'
  sheet.state.submit()
  assert.equal(sheet.events[0][1].evidence, 'first-proof')
  sheet.props.busy = true
  sheet.state.submit()
  assert.equal(sheet.events.length, 1, 'busy evidence must not be submitted twice')
  sheet.props.busy = false
  sheet.props.taskTitle = '同一任务的新标题'
  sheet.props.scratchpad = '后台更新'
  await Vue.nextTick()
  assert.equal(sheet.state.evidence.value, 'first-proof', 'failure or background refresh must preserve the draft')
  sheet.props.open = false
  await Vue.nextTick()
  sheet.props.contextId = 'delivery:second'
  sheet.props.open = true
  await Vue.nextTick(); await Vue.nextTick()
  assert.equal(sheet.state.evidence.value, '')
  assert.equal(sheet.state.nextAction.value, '')
  assert.equal(sheet.state.learned.value, '后台更新')
})

test('CompletionSheet delegates its modal boundary to the shared Sheet primitive', () => {
  const source = readFileSync(new URL('../src/components/study/CompletionSheet.vue', import.meta.url), 'utf8')
  assert.match(source, /import Sheet from '..\/ui\/Sheet\.vue'/)
  assert.match(source, /<Sheet\b[^>]*:open="open"[^>]*label="把时间变成证据"/)
  assert.doesNotMatch(source, /useModalOverlay|<Teleport\b|data-overlay-layer/)
})
