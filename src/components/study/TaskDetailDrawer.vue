<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Bell, CalendarDays, Check, Clock3, Flag, Inbox, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X } from '@lucide/vue'
import type { TaskViewItem } from './TasksView.vue'
import type { TaskOccurrence } from '../../domain/workspace/types'

export interface TaskEventViewItem {
  id: string
  time: string
  title: string
  detail: string
  tone: 'accent' | 'muted' | 'warning' | 'success' | 'danger'
}

const props = defineProps<{
  task?: TaskViewItem
  events: TaskEventViewItem[]
  dueLabel?: string
  occurrenceId?: string | null
  occurrenceStatus?: TaskOccurrence['status']
  occurrenceScheduleLabel?: string
  deadlineLabel?: string
  mobile?: boolean
}>()

const emit = defineEmits<{
  close: []
  primary: [id: string]
  defer: [id: string]
  block: [id: string]
  cancel: [id: string]
  toggleChecklist: [taskId: string, itemId: string, checked: boolean]
  addChecklist: [taskId: string, text: string]
  edit: [id: string]
  delete: [id: string]
  toggleComplete: [id: string]
  occurrenceComplete: [id: string]
  occurrenceSkip: [id: string]
  occurrenceReschedule: [id: string]
}>()

const checklistDraft = ref('')
const confirmDelete = ref(false)
const checklistLocked = computed(() => props.task?.status === 'completed' || props.task?.status === 'cancelled')
watch(() => props.task?.id, () => { checklistDraft.value = ''; confirmDelete.value = false })

const primaryLabel = computed(() => {
  if (!props.task) return ''
  if (props.task.status === 'inbox') return '加入今天'
  if (props.task.status === 'backlog') return '安排任务'
  if (props.task.status === 'in_progress') return '继续学习'
  if (props.task.status === 'blocked') return '解除受阻'
  if (props.task.status === 'completed' || props.task.status === 'cancelled') return '重开任务'
  return '开始学习'
})

function addChecklistItem() {
  const value = checklistDraft.value.trim()
  if (!props.task || !value || checklistLocked.value) return
  emit('addChecklist', props.task.id, value)
  checklistDraft.value = ''
}
</script>

<template>
  <aside v-if="task" class="detail-drawer" :class="{ mobile }" aria-label="任务详情">
    <header class="drawer-header">
      <div><button title="编辑任务" aria-label="编辑任务" @click="emit('edit', task.id)"><Pencil :size="18" /></button><button title="删除任务" aria-label="删除任务" @click="confirmDelete = true"><Trash2 :size="18" /></button></div>
      <button title="关闭任务详情" aria-label="关闭任务详情" @click="emit('close')"><X :size="22" /></button>
    </header>

    <div v-if="confirmDelete" class="delete-confirm" role="alert"><span><strong>删除这个任务？</strong></span><div><button @click="confirmDelete = false">取消</button><button class="danger" @click="emit('delete', task.id)">删除</button></div></div>

    <div class="drawer-scroll">
      <section class="task-heading">
        <button class="heading-check" :disabled="Boolean(occurrenceId && occurrenceStatus !== 'pending')" :aria-label="occurrenceId ? '完成本次' : task.status === 'completed' ? '重新打开任务' : '完成任务'" @click="occurrenceId ? emit('occurrenceComplete', occurrenceId) : emit('toggleComplete', task.id)"><span :class="{ checked: occurrenceId ? occurrenceStatus === 'completed' : task.status === 'completed' }"><Check :size="15" /></span></button>
        <div><h1>{{ task.title }}</h1><p class="topic"><Inbox :size="14" />{{ task.topic }}</p></div>
        <p v-if="task.notes" class="notes">{{ task.notes }}</p>
      </section>

      <section class="criteria">
        <div class="section-title"><h2>执行检查项</h2><span v-if="task.checklist.length">{{ task.checklist.filter((item) => item.checked).length }} / {{ task.checklist.length }}</span></div>
        <button
          v-for="item in task.checklist"
          :key="item.id"
          class="checklist-item"
          :class="{ checked: item.checked }"
          :disabled="checklistLocked"
          @click="emit('toggleChecklist', task.id, item.id, !item.checked)"
        ><span><Check :size="15" /></span><b>{{ item.text }}</b></button>
        <form v-if="!checklistLocked" class="checklist-add" @submit.prevent="addChecklistItem">
          <input v-model="checklistDraft" aria-label="新增检查项" placeholder="新增一个执行检查项" />
          <button :disabled="!checklistDraft.trim()" title="新增检查项" type="submit"><Plus :size="16" /></button>
        </form>
        <div v-if="task.acceptanceCriteria.length" class="acceptance">
          <h3>完成时要验证</h3>
          <p v-for="item in task.acceptanceCriteria" :key="item">{{ item }}</p>
        </div>
      </section>

      <dl class="facts">
        <div v-if="occurrenceId"><dt><CalendarDays :size="18" />本次计划</dt><dd>{{ occurrenceScheduleLabel || '待安排' }}</dd></div>
        <div><dt><CalendarDays :size="18" />计划日期</dt><dd>{{ task.plannedLabel || '待安排' }}</dd></div>
        <div><dt><CalendarDays :size="18" />截止日期</dt><dd>{{ deadlineLabel || dueLabel || '未设置' }}</dd></div>
        <div><dt><Bell :size="18" />提醒</dt><dd>{{ task.reminderLabel || '未设置' }}</dd></div>
        <div><dt><Flag :size="18" />优先级</dt><dd>{{ ({ none: '无', low: '低', medium: '中', high: '高' } as const)[task.priority] }}</dd></div>
        <div><dt><Clock3 :size="18" />预计时长</dt><dd>{{ task.estimateMinutes ? `${task.estimateMinutes} 分钟` : '未设置' }}</dd></div>
      </dl>

      <section class="event-section">
        <h2>任务记录</h2>
        <ol v-if="events.length" class="timeline">
          <li v-for="event in events" :key="event.id" :class="event.tone">
            <time>{{ event.time }}</time>
            <i />
            <span><strong>{{ event.title }}</strong><small>{{ event.detail }}</small></span>
          </li>
        </ol>
      </section>
    </div>

    <footer class="drawer-actions">
      <div v-if="occurrenceId && occurrenceStatus === 'pending'" class="secondary-actions">
        <button @click="emit('occurrenceReschedule', occurrenceId)">本次改期</button>
        <button class="danger" @click="emit('occurrenceSkip', occurrenceId)">跳过本次</button>
      </div>
      <div v-if="!occurrenceId && (task.status === 'planned' || task.status === 'in_progress' || task.status === 'blocked' || task.status === 'backlog')" class="secondary-actions">
        <button @click="emit('defer', task.id)">延期</button>
        <button v-if="task.status !== 'blocked'" @click="emit('block', task.id)">标记受阻</button>
        <button class="danger" @click="emit('cancel', task.id)">取消</button>
      </div>
      <button v-if="!occurrenceId || occurrenceStatus === 'pending'" class="primary" @click="occurrenceId ? emit('occurrenceComplete', occurrenceId) : emit('primary', task.id)">
        <RotateCcw v-if="task.status === 'completed' || task.status === 'cancelled'" :size="18" />
        <MoreHorizontal v-else-if="task.status === 'blocked'" :size="18" />
        <span>{{ occurrenceId ? '完成本次' : primaryLabel }}</span><ArrowRight :size="20" />
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.detail-drawer { width: 420px; min-width: 420px; height: 100%; display: flex; flex-direction: column; border-left: 1px solid var(--hairline); background: var(--material-regular); box-shadow: -14px 0 38px color-mix(in srgb, var(--text) 5%, transparent); backdrop-filter: saturate(150%) blur(22px); -webkit-backdrop-filter: saturate(150%) blur(22px); }
.drawer-header { height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 0 28px; }.drawer-header > div { display: flex; gap: 3px; }.drawer-header button { width: 42px; height: 42px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--text); }.drawer-header button:hover { background: var(--control-fill); }.drawer-header > div button:last-child { color: var(--danger); }
.delete-confirm { margin: 0 28px 12px; padding: 13px; border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border)); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); }.delete-confirm > span { display: flex; flex-direction: column; gap: 4px; }.delete-confirm strong { color: var(--danger); font-size: 12px; }.delete-confirm small { color: var(--muted); font-size: 10px; line-height: 1.5; }.delete-confirm > div { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }.delete-confirm button { min-height: 34px; padding: 0 11px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font-size: 11px; }.delete-confirm button.danger { color: var(--danger); }
.drawer-scroll { flex: 1; overflow-y: auto; padding: 6px 38px 30px; }
.task-heading { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; padding-bottom: 22px; border-bottom: 1px solid var(--border); }.task-heading h1 { margin: 1px 0 0; font-size: 20px; line-height: 1.35; font-weight: 620; letter-spacing: -.015em; }.task-heading p { margin: 9px 0 0; font-size: 13px; }.task-heading .topic { display: flex; align-items: center; gap: 5px; color: var(--accent); }.task-heading .notes { grid-column: 2; color: var(--muted); line-height: 1.65; white-space: pre-wrap; }.heading-check { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; background: transparent; }.heading-check span { width: 23px; height: 23px; display: grid; place-items: center; border: 1.5px solid var(--muted); border-radius: 50%; color: transparent; }.heading-check span.checked { border-color: var(--success); background: var(--success); color: var(--accent-text); }
.criteria { padding: 24px 0 22px; border-bottom: 1px solid var(--hairline); }.criteria h2, .event-section h2 { margin: 0 0 13px; font-size: 15px; font-weight: 650; }.section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }.section-title span { color: var(--muted); font-size: 10px; }.checklist-item { width: 100%; min-height: 40px; display: flex; align-items: center; gap: 11px; padding: 4px 0; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text); text-align: left; }.checklist-item:hover:not(:disabled) { background: color-mix(in srgb, var(--control-fill) 68%, transparent); }.checklist-item > span { width: 22px; height: 22px; flex: 0 0 auto; display: grid; place-items: center; border: 1px solid var(--muted); border-radius: 50%; color: transparent; transition: background var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease-spring); }.checklist-item:active:not(:disabled) > span { transform: scale(.9); }.checklist-item b { font-size: 13px; line-height: 1.45; font-weight: 450; }.checklist-item.checked > span { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }.checklist-item.checked b { color: var(--muted); text-decoration: line-through; }.checklist-item:disabled { cursor: default; }.checklist-add { display: grid; grid-template-columns: 1fr 36px; align-items: center; gap: 7px; margin-top: 10px; }.checklist-add input { min-width: 0; min-height: 40px; padding: 0 12px; border: 1px solid var(--hairline); border-radius: var(--radius-md); outline: 0; background: var(--control-fill); color: var(--text); font-size: 11px; transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease); }.checklist-add input:focus { border-color: var(--accent); box-shadow: var(--focus-ring); }.checklist-add button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: var(--control-fill); color: var(--accent); }.checklist-add button:disabled { opacity: .35; }.acceptance { margin-top: 18px; padding-top: 15px; border-top: 1px dashed var(--border); }.acceptance h3 { margin: 0 0 8px; color: var(--muted); font-size: 10px; font-weight: 650; letter-spacing: .05em; }.acceptance p { margin: 6px 0; padding-left: 12px; color: var(--muted); font-size: 11px; line-height: 1.5; border-left: 2px solid color-mix(in srgb, var(--accent) 34%, var(--border)); }
.facts { margin: 0; padding: 16px 0; border-bottom: 1px solid var(--border); }.facts div { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 15px; }.facts dt { display: flex; align-items: center; gap: 10px; color: var(--text); font-size: 12px; }.facts dt svg { color: var(--accent); }.facts dd { margin: 0; font-size: 12px; }
.event-section { padding: 24px 0; }.timeline { margin: 0; padding: 0; list-style: none; }.timeline li { position: relative; display: grid; grid-template-columns: 106px 18px 1fr; gap: 10px; min-height: 64px; }.timeline li::after { content: ''; position: absolute; left: 124px; top: 20px; bottom: -8px; width: 1px; background: var(--border); }.timeline li:last-child::after { display: none; }.timeline time { padding-top: 1px; color: var(--muted); font-size: 10px; white-space: nowrap; }.timeline i { z-index: 1; width: 15px; height: 15px; border: 2px solid var(--surface); border-radius: 50%; background: var(--muted); box-shadow: 0 0 0 1px var(--muted); }.timeline li.accent i { background: var(--accent); box-shadow: 0 0 0 1px var(--accent); }.timeline li.warning i { background: var(--warning); box-shadow: 0 0 0 1px var(--warning); }.timeline li.success i { background: var(--success); box-shadow: 0 0 0 1px var(--success); }.timeline li.danger i { background: var(--danger); box-shadow: 0 0 0 1px var(--danger); }.timeline span { display: flex; flex-direction: column; gap: 5px; }.timeline strong { font-size: 12px; font-weight: 600; }.timeline small { color: var(--muted); font-size: 10px; line-height: 1.35; }
.empty-copy { color: var(--muted); font-size: 11px; line-height: 1.6; }
.drawer-actions { padding: 14px 38px 28px; border-top: 1px solid var(--hairline); background: var(--material-regular); backdrop-filter: saturate(150%) blur(22px); }.secondary-actions { display: flex; gap: 7px; margin-bottom: 10px; }.secondary-actions button { min-height: 36px; flex: 1; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--muted); font-size: 11px; }.secondary-actions .danger { color: var(--danger); }.primary { position: relative; width: 100%; min-height: 52px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 48px; border: 0; border-radius: var(--radius-lg); background: var(--accent); color: var(--accent-text); font-size: 14px; font-weight: 600; box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 20%, transparent); }.primary > svg:first-child:not(:last-child) { position: absolute; left: 18px; }.primary > svg:last-child { position: absolute; right: 18px; }.primary > span { text-align: center; }
@media (max-width: 799px) {
  .detail-drawer { position: fixed; z-index: var(--z-overlay); inset: 0; width: 100%; min-width: 0; background: var(--bg); box-shadow: none; animation: detail-in var(--motion-base) var(--ease); }.drawer-header { height: calc(60px + env(safe-area-inset-top, 0px)); padding: env(safe-area-inset-top, 0px) 16px 0; border-bottom: 1px solid var(--hairline); background: var(--material-thin); backdrop-filter: saturate(170%) blur(24px); -webkit-backdrop-filter: saturate(170%) blur(24px); }.drawer-scroll { padding: 18px 20px calc(126px + env(safe-area-inset-bottom, 0px)); }.task-heading h1 { font-size: 25px; }.timeline li { grid-template-columns: 82px 18px 1fr; }.timeline li::after { left: 100px; }.drawer-actions { position: fixed; left: 0; right: 0; bottom: 0; padding: 11px 20px calc(12px + env(safe-area-inset-bottom, 0px)); backdrop-filter: saturate(170%) blur(24px); -webkit-backdrop-filter: saturate(170%) blur(24px); }.secondary-actions { overflow-x: auto; scrollbar-width: none; }.secondary-actions::-webkit-scrollbar { display: none; }.secondary-actions button { min-width: 84px; }.primary { min-height: 54px; }
}
@keyframes detail-in { from { transform: translateX(18px); opacity: .82; } }
</style>
