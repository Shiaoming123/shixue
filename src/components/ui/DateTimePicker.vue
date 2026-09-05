<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Popover from './Popover.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  mode?: 'date' | 'datetime'
  placeholder?: string
  disabled?: boolean
  required?: boolean
}>(), {
  mode: 'date',
  placeholder: '选择日期',
  disabled: false,
  required: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const viewMonth = ref(startOfMonth(new Date()))
const draftDate = ref('')
const draftTime = ref('09:00')
const weekdays = ['一', '二', '三', '四', '五', '六', '日']

const monthLabel = computed(() => new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
}).format(viewMonth.value))

const days = computed(() => {
  const first = startOfMonth(viewMonth.value)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      key: dateKey(date),
      day: date.getDate(),
      currentMonth: date.getMonth() === first.getMonth(),
      today: dateKey(date) === dateKey(new Date()),
    }
  })
})

const displayValue = computed(() => {
  if (!props.modelValue) return props.placeholder
  const date = parseDate(props.modelValue.slice(0, 10))
  if (!date) return props.modelValue
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
  return props.mode === 'datetime' ? `${formatted} ${props.modelValue.slice(11, 16)}` : formatted
})

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return dateKey(date) === value ? date : null
}

function resetDraft() {
  const datePart = props.modelValue.slice(0, 10)
  const selected = parseDate(datePart)
  draftDate.value = selected ? datePart : ''
  draftTime.value = /^\d{2}:\d{2}$/.test(props.modelValue.slice(11, 16))
    ? props.modelValue.slice(11, 16)
    : '09:00'
  viewMonth.value = startOfMonth(selected ?? new Date())
}

async function setOpen(value: boolean) {
  open.value = value
  if (!value) return
  resetDraft()
  await nextTick()
  focusDate(draftDate.value || dateKey(new Date()))
}

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) nextTick(() => trigger.value?.focus({ preventScroll: true }))
}

function moveMonth(amount: number) {
  viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() + amount, 1)
}

function selectDate(value: string) {
  draftDate.value = value
  const date = parseDate(value)
  if (date) viewMonth.value = startOfMonth(date)
  if (props.mode === 'date') {
    emit('update:modelValue', value)
    close(true)
  }
}

function chooseRelative(daysFromToday: number) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + daysFromToday)
  selectDate(dateKey(date))
}

function clear() {
  emit('update:modelValue', '')
  close(true)
}

function normalizeTime() {
  const match = /^(\d{1,2}):?(\d{0,2})$/.exec(draftTime.value.trim())
  if (!match) {
    draftTime.value = '09:00'
    return
  }
  const hours = Math.min(23, Math.max(0, Number(match[1])))
  const minutes = Math.min(59, Math.max(0, Number(match[2] || 0)))
  draftTime.value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function applyDateTime() {
  if (!draftDate.value) return
  normalizeTime()
  emit('update:modelValue', `${draftDate.value}T${draftTime.value}`)
  close(true)
}

function focusDate(value: string) {
  nextTick(() => document.querySelector<HTMLButtonElement>(`[data-picker-date="${value}"]`)?.focus())
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
    const targetMonth = new Date(date.getFullYear(), date.getMonth() + (event.key === 'PageUp' ? -1 : 1), 1)
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()
    const next = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(date.getDate(), lastDay))
    viewMonth.value = startOfMonth(next)
    focusDate(dateKey(next))
    return
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    selectDate(value)
    return
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  } else return
  event.preventDefault()
  date.setDate(date.getDate() + offset)
  viewMonth.value = startOfMonth(date)
  focusDate(dateKey(date))
}
</script>

<template>
  <span class="date-time-picker">
    <Popover :open="open" align="start" @update:open="setOpen">
      <template #trigger="{ triggerProps }">
        <button
          v-bind="triggerProps"
          ref="trigger"
          type="button"
          class="date-trigger"
          :class="{ placeholder: !modelValue }"
          :aria-label="label"
          :aria-required="required || undefined"
          :disabled="disabled"
        >
          <span>{{ displayValue }}</span><i aria-hidden="true" />
        </button>
      </template>

      <div class="date-panel">
        <div class="date-shortcuts">
          <button type="button" @click="chooseRelative(0)">今天</button>
          <button type="button" @click="chooseRelative(1)">明天</button>
          <button v-if="modelValue" type="button" class="clear" @click="clear">清除</button>
        </div>
        <div class="month-header">
          <button type="button" aria-label="上个月" @click="moveMonth(-1)">‹</button>
          <strong aria-live="polite">{{ monthLabel }}</strong>
          <button type="button" aria-label="下个月" @click="moveMonth(1)">›</button>
        </div>
        <div class="calendar" role="grid" :aria-label="`${monthLabel}日历`">
          <span v-for="weekday in weekdays" :key="weekday" role="columnheader">{{ weekday }}</span>
          <button
            v-for="day in days"
            :key="day.key"
            type="button"
            role="gridcell"
            :data-picker-date="day.key"
            :class="{ muted: !day.currentMonth, today: day.today, selected: draftDate === day.key }"
            :aria-label="day.key"
            :aria-selected="draftDate === day.key"
            @click="selectDate(day.key)"
            @keydown="onDayKeydown($event, day.key)"
          >{{ day.day }}</button>
        </div>
        <template v-if="mode === 'datetime'">
          <label class="time-field">
            <span>本地时间</span>
            <input
              v-model="draftTime"
              type="text"
              inputmode="numeric"
              maxlength="5"
              pattern="[0-2]?[0-9]:[0-5][0-9]"
              aria-label="本地时间，24 小时制"
              placeholder="09:00"
              @blur="normalizeTime"
              @keydown.enter.prevent="applyDateTime"
            />
          </label>
          <p class="timezone-note">使用这台设备的本地时间</p>
          <footer>
            <button type="button" @click="close(true)">取消</button>
            <button type="button" class="apply" :disabled="!draftDate" @click="applyDateTime">应用</button>
          </footer>
        </template>
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.date-time-picker { display: block; min-width: 0; }
.date-trigger { width: 100%; min-height: 44px; display: grid; grid-template-columns: minmax(0, 1fr) 18px; align-items: center; gap: var(--space-2); padding: 0 var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); color: var(--text); font-size: var(--text-base); font-variant-numeric: tabular-nums; text-align: left; }.date-trigger.placeholder { color: var(--muted); }.date-trigger[aria-expanded='true'] { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }.date-trigger > i { position: relative; width: 15px; height: 15px; justify-self: end; border: 1.5px solid currentColor; border-radius: 4px; color: var(--muted); }.date-trigger > i::before { content: ''; position: absolute; top: 3px; left: -1.5px; right: -1.5px; border-top: 1.5px solid currentColor; }
.date-panel { width: min(320px, calc(100vw - 16px)); padding: var(--space-3); font-variant-numeric: tabular-nums; }.date-shortcuts { display: flex; gap: var(--space-1); }.date-shortcuts button { min-height: max(32px, var(--control-hit)); padding: 0 var(--space-3); border: 0; border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font-size: var(--text-xs); }.date-shortcuts .clear { margin-left: auto; color: var(--danger); }.month-header { display: grid; grid-template-columns: max(36px, var(--icon-hit)) 1fr max(36px, var(--icon-hit)); align-items: center; gap: var(--space-2); margin-top: var(--space-3); }.month-header strong { text-align: center; font-size: var(--text-base); font-weight: 600; }.month-header button { width: max(36px, var(--icon-hit)); height: max(36px, var(--icon-hit)); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted); font-size: var(--text-xl); }.month-header button:hover { background: var(--control-fill); color: var(--text); }
.calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-top: var(--space-2); }.calendar > span { height: 28px; display: grid; place-items: center; color: var(--muted); font-size: var(--text-xs); }.calendar button { aspect-ratio: 1; min-width: 0; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text); font-size: var(--text-sm); }.calendar button:hover { background: var(--control-fill); }.calendar button.muted { color: color-mix(in srgb, var(--muted) 58%, transparent); }.calendar button.today { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 48%, transparent); color: var(--accent); }.calendar button.selected { background: var(--accent); box-shadow: none; color: var(--accent-text); font-weight: 600; }
.time-field { display: grid; grid-template-columns: 1fr 88px; align-items: center; gap: var(--space-3); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--hairline); }.time-field span { color: var(--muted); font-size: var(--text-sm); }.time-field input { min-height: max(38px, var(--field-min-height)); padding: 0 var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-md); outline: 0; background: var(--control-fill); color: var(--text); font-size: var(--text-base); font-variant-numeric: tabular-nums; text-align: center; }.time-field input:focus { border-color: var(--accent); box-shadow: var(--focus-ring); }.timezone-note { margin: var(--space-1) 0 0; color: var(--muted); font-size: var(--text-xs); text-align: right; }.date-panel footer { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3); }.date-panel footer button { min-height: max(36px, var(--control-hit)); padding: 0 var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font-size: var(--text-sm); }.date-panel footer .apply { border-color: transparent; background: var(--accent); color: var(--accent-text); }.date-panel footer .apply:disabled { opacity: .42; }
</style>
