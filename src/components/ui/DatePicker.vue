<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  disabled?: boolean
}>(), { disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const viewMonth = ref(startOfMonth(parseDate(props.modelValue) ?? new Date()))
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const monthLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(viewMonth.value))
const days = computed(() => {
  const first = startOfMonth(viewMonth.value)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { key: dateKey(date), day: date.getDate(), currentMonth: date.getMonth() === first.getMonth(), today: dateKey(date) === dateKey(new Date()) }
  })
})

watch(() => props.modelValue, (value) => {
  const date = parseDate(value)
  if (date) viewMonth.value = startOfMonth(date)
})

function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return dateKey(date) === value ? date : null
}
function selectDate(value: string) {
  if (props.disabled) return
  emit('update:modelValue', value)
  const selected = parseDate(value)
  if (selected) viewMonth.value = startOfMonth(selected)
}
function chooseRelative(offset: number) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  selectDate(dateKey(date))
}
function moveMonth(offset: number) { viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() + offset, 1) }
function focusDate(value: string) { nextTick(() => document.querySelector<HTMLButtonElement>(`[data-quick-add-date="${value}"]`)?.focus()) }
function onDayKeydown(event: KeyboardEvent, value: string) {
  const date = parseDate(value)
  if (!date) return
  let offset = 0
  if (event.key === 'ArrowLeft') offset = -1
  else if (event.key === 'ArrowRight') offset = 1
  else if (event.key === 'ArrowUp') offset = -7
  else if (event.key === 'ArrowDown') offset = 7
  else if (event.key === 'Home') offset = -((date.getDay() + 6) % 7)
  else if (event.key === 'End') offset = 6 - ((date.getDay() + 6) % 7)
  else if (event.key === 'PageUp' || event.key === 'PageDown') {
    event.preventDefault()
    moveMonth(event.key === 'PageUp' ? -1 : 1)
    const target = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth(), Math.min(date.getDate(), new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() + 1, 0).getDate()))
    focusDate(dateKey(target))
    return
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault(); selectDate(value); return
  } else return
  event.preventDefault()
  date.setDate(date.getDate() + offset)
  viewMonth.value = startOfMonth(date)
  focusDate(dateKey(date))
}
</script>

<template>
  <section class="date-picker" :aria-label="label">
    <div class="date-shortcuts">
      <button type="button" :disabled="disabled" @click="chooseRelative(0)">今天</button>
      <button type="button" :disabled="disabled" @click="chooseRelative(1)">明天</button>
      <button v-if="modelValue" type="button" class="clear" :disabled="disabled" @click="emit('update:modelValue', '')">清除</button>
    </div>
    <div class="month-header">
      <button type="button" aria-label="上个月" :disabled="disabled" @click="moveMonth(-1)">‹</button>
      <strong aria-live="polite">{{ monthLabel }}</strong>
      <button type="button" aria-label="下个月" :disabled="disabled" @click="moveMonth(1)">›</button>
    </div>
    <div class="calendar" role="grid" :aria-label="`${monthLabel}日历`">
      <span v-for="weekday in weekdays" :key="weekday" role="columnheader">{{ weekday }}</span>
      <button
        v-for="day in days"
        :key="day.key"
        type="button"
        role="gridcell"
        :data-quick-add-date="day.key"
        :class="{ muted: !day.currentMonth, today: day.today, selected: modelValue === day.key }"
        :aria-label="day.key"
        :aria-selected="modelValue === day.key"
        :disabled="disabled"
        @click="selectDate(day.key)"
        @keydown="onDayKeydown($event, day.key)"
      >{{ day.day }}</button>
    </div>
  </section>
</template>

<style scoped>
.date-picker { width: 100%; color: var(--text); font-variant-numeric: tabular-nums; }
.date-shortcuts { display: flex; gap: var(--space-1); }
.date-shortcuts button { min-height: max(34px, var(--control-hit)); padding: 0 var(--space-3); border: 0; border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font: inherit; font-size: var(--text-xs); }
.date-shortcuts .clear { margin-left: auto; color: var(--danger); }
.month-header { display: grid; grid-template-columns: max(36px, var(--icon-hit)) 1fr max(36px, var(--icon-hit)); align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.month-header strong { text-align: center; font-size: var(--text-base); font-weight: 600; }
.month-header button { width: max(36px, var(--icon-hit)); height: max(36px, var(--icon-hit)); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted); font-size: var(--text-xl); }
.month-header button:hover { background: var(--control-fill); color: var(--text); }
.calendar { display: grid; grid-template-columns: repeat(7, minmax(36px, 1fr)); gap: 2px; margin-top: var(--space-1); }
.calendar > span { min-height: 28px; display: grid; place-items: center; color: var(--muted); font-size: var(--text-xs); }
.calendar button { aspect-ratio: 1; min-width: 0; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text); font: inherit; font-size: var(--text-sm); }
.calendar button:hover { background: var(--control-fill); }
.calendar button.muted { color: color-mix(in srgb, var(--muted) 58%, transparent); }
.calendar button.today { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 48%, transparent); color: var(--accent); }
.calendar button.selected { background: var(--accent); box-shadow: none; color: var(--accent-text); font-weight: 600; }
@media (max-width: 819px) {
  .calendar { grid-template-columns: repeat(7, minmax(38px, 1fr)); }
  .calendar button { min-height: 44px; }
}
</style>
