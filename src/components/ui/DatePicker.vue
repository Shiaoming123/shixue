<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  disabled?: boolean
}>(), { disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const initialDate = parseDate(props.modelValue) ?? new Date()
const viewMonth = ref(startOfMonth(initialDate))
const focusedDateKey = ref(dateKey(initialDate))
const calendarElement = ref<HTMLElement | null>(null)
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
const weeks = computed(() => Array.from({ length: 6 }, (_, index) => days.value.slice(index * 7, index * 7 + 7)))

watch(() => props.modelValue, (value) => {
  const date = parseDate(value)
  if (date) {
    viewMonth.value = startOfMonth(date)
    focusedDateKey.value = value
  }
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
  focusedDateKey.value = value
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
function moveMonth(offset: number) {
  const current = parseDate(focusedDateKey.value) ?? viewMonth.value
  const first = new Date(current.getFullYear(), current.getMonth() + offset, 1)
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const target = new Date(first.getFullYear(), first.getMonth(), Math.min(current.getDate(), lastDay))
  viewMonth.value = startOfMonth(target)
  focusedDateKey.value = dateKey(target)
}
function moveYear(offset: number) { moveMonth(offset * 12) }
function focusDate(value: string) {
  focusedDateKey.value = value
  nextTick(() => calendarElement.value?.querySelector<HTMLButtonElement>(`[data-quick-add-date="${value}"]`)?.focus())
}
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
    const distance = event.shiftKey ? 12 : 1
    moveMonth(event.key === 'PageUp' ? -distance : distance)
    focusDate(focusedDateKey.value)
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
      <button type="button" aria-label="上一年" :disabled="disabled" @click="moveYear(-1)">«</button>
      <button type="button" aria-label="上个月" :disabled="disabled" @click="moveMonth(-1)">‹</button>
      <strong aria-live="polite">{{ monthLabel }}</strong>
      <button type="button" aria-label="下个月" :disabled="disabled" @click="moveMonth(1)">›</button>
      <button type="button" aria-label="下一年" :disabled="disabled" @click="moveYear(1)">»</button>
    </div>
    <div ref="calendarElement" class="calendar" role="grid" :aria-label="`${monthLabel}日历`">
      <div class="calendar-row calendar-head" role="row">
        <span v-for="weekday in weekdays" :key="weekday" role="columnheader">{{ weekday }}</span>
      </div>
      <div v-for="(week, weekIndex) in weeks" :key="weekIndex" class="calendar-row" role="row">
        <button
          v-for="day in week"
          :key="day.key"
          type="button"
          role="gridcell"
          :tabindex="day.key === focusedDateKey ? 0 : -1"
          :data-quick-add-date="day.key"
          :class="{ muted: !day.currentMonth, today: day.today, selected: modelValue === day.key }"
          :aria-label="day.key"
          :aria-selected="modelValue === day.key"
          :aria-current="day.today ? 'date' : undefined"
          :disabled="disabled"
          @click="selectDate(day.key)"
          @focus="focusedDateKey = day.key"
          @keydown="onDayKeydown($event, day.key)"
        >{{ day.day }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.date-picker { width: 100%; color: var(--text); font-variant-numeric: tabular-nums; }
.date-shortcuts { display: flex; gap: var(--space-1); }
.date-shortcuts button { min-height: max(34px, var(--control-hit)); padding: 0 var(--space-3); border: 0; border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font: inherit; font-size: var(--text-xs); }
.date-shortcuts .clear { margin-left: auto; color: var(--danger); }
.month-header { display: grid; grid-template-columns: repeat(2, max(36px, var(--icon-hit))) 1fr repeat(2, max(36px, var(--icon-hit))); align-items: center; gap: var(--space-1); margin-top: var(--space-2); }
.month-header strong { text-align: center; font-size: var(--text-base); font-weight: 600; }
.month-header button { width: max(36px, var(--icon-hit)); height: max(36px, var(--icon-hit)); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted); font-size: var(--text-xl); }
.month-header button:hover { background: var(--control-fill); color: var(--text); }
.calendar { display: grid; gap: 2px; margin-top: var(--space-1); }
.calendar-row { display: grid; grid-template-columns: repeat(7, minmax(36px, 1fr)); gap: 2px; }
.calendar-head span { min-height: 28px; display: grid; place-items: center; color: var(--muted); font-size: var(--text-xs); }
.calendar button { aspect-ratio: 1; min-width: 0; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text); font: inherit; font-size: var(--text-sm); }
.calendar button:hover { background: var(--control-fill); }
.calendar button.muted { color: color-mix(in srgb, var(--muted) 58%, transparent); }
.calendar button.today { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 48%, transparent); color: var(--accent); }
.calendar button.selected { background: var(--accent); box-shadow: none; color: var(--accent-text); font-weight: 600; }
@media (max-width: 819px) {
  .calendar-row { grid-template-columns: repeat(7, minmax(38px, 1fr)); }
  .calendar button { min-height: 44px; }
}
@media (max-width: 359px) {
  .calendar-row { grid-template-columns: repeat(7, minmax(44px, 1fr)); gap: 0; }
  .calendar button { aspect-ratio: auto; }
}
</style>
