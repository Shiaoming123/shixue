<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { Brain, CheckCircle2, ChevronRight, FileCheck2, RotateCcw, Search, Sparkles } from '@lucide/vue'
import type { WeeklyLearningDueReviewFact, WeeklyLearningDueReviewState, WeeklyLearningPlanFact, WeeklyLearningPlanStatus, WeeklyLearningReviewFact, WeeklyLearningSummary } from '../../domain/views/weekly-learning-summary.ts'
import Button from '../ui/Button.vue'
import Listbox from '../ui/Listbox.vue'

export interface ReviewViewItem { id: string; linkId: string; topic: string; learned: string; evidence: string; ageLabel: string }
export interface CompletionRecordViewItem {
  id: string
  taskId: string
  topicId: string | null
  topic: string
  taskTitle: string
  learned: string
  evidence: string
  blocker: string
  nextAction: string
  mastery: number | null
  completedLabel: string
  minutes: number
}
export interface RecordTopicOption { id: string; title: string }

const props = defineProps<{
  item?: ReviewViewItem
  remaining: number
  revealed: boolean
  busy?: boolean
  refreshRequired?: boolean
  weeklySummary: WeeklyLearningSummary
  records: CompletionRecordViewItem[]
  topics: RecordTopicOption[]
  initialMode?: 'review' | 'records'
  recordTarget?: { id: string; requestId: number }
}>()

const emit = defineEmits<{
  reveal: []
  reload: []
  rate: [linkId: string, result: 'clear' | 'fuzzy' | 'relearn']
  createTask: [recordId: string]
  openTask: [taskId: string]
  openRecord: [recordId: string]
  openPlanSource: [taskId: string, occurrenceId: string | null]
}>()

const mode = ref<'review' | 'records'>(props.initialMode ?? 'review')
const reviewCard = ref<HTMLElement | null>(null)
const query = ref('')
const topicId = ref('')
const selectedRecordId = ref('')
const weeklyRecordIds = ref<string[] | null>(null)
const weeklyFilterLabel = ref('')
const weeklyReviewFacts = ref<WeeklyLearningReviewFact[]>([])
const recordScope = ref<HTMLElement | null>(null)
const recordButtons = new Map<string, HTMLButtonElement>()
const weeklyPlanFacts = ref<WeeklyLearningPlanFact[] | null>(null)
const weeklyPlanFilterLabel = ref('')
const weeklyPlanTriggerKey = ref('')
const planScope = ref<HTMLElement | null>(null)
const planButtons = new Map<string, HTMLButtonElement>()
const planMetricButtons = new Map<string, HTMLButtonElement>()
const weeklyDueReviewFacts = ref<WeeklyLearningDueReviewFact[] | null>(null)
const weeklyDueReviewLabel = ref('')
const weeklyDueReviewTriggerKey = ref('')
const dueReviewScope = ref<HTMLElement | null>(null)
const dueReviewButtons = new Map<string, HTMLButtonElement>()
const dueReviewMetricButtons = new Map<string, HTMLButtonElement>()
const reviewResultLabels = { clear: '记得清楚', fuzzy: '有点模糊', relearn: '需要重学' } as const
const planStatusLabels: Record<WeeklyLearningPlanStatus, string> = { pending: '待完成', completed: '已完成', cancelled: '已取消', skipped: '已跳过' }
const dueReviewStateLabels: Record<WeeklyLearningDueReviewState, string> = { scheduled: '本周稍后', due: '今日到期', overdue: '已逾期', completed: '已完成' }
watch(() => props.initialMode, (value) => { if (value) mode.value = value })
watch(() => props.item?.linkId, async (linkId) => {
  if (!linkId) return
  mode.value = 'review'
  await nextTick()
  reviewCard.value?.focus()
}, { immediate: true })
watch(() => props.recordTarget, async (target) => {
  if (!target) return
  mode.value = 'records'
  query.value = ''
  topicId.value = ''
  weeklyRecordIds.value = null
  weeklyFilterLabel.value = ''
  weeklyReviewFacts.value = []
  selectedRecordId.value = target.id
  await nextTick()
  const button = recordButtons.get(target.id)
  button?.scrollIntoView({ block: 'nearest' })
  button?.focus({ preventScroll: true })
}, { immediate: true })

function setRecordButton(id: string, value: Element | ComponentPublicInstance | null) {
  if (value instanceof HTMLButtonElement) recordButtons.set(id, value)
  else recordButtons.delete(id)
}

function resolveButton(value: Element | ComponentPublicInstance | null): HTMLButtonElement | null {
  if (value instanceof HTMLButtonElement) return value
  const element = value && '$el' in value ? value.$el : null
  return element instanceof HTMLButtonElement ? element : null
}

function setPlanButton(id: string, value: Element | ComponentPublicInstance | null) {
  const button = resolveButton(value)
  if (button) planButtons.set(id, button)
  else planButtons.delete(id)
}

function setPlanMetricButton(key: string, value: Element | ComponentPublicInstance | null) {
  const button = resolveButton(value)
  if (button) planMetricButtons.set(key, button)
  else planMetricButtons.delete(key)
}

function setDueReviewButton(id: string, value: Element | ComponentPublicInstance | null) {
  const button = resolveButton(value)
  if (button) dueReviewButtons.set(id, button)
  else dueReviewButtons.delete(id)
}

function setDueReviewMetricButton(key: string, value: Element | ComponentPublicInstance | null) {
  const button = resolveButton(value)
  if (button) dueReviewMetricButtons.set(key, button)
  else dueReviewMetricButtons.delete(key)
}

const topicOptions = computed(() => [
  { value: '', label: '全部主题' },
  ...props.topics.map((topic) => ({ value: topic.id, label: topic.title })),
])

const filteredRecords = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  const weeklyIds = weeklyRecordIds.value ? new Set(weeklyRecordIds.value) : null
  return props.records.filter((record) => {
    if (weeklyIds && !weeklyIds.has(record.id)) return false
    if (topicId.value && record.topicId !== topicId.value) return false
    return !normalized || `${record.taskTitle} ${record.learned} ${record.evidence} ${record.blocker} ${record.nextAction}`.toLocaleLowerCase().includes(normalized)
  })
})

async function showWeeklyRecords(
  recordIds: readonly string[],
  label: string,
  reviewFacts: readonly WeeklyLearningReviewFact[] = [],
) {
  if (!recordIds.length) return
  mode.value = 'records'
  query.value = ''
  topicId.value = ''
  weeklyRecordIds.value = [...recordIds]
  weeklyFilterLabel.value = label
  weeklyReviewFacts.value = [...reviewFacts]
  selectedRecordId.value = recordIds.length === 1 ? recordIds[0]! : ''
  await nextTick()
  if (recordIds.length === 1) recordButtons.get(recordIds[0]!)?.focus({ preventScroll: true })
  else recordScope.value?.focus({ preventScroll: true })
}

function showAllRecords() {
  mode.value = 'records'
  weeklyRecordIds.value = null
  weeklyFilterLabel.value = ''
  weeklyReviewFacts.value = []
  selectedRecordId.value = ''
}

function metricKey(topicId: string | null, metric: string): string {
  return `${topicId ?? 'unassigned'}:${metric}`
}

async function showWeeklyPlans(facts: readonly WeeklyLearningPlanFact[], label: string, triggerKey: string) {
  if (!facts.length) return
  weeklyDueReviewFacts.value = null
  weeklyPlanFacts.value = [...facts]
  weeklyPlanFilterLabel.value = label
  weeklyPlanTriggerKey.value = triggerKey
  await nextTick()
  if (facts.length === 1) planButtons.get(facts[0]!.id)?.focus({ preventScroll: true })
  else planScope.value?.focus({ preventScroll: true })
}

async function hideWeeklyPlans() {
  const triggerKey = weeklyPlanTriggerKey.value
  weeklyPlanFacts.value = null
  weeklyPlanFilterLabel.value = ''
  weeklyPlanTriggerKey.value = ''
  await nextTick()
  planMetricButtons.get(triggerKey)?.focus({ preventScroll: true })
}

function openPlanSource(fact: WeeklyLearningPlanFact) {
  emit('openPlanSource', fact.taskId, fact.occurrenceId)
}

function planRecordIds(facts: readonly WeeklyLearningPlanFact[]): string[] {
  return facts.flatMap(({ completionRecordId }) => completionRecordId ? [completionRecordId] : [])
}

async function showWeeklyDueReviews(facts: readonly WeeklyLearningDueReviewFact[], label: string, triggerKey: string) {
  if (!facts.length) return
  weeklyPlanFacts.value = null
  weeklyDueReviewFacts.value = [...facts]
  weeklyDueReviewLabel.value = label
  weeklyDueReviewTriggerKey.value = triggerKey
  await nextTick()
  if (facts.length === 1) dueReviewButtons.get(facts[0]!.id)?.focus({ preventScroll: true })
  else dueReviewScope.value?.focus({ preventScroll: true })
}

async function hideWeeklyDueReviews() {
  const triggerKey = weeklyDueReviewTriggerKey.value
  weeklyDueReviewFacts.value = null
  weeklyDueReviewLabel.value = ''
  weeklyDueReviewTriggerKey.value = ''
  await nextTick()
  dueReviewMetricButtons.get(triggerKey)?.focus({ preventScroll: true })
}

function openDueReviewSource(fact: WeeklyLearningDueReviewFact) {
  if (fact.state === 'completed') emit('openRecord', fact.recordId)
  else emit('openPlanSource', fact.reviewTaskId, fact.occurrenceId)
}

function formatRange(start: string, endExclusive: string): string {
  const end = new Date(`${endExclusive}T12:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() - 1)
  return `${formatDay(start)}至 ${end.getUTCMonth() + 1} 月 ${end.getUTCDate()} 日`
}

function formatDay(value: string): string {
  const [, , month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? []
  return month && day ? `${Number(month)} 月 ${Number(day)} 日` : value
}

function reviewResultLabel(result: WeeklyLearningReviewFact['result']): string {
  return result ? reviewResultLabels[result] : '结果未记录'
}

function dueReviewSourceLabel(fact: WeeklyLearningDueReviewFact): string {
  const completion = fact.reviewedOn ? `，完成 ${formatDay(fact.reviewedOn)}` : ''
  const result = fact.result ? `，${reviewResultLabel(fact.result)}` : ''
  return `${dueReviewStateLabels[fact.state]}，${fact.sourceTitle}，第 ${fact.reviewStage + 1} 次复习，到期 ${formatDay(fact.dueOn)}${completion}${result}`
}

function formatPlanSchedule(fact: WeeklyLearningPlanFact): string {
  return `${formatDay(fact.scheduledDate)} · ${fact.scheduledTime ?? '全天'}`
}

function planSourceLabel(fact: WeeklyLearningPlanFact): string {
  return `${planStatusLabels[fact.status]}，${fact.title}，${formatPlanSchedule(fact)}，${fact.estimateMinutes === null ? '未估时' : `预计 ${fact.estimateMinutes} 分钟`}`
}
</script>

<template>
  <section class="review-view">
    <div class="segmented" aria-label="回顾范围">
      <button :class="{ active: mode === 'review' }" @click="mode = 'review'">待复习 <span>{{ remaining }}</span></button>
      <button :class="{ active: mode === 'records' }" @click="showAllRecords">完成记录</button>
    </div>

    <template v-if="mode === 'review'">
      <header class="page-header"><p>5 分钟回顾</p><h1>确认自己是否真的记住</h1><span>{{ remaining > 0 ? `还有 ${remaining} 条到期记录` : '今天的到期记录已经完成' }}</span></header>
      <p v-if="refreshRequired" role="status">复习结果已保存，需重新加载后继续。<Button variant="ghost" size="sm" @click="emit('reload')">重新加载复习结果</Button></p>
      <article v-if="item" ref="reviewCard" class="review-card" :data-review-link-id="item.linkId" tabindex="-1" :aria-busy="busy">
        <div class="review-meta"><Brain :size="20" />{{ item.ageLabel }}你记录了 · {{ item.topic }}</div>
        <blockquote>{{ item.learned }}</blockquote>
        <template v-if="!revealed"><p class="question">不看原记录，你能解释为什么吗？</p><button class="reveal" @click="emit('reveal')">想过了，查看证据</button></template>
        <template v-else>
          <div class="evidence"><small>当时留下的证据</small><p>{{ item.evidence }}</p></div>
          <p class="prompt">现在回忆得怎么样？</p>
          <div class="rating-actions">
            <button class="relearn" :disabled="busy" @click="emit('rate', item.linkId, 'relearn')"><RotateCcw :size="17" />需要重学</button>
            <button class="fuzzy" :disabled="busy" @click="emit('rate', item.linkId, 'fuzzy')"><Sparkles :size="17" />有点模糊</button>
            <button class="clear" :disabled="busy" @click="emit('rate', item.linkId, 'clear')"><CheckCircle2 :size="17" />记得清楚</button>
          </div>
        </template>
      </article>
      <article v-else class="empty"><CheckCircle2 :size="34" :stroke-width="1.5" /><h2>今天的回顾完成了</h2><p>重要的知识会在下一次到期时再次出现。</p></article>
      <section class="weekly-summary">
        <header><div><h2>本周证据</h2><p>{{ formatRange(weeklySummary.rangeStart, weeklySummary.rangeEnd) }}</p></div><p>完成 <strong>{{ weeklySummary.totals.evidenceCompletions.value }}</strong> 次 · 有证据专注 <strong>{{ weeklySummary.totals.evidenceMinutes.value }}</strong> 分钟 · 回顾 <strong>{{ weeklySummary.totals.completedReviews.value }}</strong> 次</p></header>
        <template v-if="weeklyDueReviewFacts">
          <div ref="dueReviewScope" class="due-review-scope" tabindex="-1">
            <span>正在查看：{{ weeklyDueReviewLabel }}</span>
            <Button variant="ghost" size="sm" @click="hideWeeklyDueReviews">返回本周证据</Button>
          </div>
          <div class="due-review-list">
            <button v-for="fact in weeklyDueReviewFacts" :key="fact.id" :ref="(value) => setDueReviewButton(fact.id, value)" class="due-review-row" :data-due-review-id="fact.id" :data-record-id="fact.recordId" :aria-label="dueReviewSourceLabel(fact)" @click="openDueReviewSource(fact)">
              <span class="due-review-state">{{ dueReviewStateLabels[fact.state] }}</span>
              <span><strong>{{ fact.sourceTitle }}</strong><small>到期 {{ formatDay(fact.dueOn) }} · 第 {{ fact.reviewStage + 1 }} 次复习<template v-if="fact.reviewedOn"> · 完成 {{ formatDay(fact.reviewedOn) }}</template><template v-if="fact.result"> · {{ reviewResultLabel(fact.result) }}</template></small></span>
              <ChevronRight :size="18" aria-hidden="true" />
            </button>
          </div>
        </template>
        <template v-else-if="weeklyPlanFacts">
          <div ref="planScope" class="plan-scope" tabindex="-1">
            <span>正在查看：{{ weeklyPlanFilterLabel }}</span>
            <Button variant="ghost" size="sm" @click="hideWeeklyPlans">返回本周证据</Button>
          </div>
          <div class="plan-source-list">
            <button v-for="fact in weeklyPlanFacts" :key="fact.id" :ref="(value) => setPlanButton(fact.id, value)" class="plan-source-row" :data-plan-source-id="fact.id" :aria-label="planSourceLabel(fact)" @click="openPlanSource(fact)">
              <span class="plan-source-state">{{ planStatusLabels[fact.status] }}</span>
              <span><strong>{{ fact.title }}</strong><small>{{ formatPlanSchedule(fact) }} · {{ fact.estimateMinutes === null ? '未估时' : `预计 ${fact.estimateMinutes} 分钟` }}</small></span>
              <ChevronRight :size="18" aria-hidden="true" />
            </button>
          </div>
        </template>
        <div v-else-if="weeklySummary.topics.length" class="weekly-topics">
          <article v-for="topic in weeklySummary.topics" :key="topic.topicId ?? 'unassigned'">
            <h3>{{ topic.topicTitle }}</h3>
            <div class="weekly-metrics">
              <Button variant="secondary" :disabled="!topic.evidenceCompletions.recordIds.length" @click="showWeeklyRecords(topic.evidenceCompletions.recordIds, `${topic.topicTitle} · 有证据完成`)"><strong>{{ topic.evidenceCompletions.value }}</strong><span>有证据完成</span></Button>
              <Button variant="secondary" :disabled="!topic.evidenceMinutes.recordIds.length" @click="showWeeklyRecords(topic.evidenceMinutes.recordIds, `${topic.topicTitle} · 有证据专注`)"><strong>{{ topic.evidenceMinutes.value }}</strong><span>有证据专注分钟</span></Button>
              <Button variant="secondary" :disabled="!topic.completedReviews.recordIds.length" @click="showWeeklyRecords(topic.completedReviews.recordIds, `${topic.topicTitle} · 已完成回顾`, topic.completedReviewFacts)"><strong>{{ topic.completedReviews.value }}</strong><span>完成回顾</span></Button>
            </div>
            <h4 class="plan-heading">本周计划现状</h4>
            <div class="plan-metrics">
              <Button :ref="(value) => setPlanMetricButton(metricKey(topic.topicId, 'planned'), value)" variant="secondary" :disabled="!topic.currentPlans.planned.facts.length" @click="showWeeklyPlans(topic.currentPlans.planned.facts, `${topic.topicTitle} · 全部计划`, metricKey(topic.topicId, 'planned'))"><strong>{{ topic.currentPlans.planned.value }}</strong><span>计划</span><small>预计 {{ topic.currentPlans.estimatedMinutes.value }} 分钟<template v-if="topic.currentPlans.unestimatedCount"> · {{ topic.currentPlans.unestimatedCount }} 项未估时</template></small></Button>
              <Button :ref="(value) => setPlanMetricButton(metricKey(topic.topicId, 'completed'), value)" variant="secondary" :disabled="!topic.currentPlans.completed.facts.length" @click="showWeeklyPlans(topic.currentPlans.completed.facts, `${topic.topicTitle} · 已完成计划`, metricKey(topic.topicId, 'completed'))"><strong>{{ topic.currentPlans.completed.value }}</strong><span>完成</span></Button>
              <Button :ref="(value) => setPlanMetricButton(metricKey(topic.topicId, 'cancelled'), value)" variant="secondary" :disabled="!topic.currentPlans.cancelled.facts.length" @click="showWeeklyPlans(topic.currentPlans.cancelled.facts, `${topic.topicTitle} · 已取消计划`, metricKey(topic.topicId, 'cancelled'))"><strong>{{ topic.currentPlans.cancelled.value }}</strong><span>取消</span></Button>
              <Button :ref="(value) => setPlanMetricButton(metricKey(topic.topicId, 'skipped'), value)" variant="secondary" :disabled="!topic.currentPlans.skipped.facts.length" @click="showWeeklyPlans(topic.currentPlans.skipped.facts, `${topic.topicTitle} · 已跳过计划`, metricKey(topic.topicId, 'skipped'))"><strong>{{ topic.currentPlans.skipped.value }}</strong><span>跳过</span></Button>
            </div>
            <h4 class="coverage-heading">完成证据覆盖</h4>
            <p v-if="!topic.currentPlans.evidenceCoverage.eligible.value" class="coverage-empty">本周暂无已完成计划</p>
            <div v-else class="coverage-metrics">
              <Button variant="secondary" :disabled="!topic.currentPlans.evidenceCoverage.covered.value" @click="showWeeklyRecords(planRecordIds(topic.currentPlans.evidenceCoverage.covered.facts), `${topic.topicTitle} · 已留完成证据`)"><strong>{{ topic.currentPlans.evidenceCoverage.covered.value }} / {{ topic.currentPlans.evidenceCoverage.eligible.value }}</strong><span>已留证据</span></Button>
              <Button :ref="(value) => setPlanMetricButton(metricKey(topic.topicId, 'evidence-missing'), value)" variant="secondary" :disabled="!topic.currentPlans.evidenceCoverage.missing.facts.length" @click="showWeeklyPlans(topic.currentPlans.evidenceCoverage.missing.facts, `${topic.topicTitle} · 待补完成证据`, metricKey(topic.topicId, 'evidence-missing'))"><strong>{{ topic.currentPlans.evidenceCoverage.missing.value }}</strong><span>待补证据</span></Button>
            </div>
            <h4 class="coverage-heading">本周复习覆盖</h4>
            <div class="coverage-metrics">
              <Button :ref="(value) => setDueReviewMetricButton(metricKey(topic.topicId, 'reviews-due'), value)" variant="secondary" :disabled="!topic.reviewCoverage.due.facts.length" @click="showWeeklyDueReviews(topic.reviewCoverage.due.facts, `${topic.topicTitle} · 本周应复习`, metricKey(topic.topicId, 'reviews-due'))"><strong>{{ topic.reviewCoverage.due.value }}</strong><span>本周应复习</span><small>稍后 {{ topic.reviewCoverage.scheduledCount }} · 今日 {{ topic.reviewCoverage.dueTodayCount }} · 逾期 {{ topic.reviewCoverage.overdueCount }}</small></Button>
              <Button :ref="(value) => setDueReviewMetricButton(metricKey(topic.topicId, 'reviews-completed'), value)" variant="secondary" :disabled="!topic.reviewCoverage.completed.facts.length" @click="showWeeklyDueReviews(topic.reviewCoverage.completed.facts, `${topic.topicTitle} · 本周到期且已完成`, metricKey(topic.topicId, 'reviews-completed'))"><strong>{{ topic.reviewCoverage.completed.value }}</strong><span>已完成到期复习</span></Button>
            </div>
          </article>
        </div>
        <p v-else class="weekly-empty">本周还没有可归因的学习证据或回顾。</p>
      </section>
    </template>

    <template v-else>
      <header class="page-header"><p>学习证据</p><h1>完成记录</h1><span>每次完成都保留原始收获、证据与下一步。</span></header>
      <div v-if="weeklyRecordIds" ref="recordScope" class="record-scope" tabindex="-1">
        <div><span>正在查看：{{ weeklyFilterLabel }}</span><ul v-if="weeklyReviewFacts.length" class="review-facts"><li v-for="fact in weeklyReviewFacts" :key="fact.id" :data-review-link-id="fact.id"><span>{{ formatDay(fact.reviewedOn) }}</span><span>{{ reviewResultLabel(fact.result) }}</span><code>{{ fact.id }}</code></li></ul></div>
        <Button variant="ghost" size="sm" @click="showAllRecords">显示全部记录</Button>
      </div>
      <div class="record-tools">
        <label><Search :size="17" /><input v-model="query" aria-label="搜索完成记录" placeholder="搜索收获、证据或下一步" /></label>
        <Listbox v-model="topicId" class="record-topic-listbox" :options="topicOptions" label="按主题筛选" />
      </div>
      <div v-if="filteredRecords.length" class="record-list">
        <article v-for="record in filteredRecords" :key="record.id" :class="{ expanded: selectedRecordId === record.id }">
          <button :ref="(value) => setRecordButton(record.id, value)" class="record-main" :data-record-id="record.id" @click="selectedRecordId = selectedRecordId === record.id ? '' : record.id">
            <span class="record-icon"><FileCheck2 :size="18" /></span>
            <span><small class="tabular-numbers">{{ record.completedLabel }} · {{ record.topic }} · {{ record.minutes }} 分钟</small><strong>{{ record.learned }}</strong><b>证据：{{ record.evidence }}</b></span>
            <ChevronRight :size="18" />
          </button>
          <div v-if="selectedRecordId === record.id" class="record-detail">
            <dl>
              <div v-if="record.blocker"><dt>仍然卡住</dt><dd>{{ record.blocker }}</dd></div>
              <div><dt>下一步</dt><dd>{{ record.nextAction }}</dd></div>
              <div><dt>掌握程度</dt><dd>{{ record.mastery ? `${record.mastery} / 5` : '未评分' }}</dd></div>
            </dl>
            <footer><button @click="emit('openTask', record.taskId)">查看原任务</button><button class="create" @click="emit('createTask', record.id)">从下一步建任务</button></footer>
          </div>
        </article>
      </div>
      <article v-else class="empty">
        <Search v-if="query || topicId" :size="34" :stroke-width="1.5" /><FileCheck2 v-else :size="34" :stroke-width="1.5" />
        <h2>{{ query || topicId ? '没有匹配的完成记录' : '还没有完成记录' }}</h2>
        <p>{{ query || topicId ? '换个关键词或清除筛选后再试。' : '完成一次学习并写下收获后，它会沉淀在这里。' }}</p>
        <button v-if="query || topicId" @click="query = ''; topicId = ''">清除筛选</button>
      </article>
    </template>
  </section>
</template>

<style scoped>
.review-view { width: min(100%, 790px); margin: 0 auto; padding: 32px 32px 100px; }.segmented { width: max-content; display: flex; padding: 3px; margin-bottom: 24px; border-radius: var(--radius-lg); background: var(--control-fill); }.segmented button { min-height: 36px; padding: 0 14px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted); font-size: 12px; }.segmented button.active { background: var(--surface); box-shadow: var(--shadow-sm); color: var(--text); }.segmented span { color: var(--accent); }
.page-header { padding-bottom: 24px; border-bottom: 1px solid var(--border); }.page-header p { margin: 0 0 8px; color: var(--accent); font-size: 12px; font-weight: 600; }.page-header h1 { margin: 0 0 9px; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.02em; }.page-header > span { color: var(--muted); font-size: 13px; }
.review-card { margin-top: 24px; padding: 24px; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-sm); }.review-meta { display: flex; align-items: center; gap: 9px; color: var(--accent); font-size: 12px; font-weight: 600; } blockquote { margin: 25px 0; padding-left: 18px; border-left: 2px solid var(--accent); font-size: 18px; line-height: 1.5; font-weight: 570; letter-spacing: -.01em; }.question { margin: 0; padding-top: 19px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }.reveal { width: 100%; min-height: 50px; margin-top: 18px; border: 0; border-radius: 12px; background: var(--accent); color: var(--accent-text); font-size: 14px; font-weight: 600; }.evidence { padding: 16px 17px; border-radius: 12px; background: var(--surface-alt); }.evidence small { color: var(--muted); font-size: 10px; }.evidence p { margin: 6px 0 0; font-size: 13px; }.prompt { margin: 20px 0 10px; font-size: 13px; font-weight: 600; }.rating-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }.rating-actions button { min-height: 47px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface-alt); color: var(--text); font-size: 12px; }.rating-actions .clear { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }.rating-actions .fuzzy { color: var(--warning); }.rating-actions .relearn { color: var(--danger); }
.weekly-summary { margin-top: 38px; padding-top: 24px; border-top: 1px solid var(--border); }.weekly-summary > header { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-4); }.weekly-summary h2 { margin: 0 0 5px; font-size: 18px; }.weekly-summary header p { margin: 0; color: var(--muted); font-size: 12px; }.weekly-summary header > p { text-align: right; }.weekly-summary strong { color: var(--accent); font-variant-numeric: tabular-nums; }.weekly-topics { display: grid; gap: 20px; margin-top: 24px; }.weekly-topics > article { padding: 24px; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-sm); }.weekly-topics h3 { margin: 0 0 var(--space-3); font-size: var(--text-sm); font-weight: 620; }.weekly-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }.weekly-metrics :deep(.btn) { min-height: 64px; align-items: flex-start; flex-direction: column; gap: 5px; text-align: left; }.weekly-metrics :deep(.btn strong) { font-size: var(--text-md); }.weekly-metrics :deep(.btn span) { color: var(--muted); font-size: var(--text-xs); }.weekly-empty { margin: var(--space-4) 0 0; color: var(--muted); font-size: var(--text-sm); }.record-scope { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-4); padding: var(--space-2) var(--space-3); border-radius: var(--radius-lg); outline: none; background: var(--surface-alt); color: var(--muted); font-size: var(--text-xs); }.record-scope:focus-visible { box-shadow: var(--focus-ring); }.record-scope > div { min-width: 0; }.review-facts { display: grid; gap: var(--space-1); margin: var(--space-2) 0 0; padding: 0; list-style: none; }.review-facts li { display: flex; flex-wrap: wrap; gap: var(--space-2); }.review-facts code { overflow-wrap: anywhere; color: var(--text); }
.plan-heading { margin: var(--space-4) 0 var(--space-2); color: var(--muted); font-size: var(--text-xs); font-weight: 600; }.plan-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }.plan-metrics :deep(.btn) { min-width: 0; min-height: 58px; align-items: flex-start; flex-direction: column; gap: 4px; text-align: left; white-space: normal; }.plan-metrics :deep(.btn strong) { font-size: var(--text-md); }.plan-metrics :deep(.btn span), .plan-metrics :deep(.btn small) { color: var(--muted); font-size: var(--text-xs); line-height: 1.35; }.plan-scope { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-4); padding: var(--space-2) var(--space-3); border-radius: var(--radius-lg); outline: none; background: var(--surface-alt); color: var(--muted); font-size: var(--text-xs); }.plan-scope:focus-visible { box-shadow: var(--focus-ring); }.plan-scope :deep(.btn) { min-height: 44px; }.plan-source-list { margin-top: var(--space-3); border-bottom: 1px solid var(--border); }.plan-source-row { width: 100%; min-height: 68px; display: grid; grid-template-columns: max-content minmax(0, 1fr) 18px; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-2); border: 0; border-top: 1px solid var(--border); background: transparent; color: var(--text); text-align: left; }.plan-source-row:hover { background: color-mix(in srgb, var(--control-fill) 70%, transparent); }.plan-source-row:focus-visible { border-radius: var(--radius-md); box-shadow: var(--focus-ring); outline: 0; }.plan-source-state { padding: 4px 7px; border-radius: 999px; background: var(--surface-alt); color: var(--muted); font-size: 10px; }.plan-source-row > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 5px; }.plan-source-row strong, .plan-source-row small { overflow-wrap: anywhere; }.plan-source-row strong { color: var(--text); font-size: var(--text-sm); }.plan-source-row small { color: var(--muted); font-size: var(--text-xs); }.plan-source-row > svg { color: var(--muted); }
.coverage-heading { margin: var(--space-4) 0 var(--space-2); color: var(--muted); font-size: var(--text-xs); font-weight: 600; }.coverage-empty { min-height: 44px; display: flex; align-items: center; margin: 0; padding: 0 var(--space-3); border-radius: var(--radius-lg); background: var(--surface-alt); color: var(--muted); font-size: var(--text-xs); }.coverage-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }.coverage-metrics :deep(.btn) { min-width: 0; min-height: 58px; align-items: flex-start; flex-direction: column; gap: 4px; text-align: left; white-space: normal; }.coverage-metrics :deep(.btn strong) { font-size: var(--text-md); }.coverage-metrics :deep(.btn span), .coverage-metrics :deep(.btn small) { color: var(--muted); font-size: var(--text-xs); line-height: 1.35; }
.due-review-scope { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-4); padding: var(--space-2) var(--space-3); border-radius: var(--radius-lg); outline: none; background: var(--surface-alt); color: var(--muted); font-size: var(--text-xs); }.due-review-scope:focus-visible { box-shadow: var(--focus-ring); }.due-review-scope :deep(.btn) { min-height: 44px; }.due-review-list { margin-top: var(--space-3); border-bottom: 1px solid var(--border); }.due-review-row { width: 100%; min-height: 68px; display: grid; grid-template-columns: max-content minmax(0, 1fr) 18px; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-2); border: 0; border-top: 1px solid var(--border); background: transparent; color: var(--text); text-align: left; }.due-review-row:hover { background: color-mix(in srgb, var(--control-fill) 70%, transparent); }.due-review-row:focus-visible { border-radius: var(--radius-md); box-shadow: var(--focus-ring); outline: 0; }.due-review-state { padding: 4px 7px; border-radius: 999px; background: var(--surface-alt); color: var(--muted); font-size: 10px; }.due-review-row > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 5px; }.due-review-row strong, .due-review-row small { overflow-wrap: anywhere; }.due-review-row strong { color: var(--text); font-size: var(--text-sm); }.due-review-row small { color: var(--muted); font-size: var(--text-xs); }.due-review-row > svg { color: var(--muted); }
.record-tools { display: grid; grid-template-columns: 1fr 180px; gap: 12px; padding: 22px 0 16px; }.record-tools label { min-height: 42px; display: flex; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--muted); }.record-tools input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 12px; }
.record-list { padding: 12px 20px; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-sm); }.record-list > article + article { border-top: 1px solid var(--border); }.record-main { width: 100%; min-height: 86px; display: grid; grid-template-columns: 34px 1fr 20px; align-items: center; gap: 12px; padding: 11px 6px; border: 0; background: transparent; color: var(--text); text-align: left; }.record-icon { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--accent); border-radius: 50%; color: var(--accent); }.record-main > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 5px; }.record-main small, .record-main b { overflow: hidden; color: var(--muted); font-size: 10px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }.record-main strong { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.record-main > svg { color: var(--muted); transition: transform var(--motion-fast) var(--ease); }.expanded .record-main > svg { transform: rotate(90deg); }.record-detail { padding: 0 8px 18px 46px; }.record-detail dl { margin: 0; padding: 13px 15px; border-radius: 11px; background: var(--surface-alt); }.record-detail dl div { display: grid; grid-template-columns: 80px 1fr; gap: 12px; padding: 7px 0; font-size: 11px; }.record-detail dt { color: var(--muted); }.record-detail dd { margin: 0; }.record-detail footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 11px; }.record-detail footer button { min-height: 38px; padding: 0 13px; border: 1px solid var(--border); border-radius: 9px; background: transparent; color: var(--text); font-size: 11px; }.record-detail footer .create { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
.empty { min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 42px 22px; text-align: center; }.empty > svg { color: var(--accent); }.empty h2 { margin: 14px 0 6px; font-size: 18px; }.empty p { margin: 0; color: var(--muted); font-size: 12px; }.empty button { min-height: 40px; margin-top: 16px; padding: 0 14px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); color: var(--accent); }
.record-tools label { min-height: 44px; border-color: var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease); }.record-tools label:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.record-main { border-radius: var(--radius-md); }.record-main:hover { background: color-mix(in srgb, var(--control-fill) 70%, transparent); }
@media (max-width: 819px) { .review-view { padding: 27px 20px 126px; }.segmented { width: 100%; }.segmented button { flex: 1; }.review-card, .weekly-topics > article { padding: 20px; }.rating-actions { grid-template-columns: 1fr; }.weekly-summary > header { align-items: flex-start; flex-direction: column; }.weekly-summary header > p { text-align: left; }.record-tools { grid-template-columns: 1fr; }.record-main { min-height: 92px; }.record-detail { padding-left: 0; }.record-detail footer { align-items: stretch; flex-direction: column; }.record-detail footer button { min-height: 44px; } }
@media (max-width: 439px) { .weekly-metrics, .plan-metrics, .coverage-metrics { grid-template-columns: 1fr; }.weekly-metrics :deep(.btn), .plan-metrics :deep(.btn), .coverage-metrics :deep(.btn) { width: 100%; min-height: 58px; }.record-scope, .plan-scope, .due-review-scope { align-items: flex-start; flex-direction: column; }.plan-scope :deep(.btn), .due-review-scope :deep(.btn) { width: 100%; }.plan-source-row, .due-review-row { grid-template-columns: 1fr 18px; }.plan-source-state, .due-review-state { width: max-content; grid-column: 1 / -1; } }
</style>
