import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

const source = (name: string) => readFileSync(new URL(`../src/components/calendar/${name}`, import.meta.url), 'utf8')

function styleRule(content: string, selector: string) {
  const style = content.split('<style scoped>')[1]!.split('</style>')[0]!
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(style)?.[1] ?? ''
}

function mountWorkspace() {
  const content = source('CalendarWorkspace.vue')
  const code = ts.transpileModule(compileScript(parse(content).descriptor, { id: 'calendar-phase3' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: any = {}
  const drag = { session: Vue.ref(null), preview: Vue.ref(null), begin: () => false, update() {}, release: async () => {}, cancel() {}, cancelActive() {} }
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue
    if (id.includes('/layout')) return { layoutTimedItems: () => [] }
    if (id.includes('/query')) return { queryCalendar: () => ({ items: [], allItems: [], tasks: [] }) }
    if (id.includes('/range')) return { calendarRange: () => ({ start: '2026-09-10', end: '2026-09-11' }) }
    if (id.includes('/target')) return { calendarTimedTarget: () => ({ startAt: '2026-09-10T09:00:00Z', displayDate: '2026-09-10', displayMinute: 540 }) }
    if (id.includes('/view')) return { resolveCalendarMode: (mode: string) => mode }
    if (id.includes('use-calendar-drag')) return { createCalendarDragController: () => drag, calendarCommandForPreview: () => ({}), durationMinutes: () => 30, calendarItemInteractive: () => true, filterUnscheduledTasks: (tasks: unknown[]) => tasks }
    if (id.includes('calendar-conflicts')) return { calendarDeadlineConflict: () => null }
    return {}
  }, exported)
  const props = Vue.reactive({ workspace: { tags: [], tasks: [], calendarEvents: [], calendarSources: [{ id: 'local', title: '我的日历', provider: 'local', permission: 'write', archivedAt: null }] }, weekStartsOn: 1, defaultEstimateMinutes: 30, initialMode: 'week', now: '2026-09-10T08:00:00Z', targetOffset: 'Z', executeCommand: async () => {} })
  const events: any[][] = []; let state: any
  const media = { matches: false, addEventListener() {}, removeEventListener() {} }
  const oldWindow = (globalThis as any).window
  ;(globalThis as any).window = { innerWidth: 1200, matchMedia: () => media }
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const app = renderer.createApp({ setup() { state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => events.push(args) }); return () => Vue.h('div') } })
  app.mount({})
  return { state, events, unmount() { app.unmount(); (globalThis as any).window = oldWindow } }
}

test('calendar toolbar is one fixed-height row containing primary actions', () => {
  const toolbar = source('CalendarToolbar.vue')
  const rule = styleRule(toolbar, '.calendar-toolbar')
  assert.match(rule, /height:\s*56px/)
  assert.match(rule, /flex-wrap:\s*nowrap/)
  assert.doesNotMatch(toolbar, /<h1>|<p>时间规划/)
  assert.match(toolbar, /emit\('new-event'\)/)
  assert.match(toolbar, /emit\('toggle-context'\)/)
  assert.match(toolbar, /<slot name="filters"/)
})

test('context tray overlays the grid and quick creation replaces persistent capture rows', () => {
  const workspace = source('CalendarWorkspace.vue')
  assert.doesNotMatch(workspace, /slot name="quick-add"/)
  assert.doesNotMatch(workspace, /title="创建安排"/)
  assert.match(workspace, /class="calendar-workspace__context"/)
  assert.match(workspace, /slot name="context"/)
  assert.match(styleRule(workspace, '.calendar-workspace__context'), /position:\s*absolute/)
  assert.match(workspace, /class="calendar-workspace__quick-event"/)
  assert.match(workspace, /@blank-slot="openQuickEvent"/)
  assert.match(workspace, /@new-event="openToolbarEvent"/)
  assert.match(workspace, /defineExpose\(\{ openToolbarEvent, closeQuickEvent \}\)/)
  assert.match(workspace, /更多选项/)
  assert.match(workspace, /quick-create-event/)
  assert.match(workspace, /expand-event/)
  assert.match(workspace, /groupCalendarPlanningTasks/)
  assert.match(workspace, /calendar-workspace__quick-times[^\n]*time-options/)
  assert.match(workspace, /quickEventReturnFocus/)
  assert.match(workspace, /target\?\.focus\(\{ preventScroll: true \}\)/)
})

test('blank slot opens one lightweight draft and carries it intact to save or full edit', async () => {
  const h = mountWorkspace()
  try {
    h.state.openQuickEvent({ date: '2026-09-10', minute: 615, duration: 45 })
    assert.equal(h.state.quickEventOpen.value, true)
    assert.deepEqual([h.state.quickDate.value, h.state.quickStart.value, h.state.quickEnd.value, h.state.quickSourceId.value], ['2026-09-10', '10:15', '11:00', 'local'])
    h.state.quickTitle.value = '深度学习'
    h.state.openFullEventEditor()
    assert.deepEqual(h.events.pop(), ['expand-event', { title: '深度学习', date: '2026-09-10', startTime: '10:15', endDate: '2026-09-10', endTime: '11:00', sourceId: 'local' }])
    assert.equal(h.state.quickEventOpen.value, true, 'draft stays open until the App confirms the full editor opened')
    assert.equal(h.state.quickTitle.value, '深度学习')
    h.state.closeQuickEvent()
    assert.equal(h.state.quickEventOpen.value, false)

    h.state.openQuickEvent({ date: '2026-09-10', minute: 1425, duration: 30 })
    assert.equal(h.state.quickEnd.value, '00:15')
    assert.equal(h.state.quickEndDate.value, '2026-09-11')

    h.state.openQuickEvent({ date: '2026-09-11', minute: 540, duration: 30 })
    h.state.quickTitle.value = '复习'
    h.state.saveQuickEvent()
    assert.deepEqual(h.events.pop(), ['quick-create-event', { title: '复习', date: '2026-09-11', startTime: '09:00', endDate: '2026-09-11', endTime: '09:30', sourceId: 'local' }])
    assert.equal(h.state.quickEventOpen.value, true, 'draft stays open until the App confirms persistence')
    assert.equal(h.state.quickTitle.value, '复习')
    h.state.closeQuickEvent()
  } finally { h.unmount() }
})

test('unscheduled content is a collapsible vertical flat section', () => {
  const tray = source('UnscheduledTray.vue')
  assert.match(tray, /:aria-expanded="expanded"/)
  assert.match(tray, /v-show="expanded"/)
  assert.match(styleRule(tray, '.unscheduled-tray__items'), /display:\s*grid/)
  assert.match(styleRule(tray, '.unscheduled-tray__item'), /border-bottom:\s*1px solid var\(--hairline\)/)
  assert.match(styleRule(tray, '.unscheduled-tray__item'), /border-radius:\s*0/)
})

test('all-day events keep the grid compact and expose overflow in a popover', () => {
  const grid = source('TimeGrid.vue')
  assert.match(grid, /allDayVisibleFactsForDay/)
  assert.match(grid, /allDayOverflowCount/)
  assert.match(grid, /还有 \{\{ allDayOverflowCount\(day\) \}\} 项/)
  assert.match(grid, /<Popover/)
  assert.match(styleRule(grid, '.time-grid__all-day-columns'), /overflow:\s*hidden/)
})

test('full event editor fixes chrome and scrolls only its body', () => {
  const editor = source('CalendarEventEditor.vue')
  assert.match(editor, /class="event-editor__body"/)
  assert.match(editor, /initialTitle\?: string; initialSourceId\?: string/)
  assert.match(editor, /props\.initialTitle/)
  assert.match(editor, /props\.initialSourceId/)
  assert.match(styleRule(editor, '.event-editor'), /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/)
  assert.match(styleRule(editor, '.event-editor'), /overflow:\s*hidden/)
  assert.match(styleRule(editor, '.event-editor__body'), /overflow-y:\s*auto/)
  assert.match(editor, /sheet-panel:has\(> \.sheet-body > \.event-editor\)[^{]*\{[^}]*overflow:\s*hidden/)
  assert.match(editor, /@media \(max-width: 819px\)[^{]*\{[^}]*\.event-editor\s*\{[^}]*94dvh/)
  assert.doesNotMatch(styleRule(editor, 'header'), /position:\s*(?:absolute|fixed)/)
})
