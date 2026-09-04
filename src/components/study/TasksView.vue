<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  Inbox,
  Plus,
  RotateCcw,
} from '@lucide/vue'

export type TaskViewStatus = 'inbox' | 'backlog' | 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'

export interface TaskViewItem {
  id: string
  title: string
  topic: string
  status: TaskViewStatus
  plannedLabel: string
  estimateMinutes: number | null
  acceptanceCriteria: string[]
  checklist: Array<{ id: string; text: string; checked: boolean }>
  blockedReason: string
}

const props = defineProps<{ tasks: TaskViewItem[]; dateLabel: string; selectedId?: string; filter: TaskViewStatus }>()
const emit = defineEmits<{
  capture: [title: string]
  open: [id: string]
  plan: [id: string]
  start: [id: string]
  reopen: [id: string]
  filterChange: [filter: TaskViewStatus]
}>()

const draft = ref('')
const mode = computed<TaskViewStatus>({ get: () => props.filter, set: (value) => emit('filterChange', value) })

const inboxTasks = computed(() => props.tasks.filter((task) => task.status === 'inbox'))
const visibleTasks = computed(() => props.tasks.filter((task) => task.status === mode.value))
const filters: Array<{ key: TaskViewStatus; label: string }> = [
  { key: 'inbox', label: '收件箱' },
  { key: 'backlog', label: '待安排' },
  { key: 'planned', label: '已计划' },
  { key: 'in_progress', label: '进行中' },
  { key: 'blocked', label: '已阻塞' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
]

function capture() {
  const value = draft.value.trim()
  if (!value) return
  emit('capture', value)
  draft.value = ''
}

function statusLabel(task: TaskViewItem) {
  if (task.status === 'in_progress') return '进行中'
  if (task.status === 'blocked') return '已受阻'
  if (task.status === 'completed') return '已完成'
  if (task.status === 'cancelled') return '已取消'
  if (task.status === 'backlog') return '待安排'
  return task.plannedLabel || '待安排'
}
</script>

<template>
  <section class="tasks-view">
    <header class="page-header">
      <div><p>{{ dateLabel }}</p><h1>任务</h1></div>
    </header>

    <form class="capture" @submit.prevent="capture">
      <Plus :size="22" :stroke-width="1.65" />
      <input v-model="draft" aria-label="记录学习想法" placeholder="记下想学、想查或想练的事……" />
      <button :disabled="!draft.trim()" title="加入收件箱" type="submit"><ArrowRight :size="20" /></button>
    </form>

    <div class="toolbar">
      <div class="segmented" aria-label="任务范围">
        <button v-for="filter in filters" :key="filter.key" :class="{ active: mode === filter.key }" @click="mode = filter.key">
          {{ filter.label }} <span v-if="filter.key === 'inbox'">{{ inboxTasks.length }}</span>
        </button>
      </div>
    </div>

    <div v-if="visibleTasks.length" class="task-table">
      <div class="table-head"><span>任务</span><span>主题</span><span>计划</span></div>
      <div class="task-list">
        <article v-for="task in visibleTasks" :key="task.id" class="task-row">
          <button class="row-main" :class="{ selected: task.id === selectedId }" @click="emit('open', task.id)">
            <span class="state-dot" :class="task.status">
              <CheckCircle2 v-if="task.status === 'completed'" :size="17" />
              <CircleSlash2 v-else-if="task.status === 'cancelled'" :size="17" />
              <Inbox v-else-if="task.status === 'inbox'" :size="17" />
              <CalendarClock v-else :size="17" />
            </span>
            <span class="row-copy"><strong>{{ task.title }}</strong><small>{{ task.status === 'inbox' ? '尚未安排主题与日期' : statusLabel(task) }}</small></span>
            <span class="topic-cell">{{ task.topic }}</span>
            <span class="plan-cell">{{ statusLabel(task) }}</span>
            <ChevronRight :size="18" />
          </button>
          <button v-if="task.status === 'inbox' || task.status === 'backlog'" class="row-action" @click="emit('plan', task.id)">安排</button>
          <button v-else-if="task.status === 'planned'" class="row-action" @click="emit('start', task.id)">开始</button>
          <button v-else-if="task.status === 'completed' || task.status === 'cancelled'" class="icon-action" title="重开任务" @click="emit('reopen', task.id)"><RotateCcw :size="17" /></button>
          <button v-else class="icon-action" title="继续任务" @click="emit('start', task.id)"><ArrowRight :size="18" /></button>
        </article>
      </div>
    </div>
    <div v-else class="empty-state">
      <CheckCircle2 :size="34" :stroke-width="1.5" />
      <h2>{{ mode === 'inbox' ? '收件箱清空了' : `没有${filters.find((item) => item.key === mode)?.label}的任务` }}</h2>
      <p>{{ mode === 'inbox' ? '这里是想法的临时停靠点，不必把每个念头都变成任务。' : '任务发生变化后，会自动出现在对应状态中。' }}</p>
    </div>
  </section>
</template>

<style scoped>
.tasks-view { width: min(100%, 900px); margin: 0 auto; padding: 48px 44px 104px; }
.page-header { padding-bottom: 24px; border-bottom: 1px solid var(--border); }
.page-header p { margin: 0 0 18px; color: var(--text); font-size: 13px; letter-spacing: .1em; }
h1 { margin: 0; font-size: clamp(28px, 3.1vw, 38px); line-height: 1.2; font-weight: 650; letter-spacing: -.035em; }
.capture { display: grid; grid-template-columns: 24px 1fr 42px; align-items: center; gap: 12px; margin: 28px 0 22px; padding: 8px 8px 8px 16px; border: 1px solid var(--hairline); border-radius: var(--radius-xl); background: var(--surface); color: var(--muted); box-shadow: var(--shadow-sm); transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease); }
.capture:focus-within { border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); box-shadow: var(--focus-ring), var(--shadow-sm); }
.capture input { min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 14px; }
.capture button { width: 42px; height: 42px; display: grid; place-items: center; border: 0; border-radius: var(--radius-lg); background: var(--accent); color: var(--accent-text); box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 18%, transparent); }
.capture button:disabled { opacity: .4; }
.toolbar { overflow-x: auto; padding: 0 0 16px; border-bottom: 1px solid var(--hairline); scrollbar-width: none; }.toolbar::-webkit-scrollbar { display: none; }
.segmented { display: flex; width: max-content; min-width: 100%; gap: 3px; padding: 3px; border-radius: var(--radius-lg); background: var(--control-fill); }
.segmented button { min-height: 36px; padding: 0 13px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted); font-size: 12px; white-space: nowrap; }
.segmented button:hover { color: var(--text); }.segmented button.active { background: var(--surface); box-shadow: var(--shadow-sm); color: var(--text); }
.segmented span { color: var(--muted); font-variant-numeric: tabular-nums; }
.task-table { margin-top: 4px; }.table-head { display: grid; grid-template-columns: 1fr 180px 116px; gap: 12px; padding: 16px 58px 11px 16px; color: var(--muted); font-size: 11px; }
.task-list { overflow: hidden; border: 1px solid var(--hairline); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-sm); }
.task-row { min-height: 72px; display: flex; align-items: center; border-top: 1px solid var(--hairline); }.task-row:first-child { border-top: 0; }
.row-main { min-width: 0; flex: 1; min-height: 70px; display: grid; grid-template-columns: 34px minmax(180px, 1fr) 180px 100px 20px; align-items: center; gap: 11px; padding: 8px 8px 8px 16px; border: 0; border-radius: var(--radius-lg); background: transparent; color: var(--text); text-align: left; }.row-main:hover { background: color-mix(in srgb, var(--control-fill) 72%, transparent); }.row-main.selected { outline: 1px solid color-mix(in srgb, var(--accent) 38%, transparent); outline-offset: -1px; background: var(--press-fill); }
.state-dot { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border)); border-radius: 50%; color: var(--accent); }
.state-dot.blocked { color: var(--warning); }.state-dot.completed { color: var(--success); }.state-dot.cancelled { color: var(--muted); }
.row-copy { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.row-copy strong { overflow: hidden; font-size: 14px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.row-copy small { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.topic-cell, .plan-cell { overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.row-main > svg { color: var(--muted); }
.row-action { min-height: 38px; margin-right: 8px; padding: 0 14px; border: 0; border-radius: var(--radius-md); background: var(--accent); color: var(--accent-text); font-size: 12px; font-weight: 600; }
.icon-action { width: 42px; height: 42px; display: grid; place-items: center; margin-right: 8px; border: 0; border-radius: 50%; background: var(--control-fill); color: var(--accent); }
.empty-state { min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; text-align: center; }
.empty-state > svg { color: var(--accent); }.empty-state h2 { margin: 14px 0 6px; font-size: 18px; }.empty-state p { max-width: 430px; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.empty-state button { min-height: 42px; margin-top: 18px; padding: 0 15px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--accent); }
@media (max-width: 799px) {
  .tasks-view { padding: 27px 20px 126px; }
  .page-header { padding-bottom: 19px; } .page-header p { display: none; } h1 { font-size: 34px; }
  .capture { grid-template-columns: 22px 1fr 42px; margin-top: 20px; padding: 7px 7px 7px 15px; border-radius: 18px; }
  .capture button { width: 42px; padding: 0; justify-content: center; font-size: 0; }
  .toolbar { margin-right: -20px; border-bottom: 0; }.segmented { min-width: max-content; gap: 2px; padding: 3px 23px 3px 3px; }.segmented button { min-height: 40px; padding: 0 11px; font-size: 11px; }
  .task-table { margin-top: 12px; }.table-head { display: none; }.task-list { border-radius: 18px; }.task-row { min-height: 84px; }.row-main { min-height: 82px; grid-template-columns: 32px 1fr 18px; padding-left: 13px; }
  .row-copy strong { display: -webkit-box; overflow: hidden; white-space: normal; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .topic-cell, .plan-cell { display: none; }
  .row-action { min-width: 56px; padding: 0 10px; }
}
</style>
