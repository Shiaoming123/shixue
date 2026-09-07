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
  const plannedFacts = [
    { id: 'task:plan', taskId: 'task:plan', occurrenceId: null, title: '整理笔记', scheduledAt: null, scheduledOn: '2026-09-15', scheduledDate: '2026-09-15', scheduledTime: null, estimateMinutes: 25, status: 'pending', outcomeEventId: null, completionRecordId: null },
    { id: 'occurrence:done', taskId: 'task:series', occurrenceId: 'occurrence:done', title: '复习卡片', scheduledAt: '2026-09-16T11:30:00.000Z', scheduledOn: null, scheduledDate: '2026-09-16', scheduledTime: '19:30', estimateMinutes: null, status: 'completed', outcomeEventId: 'event:done', completionRecordId: 'record:b' },
  ]
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
      reviewCoverage: {
        due: { value: 2, recordIds: ['record:a', 'record:b'], facts: [
          { id: 'review:due', recordId: 'record:a', reviewTaskId: 'task:review-due', occurrenceId: 'occurrence:review-due', reviewStage: 0, dueOn: '2026-09-15', sourceTitle: '整理笔记', state: 'overdue', completedAt: null, reviewedOn: null, result: null },
          { id: 'review:complete', recordId: 'record:b', reviewTaskId: 'task:review-complete', occurrenceId: null, reviewStage: 1, dueOn: '2026-09-16', sourceTitle: '复习卡片', state: 'completed', completedAt: '2026-09-16T08:00:00.000Z', reviewedOn: '2026-09-16', result: 'clear' },
        ] },
        completed: { value: 1, recordIds: ['record:b'], facts: [
          { id: 'review:complete', recordId: 'record:b', reviewTaskId: 'task:review-complete', occurrenceId: null, reviewStage: 1, dueOn: '2026-09-16', sourceTitle: '复习卡片', state: 'completed', completedAt: '2026-09-16T08:00:00.000Z', reviewedOn: '2026-09-16', result: 'clear' },
        ] },
        scheduledCount: 0, dueTodayCount: 0, overdueCount: 1,
      },
      currentPlans: {
        planned: { value: 2, facts: plannedFacts },
        completed: { value: 1, facts: [plannedFacts[1]] },
        cancelled: { value: 0, facts: [] },
        skipped: { value: 0, facts: [] },
        estimatedMinutes: { value: 25, facts: [plannedFacts[0]] },
        unestimatedCount: 1,
        evidenceCoverage: {
          eligible: { value: 1, facts: [plannedFacts[1]] },
          covered: { value: 1, facts: [plannedFacts[1]] },
          missing: { value: 0, facts: [] },
        },
      },
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
  assert.match(template, /本周计划现状/)
  assert.match(template, /topic\.currentPlans\.planned\.facts/)
  assert.match(template, /topic\.currentPlans\.completed\.facts/)
  assert.match(template, /topic\.currentPlans\.cancelled\.facts/)
  assert.match(template, /topic\.currentPlans\.skipped\.facts/)
  assert.equal(template.match(/:disabled="!topic\.currentPlans\.(?:planned|completed|cancelled|skipped)\.facts\.length"/g)?.length, 4)
  assert.match(template, /预计.*topic\.currentPlans\.estimatedMinutes\.value.*分钟/)
  assert.match(template, /topic\.currentPlans\.unestimatedCount/)
  assert.match(template, /完成证据覆盖/)
  assert.match(template, /topic\.currentPlans\.evidenceCoverage\.covered/)
  assert.match(template, /本周暂无已完成计划/)
  assert.match(template, /本周复习覆盖/)
  assert.match(template, /topic\.reviewCoverage\.due\.facts/)
  assert.match(template, /topic\.reviewCoverage\.completed\.facts/)
  assert.match(template, /data-due-review-id/)
  assert.match(source, /emit\('openRecord', fact\.recordId\)/)
  assert.match(template, /data-plan-source-id/)
  assert.match(source, /emit\('openPlanSource', fact\.taskId, fact\.occurrenceId\)/)
  assert.match(template, /返回本周证据/)
  assert.match(css, /weekly-metrics[\s\S]*min-height:\s*64px/)
  assert.match(css, /plan-metrics[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /plan-metrics[\s\S]*min-height:\s*(?:44|5\d|6\d)px/)
  assert.match(css, /plan-scope\s+:deep\(\.btn\)\s*\{[^}]*min-height:\s*44px/)
  assert.match(css, /@media\s*\(max-width:\s*439px\)/)
  assert.match(css, /@media\s*\(max-width:\s*439px\)[\s\S]*plan-metrics[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(css, /coverage-metrics[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /due-review-row[\s\S]*min-height:\s*(?:44|5\d|6\d)px/)
  assert.doesNotMatch(source, /kind:\s*'weekly-summary'|section:\s*'summary'/)
})

test('weekly due-review drilldown opens the exact pending task or completed record and restores focus', async () => {
  const { Component } = loadSetup()
  const props = Vue.reactive<any>({
    item: undefined, remaining: 0, revealed: false, weeklySummary: summary(),
    records: [], topics: [], initialMode: 'review', recordTarget: undefined,
  })
  const events: unknown[][] = []
  let state: any
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const app = renderer.createApp({ setup() { state = Component.setup(props, { expose() {}, emit: (...args: unknown[]) => events.push(args) }); return () => Vue.h('div') } })
  app.mount({})

  const facts = summary().topics[0].reviewCoverage.due.facts
  let focused = ''
  state.dueReviewScope.value = { focus() { focused = 'scope' } }
  await state.showWeeklyDueReviews(facts, 'Agent 系统 · 本周应复习', 'topic:a:reviews-due')
  assert.equal(state.weeklyDueReviewLabel.value, 'Agent 系统 · 本周应复习')
  assert.equal(focused, 'scope')
  assert.equal(state.dueReviewSourceLabel(facts[0]), '已逾期，整理笔记，第 1 次复习，到期 9 月 15 日')
  assert.equal(state.dueReviewSourceLabel(facts[1]), '已完成，复习卡片，第 2 次复习，到期 9 月 16 日，完成 9 月 16 日，记得清楚')

  state.openDueReviewSource(facts[0])
  state.openDueReviewSource(facts[1])
  assert.deepEqual(events, [
    ['openPlanSource', 'task:review-due', 'occurrence:review-due'],
    ['openRecord', 'record:b'],
  ])

  state.dueReviewMetricButtons.set('topic:a:reviews-due', { focus() { focused = 'metric' } })
  await state.hideWeeklyDueReviews()
  assert.equal(state.weeklyDueReviewFacts.value, null)
  assert.equal(focused, 'metric')
  app.unmount()
})

test('weekly plan drilldown focuses its source, emits exact identity, and restores its metric focus', async () => {
  const { Component } = loadSetup()
  const props = Vue.reactive<any>({
    item: undefined, remaining: 0, revealed: false, weeklySummary: summary(),
    records: [], topics: [], initialMode: 'review', recordTarget: undefined,
  })
  const events: unknown[][] = []
  let state: any
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const app = renderer.createApp({ setup() { state = Component.setup(props, { expose() {}, emit: (...args: unknown[]) => events.push(args) }); return () => Vue.h('div') } })
  app.mount({})

  const plans = summary().topics[0].currentPlans.planned.facts
  let focused = ''
  state.planButtons.set(plans[0].id, { focus() { focused = 'source' } })
  await state.showWeeklyPlans([plans[0]], 'Agent 系统 · 计划', 'topic:a:planned')
  assert.equal(state.weeklyPlanFilterLabel.value, 'Agent 系统 · 计划')
  assert.equal(state.weeklyPlanFacts.value[0].id, 'task:plan')
  assert.equal(focused, 'source')
  assert.equal(state.planSourceLabel(plans[0]), '待完成，整理笔记，9 月 15 日 · 全天，预计 25 分钟')
  assert.equal(state.planSourceLabel(plans[1]), '已完成，复习卡片，9 月 16 日 · 19:30，未估时')

  state.openPlanSource(plans[0])
  state.openPlanSource(plans[1])
  assert.deepEqual(events, [
    ['openPlanSource', 'task:plan', null],
    ['openPlanSource', 'task:series', 'occurrence:done'],
  ])

  state.planScope.value = { focus() { focused = 'scope' } }
  await state.showWeeklyPlans(plans, 'Agent 系统 · 全部计划', 'topic:a:planned')
  assert.equal(focused, 'scope')

  state.planMetricButtons.set('topic:a:planned', { focus() { focused = 'metric' } })
  await state.hideWeeklyPlans()
  assert.equal(state.weeklyPlanFacts.value, null)
  assert.equal(focused, 'metric')
  app.unmount()
})
