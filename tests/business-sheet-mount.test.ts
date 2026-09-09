import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { buildQuickAddCommand } from '../src/domain/quick-add/command.ts'
import { parseQuickAdd } from '../src/domain/quick-add/parse.ts'
import * as recurrenceTimezone from '../src/domain/recurrence/timezone.ts'
import { useQuickAddCandidateState } from '../src/components/study/use-quick-add-candidate-state.ts'
import { reminderTarget } from '../src/domain/reminders/target.ts'

if (!globalThis.Document) Object.assign(globalThis, { Document: class { activeElement = null } })

class HostNode extends EventTarget {
  children: HostNode[] = []
  parent: HostNode | null = null
  props: Record<string, unknown> = {}
  value = ''
  text = ''
  focusCalls = 0
  tagName = 'DIV'
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase() }
  insertBefore(child: HostNode) { child.parent = this; this.children.push(child) }
  removeChild(child: HostNode) { this.children = this.children.filter((item) => item !== child); child.parent = null }
  setAttribute(name: string, value: unknown) { this.props[name] = value }
  removeAttribute(name: string) { delete this.props[name] }
  getRootNode() { return new globalThis.Document() }
  focus() { this.focusCalls += 1 }
}

const renderer = Vue.createRenderer<HostNode, HostNode>({
  createElement: (tag) => new HostNode(tag), createText: (value) => { const node = new HostNode('#text'); node.text = value; return node }, createComment: () => new HostNode('#comment'),
  insert(child, parent, anchor) { child.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child) },
  remove(child) { child.parent?.removeChild(child) }, setText(node, value) { node.text = value }, setElementText(node, value) { node.text = value }, parentNode: (node) => node.parent, nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp(node, key, _previous, value) {
    node.props[key] = value
    if (key === 'value') node.value = typeof value === 'string' ? value : ''
  },
})

function componentFrom(name: string, controls: Record<string, (...args: any[]) => void>, modules: Record<string, unknown> = {}) {
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
    const injected = Object.entries(modules).find(([suffix]) => id.endsWith(suffix))?.[1]
    if (injected) return injected
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
function findAll(node: HostNode, tagName: string): HostNode[] {
  return [...(node.tagName === tagName ? [node] : []), ...node.children.flatMap((child) => findAll(child, tagName))]
}

test('mounted QuickAdd exposes keyboard-native learning choice and resets it only after success', async () => {
  for (const fails of [false, true]) {
    const commands: any[] = []
    let finishExecute: (() => void) | undefined
    const service = {
      query: async () => ({ revision: 1, lists: [], tags: [] }),
      execute: async (envelope: any) => {
        commands.push(envelope.command)
        await new Promise<void>((resolve) => { finishExecute = resolve })
        if (fails) throw Error('save failed')
        return { affected: [{ type: 'task', id: envelope.command.taskId, revision: 1 }] }
      },
    }
    const controls: Record<string, (...args: any[]) => void> = {}
    const Component = componentFrom('QuickAddComposer', controls, {
      '/capabilities/types': { CAPABILITY_PROTOCOL_VERSION: 1 },
      '/capabilities/service': { createTaskCapabilityService: () => service },
      '/quick-add/command': { buildQuickAddCommand }, '/quick-add/parse': { parseQuickAdd },
      '/recurrence/timezone': recurrenceTimezone, '/workspace/registry': { getWorkspaceStore: () => ({}) },
      '/use-quick-add-candidate-state': { useQuickAddCandidateState },
    })
    const root = new HostNode()
    const app = renderer.createApp(Component, { destinationListId: 'list:system:learning' })
    app.mount(root)
    await Vue.nextTick()
    const input = find(root, 'INPUT')!
    const buttons = findAll(root, 'BUTTON')
    const learning = buttons.find((button) => button.props['aria-label'] === '学习任务')
    assert.ok(learning, 'learning mode is a named native button reachable between input and submit')
    assert.equal(learning.props['aria-pressed'], false)
    assert.ok(findAll(root, 'INPUT').indexOf(input) >= 0)
    assert.ok(buttons.indexOf(learning) < buttons.length - 1, 'Tab order reaches learning before submit')
    ;(input.props['onUpdate:modelValue'] as (value: string) => void)('Learn proofs')
    ;(learning.props.onClick as () => void)()
    await Vue.nextTick()
    assert.equal(input.value, 'Learn proofs')
    assert.equal(learning.props['aria-pressed'], true, 'native button activation used by Space toggles the exposed state')
    ;(find(root, 'FORM')!.props.onSubmit as (event: Event) => void)(new Event('submit', { cancelable: true }))
    await Vue.nextTick()
    assert.equal(learning.props.disabled, true, 'the mode cannot change while Enter submission is in flight')
    finishExecute?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(commands[0]?.mode, 'learning', 'Enter form submission persists the explicit mode')
    assert.equal(input.value, fails ? 'Learn proofs' : '', fails ? 'failure retains the title' : 'success clears the title')
    assert.equal(learning.props['aria-pressed'], fails, fails ? 'failure retains learning mode' : 'success resets to general')
    app.unmount()
  }
})

test('mounted QuickAdd reports a committed task when catalog refresh fails after execute', async () => {
  let queries = 0
  let executes = 0
  const created: unknown[] = []
  const service = {
    query: async () => {
      queries += 1
      if (queries > 2) throw Error('catalog unavailable')
      return { revision: 1, lists: [], tags: [] }
    },
    execute: async (envelope: any) => {
      executes += 1
      return { affected: [{ type: 'task', id: envelope.command.taskId, revision: 1 }] }
    },
  }
  const Component = componentFrom('QuickAddComposer', {}, {
    '/capabilities/types': { CAPABILITY_PROTOCOL_VERSION: 1 },
    '/capabilities/service': { createTaskCapabilityService: () => service },
    '/quick-add/command': { buildQuickAddCommand }, '/quick-add/parse': { parseQuickAdd },
    '/recurrence/timezone': recurrenceTimezone, '/workspace/registry': { getWorkspaceStore: () => ({}) },
    '/use-quick-add-candidate-state': { useQuickAddCandidateState },
  })
  const root = new HostNode()
  const app = renderer.createApp(Component, { destinationListId: 'list:system:learning', onCreated: (entity: unknown) => created.push(entity) })
  app.mount(root)
  await Vue.nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const input = find(root, 'INPUT')!
  const learning = findAll(root, 'BUTTON').find((button) => button.props['aria-label'] === '学习任务')!
  ;(input.props['onUpdate:modelValue'] as (value: string) => void)('Learn proofs')
  ;(learning.props.onClick as () => void)()
  await Vue.nextTick()
  assert.equal(input.value, 'Learn proofs')
  assert.equal(findAll(root, 'BUTTON').at(-1)?.props.disabled, false)
  ;(find(root, 'FORM')!.props.onSubmit as (event: Event) => void)(new Event('submit', { cancelable: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(executes, 1)
  assert.equal(created.length, 1, 'a committed task is emitted even when catalog refresh fails')
  assert.equal(input.value, '')
  assert.equal(learning.props['aria-pressed'], false)
  assert.equal(input.focusCalls, 1)
  assert.equal(findByClass(root, 'quick-add-message')?.text, '任务已保存，但清单与标签未能刷新。')
  app.unmount()
})

test('mounted TaskEditSheet stages child reminder and recurrence events until outer Save', async () => {
  const controls: Record<string, (...args: any[]) => any> = {}
  const events: any[][] = []
  const Component = componentFrom('TaskEditSheet', controls, { '/reminders/target': { reminderTarget } })
  const rule = { id: 'rule:one', target: { kind: 'task', taskId: task.id, occurrenceId: null }, trigger: { kind: 'at_start' }, enabled: true, revision: 4 }
  const app = renderer.createApp(Component, {
    open: true, task, topics: [], plannedAt: '2026-09-06T01:00:00.000Z', dueAt: null, reminderRules: [rule], recurrenceRule: null,
    onClose: () => events.push(['close']), onSave: (...args: any[]) => events.push(['save', ...args]),
  })
  const root = new HostNode()
  app.mount(root)
  const addition = { type: 'reminder.set', ruleId: 'rule:new', target: { kind: 'task', taskId: task.id, occurrenceId: null }, trigger: { kind: 'before_start', minutes: 10 }, enabled: true }
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
      reminderAt: null, priority: 'none', estimateMinutes: 15, tagIds: [],
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
