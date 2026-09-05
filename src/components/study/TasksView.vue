<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Bell, CalendarDays, Check, CheckCircle2, ChevronRight, Filter, Flag, Inbox, ListFilter, MoreHorizontal, Pencil, Search, Trash2, X } from '@lucide/vue'
import type { StudyTaskPriority } from '../../storage/study/types'
import type { StudyTaskQuerySort, StudyTaskSmartView } from '../../lib/study-task-query'
import type { TaskOccurrence } from '../../domain/workspace/types'
import type { EntityRef } from '../../domain/capabilities/types'
import Checkbox from '../ui/Checkbox.vue'
import Dialog from '../ui/Dialog.vue'
import Listbox from '../ui/Listbox.vue'
import OccurrenceRow from './OccurrenceRow.vue'
import QuickAddComposer from './QuickAddComposer.vue'

export type TaskViewStatus = 'inbox' | 'backlog' | 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
export interface TaskViewItem {
  id: string; title: string; notes: string; topic: string; topicId: string | null
  status: TaskViewStatus; plannedOn: string | null; dueOn: string | null; reminderAt: string | null
  priority: StudyTaskPriority; plannedLabel: string; dueLabel: string; reminderLabel: string
  estimateMinutes: number | null; acceptanceCriteria: string[]
  checklist: Array<{ id: string; text: string; checked: boolean }>; blockedReason: string
}
export interface OccurrenceViewItem { id: string; title: string; scheduledLabel: string; deadlineLabel: string; reasons: string[]; occurrence: TaskOccurrence }

const props = defineProps<{
  tasks: TaskViewItem[]; occurrences: OccurrenceViewItem[]; topics: Array<{ id: string; title: string }>; title: string; subtitle: string
  selectedId?: string; smartView: StudyTaskSmartView; search: string; topicFilter: string
  priorityFilter: StudyTaskPriority | 'all'; sort: StudyTaskQuerySort
  quickAddDestinationListId: string; quickAddDefaultStartOn?: string; quickAddRemoveRecognizedText?: boolean
}>()
const emit = defineEmits<{
  created: [entity: EntityRef]; open: [id: string]; toggleComplete: [id: string]; edit: [id: string]; delete: [id: string]
  bulkDelete: [ids: string[]]; bulkComplete: [ids: string[]]; bulkMoveToToday: [ids: string[]]
  smartViewChange: [value: StudyTaskSmartView]
  searchChange: [value: string]; topicFilterChange: [value: string]
  priorityFilterChange: [value: StudyTaskPriority | 'all']; sortChange: [value: StudyTaskQuerySort]
  occurrenceComplete: [id: string]; occurrenceSkip: [id: string]; occurrenceReschedule: [id: string]
  occurrenceOpen: [id: string]
}>()

const quickAddComposer = ref<InstanceType<typeof QuickAddComposer> | null>(null)
const searchInput = ref<HTMLInputElement>()
const toolbarOpen = ref(false)
const batchMode = ref(false)
const selectedIds = ref<string[]>([])
const confirmDeleteIds = ref<string[]>([])
const searchModel = computed({ get: () => props.search, set: (value: string) => emit('searchChange', value) })
const topicModel = computed({ get: () => props.topicFilter, set: (value: string) => emit('topicFilterChange', value) })
const priorityModel = computed<StudyTaskPriority | 'all'>({ get: () => props.priorityFilter, set: (value) => emit('priorityFilterChange', value) })
const sortModel = computed<StudyTaskQuerySort>({ get: () => props.sort, set: (value) => emit('sortChange', value) })
const smartViewOptions = [
  { value: 'inbox', label: '收件箱' },
  { value: 'today', label: '今天' },
  { value: 'next7', label: '最近 7 天' },
  { value: 'all', label: '全部任务' },
  { value: 'completed', label: '已完成' },
]
const topicOptions = computed(() => [
  { value: 'all', label: '全部清单' },
  { value: 'unassigned', label: '收件箱' },
  ...props.topics.map((topic) => ({ value: topic.id, label: topic.title })),
])
const priorityOptions = [
  { value: 'all', label: '全部优先级' },
  { value: 'high', label: '高优先级' },
  { value: 'medium', label: '中优先级' },
  { value: 'low', label: '低优先级' },
  { value: 'none', label: '无优先级' },
]
const sortOptions = [
  { value: 'manual', label: '手动排序' },
  { value: 'dueOn', label: '截止日期' },
  { value: 'priority', label: '优先级' },
  { value: 'updatedAt', label: '最近更新' },
  { value: 'title', label: '标题' },
]
const sections = computed(() => {
  if (props.smartView !== 'today') return [{ key: 'all', label: '', tasks: props.tasks }]
  const today = new Date().toLocaleDateString('sv-SE')
  const overdue = props.tasks.filter((task) => dateFor(task) && dateFor(task)! < today)
  const current = props.tasks.filter((task) => !dateFor(task) || dateFor(task)! >= today)
  return [{ key: 'overdue', label: overdue.length ? '已过期' : '', tasks: overdue }, { key: 'today', label: current.length ? '今天' : '', tasks: current }].filter(({ tasks }) => tasks.length)
})

watch(() => props.smartView, clearSelection)
watch(() => props.tasks.map(({ id }) => id).join('|'), () => {
  const available = new Set(props.tasks.map(({ id }) => id))
  selectedIds.value = selectedIds.value.filter((id) => available.has(id))
})

function dateFor(task: TaskViewItem) { return task.plannedOn ?? task.dueOn }
function toggleSelection(id: string) { selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter((value) => value !== id) : [...selectedIds.value, id] }
function clearSelection() { selectedIds.value = []; confirmDeleteIds.value = [] }
function finishBatch(action: 'complete' | 'today' | 'delete') {
  const ids = [...selectedIds.value]; if (!ids.length) return
  if (action === 'complete') emit('bulkComplete', ids)
  if (action === 'today') emit('bulkMoveToToday', ids)
  if (action === 'delete') emit('bulkDelete', ids)
  batchMode.value = false; clearSelection()
}
function isTyping(target: EventTarget | null) { return target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]') }
function handleShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
  if (event.key === '/') { event.preventDefault(); searchInput.value?.focus(); return }
  if (event.key.toLowerCase() === 'n') { event.preventDefault(); quickAddComposer.value?.focus(); return }
  const index = props.tasks.findIndex(({ id }) => id === props.selectedId)
  if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); const task = props.tasks[Math.min(props.tasks.length - 1, Math.max(0, index + 1))]; if (task) emit('open', task.id) }
  if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); const task = props.tasks[Math.max(0, index < 0 ? 0 : index - 1)]; if (task) emit('open', task.id) }
  if (event.key.toLowerCase() === 'e' && props.selectedId) emit('edit', props.selectedId)
  if (event.key.toLowerCase() === 'c' && props.selectedId) emit('toggleComplete', props.selectedId)
}
onMounted(() => window.addEventListener('keydown', handleShortcut))
onUnmounted(() => window.removeEventListener('keydown', handleShortcut))
</script>

<template>
  <section class="tasks-view">
    <header class="page-header">
      <div class="page-title"><h1>{{ title }}</h1><Listbox class="mobile-smart-view" variant="title" :model-value="smartView" :options="smartViewOptions" label="智能清单" @update:model-value="emit('smartViewChange', $event as StudyTaskSmartView)" /><span>{{ subtitle }}</span></div>
      <div class="header-actions">
        <button type="button" :class="{ active: toolbarOpen }" title="筛选" aria-label="筛选" @click="toolbarOpen = !toolbarOpen"><Filter :size="18" /></button>
        <button type="button" :class="{ active: batchMode }" title="批量操作" aria-label="批量操作" @click="batchMode = !batchMode; clearSelection()"><ListFilter :size="18" /></button>
        <button type="button" title="更多" aria-label="更多"><MoreHorizontal :size="19" /></button>
      </div>
    </header>
    <QuickAddComposer
      ref="quickAddComposer"
      :destination-list-id="quickAddDestinationListId"
      :default-start-on="quickAddDefaultStartOn"
      :quick-add-remove-recognized-text="quickAddRemoveRecognizedText"
      @created="emit('created', $event)"
    />
    <label class="search-field"><Search :size="16" /><input ref="searchInput" v-model="searchModel" type="search" aria-label="搜索任务" placeholder="搜索" /><button v-if="searchModel" type="button" title="清除" aria-label="清除搜索" @click="searchModel = ''"><X :size="14" /></button><kbd v-else>/</kbd></label>
    <div v-if="toolbarOpen" class="filters">
      <Listbox v-model="topicModel" :options="topicOptions" label="清单" variant="compact" />
      <Listbox :model-value="priorityModel" :options="priorityOptions" label="优先级" variant="compact" @update:model-value="priorityModel = $event as StudyTaskPriority | 'all'" />
      <Listbox :model-value="sortModel" :options="sortOptions" label="排序" variant="compact" @update:model-value="sortModel = $event as StudyTaskQuerySort" />
    </div>
    <div v-if="batchMode" class="batch-bar"><span>{{ selectedIds.length }}</span><div><button type="button" :disabled="!selectedIds.length" title="完成" aria-label="批量完成" @click="finishBatch('complete')"><CheckCircle2 :size="17" /></button><button type="button" :disabled="!selectedIds.length" title="移到今天" aria-label="移到今天" @click="finishBatch('today')"><CalendarDays :size="17" /></button><button type="button" class="danger" :disabled="!selectedIds.length" title="删除" aria-label="批量删除" @click="confirmDeleteIds = [...selectedIds]"><Trash2 :size="17" /></button></div></div>
    <div v-if="tasks.length || occurrences.length" class="task-sections">
      <OccurrenceRow v-for="item in occurrences" :key="item.id" :occurrence="item.occurrence" :title="item.title" :scheduled-label="item.scheduledLabel" :deadline-label="item.deadlineLabel" :reasons="item.reasons" @open="emit('occurrenceOpen', $event)" @complete="emit('occurrenceComplete', $event)" @skip="emit('occurrenceSkip', $event)" @reschedule="emit('occurrenceReschedule', $event)" />
      <section v-for="section in sections" :key="section.key" class="task-section">
        <h2 v-if="section.label" :class="{ overdue: section.key === 'overdue' }">{{ section.label }} <span>{{ section.tasks.length }}</span></h2>
        <article v-for="task in section.tasks" :key="task.id" class="task-row" :class="{ selected: selectedId === task.id, completed: task.status === 'completed' }">
          <Checkbox v-if="batchMode" class="select-button" shape="round" :model-value="selectedIds.includes(task.id)" :accessible-label="`选择 ${task.title}`" @update:model-value="toggleSelection(task.id)" />
          <button v-else class="complete-button" type="button" :aria-label="task.status === 'completed' ? `重新打开 ${task.title}` : `完成 ${task.title}`" @click="emit('toggleComplete', task.id)"><span :class="[task.priority, { checked: task.status === 'completed' }]"><Check :size="14" /></span></button>
          <button class="task-main" type="button" @click="emit('open', task.id)"><span class="task-copy"><strong>{{ task.title }}</strong><small class="tabular-numbers"><span v-if="task.plannedLabel"><CalendarDays :size="13" />{{ task.plannedLabel }}</span><span v-if="task.reminderLabel"><Bell :size="13" />{{ task.reminderLabel }}</span><span><Inbox :size="13" />{{ task.topic }}</span></small></span><Flag v-if="task.priority !== 'none'" class="priority" :class="task.priority" :size="17" fill="currentColor" /><ChevronRight :size="17" class="chevron" /></button>
          <div class="row-actions"><button type="button" title="编辑" :aria-label="`编辑 ${task.title}`" @click="emit('edit', task.id)"><Pencil :size="15" /></button><button type="button" class="danger" title="删除" :aria-label="`删除 ${task.title}`" @click="confirmDeleteIds = [task.id]"><Trash2 :size="15" /></button></div>
        </article>
      </section>
    </div>
    <div v-else class="empty-state"><CheckCircle2 :size="36" /><strong>{{ searchModel ? '没有结果' : smartView === 'completed' ? '尚无已完成任务' : '清单已清空' }}</strong></div>
    <Dialog :open="Boolean(confirmDeleteIds.length)" :title="`删除 ${confirmDeleteIds.length} 项？`" role="alertdialog" size="sm" :show-close="false" @close="confirmDeleteIds = []">
      <template #footer>
        <button type="button" class="confirm-button" autofocus @click="confirmDeleteIds = []">取消</button>
        <button type="button" class="confirm-button danger" @click="confirmDeleteIds.length === 1 ? (emit('delete', confirmDeleteIds[0]), confirmDeleteIds = []) : finishBatch('delete')">删除</button>
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.tasks-view { width: min(100%, 760px); min-height: 100%; margin: 0 auto; padding: 28px 28px 80px; }.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }.page-header h1 { margin: 0; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.02em; }.page-header span { display: block; margin-top: 5px; color: var(--muted); font-size: var(--text-xs); }.mobile-smart-view { display: none; }.header-actions { display: flex; gap: 2px; }.header-actions button, .search-field button, .row-actions button { width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted); }.header-actions button:hover, .header-actions button.active, .row-actions button:hover { background: var(--control-fill); color: var(--text); }
.capture { min-height: max(48px, var(--field-min-height)); display: grid; grid-template-columns: 24px 1fr max(36px, var(--icon-hit)); align-items: center; gap: 8px; margin-top: 22px; padding: 0 6px 0 14px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); box-shadow: var(--shadow-sm); }.capture > svg { color: var(--accent); }.capture input { min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--text); font-size: var(--text-base); }.capture button { width: max(36px, var(--icon-hit)); height: max(36px, var(--icon-hit)); display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: var(--accent); color: var(--accent-text); }.capture button:disabled { opacity: .28; }
.search-field { height: 38px; display: grid; grid-template-columns: 20px 1fr auto; align-items: center; gap: 6px; margin-top: 14px; padding: 0 8px 0 11px; border: 1px solid transparent; border-radius: var(--radius-md); background: var(--control-fill); color: var(--muted); }.search-field:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }.search-field input { min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-size: var(--text-sm); }.search-field button { width: 28px; height: 28px; }.search-field kbd { padding: 2px 6px; border: 1px solid var(--hairline); border-radius: 6px; color: var(--muted); font: inherit; font-size: 10px; }.filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 9px; padding: 10px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--material-thin); }
.batch-bar { min-height: 46px; display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding: 5px 7px 5px 13px; border-radius: var(--radius-lg); background: color-mix(in srgb, var(--accent) 9%, var(--surface)); color: var(--accent); font-size: var(--text-sm); }.batch-bar > div { display: flex; gap: 3px; }.batch-bar button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: transparent; color: inherit; }.task-sections { margin-top: 20px; }.task-section + .task-section { margin-top: 20px; }.task-section h2 { margin: 0 0 7px; color: var(--accent); font-size: var(--text-sm); font-weight: 650; }.task-section h2.overdue { color: var(--danger); }.task-section h2 span { margin-left: 4px; color: var(--muted); font-weight: 500; }
.task-row { position: relative; min-height: 64px; display: grid; grid-template-columns: 42px minmax(0, 1fr); align-items: stretch; border-bottom: 1px solid var(--hairline); transition: background var(--motion-fast) var(--ease); }.task-row:first-of-type { border-top: 1px solid var(--hairline); }.task-row:hover, .task-row.selected { background: color-mix(in srgb, var(--press-fill) 72%, transparent); }.task-row.selected { box-shadow: inset 3px 0 var(--accent); }.complete-button, .select-button { display: grid; place-items: center; border: 0; background: transparent; }.complete-button span { width: 22px; height: 22px; display: grid; place-items: center; border: 1.5px solid color-mix(in srgb, var(--muted) 78%, transparent); border-radius: 50%; color: transparent; }.complete-button span.high { border-color: var(--danger); }.complete-button span.medium { border-color: var(--warning); }.complete-button span.low { border-color: var(--accent); }.complete-button span.checked { border-color: var(--success); background: var(--success); color: var(--accent-text); }
.task-main { min-width: 0; min-height: 63px; display: grid; grid-template-columns: minmax(0, 1fr) 22px 20px; align-items: center; gap: 6px; padding: 8px 8px 8px 0; border: 0; background: transparent; color: var(--text); text-align: left; }.task-copy { min-width: 0; }.task-copy strong { display: block; overflow: hidden; font-size: var(--text-base); font-weight: 550; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }.task-copy small { min-height: 18px; display: flex; align-items: center; gap: 12px; margin-top: 5px; overflow: hidden; color: var(--muted); font-size: var(--text-xs); white-space: nowrap; }.task-copy small span { display: inline-flex; align-items: center; gap: 4px; }.task-row.completed .task-copy strong { color: var(--muted); text-decoration: line-through; }.priority.high { color: var(--danger); }.priority.medium { color: var(--warning); }.priority.low { color: var(--accent); }.chevron { color: color-mix(in srgb, var(--muted) 55%, transparent); }.row-actions { position: absolute; right: 7px; top: 50%; display: flex; transform: translateY(-50%); gap: 2px; padding-left: 18px; background: linear-gradient(90deg, transparent, var(--surface) 25%); opacity: 0; pointer-events: none; }.task-row:is(:hover, :focus-within) .row-actions { opacity: 1; pointer-events: auto; }.row-actions button { width: 34px; height: 34px; background: var(--control-fill); }.danger { color: var(--danger) !important; }
.empty-state { min-height: 320px; display: grid; place-content: center; justify-items: center; gap: 12px; color: color-mix(in srgb, var(--muted) 72%, transparent); }.empty-state strong { color: var(--muted); font-size: var(--text-base); font-weight: 550; }.confirm-button { min-height: 38px; padding: 0 14px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font-size: var(--text-sm); }
@media (max-width: 799px) { .tasks-view { width: 100%; padding: 18px 16px calc(106px + env(safe-area-inset-bottom, 0px)); }.page-header h1 { display: none; }.mobile-smart-view { display: block; max-width: 190px; }.capture { margin-top: 16px; }.task-sections { margin-top: 15px; }.task-row { min-height: 68px; }.task-main { min-height: 67px; grid-template-columns: minmax(0, 1fr) 22px; }.chevron { display: none; }.task-copy strong { white-space: normal; }.task-copy small { gap: 9px; }.task-copy small span:nth-child(2) { display: none; }.row-actions { display: none !important; }.filters { grid-template-columns: 1fr; }.complete-button span { width: 24px; height: 24px; } }
@media (hover: none) { .row-actions { display: none !important; } }
</style>
