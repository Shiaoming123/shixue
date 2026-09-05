<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertCircle, ArrowDown, ArrowRight, ArrowUp, Check, CheckCircle2, ChevronRight, Clock3, GripVertical, Inbox, ListTodo, SlidersHorizontal } from '@lucide/vue'
import type { EntityRef } from '../../domain/capabilities/types'
import QuickAddComposer from './QuickAddComposer.vue'

export interface TodayTaskItem {
  id: string
  taskId?: string
  occurrenceId?: string | null
  topic: string
  title: string
  estimateMinutes: number | null
  criteria: string[]
  status: 'planned' | 'in_progress' | 'blocked' | 'completed'
  plannedLabel: string
  occurrenceScheduleLabel?: string
  deadlineLabel?: string
  reasons?: Array<'overdue' | 'planned' | 'due' | 'repeating'>
  isActive: boolean
  activeLabel?: string
}

const props = defineProps<{
  dateLabel: string
  tasks: TodayTaskItem[]
  overdueTasks: TodayTaskItem[]
  inboxCount: number
  weeklyCompleted: number
  weeklyTarget: number
  weeklyMinutes: number
  quickAddDestinationListId: string
  quickAddDefaultStartOn: string
  quickAddRemoveRecognizedText?: boolean
}>()

const emit = defineEmits<{
  start: [id: string]
  open: [id: string]
  openTasks: []
  openInbox: []
  openRecords: []
  moveToToday: [id: string]
  defer: [id: string]
  cancel: [id: string]
  occurrenceComplete: [id: string]
  occurrenceSkip: [id: string]
  occurrenceReschedule: [id: string]
  reorder: [taskIds: string[]]
  created: [entity: EntityRef]
}>()

const ordering = ref(false)
const draggedId = ref('')
const actionable = computed(() => props.tasks.filter((task) => task.status !== 'completed'))
const completed = computed(() => props.tasks.filter((task) => task.status === 'completed'))
const lead = computed(() => actionable.value[0])
const remaining = computed(() => actionable.value.slice(1))
const remainingMinutes = computed(() => remaining.value.reduce((total, task) => total + (task.estimateMinutes ?? 0), 0))

function moveTask(taskId: string, direction: -1 | 1) {
  const ids = actionable.value.map((task) => task.id)
  const index = ids.indexOf(taskId)
  const fixedStart = actionable.value[0]?.isActive ? 1 : 0
  const destination = Math.min(ids.length - 1, Math.max(fixedStart, index + direction))
  if (index < fixedStart || destination === index) return
  const [moved] = ids.splice(index, 1)
  ids.splice(destination, 0, moved)
  emit('reorder', ids)
}

function startDrag(task: TodayTaskItem) {
  if (task.isActive) return
  draggedId.value = task.id
}

function dropBefore(targetId: string) {
  const sourceId = draggedId.value
  draggedId.value = ''
  if (!sourceId || sourceId === targetId) return
  const ids = actionable.value.map((task) => task.id)
  const sourceIndex = ids.indexOf(sourceId)
  if (sourceIndex < 0) return
  const [moved] = ids.splice(sourceIndex, 1)
  const fixedStart = actionable.value[0]?.isActive ? 1 : 0
  const destination = Math.max(fixedStart, ids.indexOf(targetId))
  ids.splice(destination, 0, moved)
  emit('reorder', ids)
}

function minutesLabel(total: number) {
  if (total < 60) return `${total} 分钟`
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}`
}

function primaryAction(task: TodayTaskItem) {
  if (task.occurrenceId) emit('occurrenceComplete', task.occurrenceId)
  else emit('start', task.taskId ?? task.id)
}

function reasonLabel(reason: NonNullable<TodayTaskItem['reasons']>[number]) {
  return ({ overdue: '逾期', planned: '计划', due: '截止', repeating: '重复' } as const)[reason]
}
</script>

<template>
  <section class="today-view">
    <header class="today-header">
      <div><p>{{ dateLabel }}</p><h1>{{ actionable.length ? `今天有 ${actionable.length} 件，先完成这一件` : '今天的学习已经有了答案' }}</h1></div>
      <div class="header-actions">
        <button v-if="actionable.length > 1" class="order-toggle" :class="{ active: ordering }" @click="ordering = !ordering"><SlidersHorizontal :size="17" />{{ ordering ? '完成排序' : '调整顺序' }}</button>
        <button class="inbox-link" aria-label="打开任务收件箱" @click="emit('openInbox')"><Inbox :size="18" />收件箱 <span>{{ inboxCount }}</span></button>
      </div>
    </header>

    <QuickAddComposer
      :destination-list-id="quickAddDestinationListId"
      :default-start-on="quickAddDefaultStartOn"
      :quick-add-remove-recognized-text="quickAddRemoveRecognizedText"
      @created="emit('created', $event)"
    />

    <section v-if="overdueTasks.length" class="overdue-section">
      <header><span><AlertCircle :size="17" />逾期 {{ overdueTasks.length }} 项</span><small>先决定今天做不做</small></header>
      <article v-for="task in overdueTasks" :key="task.id" class="overdue-row">
        <button class="overdue-main" @click="emit('open', task.id)"><strong>{{ task.title }}</strong><span v-if="task.reasons?.length" class="reason-tags"><small v-for="reason in task.reasons" :key="reason">{{ reasonLabel(reason) }}</small></span><small>{{ task.topic }} · 原计划 {{ task.occurrenceScheduleLabel || task.plannedLabel }}</small><small v-if="task.deadlineLabel">截止 {{ task.deadlineLabel }}</small></button>
        <div class="overdue-actions">
          <template v-if="task.occurrenceId">
            <button class="today" @click="emit('occurrenceComplete', task.occurrenceId)">完成本次</button>
            <button @click="emit('occurrenceReschedule', task.occurrenceId)">改期</button>
            <button class="danger" @click="emit('occurrenceSkip', task.occurrenceId)">跳过</button>
          </template>
          <template v-else>
            <button class="today" @click="emit('moveToToday', task.taskId ?? task.id)">放到今天</button>
            <button @click="emit('defer', task.taskId ?? task.id)">延期</button>
            <button class="danger" @click="emit('cancel', task.taskId ?? task.id)">取消</button>
          </template>
        </div>
      </article>
    </section>

    <section v-if="ordering" class="order-panel">
      <header><h2>今日顺序</h2><span>桌面可拖动，移动端可用箭头</span></header>
      <ol>
        <li
          v-for="(task, index) in actionable"
          :key="task.id"
          :class="{ dragging: draggedId === task.id, fixed: task.isActive }"
          :draggable="!task.isActive"
          @dragstart="startDrag(task)"
          @dragend="draggedId = ''"
          @dragover.prevent
          @drop="dropBefore(task.id)"
        >
          <GripVertical :size="18" class="drag-handle" />
          <span class="order">{{ index + 1 }}</span>
          <button class="order-open" @click="emit('open', task.id)"><small>{{ task.topic }}</small><strong>{{ task.title }}</strong></button>
          <span v-if="task.isActive" class="active-tag">学习中</span>
          <div v-else class="move-buttons">
            <button :disabled="index === (actionable[0]?.isActive ? 1 : 0)" :aria-label="`上移 ${task.title}`" @click="moveTask(task.id, -1)"><ArrowUp :size="17" /></button>
            <button :disabled="index === actionable.length - 1" :aria-label="`下移 ${task.title}`" @click="moveTask(task.id, 1)"><ArrowDown :size="17" /></button>
          </div>
        </li>
      </ol>
    </section>

    <template v-else-if="lead">
      <article class="lead-task">
        <button class="lead-copy" @click="emit('open', lead.id)">
          <span>{{ lead.topic }}<template v-if="lead.estimateMinutes"> · {{ lead.estimateMinutes }} 分钟</template></span>
          <h2>{{ lead.title }}</h2>
          <span v-if="lead.reasons?.length" class="reason-tags"><small v-for="reason in lead.reasons" :key="reason">{{ reasonLabel(reason) }}</small></span>
          <small v-if="lead.occurrenceScheduleLabel">本次计划 {{ lead.occurrenceScheduleLabel }}</small>
          <small v-if="lead.deadlineLabel">任务截止 {{ lead.deadlineLabel }}</small>
          <small v-if="lead.status === 'blocked'">已受阻，打开任务补充原因或重新安排</small>
          <small v-else-if="lead.status === 'in_progress'">{{ lead.activeLabel || '学习进行中' }}</small>
        </button>
        <div v-if="lead.criteria.length" class="criteria">
          <p>完成标准</p>
          <span v-for="item in lead.criteria.slice(0, 3)" :key="item"><i /><b>{{ item }}</b></span>
        </div>
      </article>

      <div class="primary-actions">
        <button class="start-button" :disabled="lead.status === 'blocked'" @click="primaryAction(lead)">
          <span>{{ lead.occurrenceId ? '完成本次' : lead.status === 'in_progress' ? (lead.activeLabel || '继续学习') : `开始${lead.estimateMinutes ? ` ${lead.estimateMinutes} 分钟` : '学习'}` }}</span>
          <ArrowRight :size="20" />
        </button>
        <button v-if="lead.occurrenceId" class="text-button" @click="emit('occurrenceSkip', lead.occurrenceId)">跳过本次</button>
        <button v-if="lead.occurrenceId" class="text-button" @click="emit('occurrenceReschedule', lead.occurrenceId)">改期</button>
        <button class="text-button" @click="emit('open', lead.id)">查看任务</button>
      </div>

      <section v-if="remaining.length" class="queue">
        <header><h2>接下来</h2><span>{{ remaining.length }} 项 · {{ minutesLabel(remainingMinutes) }}</span></header>
        <button v-for="(task, index) in remaining" :key="task.id" @click="emit('open', task.id)">
          <span class="order">{{ index + 2 }}</span>
          <span class="task-copy"><small>{{ task.topic }}</small><strong>{{ task.title }}</strong><span v-if="task.reasons?.length" class="reason-tags"><small v-for="reason in task.reasons" :key="reason">{{ reasonLabel(reason) }}</small></span><small v-if="task.occurrenceScheduleLabel">本次 {{ task.occurrenceScheduleLabel }}<template v-if="task.deadlineLabel"> · 截止 {{ task.deadlineLabel }}</template></small></span>
          <span class="duration">{{ task.estimateMinutes ? `${task.estimateMinutes} 分钟` : '未估时' }}</span>
          <ChevronRight :size="18" />
        </button>
      </section>
    </template>

    <section v-else class="empty-state">
      <CheckCircle2 v-if="completed.length" :size="38" :stroke-width="1.5" />
      <ListTodo v-else :size="38" :stroke-width="1.5" />
      <h2>{{ completed.length ? `今天的 ${completed.length} 项都留下了记录` : '今天还没安排学习' }}</h2>
      <p v-if="completed.length">可以收工，也可以从收件箱安排下一步。</p>
      <p v-else-if="inboxCount">收件箱里有 {{ inboxCount }} 条想法，可以挑一条变成今天的小步骤。</p>
      <p v-else>记下一件想学、想查或想练的事。</p>
      <button @click="inboxCount ? emit('openInbox') : emit('openTasks')">{{ inboxCount ? '处理收件箱' : '记到收件箱' }}</button>
    </section>

    <section v-if="completed.length" class="completed-section">
      <button @click="emit('openRecords')"><span><Check :size="17" />已完成 {{ completed.length }} 项</span><ChevronRight :size="18" /></button>
    </section>

    <footer class="weekly-line">
      <span>本周 <strong>{{ weeklyCompleted }} / {{ weeklyTarget }}</strong> 次闭环</span>
      <span><Clock3 :size="15" />{{ minutesLabel(weeklyMinutes) }}</span>
    </footer>
  </section>
</template>

<style scoped>
.today-view { width: min(100%, 720px); padding: 52px 48px 90px; }
.today-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; margin-bottom: 30px; }
.today-header p { margin: 0 0 20px; font-size: 15px; letter-spacing: .12em; }
h1 { max-width: 560px; margin: 0; font-size: clamp(31px, 3.2vw, 42px); line-height: 1.16; font-weight: 650; letter-spacing: -.035em; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.order-toggle { min-height: 40px; display: inline-flex; align-items: center; gap: 7px; padding: 0 12px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); color: var(--muted); font-size: 12px; white-space: nowrap; }.order-toggle:hover, .order-toggle.active { border-color: color-mix(in srgb, var(--accent) 38%, var(--border)); background: var(--press-fill); color: var(--accent); }
.inbox-link { min-height: 40px; display: inline-flex; align-items: center; gap: 7px; padding: 0 12px; border: 0; border-radius: var(--radius-lg); background: var(--control-fill); color: var(--accent); font-size: 12px; white-space: nowrap; }
.inbox-link span { min-width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; background: var(--accent); color: var(--accent-text); font-size: 10px; }
.reason-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }.reason-tags small { padding: 2px 6px; border-radius: var(--radius-sm); background: var(--control-fill); color: var(--muted); font-size: 10px; font-weight: 600; }
.overdue-section { margin: -6px 0 26px; border: 1px solid color-mix(in srgb, var(--warning) 34%, var(--border)); border-radius: 14px; background: color-mix(in srgb, var(--warning) 5%, transparent); }.overdue-section > header { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 17px; border-bottom: 1px solid color-mix(in srgb, var(--warning) 24%, var(--border)); }.overdue-section > header span { display: inline-flex; align-items: center; gap: 8px; color: var(--warning); font-size: 13px; font-weight: 650; }.overdue-section > header small { color: var(--muted); font-size: 10px; }.overdue-row { min-height: 70px; display: flex; align-items: center; gap: 10px; padding: 9px 11px 9px 17px; border-bottom: 1px solid color-mix(in srgb, var(--warning) 18%, var(--border)); }.overdue-row:last-child { border-bottom: 0; }.overdue-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; border: 0; background: transparent; color: var(--text); text-align: left; }.overdue-main strong { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.overdue-main small { color: var(--muted); font-size: 10px; }.overdue-actions { display: flex; gap: 5px; }.overdue-actions button { min-height: 34px; padding: 0 10px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--muted); font-size: 10px; white-space: nowrap; }.overdue-actions .today { border-color: transparent; background: var(--accent); color: var(--accent-text); }.overdue-actions .danger { color: var(--danger); }
.order-panel { margin-bottom: 24px; border-top: 1px solid var(--border); }.order-panel > header { display: flex; align-items: center; justify-content: space-between; padding: 17px 3px 10px; }.order-panel h2 { margin: 0; font-size: 15px; }.order-panel header span { color: var(--muted); font-size: 10px; }.order-panel ol { margin: 0; padding: 0; list-style: none; }.order-panel li { min-height: 70px; display: grid; grid-template-columns: 20px 30px minmax(0, 1fr) auto; align-items: center; gap: 9px; border-bottom: 1px solid var(--border); transition: opacity var(--motion-fast) var(--ease); }.order-panel li[draggable='true'] { cursor: grab; }.order-panel li.dragging { opacity: .45; }.order-panel li.fixed { background: color-mix(in srgb, var(--accent) 4%, transparent); }.drag-handle { color: var(--muted); }.order-open { min-width: 0; display: flex; flex-direction: column; gap: 4px; border: 0; background: transparent; color: var(--text); text-align: left; }.order-open small { color: var(--accent); font-size: 10px; }.order-open strong { overflow: hidden; font-size: 13px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }.move-buttons { display: flex; gap: 4px; }.move-buttons button { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 9px; background: transparent; color: var(--text); }.move-buttons button:disabled { opacity: .25; }.active-tag { padding: 5px 8px; border-radius: 999px; background: var(--surface-alt); color: var(--accent); font-size: 10px; }
.lead-task { overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--hairline)); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-md); }
.lead-copy { width: 100%; padding: 25px 29px 19px; border: 0; background: transparent; color: var(--text); text-align: left; }
.lead-copy > span { color: var(--accent); font-size: 13px; font-weight: 600; }.lead-copy h2 { margin: 12px 0 0; font-size: clamp(24px, 2.5vw, 31px); line-height: 1.25; font-weight: 630; letter-spacing: -.025em; }.lead-copy small { display: block; margin-top: 10px; color: var(--warning); }
.criteria { padding: 16px 29px 18px; border-top: 1px solid var(--border); }.criteria > p { margin: 0 0 8px; color: var(--muted); font-size: 11px; }.criteria > span { min-height: 34px; display: flex; align-items: center; gap: 11px; font-size: 13px; }.criteria i { width: 7px; height: 7px; flex: 0 0 auto; border: 1.5px solid var(--accent); border-radius: 50%; }.criteria b { font-weight: 450; }
.primary-actions { display: flex; align-items: center; gap: 34px; padding: 20px 0 25px; }.start-button { min-width: 272px; min-height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 21px 0 27px; border: 0; border-radius: var(--radius-lg); background: var(--accent); color: var(--accent-text); font-size: 15px; font-weight: 600; box-shadow: 0 7px 18px color-mix(in srgb, var(--accent) 22%, transparent); }.start-button:hover:not(:disabled) { box-shadow: 0 9px 22px color-mix(in srgb, var(--accent) 27%, transparent); transform: translateY(-1px); }.start-button:disabled { opacity: .45; box-shadow: none; }.text-button { min-height: 44px; padding: 0 10px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--accent); font-size: 13px; }.text-button:hover { background: var(--control-fill); }
.queue { margin-top: 2px; border-top: 1px solid var(--border); }.queue > header { display: flex; align-items: center; justify-content: space-between; padding: 19px 4px 10px; }.queue h2 { margin: 0; font-size: 15px; }.queue header span { color: var(--muted); font-size: 11px; }.queue > button { width: 100%; min-height: 70px; display: grid; grid-template-columns: 32px 1fr auto 18px; align-items: center; gap: 11px; padding: 8px 4px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--text); text-align: left; }.order { width: 27px; height: 27px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 50%; color: var(--muted); font-size: 11px; }.task-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }.task-copy small { color: var(--accent); font-size: 10px; }.task-copy strong { overflow: hidden; font-size: 13px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }.duration { color: var(--muted); font-size: 11px; }
.empty-state { min-height: 360px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 44px 20px; text-align: center; }.empty-state > svg { color: var(--accent); }.empty-state h2 { margin: 15px 0 6px; font-size: 21px; }.empty-state p { margin: 0; color: var(--muted); font-size: 12px; }.empty-state button { min-height: 46px; margin-top: 20px; padding: 0 18px; border: 0; border-radius: 11px; background: var(--accent); color: var(--accent-text); font-size: 13px; font-weight: 600; }
.completed-section { margin-top: 18px; border-top: 1px solid var(--border); }.completed-section button { width: 100%; min-height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 5px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--text); }.completed-section span { display: flex; align-items: center; gap: 10px; font-size: 13px; }.completed-section span svg { color: var(--success); }
.weekly-line { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; color: var(--muted); font-size: 12px; }.weekly-line span { display: flex; align-items: center; gap: 7px; }.weekly-line strong { color: var(--accent); }
.queue > button { padding-inline: 8px; border-radius: var(--radius-md); }.queue > button:hover { background: color-mix(in srgb, var(--control-fill) 70%, transparent); }
@media (max-width: 819px) {
  .today-view { padding: 26px 20px 126px; }.today-header { align-items: flex-start; margin-bottom: 22px; }.today-header p { margin-bottom: 13px; font-size: 13px; }.today-header h1 { font-size: 29px; }.header-actions { align-items: flex-end; flex-direction: column-reverse; }.order-toggle { width: 42px; padding: 0; justify-content: center; font-size: 0; }.inbox-link { position: relative; width: 42px; padding: 0; justify-content: center; font-size: 0; }.inbox-link span { position: absolute; top: -6px; right: -5px; }
  .overdue-section { margin-top: 0; }.overdue-section > header { padding: 0 13px; }.overdue-row { align-items: stretch; flex-direction: column; padding: 12px 13px; }.overdue-actions button { min-height: 38px; flex: 1; }.overdue-main strong { white-space: normal; }.overdue-actions { width: 100%; }
  .order-panel li { grid-template-columns: minmax(0, 1fr) auto; }.drag-handle { display: none; }.order-panel header span { display: none; }.order-panel .order { display: none; }.move-buttons button { width: 40px; height: 40px; }
  .lead-copy { padding: 22px 21px 17px; }.lead-copy h2 { font-size: 24px; }.criteria { padding: 15px 21px 17px; }
  .primary-actions { align-items: stretch; flex-direction: column; gap: 2px; padding-bottom: 20px; }.start-button { width: 100%; min-width: 0; min-height: 54px; }.text-button { width: 100%; }
  .queue > button { min-height: 76px; grid-template-columns: 30px 1fr 18px; }.duration { display: none; }.weekly-line { align-items: flex-start; flex-direction: column; gap: 8px; }
}
</style>
