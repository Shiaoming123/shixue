import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref, shallowRef } from 'vue'
import { focusNextToTrigger, hasActiveOverlay, useModalOverlay, useOverlay } from '../src/components/ui/use-overlay.ts'

class ElementStub extends EventTarget {
  tabIndex = 0
  children: ElementStub[] = []
  dataset: Record<string, string> = {}
  scope: ElementStub | null = null
  attributes = new Map<string, string>()
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  contains(target: unknown): boolean { return target === this || this.children.some((child) => child.contains(target)) }
  querySelectorAll() { return this.children }
  querySelector() { return null }
  matches() { return false }
  closest(selector: string) { return selector === '[data-overlay-layer]' ? this.scope : null }
  getClientRects() { return [{}] }
  focus() { doc.activeElement = this }
}
const doc = Object.assign(new EventTarget(), {
  body: new ElementStub(),
  activeElement: null as ElementStub | null,
  querySelector: (_selector: string) => null as ElementStub | null,
})

test('nested modal hides and inerts the covered dialog and page, then restores their prior semantics', async () => {
  const page = new ElementStub()
  const host = new ElementStub()
  const drawer = new ElementStub()
  const editor = new ElementStub()
  const picker = new ElementStub()
  const editTrigger = new ElementStub()
  const input = new ElementStub()
  const originalHidden = new ElementStub()
  originalHidden.setAttribute('aria-hidden', 'true')
  drawer.children = [editTrigger]
  editor.children = [input]
  host.children = [drawer, editor, picker]
  doc.body.children = [page, host, originalHidden]
  const drawerOpen = ref(false)
  const editorOpen = ref(false)
  let showPicker!: () => void
  const app = renderer.createApp({ setup() {
    useModalOverlay(drawerOpen, shallowRef(drawer) as never, () => { drawerOpen.value = false })
    useModalOverlay(editorOpen, shallowRef(editor) as never, () => { editorOpen.value = false })
    showPicker = useOverlay({ id: 'isolation-picker', kind: 'popover', trigger: input as never, panel: () => picker as never, close() {} }).bringToFront
    return () => h('div')
  } })
  app.mount(new ElementStub())
  try {
    page.focus()
    drawerOpen.value = true
    await nextTick(); await nextTick()
    assert.equal(page.getAttribute('inert'), '', 'main content must reject interaction behind a modal')
    assert.equal(page.getAttribute('aria-hidden'), 'true')
    editTrigger.focus()
    editorOpen.value = true
    await nextTick(); await nextTick()
    assert.equal(drawer.getAttribute('inert'), '')
    assert.equal(drawer.getAttribute('aria-hidden'), 'true', 'covered detail dialog must disappear from accessibility tree')
    assert.equal(editor.getAttribute('inert'), null)
    assert.equal(editor.getAttribute('aria-hidden'), null)
    showPicker()
    assert.equal(picker.getAttribute('aria-hidden'), null, 'a child picker must remain accessible beside its parent dialog')
    assert.equal(editor.getAttribute('aria-hidden'), null)
    assert.equal(drawer.getAttribute('aria-hidden'), 'true')
    key('Escape')
    await nextTick(); await nextTick()
    key('Escape')
    await nextTick(); await nextTick()
    assert.equal(drawer.getAttribute('inert'), null)
    assert.equal(drawer.getAttribute('aria-hidden'), null)
    assert.equal(doc.activeElement, editTrigger)
    assert.equal(page.getAttribute('inert'), '')
    key('Escape')
    await nextTick(); await nextTick()
    assert.equal(page.getAttribute('inert'), null)
    assert.equal(page.getAttribute('aria-hidden'), null)
    assert.equal(originalHidden.getAttribute('aria-hidden'), 'true', 'preexisting hidden semantics must be preserved')
    assert.equal(doc.activeElement, page)
  } finally { app.unmount(); doc.body.children = [] }
})

test('listbox Tab exit follows its trigger form order and wraps inside the parent modal', () => {
  const panel = new ElementStub()
  const previous = new ElementStub()
  const trigger = new ElementStub()
  const next = new ElementStub()
  panel.children = [previous, trigger, next]
  for (const element of panel.children) element.scope = panel
  focusNextToTrigger(trigger as never, false)
  assert.equal(doc.activeElement, next, 'forward exit must reach the next form field, not the portal tail')
  focusNextToTrigger(trigger as never, true)
  assert.equal(doc.activeElement, previous)
  focusNextToTrigger(next as never, false)
  assert.equal(doc.activeElement, previous, 'last-field exit must stay in the parent modal')
  focusNextToTrigger(previous as never, true)
  assert.equal(doc.activeElement, next)
})
Object.assign(globalThis, { document: doc, HTMLElement: ElementStub, Node: ElementStub })
const renderer = createRenderer<ElementStub, ElementStub>({
  createElement: () => new ElementStub(), createText: () => new ElementStub(), createComment: () => new ElementStub(),
  insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {},
})
function key(value: string, shiftKey = false) {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key: value, shiftKey })
  doc.dispatchEvent(event)
  return event
}

test('modal lifecycle traps both tab boundaries, closes only top layer, and restores the task trigger', async () => {
  const trigger = new ElementStub()
  const first = new ElementStub()
  const last = new ElementStub()
  const panel = new ElementStub()
  panel.children = [first, last]
  trigger.focus()
  const open = ref(false)
  let showMenu!: () => void
  let menuClosed = 0
  const app = renderer.createApp({ setup() {
    useModalOverlay(open, shallowRef(panel) as never, () => { open.value = false })
    const menu = useOverlay({ id: 'test-menu', kind: 'menu', trigger: last as never, close: () => { menuClosed += 1 } })
    showMenu = menu.bringToFront
    return () => h('div')
  } })
  app.mount(new ElementStub())
  assert.equal(hasActiveOverlay(), false, 'closed sheets must not disable task commands')
  open.value = true
  await nextTick(); await nextTick()
  assert.equal(doc.activeElement, first, 'opening must move focus off the covered task row')
  assert.equal(hasActiveOverlay(), true, 'task commands must be blocked while modal is active')
  first.focus()
  assert.equal(key('Tab', true).defaultPrevented, true)
  assert.equal(doc.activeElement, last)
  assert.equal(key('Tab').defaultPrevented, true)
  assert.equal(doc.activeElement, first)
  showMenu()
  key('Escape')
  await nextTick()
  assert.equal(menuClosed, 1)
  assert.equal(open.value, true, 'Escape on a child picker must not discard the task editor')
  key('Escape')
  await nextTick(); await nextTick()
  assert.equal(open.value, false)
  assert.equal(hasActiveOverlay(), false)
  assert.equal(doc.activeElement, trigger, 'closing must return to the original task trigger')
  app.unmount()
})

test('removing an active responsive drawer releases its command boundary', async () => {
  const open = ref(true)
  const panel = new ElementStub()
  const app = renderer.createApp({ setup() {
    useModalOverlay(open, shallowRef(panel) as never, () => { open.value = false })
    return () => h('div')
  } })
  app.mount(new ElementStub())
  await nextTick(); await nextTick()
  assert.equal(hasActiveOverlay(), true)
  app.unmount()
  assert.equal(hasActiveOverlay(), false, 'navigation must not leave background commands permanently blocked')
})

test('every task action sheet registers a modal, isolates task commands, and closes without submitting', async () => {
  const source = readFileSync(new URL('../src/components/study/TaskActionSheet.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const code = ts.transpileModule(compileScript(descriptor, { id: 'task-action-test' }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : id.endsWith('use-overlay') ? { useModalOverlay } : {}, exported)
  const trigger = new ElementStub()
  const panel = new ElementStub()
  const first = new ElementStub()
  panel.children = [first]
  const props = Vue.reactive({ open: false, mode: 'plan', taskTitle: 'Task', topics: [] })
  let state: any
  let submissions = 0
  const app = renderer.createApp({ setup() {
    state = exported.default.setup(props, { expose() {}, emit: (event: string) => { if (event === 'close') props.open = false; else submissions++ } })
    return () => h('div')
  } })
  app.mount(new ElementStub())
  if (state.panel) state.panel.value = panel
  try {
    for (const mode of ['plan', 'defer', 'block', 'cancel', 'reopen']) {
      props.mode = mode
      trigger.focus()
      props.open = true
      await nextTick(); await nextTick()
      assert.equal(hasActiveOverlay(), true, `${mode}: background task commands must be blocked`)
      assert.equal(doc.activeElement, first)
      key('Escape')
      await nextTick(); await nextTick()
      assert.equal(props.open, false)
      assert.equal(hasActiveOverlay(), false)
      assert.equal(doc.activeElement, trigger)
    }
    props.open = true
    await nextTick(); await nextTick()
    doc.dispatchEvent(new Event('pointerdown'))
    await nextTick(); await nextTick()
    assert.equal(props.open, false, 'outside pointer must still close the custom sheet')
    assert.equal(submissions, 0, 'dismissal must never execute a dangerous task action')
    assert.match(source, /<Teleport defer to="#ui-overlay-host">/)
    assert.match(source, /:data-overlay-layer="layerId"/)
  } finally { app.unmount() }
})

test('unmounting the last modal disconnects isolation observation and restores background attributes', async () => {
  const originalObserver = globalThis.MutationObserver
  let observing = false
  class ObserverStub {
    observe() { observing = true }
    disconnect() { observing = false }
  }
  Object.assign(globalThis, { MutationObserver: ObserverStub })
  const background = new ElementStub()
  const panel = new ElementStub()
  doc.body.children = [background, panel]
  background.focus()
  const app = renderer.createApp({ setup() {
    useModalOverlay(ref(true), shallowRef(panel) as never, () => {})
    return () => h('div')
  } })
  app.mount(new ElementStub())
  try {
    await nextTick(); await nextTick()
    assert.equal(observing, true)
    assert.equal(background.getAttribute('inert'), '')
    app.unmount()
    await nextTick(); await Promise.resolve()
    assert.equal(observing, false, 'no body observer may remain active after modal teardown')
    assert.equal(background.getAttribute('inert'), null)
    assert.equal(background.getAttribute('aria-hidden'), null)
    assert.equal(doc.activeElement, background)
  } finally {
    if (hasActiveOverlay()) app.unmount()
    Object.assign(globalThis, { MutationObserver: originalObserver })
    doc.body.children = []
  }
})
