<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Bell, CalendarDays, Flag, ListTree, X } from '@lucide/vue'
import type { StudyTaskPriority, StudyTopic } from '../../storage/study/types'
import DateTimePicker from '../ui/DateTimePicker.vue'
import Listbox from '../ui/Listbox.vue'
import Sheet from '../ui/Sheet.vue'
import RecurrenceEditor, { type RecurrenceRule } from './RecurrenceEditor.vue'
import ReminderEditor, { type ReminderPermission, type ReminderSetValue } from './ReminderEditor.vue'
import type { ReminderRule as TaskReminderRule } from '../../domain/workspace/types'

export interface TaskEditValue {
  title: string
  notes: string
  topicId: string | null
  plannedOn?: string | null
  plannedAt?: string | null
  dueOn?: string | null
  dueAt?: string | null
  reminderAt: string | null
  priority: StudyTaskPriority
  estimateMinutes: number | null
  acceptanceCriteria?: string[]
}

export interface TaskEditChanges {
  baseTask: TaskEditValue
  baseReminderRules: TaskReminderRule[]
  baseRecurrenceRule: RecurrenceRule | null
  reminderCommands: ReminderSetValue[]
  recurrenceRule?: RecurrenceRule
}

type EditableStudyTask = TaskEditValue & { id?: string; status: string }

const props = defineProps<{
  open: boolean
  task?: EditableStudyTask
  topics: StudyTopic[]
  recurrenceRule?: RecurrenceRule | null
  learning?: boolean
  plannedAt?: string | null
  dueAt?: string | null
  reminderRules?: TaskReminderRule[]
  notificationAvailable?: boolean
  reminderPermission?: ReminderPermission
  reminderBusy?: boolean
  reminderError?: string
}>()

const emit = defineEmits<{
  close: []
  save: [value: TaskEditValue, changes: TaskEditChanges]
}>()

const title = ref('')
const notes = ref('')
const topicId = ref('')
const plannedOn = ref('')
const plannedTimed = ref(false)
const dueOn = ref('')
const dueTimed = ref(false)
const reminderAt = ref('')
const priority = ref<StudyTaskPriority>('none')
const estimateMinutes = ref<number | null>(null)
const criteria = ref('')
const recurrenceRule = ref<RecurrenceRule | null>(null)
const recurrenceDirty = ref(false)
const reminderCommands = ref<ReminderSetValue[]>([])
const baseTask = ref<TaskEditValue | null>(null)
const baseReminderRules = ref<TaskReminderRule[]>([])
const baseRecurrenceRule = ref<RecurrenceRule | null>(null)
const draftReminderRules = computed<TaskReminderRule[]>(() => {
  const rules = [...(props.reminderRules ?? [])]
  for (const command of reminderCommands.value) {
    const index = rules.findIndex(({ id }) => id === command.ruleId)
    const rule: TaskReminderRule = {
      id: command.ruleId, taskId: command.taskId, occurrenceId: command.occurrenceId,
      trigger: command.trigger, enabled: command.enabled, revision: index >= 0 ? rules[index]!.revision : 0,
    }
    if (index >= 0) rules.splice(index, 1, rule)
    else if (command.enabled) rules.push(rule)
  }
  return rules
})
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

watch([() => props.open, () => props.task?.id, () => Boolean(props.task)], ([open]) => {
  const task = props.task
  if (!open) {
    recurrenceDirty.value = false
    reminderCommands.value = []
    baseTask.value = null
    baseReminderRules.value = []
    baseRecurrenceRule.value = null
    return
  }
  if (!task) return
  title.value = task.title
  notes.value = task.notes
  topicId.value = task.topicId ?? ''
  plannedTimed.value = Boolean(props.plannedAt)
  plannedOn.value = props.plannedAt ? toLocalDateTime(props.plannedAt) : task.plannedOn ?? ''
  dueTimed.value = Boolean(props.dueAt)
  dueOn.value = props.dueAt ? toLocalDateTime(props.dueAt) : task.dueOn ?? ''
  reminderAt.value = task.reminderAt ? toLocalDateTime(task.reminderAt) : ''
  priority.value = task.priority
  estimateMinutes.value = task.estimateMinutes
  criteria.value = task.acceptanceCriteria?.join('\n') ?? ''
  recurrenceRule.value = props.recurrenceRule ?? null
  recurrenceDirty.value = false
  reminderCommands.value = []
  baseTask.value = draftValue()
  baseReminderRules.value = (props.reminderRules ?? [])
    .filter((rule) => rule.taskId === task.id && rule.occurrenceId === null)
    .map(cloneReminderRule)
  baseRecurrenceRule.value = props.recurrenceRule ? cloneRecurrenceRule(props.recurrenceRule) : null
}, { immediate: true })

watch(() => JSON.stringify(props.recurrenceRule ?? null), () => {
  if (props.open && !recurrenceDirty.value) recurrenceRule.value = props.recurrenceRule ?? null
})

function sameReminder(command: ReminderSetValue, rule: TaskReminderRule) {
  return command.taskId === rule.taskId && command.occurrenceId === rule.occurrenceId &&
    command.enabled === rule.enabled && JSON.stringify(command.trigger) === JSON.stringify(rule.trigger)
}

function stageReminderSet(command: ReminderSetValue) {
  const base = baseReminderRules.value.find(({ id }) => id === command.ruleId)
  const index = reminderCommands.value.findIndex(({ ruleId }) => ruleId === command.ruleId)
  if ((!base && !command.enabled) || (base && sameReminder(command, base))) {
    if (index >= 0) reminderCommands.value.splice(index, 1)
    return
  }
  if (index >= 0) reminderCommands.value.splice(index, 1, command)
  else reminderCommands.value.push(command)
}

function stageReminderRemove(rule: TaskReminderRule) {
  stageReminderSet({
    type: 'reminder.set', ruleId: rule.id, taskId: rule.taskId, occurrenceId: rule.occurrenceId,
    trigger: rule.trigger, enabled: false, expectedRevision: rule.revision,
  })
}

function stageRecurrence(rule: RecurrenceRule) {
  recurrenceRule.value = rule
  recurrenceDirty.value = JSON.stringify(rule) !== JSON.stringify(props.recurrenceRule ?? null)
}

function requestClose() { emit('close') }

function cloneReminderRule(rule: TaskReminderRule): TaskReminderRule {
  return { ...rule, trigger: { ...rule.trigger } }
}

function cloneRecurrenceRule(rule: RecurrenceRule): RecurrenceRule {
  return {
    cadence: rule.cadence.kind === 'weekly' ? { ...rule.cadence, weekdays: [...rule.cadence.weekdays] } : { ...rule.cadence },
    basis: rule.basis,
    end: { ...rule.end },
  }
}

function draftValue(): TaskEditValue | null {
  const normalizedTitle = title.value.trim()
  if (!normalizedTitle) return null
  return {
    title: normalizedTitle,
    notes: notes.value.trim(),
    topicId: topicId.value || null,
    ...(plannedTimed.value
      ? { plannedAt: plannedOn.value ? new Date(plannedOn.value).toISOString() : null }
      : { plannedOn: plannedOn.value || null }),
    ...(dueTimed.value
      ? { dueAt: dueOn.value ? new Date(dueOn.value).toISOString() : null }
      : { dueOn: dueOn.value || null }),
    reminderAt: reminderAt.value ? new Date(reminderAt.value).toISOString() : null,
    priority: priority.value,
    estimateMinutes: estimateMinutes.value && estimateMinutes.value > 0 ? estimateMinutes.value : null,
    ...(props.learning ? { acceptanceCriteria: criteria.value.split('\n').map((item) => item.trim()).filter(Boolean) } : {}),
  }
}

function save() {
  const value = draftValue()
  if (!value) return
  emit('save', value, {
    baseTask: baseTask.value ?? value,
    baseReminderRules: baseReminderRules.value.map(cloneReminderRule),
    baseRecurrenceRule: baseRecurrenceRule.value ? cloneRecurrenceRule(baseRecurrenceRule.value) : null,
    reminderCommands: [...reminderCommands.value],
    ...(recurrenceDirty.value && recurrenceRule.value ? { recurrenceRule: recurrenceRule.value } : {}),
  })
}

function toLocalDateTime(value: string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
</script>

<template>
  <Sheet :open="Boolean(open && task)" label="编辑任务" @close="requestClose">
    <form v-if="task" class="sheet-content" @submit.prevent="save">
      <header><h2 id="task-edit-title">编辑任务</h2><button type="button" title="关闭" aria-label="关闭" @click="requestClose"><X :size="19" /></button></header>
      <label><span>标题</span><input v-model="title" aria-label="任务标题" required autofocus /></label>
      <label><span>备注</span><textarea v-model="notes" aria-label="任务备注" placeholder="备注" /></label>
      <label><span><ListTree :size="15" />清单</span><Listbox v-model="topicId" :options="topicOptions" label="清单" /></label>
      <div class="field-grid">
        <label><span><CalendarDays :size="15" />日期</span><DateTimePicker v-model="plannedOn" :mode="plannedTimed ? 'datetime' : 'date'" label="日期" placeholder="不设置计划日期" /></label>
        <label><span>截止</span><DateTimePicker v-model="dueOn" :mode="dueTimed ? 'datetime' : 'date'" label="截止日期" placeholder="不设置截止日期" /></label>
      </div>
      <ReminderEditor v-if="reminderRules !== undefined && task.id" :key="task.id" :task-id="task.id" :rules="draftReminderRules" :start-at="plannedAt" :due-at="dueAt" :notification-available="notificationAvailable" :permission="reminderPermission" :busy="reminderBusy" :error="reminderError" @set="stageReminderSet" @remove="stageReminderRemove" />
      <label v-else><span><Bell :size="15" />提醒</span><DateTimePicker v-model="reminderAt" mode="datetime" label="提醒时间" placeholder="不设置提醒" /></label>
      <label><span><Flag :size="15" />优先级</span><Listbox :model-value="priority" :options="priorityOptions" label="优先级" @update:model-value="priority = $event as StudyTaskPriority" /></label>
      <label><span>重复</span><RecurrenceEditor :model-value="recurrenceRule" @save="stageRecurrence" /></label>
      <label><span>预计分钟</span><input v-model.number="estimateMinutes" type="number" min="1" max="1440" placeholder="分钟" /></label>
      <label v-if="learning"><span>完成标准</span><textarea v-model="criteria" aria-label="完成标准" placeholder="每行一项" /></label>
      <footer><button type="button" class="cancel" @click="requestClose">取消</button><button class="save" type="submit" :disabled="!title.trim() || reminderBusy">保存</button></footer>
    </form>
  </Sheet>
</template>

<style scoped>
.sheet-content { width: 100%; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; padding-bottom: 15px; border-bottom: 1px solid var(--hairline); } h2 { margin: 0; font-size: var(--text-xl); font-weight: 600; } header button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--control-fill); color: var(--muted); }
label { display: block; margin-top: 14px; } label > span { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; color: var(--muted); font-size: var(--text-xs); font-weight: 600; } input, textarea { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); outline: 0; background: var(--control-fill); color: var(--text); font: inherit; font-size: var(--text-base); } textarea { min-height: 72px; resize: vertical; } input:focus, textarea:focus { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--hairline); } footer button { min-height: 44px; padding: 0 17px; border-radius: var(--radius-lg); font-size: 12px; font-weight: 650; } .cancel { border: 1px solid var(--hairline); background: var(--control-fill); color: var(--text); } .save { border: 0; background: var(--accent); color: var(--accent-text); } .save:disabled { opacity: .4; }
@media (max-width: 819px) { .field-grid { grid-template-columns: 1fr; gap: 0; } }
</style>
