import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { resolveTaskEditWrite, runTaskEditCommit } from '../src/lib/task-edit-commit.ts'

const { descriptor } = parse(readFileSync(new URL('../src/components/study/TaskEditSheet.vue', import.meta.url), 'utf8'))
const code = ts.transpileModule(compileScript(descriptor, { id: 'edit-draft-test' }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const exported: any = {}
new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : id.endsWith('use-overlay') ? { useModalOverlay: () => ({ layerId: 'test' }) } : {}, exported)
const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
const task = (id = 'one', title = 'Stored title') => ({ id, title, notes: 'Stored notes', topicId: null, plannedOn: '2026-09-05', dueOn: null, reminderAt: null, status: 'planned', priority: 'none', estimateMinutes: 15, acceptanceCriteria: [] })
function mount() {
  const props = Vue.reactive<any>({ open: true, task: task(), topics: [], recurrenceRule: null, plannedAt: null, dueAt: null, reminderRules: [{ id: 'rule:b', taskId: 'one', occurrenceId: null, trigger: { kind: 'at_start' }, enabled: true, revision: 2 }] })
  const events: any[][] = []
  let state: any
  const app = renderer.createApp({ setup() { state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => events.push(args) }); return () => Vue.h('div') } })
  app.mount({})
  return { props, state, events, unmount: () => app.unmount() }
}

test('runtime snapshot and reminder-rule refresh cannot overwrite an unsaved task draft', async () => {
  const { props, state, unmount } = mount()
  state.title.value = 'Unsaved title'
  state.notes.value = 'Unsaved notes'
  state.plannedOn.value = '2026-09-10'
  state.priority.value = 'high'
  props.task = task()
  props.reminderRules = [{ id: 'new-rule' }]
  await Vue.nextTick()
  assert.equal(state.title.value, 'Unsaved title')
  assert.equal(state.notes.value, 'Unsaved notes')
  assert.equal(state.plannedOn.value, '2026-09-10')
  assert.equal(state.priority.value, 'high')
  props.recurrenceRule = { cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', end: { kind: 'never' } }
  await Vue.nextTick()
  assert.equal(state.title.value, 'Unsaved title', 'recurrence persistence feedback must only update its own field')
  assert.equal(state.recurrenceRule.value.cadence.kind, 'daily')
  unmount()
})

test('switching task identity and closing then reopening each initialize fresh persisted fields', async () => {
  const { props, state, unmount } = mount()
  state.title.value = 'Do not carry to next task'
  props.task = task('two', 'Second task')
  await Vue.nextTick()
  assert.equal(state.title.value, 'Second task')
  state.title.value = 'Discard on cancel'
  props.open = false
  await Vue.nextTick()
  props.task = task('two', 'Fresh persisted second task')
  await Vue.nextTick()
  props.open = true
  await Vue.nextTick()
  assert.equal(state.title.value, 'Fresh persisted second task')
  assert.equal(state.notes.value, 'Stored notes')
  unmount()
})

test('reminder and recurrence edits stay local until the outer save and cancel paths submit nothing', async () => {
  const { props, state, events, unmount } = mount()
  const replacement = { type: 'reminder.set', ruleId: 'rule:b', taskId: 'one', occurrenceId: null, trigger: { kind: 'before_start', minutes: 10 }, enabled: true, expectedRevision: 2 }
  const addition = { type: 'reminder.set', ruleId: 'rule:a', taskId: 'one', occurrenceId: null, trigger: { kind: 'absolute', at: '2026-09-06T01:00:00.000Z' }, enabled: true }
  const recurrence = { cadence: { kind: 'daily', interval: 2 }, basis: 'fixed_schedule', end: { kind: 'never' } }
  state.stageReminderSet(addition)
  state.stageReminderSet({ ...addition, trigger: { kind: 'absolute', at: '2026-09-07T01:00:00.000Z' } })
  state.stageReminderSet(replacement)
  state.stageRecurrence(recurrence)
  assert.deepEqual(events, [], 'editing nested controls must not persist before the outer save')
  state.requestClose('outside')
  state.requestClose('escape')
  assert.deepEqual(events, [['close'], ['close']], 'outside and Escape only dismiss the editor')

  events.length = 0
  state.title.value = '  Updated title  '
  state.save()
  assert.equal(events.length, 1)
  assert.equal(events[0][0], 'save')
  assert.equal(events[0][1].title, 'Updated title', 'ordinary fields retain their existing save contract')
  assert.deepEqual(events[0][2], {
    baseTask: {
      title: 'Stored title', notes: 'Stored notes', topicId: null, plannedOn: '2026-09-05', dueOn: null,
      reminderAt: null, priority: 'none', estimateMinutes: 15,
    },
    reminderCommands: [
      { ...addition, trigger: { kind: 'absolute', at: '2026-09-07T01:00:00.000Z' } },
      replacement,
    ],
    recurrenceRule: recurrence,
  }, 'the outer save emits each final reminder change once, in staging order, followed by the recurrence draft')

  props.open = false
  await Vue.nextTick()
  assert.equal(state.recurrenceDirty.value, false, 'a committed close clears the recurrence draft')
  props.recurrenceRule = recurrence
  props.open = true
  await Vue.nextTick()
  events.length = 0
  state.save()
  assert.equal(Object.hasOwn(events[0][2], 'recurrenceRule'), false, 'reopening after commit does not submit or reconfirm the persisted recurrence')
  unmount()
})

test('removing an existing rule is drafted once and background refresh does not overwrite dirty nested drafts', async () => {
  const { props, state, events, unmount } = mount()
  const rule = props.reminderRules[0]
  state.stageReminderRemove(rule)
  const recurrence = { cadence: { kind: 'weekly', interval: 1, weekdays: [1] }, basis: 'after_completion', end: { kind: 'never' } }
  state.stageRecurrence(recurrence)
  props.reminderRules = [{ ...rule, revision: 3 }]
  props.recurrenceRule = { cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', end: { kind: 'never' } }
  await Vue.nextTick()
  assert.equal(state.draftReminderRules.value.find((item: any) => item.id === rule.id).enabled, false)
  assert.deepEqual(state.recurrenceRule.value, recurrence)
  state.save()
  assert.deepEqual(events[0][2].reminderCommands, [{
    type: 'reminder.set', ruleId: rule.id, taskId: rule.taskId, occurrenceId: rule.occurrenceId,
    trigger: rule.trigger, enabled: false, expectedRevision: rule.revision,
  }])
  props.reminderError = 'CAS failure'
  props.task = { ...task(), title: 'Persisted outer fields' }
  await Vue.nextTick()
  assert.equal(state.draftReminderRules.value.find((item: any) => item.id === rule.id).enabled, false, 'failed nested save keeps the reminder draft')
  assert.deepEqual(state.recurrenceRule.value, recurrence, 'failed nested save keeps the recurrence draft')
  unmount()
})

test('outer task edit commit is ordered and stops at the failing nested change', async () => {
  const order: string[] = []
  await runTaskEditCommit({ reminders: ['remove', 'add'], recurrence: 'daily' }, {
    saveTask: async () => { order.push('task') },
    saveReminder: async (value) => { order.push(value) },
    saveRecurrence: async (value) => { order.push(value) },
  })
  assert.deepEqual(order, ['task', 'remove', 'add', 'daily'])

  order.length = 0
  await assert.rejects(runTaskEditCommit({ reminders: ['first', 'failed', 'later'], recurrence: 'weekly' }, {
    saveTask: async () => { order.push('task') },
    saveReminder: async (value) => { order.push(value); if (value === 'failed') throw new Error('CAS failure') },
    saveRecurrence: async (value) => { order.push(value) },
  }), /CAS failure/)
  assert.deepEqual(order, ['task', 'first', 'failed'], 'a failed nested write must keep later changes pending')
})

test('task edit retry resolution only writes from its captured base and treats convergence as complete', () => {
  const base = { title: 'Stored', notes: '', topicId: null, plannedOn: '2026-09-06', dueOn: null, priority: 'none', estimateMinutes: 15 }
  const desired = { ...base, title: 'Updated' }
  assert.equal(resolveTaskEditWrite(base, base, desired), 'write')
  assert.equal(resolveTaskEditWrite(desired, base, desired), 'noop')
  assert.equal(resolveTaskEditWrite({ ...base, title: 'External' }, base, desired), 'conflict')
  assert.equal(resolveTaskEditWrite({ ...desired, reminderAt: '2026-09-07T01:00:00.000Z' }, base, desired), 'noop', 'legacy reminder compatibility state is outside task edit ownership')
  assert.equal(resolveTaskEditWrite(
    { ...base, dueOn: undefined, dueAt: '2026-09-07T16:00:00+08:00' },
    { ...base, dueOn: undefined, dueAt: '2026-09-07T08:00:00.000Z' },
    { ...desired, dueOn: undefined, dueAt: '2026-09-07T08:00:00.000Z' },
  ), 'write', 'equivalent timestamp offsets are the same captured business state')
})
