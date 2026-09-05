import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

function setupComponent(name: string, props: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/components/study/${name}.vue`, import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const code = ts.transpileModule(compileScript(descriptor, { id: name }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : {}, exported)
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const events: any[][] = []
  let state: any
  const app = renderer.createApp({ setup() {
    state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => events.push(args) })
    return () => Vue.h('div')
  } })
  app.mount({})
  return { state, events, unmount: () => app.unmount() }
}

test('independent reminder edits emit revision-aware commands and removal preserves source history', () => {
  const rule = { id: 'rule-1', taskId: 'task-1', occurrenceId: null, enabled: true, revision: 3, trigger: { kind: 'before_start', minutes: 10 } }
  const rules = [rule, { ...rule, id: 'rule-2', trigger: { kind: 'at_start' } }]
  const before = structuredClone(rules)
  const { state, events, unmount } = setupComponent('ReminderEditor', { taskId: 'task-1', occurrenceId: null, rules, startAt: '2026-09-05T10:00:00Z', dueAt: null, busy: false })
  state.edit(rule)
  state.preset.value = '60'
  state.save()
  assert.deepEqual(events[0], ['set', { type: 'reminder.set', ruleId: 'rule-1', taskId: 'task-1', occurrenceId: null, trigger: { kind: 'before_start', minutes: 60 }, enabled: true, expectedRevision: 3 }])
  state.remove(rule)
  assert.deepEqual(events[1], ['remove', rule])
  assert.deepEqual(rules, before, 'UI must never remove a rule or mutate delivery history itself')
  state.editingRule.value = null
  state.save(); state.save()
  assert.equal(events[2][1].ruleId, events[3][1].ruleId, 'retry before persistence feedback must reuse the draft rule identity')
  unmount()
})

test('missing task anchor cannot invent a time while an explicit custom instant can be emitted', () => {
  const { state, events, unmount } = setupComponent('ReminderEditor', { taskId: 'task-1', occurrenceId: null, rules: [], startAt: null, dueAt: null, busy: false })
  state.save()
  assert.equal(events.length, 0)
  state.preset.value = 'custom'
  state.customAt.value = 'invalid'
  state.save()
  assert.equal(events.length, 0)
  state.customAt.value = '2026-09-05T09:00'
  state.save()
  assert.equal(events[0][1].trigger.at, new Date('2026-09-05T09:00').toISOString())
  unmount()
})

test('reminder card forwards completion intent, fixed snooze duration and explicit ambiguous retry', () => {
  const props = Vue.reactive({ delivery: { id: 'delivery-1', revision: 4, status: 'delivered' }, taskTitle: 'Study', learning: true, busy: false })
  const { state, events, unmount } = setupComponent('ReminderCard', props)
  state.act('complete'); state.act('snooze'); state.act('open')
  assert.deepEqual(events.map(([event, value]) => [event, value.action]), [['action', 'complete'], ['action', 'snooze'], ['action', 'open']])
  assert.deepEqual(events[1][1], { deliveryId: 'delivery-1', action: 'snooze', minutes: 10 })
  assert.equal(props.delivery.status, 'delivered', 'learning completion must be routed by parent through evidence UI, never completed locally')
  props.delivery.status = 'ambiguous'
  state.act('snooze')
  assert.equal(events.length, 3)
  state.act('retry')
  assert.deepEqual(events[3][1], { deliveryId: 'delivery-1', action: 'retry', expectedRevision: 4 })
  unmount()
})
