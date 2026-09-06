import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

class HostNode extends EventTarget {
  children: HostNode[] = []
  parent: HostNode | null = null
  props: Record<string, unknown> = {}
  value = ''
  tagName = 'DIV'
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase() }
  insertBefore(child: HostNode) { child.parent = this; this.children.push(child) }
  removeChild(child: HostNode) { this.children = this.children.filter((item) => item !== child); child.parent = null }
  setAttribute(name: string, value: unknown) { this.props[name] = value }
  removeAttribute(name: string) { delete this.props[name] }
}

const renderer = Vue.createRenderer<HostNode, HostNode>({
  createElement: (tag) => new HostNode(tag), createText: () => new HostNode('#text'), createComment: () => new HostNode('#comment'),
  insert(child, parent, anchor) { child.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child) },
  remove(child) { child.parent?.removeChild(child) }, setText() {}, setElementText() {}, parentNode: (node) => node.parent, nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp(node, key, _previous, value) { node.props[key] = value },
})

function componentFrom(name: string, controls: Record<string, (...args: any[]) => void>) {
  const { descriptor } = parse(readFileSync(new URL(`../src/components/study/${name}.vue`, import.meta.url), 'utf8'))
  const code = ts.transpileModule(compileScript(descriptor, { id: `mounted-${name}`, inlineTemplate: true }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const passthrough = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
  const Sheet = Vue.defineComponent({
    props: ['open', 'label', 'placement'], emits: ['close'],
    setup(props, { emit, slots }) {
      controls.close = (reason = 'outside') => emit('close', reason)
      controls.placement = () => props.placement
      return () => props.open ? Vue.h('section', slots.default?.()) : null
    },
  })
  const ReminderEditor = Vue.defineComponent({
    props: ['rules'], emits: ['set', 'remove'],
    setup(props, { emit }) {
      controls.reminderSet = (value) => emit('set', value)
      controls.reminderRemove = (value) => emit('remove', value)
      controls.rules = () => props.rules
      return () => Vue.h('div')
    },
  })
  const RecurrenceEditor = Vue.defineComponent({
    emits: ['save'], setup(_, { emit }) { controls.recurrenceSave = (value) => emit('save', value); return () => Vue.h('div') },
  })
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue
    if (id === '@lucide/vue') return new Proxy({}, { get: () => passthrough })
    if (id.endsWith('/Sheet.vue')) return { default: Sheet }
    if (id.endsWith('/ReminderEditor.vue')) return { default: ReminderEditor }
    if (id.endsWith('/RecurrenceEditor.vue')) return { default: RecurrenceEditor }
    if (id.endsWith('.vue')) return { default: passthrough }
    if (id.endsWith('/responsive-shell')) return requireResponsiveShell()
    return {}
  }, exported)
  return exported.default
}

function requireResponsiveShell() {
  return {
    resolveTaskDetailPlacement(width: number) { return width < 820 ? 'responsive' : width < 1280 ? 'right' : 'inline' },
  }
}

const task = { id: 'task:one', title: 'Stored', notes: '', topicId: null, plannedOn: '2026-09-06', dueOn: null, reminderAt: null, status: 'planned', priority: 'none', estimateMinutes: 15, acceptanceCriteria: [] }
function find(node: HostNode, tagName: string): HostNode | undefined {
  if (node.tagName === tagName) return node
  return node.children.map((child) => find(child, tagName)).find(Boolean)
}
function findByClass(node: HostNode, className: string): HostNode | undefined {
  const value = node.props.class
  if ((typeof value === 'string' ? value.split(/\s+/) : []).includes(className)) return node
  return node.children.map((child) => findByClass(child, className)).find(Boolean)
}

test('mounted TaskEditSheet stages child reminder and recurrence events until outer Save', async () => {
  const controls: Record<string, (...args: any[]) => any> = {}
  const events: any[][] = []
  const Component = componentFrom('TaskEditSheet', controls)
  const rule = { id: 'rule:one', taskId: task.id, occurrenceId: null, trigger: { kind: 'at_start' }, enabled: true, revision: 4 }
  const app = renderer.createApp(Component, {
    open: true, task, topics: [], plannedAt: '2026-09-06T01:00:00.000Z', dueAt: null, reminderRules: [rule], recurrenceRule: null,
    onClose: () => events.push(['close']), onSave: (...args: any[]) => events.push(['save', ...args]),
  })
  const root = new HostNode()
  app.mount(root)
  const addition = { type: 'reminder.set', ruleId: 'rule:new', taskId: task.id, occurrenceId: null, trigger: { kind: 'before_start', minutes: 10 }, enabled: true }
  const recurrence = { cadence: { kind: 'daily', interval: 2 }, basis: 'fixed_schedule', end: { kind: 'never' } }
  controls.reminderSet(addition)
  controls.recurrenceSave(recurrence)
  assert.deepEqual(events, [])
  const cancel = findByClass(root, 'cancel')?.props.onClick as ((event: Event) => void) | undefined
  assert.ok(cancel, 'the mounted task editor renders its outer cancel action')
  cancel(new Event('click'))
  controls.close('outside')
  controls.close('escape')
  assert.deepEqual(events, [['close'], ['close'], ['close']], 'cancel, outside, and Escape only close the outer editor')
  events.length = 0
  const submit = find(root, 'FORM')?.props.onSubmit as ((event: Event) => void) | undefined
  assert.ok(submit, 'the mounted task editor renders its real outer form')
  submit(new Event('submit', { cancelable: true }))
  assert.equal(events[0][0], 'save')
  assert.deepEqual(events[0][2], {
    baseTask: {
      title: 'Stored', notes: '', topicId: null, plannedAt: '2026-09-06T01:00:00.000Z', dueOn: null,
      reminderAt: null, priority: 'none', estimateMinutes: 15,
    },
    baseReminderRules: [rule],
    baseRecurrenceRule: null,
    reminderCommands: [addition], recurrenceRule: recurrence,
  })
  assert.doesNotThrow(
    () => structuredClone(events[0][2]),
    'the TaskEdit payload must cross the capability/storage structured-clone boundary without Vue proxies',
  )
  app.unmount()
})

for (const [name, props, submitName] of [
  ['CompletionSheet', { open: true, contextId: 'session:one', taskTitle: 'Task', scratchpad: '', busy: false }, 'save'],
  ['TaskActionSheet', { open: true, mode: 'cancel', taskTitle: 'Task', topics: [] }, 'submit'],
] as const) {
  test(`mounted ${name} Escape and outside dismissal never submit`, () => {
    const controls: Record<string, (...args: any[]) => void> = {}
    const events: string[] = []
    const Component = componentFrom(name, controls)
    const app = renderer.createApp(Component, { ...props, onClose: () => events.push('close'), [`on${submitName[0]!.toUpperCase()}${submitName.slice(1)}`]: () => events.push(submitName) })
    app.mount(new HostNode())
    controls.close('escape')
    controls.close('outside')
    assert.deepEqual(events, ['close', 'close'])
    app.unmount()
  })
}

test('mounted TaskDetailDrawer passes the three responsive placements to shared Sheet', async () => {
  const originalWindow = globalThis.window
  const windowStub = Object.assign(new EventTarget(), { innerWidth: 819 })
  Object.assign(globalThis, { window: windowStub })
  try {
    const controls: Record<string, (...args: any[]) => any> = {}
    const Component = componentFrom('TaskDetailDrawer', controls)
    const detailTask = { ...task, topic: 'Inbox', plannedLabel: '', reminderLabel: '', dueLabel: '', tags: [], checklist: [] }
    const app = renderer.createApp(Component, { task: detailTask, events: [] })
    app.mount(new HostNode())
    assert.equal(controls.placement(), 'responsive')
    windowStub.innerWidth = 820; windowStub.dispatchEvent(new Event('resize')); await Vue.nextTick()
    assert.equal(controls.placement(), 'right')
    windowStub.innerWidth = 1280; windowStub.dispatchEvent(new Event('resize')); await Vue.nextTick()
    assert.equal(controls.placement(), 'inline')
    app.unmount()
  } finally { Object.assign(globalThis, { window: originalWindow }) }
})
