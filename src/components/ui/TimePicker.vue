<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  placeholder?: string
  disabled?: boolean
}>(), { placeholder: '09:00', disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const quickTimes = ['08:00', '09:00', '12:00', '14:00', '18:00', '20:00']

function update(value: string) {
  if (!value) { emit('update:modelValue', ''); return }
  const match = /^(\d{1,2}):?(\d{0,2})$/u.exec(value.trim())
  if (!match) return
  const hours = Number(match[1])
  const minutes = Number(match[2] || 0)
  if (hours > 23 || minutes > 59) return
  emit('update:modelValue', `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`)
}
</script>

<template>
  <section class="time-picker" :aria-label="label">
    <label>
      <span>{{ label }}</span>
      <input
        :value="modelValue"
        type="text"
        inputmode="numeric"
        maxlength="5"
        :placeholder="placeholder"
        :disabled="disabled"
        @change="update(($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent="update(($event.target as HTMLInputElement).value)"
      />
    </label>
    <div class="time-options" aria-label="常用时间">
      <button v-for="value in quickTimes" :key="value" type="button" :class="{ selected: modelValue === value }" :disabled="disabled" @click="update(value)">{{ value }}</button>
      <button type="button" class="clear" :disabled="disabled || !modelValue" @click="update('')">仅日期</button>
    </div>
    <p>使用这台设备的本地时间</p>
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
.time-picker p { margin: var(--space-1) 0 0; color: var(--muted); font-size: var(--text-xs); text-align: right; }
@media (max-width: 819px) { .time-options button { min-height: 44px; } }
</style>
