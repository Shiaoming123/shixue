<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Bell, CalendarDays, Flag, ListTree, X } from '@lucide/vue'
import type { StudyTaskPriority, StudyTopic } from '../../storage/study/types'
import DateTimePicker from '../ui/DateTimePicker.vue'
import Listbox from '../ui/Listbox.vue'

export interface TaskEditValue {
  title: string
  notes: string
  topicId: string | null
  plannedOn: string | null
  dueOn: string | null
  reminderAt: string | null
  priority: StudyTaskPriority
  estimateMinutes: number | null
  acceptanceCriteria: string[]
}

type EditableStudyTask = TaskEditValue & { status: string }

const props = defineProps<{
  open: boolean
  task?: EditableStudyTask
  topics: StudyTopic[]
}>()

const emit = defineEmits<{
  close: []
  save: [value: TaskEditValue]
}>()

const title = ref('')
const notes = ref('')
const topicId = ref('')
const plannedOn = ref('')
const dueOn = ref('')
const reminderAt = ref('')
const priority = ref<StudyTaskPriority>('none')
const estimateMinutes = ref<number | null>(null)
const criteria = ref('')
const topicOptions = computed(() => [
  { value: '', label: '收件箱' },
  ...props.topics.map((topic) => ({ value: topic.id, label: topic.title })),
])
const priorityOptions = [
  { value: 'none', label: '无' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

watch(() => [props.open, props.task] as const, ([open, task]) => {
  if (!open || !task) return
  title.value = task.title
  notes.value = task.notes
  topicId.value = task.topicId ?? ''
  plannedOn.value = task.plannedOn ?? ''
  dueOn.value = task.dueOn ?? ''
  reminderAt.value = task.reminderAt ? toLocalDateTime(task.reminderAt) : ''
  priority.value = task.priority
  estimateMinutes.value = task.estimateMinutes
  criteria.value = task.acceptanceCriteria.join('\n')
}, { immediate: true })

function save() {
  const normalizedTitle = title.value.trim()
  if (!normalizedTitle) return
  emit('save', {
    title: normalizedTitle,
    notes: notes.value.trim(),
    topicId: topicId.value || null,
    plannedOn: plannedOn.value || null,
    dueOn: dueOn.value || null,
    reminderAt: reminderAt.value ? new Date(reminderAt.value).toISOString() : null,
    priority: priority.value,
    estimateMinutes: estimateMinutes.value && estimateMinutes.value > 0 ? estimateMinutes.value : null,
    acceptanceCriteria: criteria.value.split('\n').map((item) => item.trim()).filter(Boolean),
  })
}

function toLocalDateTime(value: string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
</script>

<template>
  <div v-if="open && task" class="backdrop" @click.self="emit('close')">
    <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="task-edit-title" @submit.prevent="save">
      <header><h2 id="task-edit-title">编辑任务</h2><button type="button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="19" /></button></header>
      <label><span>标题</span><input v-model="title" aria-label="任务标题" required autofocus /></label>
      <label><span>备注</span><textarea v-model="notes" aria-label="任务备注" placeholder="备注" /></label>
      <label><span><ListTree :size="15" />清单</span><Listbox v-model="topicId" :options="topicOptions" label="清单" /></label>
      <div class="field-grid">
        <label><span><CalendarDays :size="15" />日期</span><DateTimePicker v-model="plannedOn" label="日期" placeholder="不设置计划日期" /></label>
        <label><span>截止</span><DateTimePicker v-model="dueOn" label="截止日期" placeholder="不设置截止日期" /></label>
      </div>
      <label><span><Bell :size="15" />提醒</span><DateTimePicker v-model="reminderAt" mode="datetime" label="提醒时间" placeholder="不设置提醒" /></label>
      <label><span><Flag :size="15" />优先级</span><Listbox :model-value="priority" :options="priorityOptions" label="优先级" @update:model-value="priority = $event as StudyTaskPriority" /></label>
      <label><span>预计分钟</span><input v-model.number="estimateMinutes" type="number" min="1" max="1440" placeholder="分钟" /></label>
      <label><span>完成标准</span><textarea v-model="criteria" aria-label="完成标准" placeholder="每行一项" /></label>
      <footer><button type="button" class="cancel" @click="emit('close')">取消</button><button class="save" type="submit" :disabled="!title.trim()">保存</button></footer>
    </form>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; z-index: var(--z-modal); inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, var(--text) 22%, transparent); backdrop-filter: saturate(120%) blur(12px); }
.sheet { width: min(100%, 520px); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 28px; border: 1px solid var(--hairline); border-radius: var(--radius-2xl); background: var(--material-regular); box-shadow: var(--shadow-lg); animation: sheet-in var(--motion-slow) var(--ease-spring); }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; padding-bottom: 15px; border-bottom: 1px solid var(--hairline); } h2 { margin: 0; font-size: var(--text-xl); font-weight: 600; } header button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--control-fill); color: var(--muted); }
label { display: block; margin-top: 14px; } label > span { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; color: var(--muted); font-size: var(--text-xs); font-weight: 600; } input, textarea { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); outline: 0; background: var(--control-fill); color: var(--text); font: inherit; font-size: var(--text-base); } textarea { min-height: 72px; resize: vertical; } input:focus, textarea:focus { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--hairline); } footer button { min-height: 44px; padding: 0 17px; border-radius: var(--radius-lg); font-size: 12px; font-weight: 650; } .cancel { border: 1px solid var(--hairline); background: var(--control-fill); color: var(--text); } .save { border: 0; background: var(--accent); color: var(--accent-text); } .save:disabled { opacity: .4; }
@keyframes sheet-in { from { transform: translateY(16px) scale(.985); opacity: .7; } }
@media (max-width: 599px) { .backdrop { align-items: flex-end; padding: 0; } .sheet { max-height: 94dvh; padding: 30px 20px calc(22px + env(safe-area-inset-bottom, 0px)); border-radius: var(--radius-2xl) var(--radius-2xl) 0 0; } .field-grid { grid-template-columns: 1fr; gap: 0; } }
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
</style>
