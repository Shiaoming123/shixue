<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReminderRule, ReminderTrigger } from '../../domain/workspace/types'
import type { ReminderCapabilityCommand } from '../../domain/capabilities/reminder-commands'
import Button from '../ui/Button.vue'
import DateTimePicker from '../ui/DateTimePicker.vue'
import Listbox from '../ui/Listbox.vue'

export type ReminderSetValue = Extract<ReminderCapabilityCommand, { type: 'reminder.set' }>
export type ReminderPermission = 'granted' | 'prompt' | 'denied' | 'unavailable'
const props = withDefaults(defineProps<{
  taskId: string
  occurrenceId?: string | null
  rules: ReminderRule[]
  startAt?: string | null
  dueAt?: string | null
  notificationAvailable?: boolean
  permission?: ReminderPermission
  busy?: boolean
  error?: string
}>(), { occurrenceId: null, notificationAvailable: false, permission: 'unavailable', busy: false, error: '' })
const emit = defineEmits<{ set: [value: ReminderSetValue]; remove: [rule: ReminderRule] }>()
const preset = ref('at_start')
const anchor = ref('start')
const customAt = ref('')
const editingRule = ref<ReminderRule | null>(null)
const draftRuleId = ref(crypto.randomUUID())
watch(() => props.rules, (rules) => {
  if (rules.some((rule) => rule.id === draftRuleId.value)) draftRuleId.value = crypto.randomUUID()
  if (editingRule.value && rules.some((rule) => rule.id === editingRule.value?.id && rule.revision > editingRule.value.revision)) editingRule.value = null
})
const rulesForTask = computed(() => props.rules.filter((rule) => rule.taskId === props.taskId && rule.occurrenceId === props.occurrenceId))
const presetOptions = computed(() => [
  { value: 'at_start', label: '开始时', disabled: !props.startAt },
  { value: '10', label: '提前 10 分钟', disabled: !props.startAt && !props.dueAt },
  { value: '60', label: '提前 1 小时', disabled: !props.startAt && !props.dueAt },
  { value: 'custom', label: '自定义时间' },
])
const anchorOptions = computed(() => [
  { value: 'start', label: '计划开始', disabled: !props.startAt },
  { value: 'due', label: '截止时间', disabled: !props.dueAt || Boolean(props.occurrenceId) },
])
const trigger = computed<ReminderTrigger | null>(() => {
  if (preset.value === 'custom') {
    const timestamp = Date.parse(customAt.value)
    return customAt.value && Number.isFinite(timestamp) ? { kind: 'absolute', at: new Date(timestamp).toISOString() } : null
  }
  if (preset.value === 'at_start') return props.startAt ? { kind: 'at_start' } : null
  if (anchor.value === 'due') return props.dueAt && !props.occurrenceId ? { kind: 'before_due', minutes: Number(preset.value) } : null
  return props.startAt ? { kind: 'before_start', minutes: Number(preset.value) } : null
})
function formatTrigger(value: ReminderTrigger) {
  if (value.kind === 'at_start') return '开始时'
  if (value.kind === 'absolute') return new Date(value.at).toLocaleString('zh-CN', { hour12: false })
  return `${value.kind === 'before_due' ? '截止前' : '开始前'} ${value.minutes} 分钟`
}
function edit(rule: ReminderRule) {
  editingRule.value = rule
  preset.value = rule.trigger.kind === 'absolute' ? 'custom' : rule.trigger.kind === 'at_start' ? 'at_start' : String(rule.trigger.minutes)
  anchor.value = rule.trigger.kind === 'before_due' ? 'due' : 'start'
  if (rule.trigger.kind === 'absolute') {
    const date = new Date(rule.trigger.at)
    customAt.value = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  }
}
function save() {
  if (props.busy || !trigger.value) return
  emit('set', { type: 'reminder.set', ruleId: editingRule.value?.id ?? draftRuleId.value, taskId: props.taskId, occurrenceId: props.occurrenceId, trigger: trigger.value, enabled: true, ...(editingRule.value ? { expectedRevision: editingRule.value.revision } : {}) })
}
function remove(rule: ReminderRule) { if (!props.busy && rule.enabled) emit('remove', rule) }
</script>

<template>
  <section class="reminder-editor" aria-label="提醒规则">
    <h3>提醒</h3>
    <p v-if="!notificationAvailable || permission !== 'granted'" class="availability">仅应用内提醒<span v-if="permission === 'denied'"> · 系统通知权限未授予</span></p>
    <ul v-if="rulesForTask.length" class="rules">
      <li v-for="rule in rulesForTask" :key="rule.id">
        <span>{{ formatTrigger(rule.trigger) }}<small v-if="!rule.enabled">已停用，历史保留</small></span>
        <div v-if="rule.enabled" class="rule-actions">
          <Button size="sm" variant="ghost" :disabled="busy" :aria-label="`编辑提醒：${formatTrigger(rule.trigger)}`" @click="edit(rule)">编辑</Button>
          <Button size="sm" variant="ghost" :disabled="busy" :aria-label="`停用提醒：${formatTrigger(rule.trigger)}`" @click="remove(rule)">移除</Button>
        </div>
      </li>
    </ul>
    <div class="draft">
      <Listbox v-model="preset" :options="presetOptions" label="提醒时间" :disabled="busy" />
      <Listbox v-if="preset !== 'at_start' && preset !== 'custom'" v-model="anchor" :options="anchorOptions" label="提醒依据" :disabled="busy" />
      <DateTimePicker v-if="preset === 'custom'" v-model="customAt" mode="datetime" label="自定义提醒时间" :disabled="busy" />
      <p v-if="!startAt && !dueAt && preset !== 'custom'" class="availability">先设置具体计划时间，或选择自定义时间。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="rule-actions">
        <Button v-if="editingRule" size="sm" variant="ghost" :disabled="busy" @click="editingRule = null">取消编辑</Button>
        <Button size="sm" :disabled="busy || !trigger" @click="save">{{ busy ? '正在保存' : error ? '重试保存' : editingRule ? '保存提醒' : '添加提醒' }}</Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.reminder-editor { margin-top: var(--space-4); color: var(--text); }
h3 { margin: 0 0 var(--space-2); font-size: var(--text-xs); font-weight: 600; }
.availability, .error { margin: var(--space-2) 0; color: var(--muted); font-size: var(--text-xs); }
.error { color: var(--danger); }
.rules { list-style: none; margin: 0 0 var(--space-3); padding: 0; }
.rules li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding-block: var(--space-2); border-bottom: 1px solid var(--hairline); font-size: var(--text-sm); }
.rules li > span { min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
small { display: block; color: var(--muted); }
.draft { display: grid; gap: var(--space-2); }
.rule-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-1); }
@media (max-width: 369px) { .rules li { align-items: start; flex-direction: column; } }
</style>
