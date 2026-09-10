<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Bell, CalendarDays, Flag, ListTree, X } from '@lucide/vue'
import type { StudyTaskPriority, StudyTopic } from '../../storage/study/types'
import DateTimePicker from '../ui/DateTimePicker.vue'
import Listbox from '../ui/Listbox.vue'
import Sheet from '../ui/Sheet.vue'
import IconButton from '../ui/IconButton.vue'
import RecurrenceEditor, { type RecurrenceRule } from './RecurrenceEditor.vue'
import ReminderEditor, { type ReminderPermission, type ReminderSetValue } from './ReminderEditor.vue'
import type { ReminderRule as TaskReminderRule, Tag } from '../../domain/workspace/types'
import { reminderTarget } from '../../domain/reminders/target'
import { resolveTaskDetailPlacement } from '../../lib/responsive-shell'

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
  tagIds?: string[]
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
  tags?: Tag[]
  recurrenceRule?: RecurrenceRule | null
  learning?: boolean
  plannedAt?: string | null
  dueAt?: string | null
  reminderRules?: TaskReminderRule[]
  notificationAvailable?: boolean
  reminderPermission?: ReminderPermission
  reminderBusy?: boolean
  reminderError?: string
  overlay?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [value: TaskEditValue, changes: TaskEditChanges]
  manageTags: []
}>()

const title = ref('')
const viewportWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const placement = computed(() => props.overlay && viewportWidth.value >= 820 ? 'right' : resolveTaskDetailPlacement(viewportWidth.value))
function updateViewportWidth() { if (typeof window !== 'undefined') viewportWidth.value = window.innerWidth }
onMounted(() => { if (typeof window !== 'undefined') window.addEventListener('resize', updateViewportWidth) })
onUnmounted(() => { if (typeof window !== 'undefined') window.removeEventListener('resize', updateViewportWidth) })
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
const tagIds = ref<string[]>([])
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
      id: command.ruleId, target: reminderTarget(command),
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
const visibleTags = computed(() => (props.tags ?? [])
  .filter((tag) => tag.archivedAt === null || tagIds.value.includes(tag.id))
  .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)))

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
  tagIds.value = [...(task.tagIds ?? [])]
  recurrenceRule.value = props.recurrenceRule ?? null
  recurrenceDirty.value = false
  reminderCommands.value = []
  baseTask.value = draftValue()
  baseReminderRules.value = (props.reminderRules ?? [])
    .filter((rule) => rule.target.kind === 'task' && rule.target.taskId === task.id && rule.target.occurrenceId === null)
    .map(cloneReminderRule)
  baseRecurrenceRule.value = props.recurrenceRule ? cloneRecurrenceRule(props.recurrenceRule) : null
}, { immediate: true })

watch(() => JSON.stringify(props.recurrenceRule ?? null), () => {
  if (props.open && !recurrenceDirty.value) recurrenceRule.value = props.recurrenceRule ?? null
})

function sameReminder(command: ReminderSetValue, rule: TaskReminderRule) {
  return JSON.stringify(reminderTarget(command)) === JSON.stringify(rule.target) &&
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
    type: 'reminder.set', ruleId: rule.id, target: { ...rule.target },
    trigger: rule.trigger, enabled: false, expectedRevision: rule.revision,
  })
}

function stageRecurrence(rule: RecurrenceRule) {
  recurrenceRule.value = rule
  recurrenceDirty.value = JSON.stringify(rule) !== JSON.stringify(props.recurrenceRule ?? null)
}

function requestClose() { emit('close') }

function cloneReminderRule(rule: TaskReminderRule): TaskReminderRule {
  return { ...rule, target: { ...rule.target }, trigger: { ...rule.trigger } }
}

function cloneReminderCommand(command: ReminderSetValue): ReminderSetValue {
  return { ...command, target: reminderTarget(command), trigger: { ...command.trigger } }
}

function cloneTaskEditValue(value: TaskEditValue): TaskEditValue {
  const snapshot = { ...value }
  if (value.acceptanceCriteria) snapshot.acceptanceCriteria = [...value.acceptanceCriteria]
  if (value.tagIds) snapshot.tagIds = [...value.tagIds]
  return snapshot
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
    tagIds: [...tagIds.value],
    ...(props.learning ? { acceptanceCriteria: criteria.value.split('\n').map((item) => item.trim()).filter(Boolean) } : {}),
  }
}

function toggleTag(tag: Tag) {
  const selected = tagIds.value.includes(tag.id)
  if (!selected && tag.archivedAt !== null) return
  tagIds.value = selected ? tagIds.value.filter((id) => id !== tag.id) : [...tagIds.value, tag.id]
}

function save() {
  const value = draftValue()
  if (!value) return
  emit('save', value, {
    baseTask: cloneTaskEditValue(baseTask.value ?? value),
    baseReminderRules: baseReminderRules.value.map(cloneReminderRule),
    baseRecurrenceRule: baseRecurrenceRule.value ? cloneRecurrenceRule(baseRecurrenceRule.value) : null,
    reminderCommands: reminderCommands.value.map(cloneReminderCommand),
    ...(recurrenceDirty.value && recurrenceRule.value ? { recurrenceRule: cloneRecurrenceRule(recurrenceRule.value) } : {}),
  })
}

function toLocalDateTime(value: string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
</script>

<template>
  <Sheet :open="Boolean(open && task)" label="编辑任务" :placement="placement" size="lg" @close="requestClose">
    <template #header><div class="editor-header"><h2 id="task-edit-title">编辑任务</h2><IconButton label="关闭" :icon-size="18" @click="requestClose"><X /></IconButton></div></template>
    <form v-if="task" id="task-edit-form" class="sheet-content" @submit.prevent="save">
      <input v-model="title" class="title-input" aria-label="任务标题" placeholder="任务标题" required autofocus />
      <textarea v-model="notes" class="notes-input" aria-label="任务备注" placeholder="添加备注" />
      <label class="field-row"><span><ListTree :size="15" />清单</span><Listbox v-model="topicId" :options="topicOptions" label="清单" /></label>
      <div class="tag-field">
        <div class="field-label"><span>标签</span><button type="button" @click="emit('manageTags')">管理标签</button></div>
        <div v-if="visibleTags.length" class="tag-options" aria-label="任务标签">
          <button v-for="tag in visibleTags" :key="tag.id" type="button" :class="{ selected: tagIds.includes(tag.id), archived: tag.archivedAt !== null }" :aria-pressed="tagIds.includes(tag.id)" @click="toggleTag(tag)">{{ tag.title }}<small v-if="tag.archivedAt !== null">已归档</small></button>
        </div>
        <p v-else>还没有标签；创建后可跨主题筛选。</p>
      </div>
      <label class="field-row"><span><CalendarDays :size="15" />日期</span><DateTimePicker v-model="plannedOn" :mode="plannedTimed ? 'datetime' : 'date'" label="日期" placeholder="不设置计划日期" /></label>
      <label class="field-row"><span>截止</span><DateTimePicker v-model="dueOn" :mode="dueTimed ? 'datetime' : 'date'" label="截止日期" placeholder="不设置截止日期" /></label>
      <ReminderEditor v-if="reminderRules !== undefined && task.id" :key="task.id" :task-id="task.id" :rules="draftReminderRules" :start-at="plannedAt" :due-at="dueAt" :notification-available="notificationAvailable" :permission="reminderPermission" :busy="reminderBusy" :error="reminderError" @set="stageReminderSet" @remove="stageReminderRemove" />
      <label v-else class="field-row"><span><Bell :size="15" />提醒</span><DateTimePicker v-model="reminderAt" mode="datetime" label="提醒时间" placeholder="不设置提醒" /></label>
      <label class="field-row"><span><Flag :size="15" />优先级</span><Listbox :model-value="priority" :options="priorityOptions" label="优先级" @update:model-value="priority = $event as StudyTaskPriority" /></label>
      <RecurrenceEditor :model-value="recurrenceRule" @save="stageRecurrence" />
      <label class="field-row"><span>预计时长</span><input v-model.number="estimateMinutes" type="number" min="1" max="1440" placeholder="分钟" /></label>
      <label v-if="learning" class="stacked-field"><span>完成标准</span><textarea v-model="criteria" aria-label="完成标准" placeholder="每行一项" /></label>
      <footer class="editor-footer"><button type="button" class="cancel" @click="requestClose">取消</button><button class="save" type="submit" :disabled="!title.trim() || reminderBusy">保存</button></footer>
    </form>
  </Sheet>
</template>

<style scoped>
.sheet-content { width: 100%; display: grid; gap: 0; }
.editor-header, .editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.editor-header h2 { margin: 0; font-size: 18px; line-height: 24px; font-weight: var(--font-semibold); letter-spacing: -.01em; }.editor-footer { position: sticky; bottom: -22px; z-index: 1; justify-content: flex-end; margin: 18px -22px -22px; padding: 14px 22px 18px; border-top: 1px solid var(--glass-border); background: var(--material-thin); -webkit-backdrop-filter: var(--glass-filter); backdrop-filter: var(--glass-filter); }
input, textarea { width: 100%; min-height: var(--field-min-height); padding: 8px 11px; border: 1px solid transparent; border-radius: var(--radius-md); outline: 0; background: var(--field-fill); color: var(--text); font: inherit; font-size: var(--text-base); } textarea { min-height: 64px; resize: vertical; } input:hover:not(:focus), textarea:hover:not(:focus) { background: var(--field-hover-fill); } input:focus, textarea:focus { border-color: var(--accent); background: var(--field-focus-fill); box-shadow: var(--field-focus-ring); }
.title-input { min-height: max(42px, var(--field-min-height)); font-size: 18px; line-height: 24px; font-weight: 600; }.notes-input { min-height: 58px; margin-bottom: 8px; }
.field-row { min-height: 50px; display: grid; grid-template-columns: 104px minmax(0, 1fr); align-items: center; gap: 12px; border-top: 1px solid var(--hairline); }.field-row > span, .stacked-field > span { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: var(--text-sm); font-weight: 500; }.field-row :deep(.listbox-trigger), .field-row :deep(.date-trigger), .field-row > input { min-height: var(--field-min-height); text-align: right; }
.tag-field { min-height: 54px; padding: 9px 0; border-top: 1px solid var(--hairline); }.field-label { min-height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--muted); font-size: var(--text-sm); font-weight: 500; }.field-label button { min-height: 28px; padding: 0 8px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--accent); font: inherit; }.field-label button:hover { background: var(--control-fill); }.tag-options { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 6px; }.tag-options button { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; border: 0; border-radius: var(--radius-full); background: var(--control-fill); color: var(--muted); font: inherit; font-size: var(--text-xs); }.tag-options button.selected { background: color-mix(in srgb, var(--accent) 13%, var(--surface)); color: var(--accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent); }.tag-options button.archived { border: 1px dashed var(--hairline); }.tag-options small { font-size: 9px; }.tag-field > p { margin: 4px 0 0; color: var(--muted); font-size: var(--text-xs); }
.stacked-field { display: grid; gap: 7px; padding-top: 12px; border-top: 1px solid var(--hairline); }.editor-footer button { min-height: 36px; padding: 0 16px; border-radius: var(--radius-full); font-size: var(--text-sm); font-weight: 600; }.cancel { border: 0; background: var(--control-fill); color: var(--text); }.save { border: 0; background: var(--accent); color: var(--accent-text); }.save:disabled { opacity: .4; }
@media (max-width: 819px) { .tag-options button { min-height: 44px; }.field-row { grid-template-columns: 92px minmax(0, 1fr); } }
</style>
