import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

function loadSetup() {
  const source = readFileSync(new URL('../src/components/study/ReviewView.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const code = ts.transpileModule(compileScript(descriptor, { id: 'review-weekly-summary' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : {}, exported)
  return { Component: exported.default, descriptor, source }
}

function summary() {
  return {
    rangeStart: '2026-09-14', rangeEnd: '2026-09-21',
    totals: {
      evidenceCompletions: { value: 2, recordIds: ['record:a', 'record:b'] },
      evidenceMinutes: { value: 45, recordIds: ['record:a'] },
      completedReviews: { value: 1, recordIds: ['record:b'] },
    },
    topics: [{
      topicId: 'topic:a', topicTitle: 'Agent 系统',
      evidenceCompletions: { value: 2, recordIds: ['record:a', 'record:b'] },
      evidenceMinutes: { value: 45, recordIds: ['record:a'] },
      completedReviews: { value: 1, recordIds: ['record:b'] },
      completedReviewFacts: [{ id: 'review:1', recordId: 'record:b', completedAt: '2026-09-14T08:00:00.000Z', reviewedOn: '2026-09-14', result: 'clear' }],
    }],
  }
}

function record(id: string) {
  return { id, taskId: `task:${id}`, topicId: 'topic:a', topic: 'Agent 系统', taskTitle: id, learned: id, evidence: id, blocker: '', nextAction: 'next', mastery: 3, completedLabel: '9 月 14 日', minutes: 20 }
}

test('weekly metric drilldown shows only its exact records and can return to the full history', async () => {
  const { Component } = loadSetup()
  const props = Vue.reactive<any>({
    item: undefined, remaining: 0, revealed: false, weeklySummary: summary(),
    records: [record('record:a'), record('record:b'), record('record:c')], topics: [], initialMode: 'review', recordTarget: undefined,
  })
  let state: any
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const app = renderer.createApp({ setup() { state = Component.setup(props, { expose() {}, emit() {} }); return () => Vue.h('div') } })
  app.mount({})

  let focused = ''
  state.recordButtons.set('record:b', { focus() { focused = 'record' } })
  await state.showWeeklyRecords(['record:b'], 'Agent 系统 · 已完成回顾', summary().topics[0].completedReviewFacts)
  assert.equal(state.mode.value, 'records')
  assert.equal(state.weeklyFilterLabel.value, 'Agent 系统 · 已完成回顾')
  assert.equal(state.selectedRecordId.value, 'record:b')
  assert.equal(focused, 'record')
  assert.equal(state.weeklyReviewFacts.value[0].id, 'review:1')
  assert.deepEqual(state.filteredRecords.value.map(({ id }: { id: string }) => id), ['record:b'])

  state.showAllRecords()
  assert.equal(state.weeklyRecordIds.value, null)
  assert.deepEqual(state.filteredRecords.value.map(({ id }: { id: string }) => id), ['record:a', 'record:b', 'record:c'])

  state.recordScope.value = { focus() { focused = 'scope' } }
  await state.showWeeklyRecords(['record:a', 'record:b'], 'Agent 系统 · 有证据完成')
  assert.equal(focused, 'scope')

  await state.showWeeklyRecords(['record:a'], 'Agent 系统 · 有证据专注')
  props.recordTarget = { id: 'record:c', requestId: 1 }
  await Vue.nextTick()
  assert.equal(state.weeklyRecordIds.value, null)
  assert.equal(state.selectedRecordId.value, 'record:c')
  app.unmount()
})

test('weekly evidence uses labelled shared buttons and responsive touch targets without adding navigation', () => {
  const { descriptor, source } = loadSetup()
  const template = descriptor.template?.content ?? ''
  const css = descriptor.styles.map(({ content }) => content).join('\n')

  assert.match(template, /本周证据/)
  assert.match(template, /有证据专注/)
  assert.match(template, /有证据专注分钟/)
  assert.match(template, /showWeeklyRecords\(topic\.completedReviews\.recordIds/)
  assert.match(template, /topic\.completedReviewFacts/)
  assert.match(template, /data-review-link-id/)
  assert.match(template, /reviewResultLabel\(fact\.result\)/)
  assert.match(template, /ref="recordScope"[\s\S]*tabindex="-1"/)
  assert.match(template, /显示全部记录/)
  assert.match(css, /weekly-metrics[\s\S]*min-height:\s*64px/)
  assert.match(css, /@media\s*\(max-width:\s*439px\)/)
  assert.doesNotMatch(source, /kind:\s*'weekly-summary'|section:\s*'summary'/)
})
