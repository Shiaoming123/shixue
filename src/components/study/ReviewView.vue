<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Brain, CheckCircle2, ChevronRight, FileCheck2, RotateCcw, Search, Sparkles } from '@lucide/vue'

export interface ReviewViewItem { id: string; topic: string; learned: string; evidence: string; ageLabel: string }
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
  weeklyCompleted: number
  weeklyMinutes: number
  weeklyHighlight: string
  weeklyBlocker: string
  weeklyNext: string
  records: CompletionRecordViewItem[]
  topics: RecordTopicOption[]
  initialMode?: 'review' | 'records'
}>()

const emit = defineEmits<{
  reveal: []
  rate: [result: 'clear' | 'fuzzy' | 'relearn']
  createTask: [recordId: string]
  openTask: [taskId: string]
}>()

const mode = ref<'review' | 'records'>(props.initialMode ?? 'review')
const query = ref('')
const topicId = ref('')
const selectedRecordId = ref('')
watch(() => props.initialMode, (value) => { if (value) mode.value = value })

const filteredRecords = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  return props.records.filter((record) => {
    if (topicId.value && record.topicId !== topicId.value) return false
    return !normalized || `${record.taskTitle} ${record.learned} ${record.evidence} ${record.blocker} ${record.nextAction}`.toLocaleLowerCase().includes(normalized)
  })
})
</script>

<template>
  <section class="review-view">
    <div class="segmented" aria-label="回顾范围">
      <button :class="{ active: mode === 'review' }" @click="mode = 'review'">待复习 <span>{{ remaining }}</span></button>
      <button :class="{ active: mode === 'records' }" @click="mode = 'records'">完成记录</button>
    </div>

    <template v-if="mode === 'review'">
      <header class="page-header"><p>5 分钟回顾</p><h1>确认自己是否真的记住</h1><span>{{ remaining > 0 ? `还有 ${remaining} 条到期记录` : '今天的到期记录已经完成' }}</span></header>
      <article v-if="item" class="review-card">
        <div class="review-meta"><Brain :size="20" />{{ item.ageLabel }}你记录了 · {{ item.topic }}</div>
        <blockquote>{{ item.learned }}</blockquote>
        <template v-if="!revealed"><p class="question">不看原记录，你能解释为什么吗？</p><button class="reveal" @click="emit('reveal')">想过了，查看证据</button></template>
        <template v-else>
          <div class="evidence"><small>当时留下的证据</small><p>{{ item.evidence }}</p></div>
          <p class="prompt">现在回忆得怎么样？</p>
          <div class="rating-actions">
            <button class="relearn" @click="emit('rate', 'relearn')"><RotateCcw :size="17" />需要重学</button>
            <button class="fuzzy" @click="emit('rate', 'fuzzy')"><Sparkles :size="17" />有点模糊</button>
            <button class="clear" @click="emit('rate', 'clear')"><CheckCircle2 :size="17" />记得清楚</button>
          </div>
        </template>
      </article>
      <article v-else class="empty"><CheckCircle2 :size="34" :stroke-width="1.5" /><h2>今天的回顾完成了</h2><p>重要的知识会在下一次到期时再次出现。</p></article>
      <section class="weekly-summary"><h2>本周回顾</h2><p>本周完成 <strong>{{ weeklyCompleted }}</strong> 次学习闭环 · 投入 {{ weeklyMinutes }} 分钟</p><dl><div><dt>最大进展</dt><dd>{{ weeklyHighlight }}</dd></div><div><dt>反复卡住</dt><dd>{{ weeklyBlocker }}</dd></div><div><dt>下周优先</dt><dd>{{ weeklyNext }}</dd></div></dl></section>
    </template>

    <template v-else>
      <header class="page-header"><p>学习证据</p><h1>完成记录</h1><span>每次完成都保留原始收获、证据与下一步。</span></header>
      <div class="record-tools">
        <label><Search :size="17" /><input v-model="query" aria-label="搜索完成记录" placeholder="搜索收获、证据或下一步" /></label>
        <select v-model="topicId" aria-label="按主题筛选"><option value="">全部主题</option><option v-for="topic in topics" :key="topic.id" :value="topic.id">{{ topic.title }}</option></select>
      </div>
      <div v-if="filteredRecords.length" class="record-list">
        <article v-for="record in filteredRecords" :key="record.id" :class="{ expanded: selectedRecordId === record.id }">
          <button class="record-main" @click="selectedRecordId = selectedRecordId === record.id ? '' : record.id">
            <span class="record-icon"><FileCheck2 :size="18" /></span>
            <span><small>{{ record.completedLabel }} · {{ record.topic }} · {{ record.minutes }} 分钟</small><strong>{{ record.learned }}</strong><b>证据：{{ record.evidence }}</b></span>
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
.review-view { width: min(100%, 790px); margin: 0 auto; padding: 44px 48px 100px; }.segmented { width: max-content; display: flex; padding: 3px; margin-bottom: 24px; border-radius: var(--radius-lg); background: var(--control-fill); }.segmented button { min-height: 36px; padding: 0 14px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted); font-size: 12px; }.segmented button.active { background: var(--surface); box-shadow: var(--shadow-sm); color: var(--text); }.segmented span { color: var(--accent); }
.page-header { padding-bottom: 24px; border-bottom: 1px solid var(--border); }.page-header p { margin: 0 0 8px; color: var(--accent); font-size: 12px; font-weight: 600; }.page-header h1 { margin: 0 0 9px; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.02em; }.page-header > span { color: var(--muted); font-size: 13px; }
.review-card { margin-top: 28px; padding: 27px 29px; border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border)); border-radius: 18px; background: var(--surface); box-shadow: 0 10px 32px color-mix(in srgb, var(--text) 6%, transparent); }.review-meta { display: flex; align-items: center; gap: 9px; color: var(--accent); font-size: 12px; font-weight: 600; } blockquote { margin: 25px 0; padding-left: 18px; border-left: 2px solid var(--accent); font-size: 18px; line-height: 1.5; font-weight: 570; letter-spacing: -.01em; }.question { margin: 0; padding-top: 19px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }.reveal { width: 100%; min-height: 50px; margin-top: 18px; border: 0; border-radius: 12px; background: var(--accent); color: var(--accent-text); font-size: 14px; font-weight: 600; }.evidence { padding: 16px 17px; border-radius: 12px; background: var(--surface-alt); }.evidence small { color: var(--muted); font-size: 10px; }.evidence p { margin: 6px 0 0; font-size: 13px; }.prompt { margin: 20px 0 10px; font-size: 13px; font-weight: 600; }.rating-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }.rating-actions button { min-height: 47px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface-alt); color: var(--text); font-size: 12px; }.rating-actions .clear { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }.rating-actions .fuzzy { color: var(--warning); }.rating-actions .relearn { color: var(--danger); }
.weekly-summary { margin-top: 38px; padding-top: 24px; border-top: 1px solid var(--border); }.weekly-summary h2 { margin: 0 0 9px; font-size: 18px; }.weekly-summary > p { margin: 0; color: var(--muted); font-size: 13px; }.weekly-summary strong { color: var(--accent); }.weekly-summary dl { margin: 19px 0 0; }.weekly-summary dl div { display: grid; grid-template-columns: 92px 1fr; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--border); font-size: 12px; }.weekly-summary dt { color: var(--muted); }.weekly-summary dd { margin: 0; }
.record-tools { display: grid; grid-template-columns: 1fr 180px; gap: 12px; padding: 22px 0 16px; }.record-tools label { min-height: 42px; display: flex; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--muted); }.record-tools input, .record-tools select { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 12px; }.record-tools select { padding: 0 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.record-list { border-bottom: 1px solid var(--border); }.record-list > article { border-top: 1px solid var(--border); }.record-main { width: 100%; min-height: 86px; display: grid; grid-template-columns: 34px 1fr 20px; align-items: center; gap: 12px; padding: 11px 6px; border: 0; background: transparent; color: var(--text); text-align: left; }.record-icon { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--accent); border-radius: 50%; color: var(--accent); }.record-main > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 5px; }.record-main small, .record-main b { overflow: hidden; color: var(--muted); font-size: 10px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }.record-main strong { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.record-main > svg { color: var(--muted); transition: transform var(--motion-fast) var(--ease); }.expanded .record-main > svg { transform: rotate(90deg); }.record-detail { padding: 0 8px 18px 46px; }.record-detail dl { margin: 0; padding: 13px 15px; border-radius: 11px; background: var(--surface-alt); }.record-detail dl div { display: grid; grid-template-columns: 80px 1fr; gap: 12px; padding: 7px 0; font-size: 11px; }.record-detail dt { color: var(--muted); }.record-detail dd { margin: 0; }.record-detail footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 11px; }.record-detail footer button { min-height: 38px; padding: 0 13px; border: 1px solid var(--border); border-radius: 9px; background: transparent; color: var(--text); font-size: 11px; }.record-detail footer .create { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
.empty { min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 42px 22px; text-align: center; }.empty > svg { color: var(--accent); }.empty h2 { margin: 14px 0 6px; font-size: 18px; }.empty p { margin: 0; color: var(--muted); font-size: 12px; }.empty button { min-height: 40px; margin-top: 16px; padding: 0 14px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); color: var(--accent); }
.review-card { border-color: color-mix(in srgb, var(--accent) 30%, var(--hairline)); border-radius: var(--radius-xl); box-shadow: var(--shadow-md); }
.record-tools label { min-height: 44px; border-color: var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease); }.record-tools label:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }.record-tools select { min-height: 44px; border-color: var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); }
.record-main { border-radius: var(--radius-md); }.record-main:hover { background: color-mix(in srgb, var(--control-fill) 70%, transparent); }
@media (max-width: 799px) { .review-view { padding: 27px 20px 126px; }.segmented { width: 100%; }.segmented button { flex: 1; }.review-card { padding: 22px 20px; }.rating-actions { grid-template-columns: 1fr; }.record-tools { grid-template-columns: 1fr; }.record-tools select { min-height: 42px; }.record-main { min-height: 92px; }.record-detail { padding-left: 0; }.record-detail footer { align-items: stretch; flex-direction: column; }.record-detail footer button { min-height: 44px; } }
</style>
