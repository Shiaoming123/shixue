<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { normalizeQuickAddTime } from '../../domain/quick-add/time'

const props = withDefaults(defineProps<{
  modelValue: string
  valid?: boolean
  label: string
  placeholder?: string
  disabled?: boolean
}>(), { valid: true, placeholder: '09:00', disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:valid': [valid: boolean] }>()
const quickTimes = ['08:00', '09:00', '12:00', '14:00', '18:00', '20:00']
const draft = ref(props.modelValue)
const errorId = `time-picker-error-${useId()}`
const validationMessage = computed(() => normalizeQuickAddTime(draft.value) === null ? '请输入 00:00 到 23:59 之间的时间。' : '')

watch(() => props.modelValue, (value) => { draft.value = value })

function updateValidity(value: string) {
  draft.value = value
  emit('update:valid', normalizeQuickAddTime(value) !== null)
}

function commit() {
  const normalized = normalizeQuickAddTime(draft.value)
  if (normalized === null) { emit('update:valid', false); return }
  draft.value = normalized
  emit('update:modelValue', normalized)
  emit('update:valid', true)
}

function choose(value: string) {
  draft.value = value
  emit('update:modelValue', value)
  emit('update:valid', true)
}
</script>

<template>
  <section class="time-picker" :aria-label="label">
    <label>
      <span>{{ label }}</span>
      <input
        :value="draft"
        type="text"
        inputmode="numeric"
        maxlength="5"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="Boolean(validationMessage)"
        :aria-describedby="validationMessage ? errorId : undefined"
        @input="updateValidity(($event.target as HTMLInputElement).value)"
        @change="commit"
        @keydown.enter.prevent="commit"
      />
    </label>
    <div class="time-options" aria-label="常用时间">
      <button v-for="value in quickTimes" :key="value" type="button" :class="{ selected: draft === value }" :disabled="disabled" @click="choose(value)">{{ value }}</button>
      <button type="button" class="clear" :disabled="disabled || !draft" @click="choose('')">仅日期</button>
    </div>
    <p v-if="validationMessage" :id="errorId" class="error" aria-live="polite">{{ validationMessage }}</p>
    <p v-else class="note">使用这台设备的本地时间</p>
  </section>
</template>

<style scoped>
.time-picker { padding-top: var(--space-2); border-top: 1px solid var(--hairline); color: var(--text); }
.time-picker label { display: grid; grid-template-columns: minmax(0, 1fr) 96px; align-items: center; gap: var(--space-3); }
.time-picker label span { color: var(--muted); font-size: var(--text-xs); }
.time-picker input { min-height: 44px; min-width: 0; padding: 0 var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-md); outline: 0; background: var(--control-fill); color: var(--text); font: inherit; font-variant-numeric: tabular-nums; text-align: center; }
.time-picker input:focus { border-color: var(--accent); box-shadow: var(--focus-ring); }
.time-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-1); margin-top: var(--space-2); }
.time-options button { min-height: max(34px, var(--control-hit)); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font: inherit; font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.time-options button:hover, .time-options button.selected { border-color: color-mix(in srgb, var(--accent) 46%, var(--border)); background: var(--press-fill); color: var(--accent); }
.time-options .clear { grid-column: span 2; color: var(--muted); }
.time-picker p { margin: var(--space-1) 0 0; font-size: var(--text-xs); text-align: right; }
.time-picker .note { color: var(--muted); }
.time-picker .error { color: var(--danger); }
@media (max-width: 819px) { .time-options button { min-height: 44px; } }
</style>
