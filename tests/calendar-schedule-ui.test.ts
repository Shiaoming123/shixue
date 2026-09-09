import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import * as scheduling from '../src/domain/calendar/scheduling.ts'
import * as dates from '../src/domain/recurrence/calculate.ts'
import * as timezone from '../src/domain/recurrence/timezone.ts'
import { parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'

function mount() {
  const workspace = parseWorkspaceExport(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')).state
  workspace.tasks = [workspace.tasks[0]!]
  workspace.tasks[0]!.schedule = { startAt: null, startOn: null, estimateMinutes: 60 }
  workspace.tasks[0]!.deadline = { dueAt: null, dueOn: null }
  workspace.tasks[0]!.recurrenceSeriesId = null
  workspace.occurrences = []; workspace.taskEvents = []; workspace.studySessions = []
  const props = Vue.reactive({ workspace, taskId: workspace.tasks[0]!.id, open: true, timezone: 'UTC', now: '2026-09-09T00:00:00Z', externalBusy: [] as any[], busy: false, error: '' })
  const { descriptor } = parse(readFileSync(new URL('../src/components/calendar/CalendarSchedulePanel.vue', import.meta.url), 'utf8'))
  const code = ts.transpileModule(compileScript(descriptor, { id: 'schedule-test' }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : id.endsWith('/scheduling.ts') ? scheduling : id.endsWith('/calculate.ts') ? dates : id.endsWith('/timezone.ts') ? timezone : {}, exported)
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const events: any[][] = []; let state: any
  const app = renderer.createApp({ setup() { state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => events.push(args) }); return () => Vue.h('div') } })
  app.mount({})
  return { props, state, events, unmount: () => app.unmount() }
}

test('preview is read only and only adopting a current candidate emits revision and availability guards', async () => {
  const h = mount(), before = structuredClone(Vue.toRaw(h.props.workspace))
  await h.state.generate()
  assert.equal(h.events.filter(([name]) => name !== 'preview-result').length, 0)
  assert.equal(h.state.preview.value.candidates[0].startAt, '2026-09-09T09:00:00.000Z')
  h.state.adopt('2026-09-09T01:00:00Z'); assert.equal(h.events.filter(([name]) => name !== 'preview-result').length, 0)
  h.state.adopt(h.state.preview.value.candidates[0].startAt)
  const [name, value] = h.events.find(([name]) => name === 'confirm')!
  assert.equal(name, 'confirm'); assert.equal(value.expectedTaskRevision, before.tasks[0]!.revision)
  assert.match(value.availabilityFingerprint, /^[a-f0-9]{64}$/)
  assert.deepEqual(value.query.range, { start: '2026-09-09', end: '2026-09-16' })
  assert.equal('externalBusy' in value.query, false); assert.equal('now' in value.query, false)
  assert.deepEqual(Vue.toRaw(h.props.workspace), before)
  h.unmount()
})

test('input, workspace and busy cache changes invalidate old and in-flight previews', async () => {
  const h = mount()
  for (const mutate of [() => h.state.startTime.value = '10:00', () => h.props.workspace.revision++, () => h.props.externalBusy.push({ calendarId: 'unknown', error: 'failed' })]) {
    await h.state.generate(); const candidate = h.state.preview.value.candidates[0].startAt
    mutate(); assert.equal(h.state.preview.value, null); h.state.adopt(candidate); assert.equal(h.events.filter(([name]) => name !== 'preview-result').length, 0)
  }
  h.props.externalBusy = []
  const pending = h.state.generate(); h.state.endDate.value = '2026-09-10'; await pending
  assert.equal(h.state.preview.value, null)
  h.unmount()
})

test('missing estimates never create task facts and unknown busy requires explicit range refresh', async () => {
  const h = mount()
  h.props.workspace.tasks[0]!.schedule.estimateMinutes = null
  await h.state.generate(); assert.equal(h.state.preview.value, null); assert.equal(h.events.filter(([name]) => name !== 'preview-result').length, 0)
  h.props.workspace.tasks[0]!.schedule.estimateMinutes = 60
  h.props.externalBusy = [{ calendarId: 'unknown', startAt: h.props.now, endAt: '2026-09-16T00:00:00Z', fetchedAt: h.props.now, expiresAt: h.props.now, intervals: [], error: 'failed' }]
  await h.state.generate(); assert.equal(h.state.preview.value.reason, 'availability-unknown'); assert.equal(h.events.filter(([name]) => name !== 'preview-result').length, 0)
  h.props.busy = true; h.state.refreshBusy(); assert.equal(h.events.filter(([name]) => name !== 'preview-result').length, 0)
  h.props.busy = false; h.state.refreshBusy(); assert.equal(h.events.at(-1)![0], 'refresh-busy')
  assert.deepEqual(h.events.at(-1)![1].range, { start: '2026-09-09', end: '2026-09-16' })
  h.unmount()
})

test('ordinary clock ticks leave candidates adoptable until a candidate passes or busy TTL expires', async () => {
  const h = mount()
  await h.state.generate()
  const candidate = h.state.preview.value.candidates[0].startAt
  h.props.now = '2026-09-09T00:00:01Z'
  h.state.adopt(candidate)
  assert.equal(h.events.filter(([name]) => name === 'confirm').length, 1, 'a user must have time to choose after preview')
  h.props.now = '2026-09-09T09:00:01Z'
  h.state.adopt(candidate)
  assert.equal(h.state.preview.value, null)
  assert.equal(h.events.filter(([name]) => name === 'confirm').length, 1, 'a past candidate cannot be adopted')
  h.props.now = '2026-09-09T00:00:00Z'
  h.props.externalBusy = [{ calendarId: 'remote', startAt: h.props.now, endAt: '2026-09-16T00:00:00Z', fetchedAt: h.props.now, expiresAt: '2026-09-09T00:05:00Z', intervals: [], error: null }]
  await h.state.generate()
  h.props.now = '2026-09-09T00:04:59Z'
  h.state.adopt(candidate)
  assert.equal(h.events.filter(([name]) => name === 'confirm').length, 2)
  h.props.now = '2026-09-09T00:05:00Z'
  h.state.adopt(candidate)
  assert.equal(h.state.preview.value, null)
  assert.equal(h.events.filter(([name]) => name === 'confirm').length, 2, 'TTL boundary requires fresh availability')
  h.unmount()
})

test('preview results report session reasons and clear a previous reason after a successful query', async () => {
  const h = mount(), before = structuredClone(Vue.toRaw(h.props.workspace))
  h.state.endDate.value = '2026-09-09'; h.state.endTime.value = '09:30'
  await h.state.generate()
  assert.deepEqual(h.events.at(-1), ['preview-result', { taskId: h.props.taskId, reason: 'insufficient-capacity' }])
  h.state.endTime.value = '18:00'; await h.state.generate()
  assert.deepEqual(h.events.at(-1), ['preview-result', { taskId: h.props.taskId, reason: null }])
  assert.deepEqual(Vue.toRaw(h.props.workspace), before, 'query result reporting is never a persisted workspace log')
  h.unmount()
})
