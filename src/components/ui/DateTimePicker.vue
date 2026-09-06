<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import Popover from './Popover.vue'
import DatePicker from './DatePicker.vue'
import { normalizeQuickAddTime } from '../../domain/quick-add/time'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  mode?: 'date' | 'datetime'
  placeholder?: string
  disabled?: boolean
  required?: boolean
}>(), { mode: 'date', placeholder: '选择日期', disabled: false, required: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const draftDate = ref('')
const draftTime = ref('09:00')
const errorId = `date-time-error-${useId()}`
const normalizedTime = computed(() => normalizeQuickAddTime(draftTime.value))
const timeError = computed(() => normalizedTime.value === null || normalizedTime.value === '' ? '请输入 00:00 到 23:59 之间的时间。' : '')
const displayValue = computed(() => {
  if (!props.modelValue) return props.placeholder
  const date = new Date(`${props.modelValue.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return props.modelValue
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', month: 'short', day: 'numeric',
  }).format(date)
  return props.mode === 'datetime' ? `${formatted} ${props.modelValue.slice(11, 16)}` : formatted
})
async function setOpen(value: boolean) {
  if (props.disabled) return
  open.value = value
  if (!value) return
  draftDate.value = props.modelValue.slice(0, 10)
  draftTime.value = props.modelValue.slice(11, 16) || '09:00'
  await nextTick()
  await nextTick()
  if (!open.value) return
  panel.value?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus({ preventScroll: true })
}
function close() {
  open.value = false
  nextTick(() => trigger.value?.focus({ preventScroll: true }))
}
function selectDate(value: string) {
  draftDate.value = value
  if (props.mode === 'date' || !value) {
    emit('update:modelValue', value)
    close()
  }
}
function normalizeTime() {
  if (normalizedTime.value) draftTime.value = normalizedTime.value
}
function applyDateTime() {
  if (!draftDate.value || !normalizedTime.value) return
  emit('update:modelValue', `${draftDate.value}T${normalizedTime.value}`)
  close()
}
</script>

<template>
  <span class="date-time-picker">
    <Popover :open="open" align="start" mobile-sheet :mobile-sheet-label="label" @update:open="setOpen">
      <template #trigger="{ triggerProps }">
        <button v-bind="triggerProps" ref="trigger" type="button" class="date-trigger" :class="{ placeholder: !modelValue }" :aria-label="label" :aria-required="required || undefined" :disabled="disabled">
          <span>{{ displayValue }}</span><i aria-hidden="true" />
        </button>
      </template>
      <template #default="{ modal }">
        <div ref="panel" class="date-panel" :role="modal ? undefined : 'dialog'" :aria-modal="modal ? undefined : 'false'" :aria-label="modal ? undefined : label">
          <DatePicker :model-value="draftDate" :label="label" @update:model-value="selectDate" />
          <template v-if="mode === 'datetime'">
            <label class="time-field">
              <span>本地时间</span>
              <input v-model="draftTime" type="text" inputmode="numeric" maxlength="5" aria-label="本地时间，24 小时制" placeholder="09:00" :aria-invalid="Boolean(timeError)" :aria-describedby="timeError ? errorId : undefined" @blur="normalizeTime" @keydown.enter.prevent="applyDateTime" />
            </label>
            <p v-if="timeError" :id="errorId" class="time-error" role="status">{{ timeError }}</p>
            <p v-else class="timezone-note">使用这台设备的本地时间</p>
            <footer>
              <button type="button" @click="close">取消</button>
              <button type="button" class="apply" :disabled="!draftDate || Boolean(timeError)" @click="applyDateTime">应用</button>
            </footer>
          </template>
        </div>
      </template>
    </Popover>
  </span>
</template>
<style scoped>
.date-time-picker { display: block; min-width: 0; }
.date-trigger { width: 100%; min-height: 44px; display: grid; grid-template-columns: minmax(0, 1fr) 18px; align-items: center; gap: var(--space-2); padding: 0 var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); color: var(--text); font-size: var(--text-base); font-variant-numeric: tabular-nums; text-align: left; }.date-trigger.placeholder { color: var(--muted); }.date-trigger[aria-expanded='true'] { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }.date-trigger > i { position: relative; width: 15px; height: 15px; justify-self: end; border: 1.5px solid currentColor; border-radius: 4px; color: var(--muted); }.date-trigger > i::before { content: ''; position: absolute; top: 3px; left: -1.5px; right: -1.5px; border-top: 1.5px solid currentColor; }
.date-panel { width: min(340px, calc(100vw - 16px)); padding: var(--space-3); font-variant-numeric: tabular-nums; }.time-field { display: grid; grid-template-columns: 1fr 88px; align-items: center; gap: var(--space-3); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--hairline); }.time-field span { color: var(--muted); font-size: var(--text-sm); }.time-field input { min-height: max(38px, var(--field-min-height)); padding: 0 var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-md); outline: 0; background: var(--control-fill); color: var(--text); font-size: var(--text-base); font-variant-numeric: tabular-nums; text-align: center; }.time-field input:focus { border-color: var(--accent); box-shadow: var(--focus-ring); }.timezone-note { margin: var(--space-1) 0 0; color: var(--muted); font-size: var(--text-xs); text-align: right; }.date-panel footer { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3); }.date-panel footer button { min-height: max(36px, var(--control-hit)); padding: 0 var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font-size: var(--text-sm); }.date-panel footer .apply { border-color: transparent; background: var(--accent); color: var(--accent-text); }.date-panel footer .apply:disabled { opacity: .42; }
.time-error { color: var(--danger); font-size: var(--text-xs); }
@media (max-width: 819px) { .date-panel { width: 100%; } }
</style>
