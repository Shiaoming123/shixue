<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RecurrenceCadence, RecurrenceSeries } from '../../domain/workspace/types'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Listbox from '../ui/Listbox.vue'

export interface RecurrenceRule {
  cadence: RecurrenceCadence
  basis: RecurrenceSeries['basis']
  end: RecurrenceSeries['end']
}

const props = defineProps<{ modelValue?: RecurrenceRule | null }>()
const emit = defineEmits<{ save: [rule: RecurrenceRule] }>()

type Preset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom'
const preset = ref<Preset>('daily')
const interval = ref('1')
const weekdays = ref<number[]>([1, 2, 3, 4, 5])
const cadenceKind = ref<RecurrenceCadence['kind']>('weekly')
const basis = ref<RecurrenceSeries['basis']>('fixed_schedule')
const endKind = ref<RecurrenceSeries['end']['kind']>('never')
const endDate = ref('')
const endCount = ref('10')

const presetOptions = [
  { value: 'daily', label: '每天' }, { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' }, { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' }, { value: 'custom', label: '自定义' },
]
const cadenceOptions = [{ value: 'daily', label: '每天' }, { value: 'weekly', label: '每周' }, { value: 'monthly', label: '每月' }, { value: 'yearly', label: '每年' }]
const basisOptions = [{ value: 'fixed_schedule', label: '按固定计划' }, { value: 'after_completion', label: '完成后开始' }]
const endOptions = [{ value: 'never', label: '永不结束' }, { value: 'on', label: '截止日期' }, { value: 'after', label: '完成次数' }]
const weekdaysOptions = [{ value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' }, { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' }, { value: 0, label: '日' }]

watch(() => props.modelValue, (rule) => {
  if (!rule) return
  basis.value = rule.basis
  if (rule.end.kind === 'on') endDate.value = rule.end.date
  if (rule.end.kind === 'after') endCount.value = String(rule.end.count)
  endKind.value = rule.end.kind
  cadenceKind.value = rule.cadence.kind
  interval.value = String(rule.cadence.interval)
  if (rule.cadence.kind === 'weekly') weekdays.value = [...rule.cadence.weekdays]
}, { immediate: true })

const rule = computed<RecurrenceRule>(() => {
  const cadence = preset.value === 'daily' ? { kind: 'daily' as const, interval: 1 }
    : preset.value === 'weekdays' ? { kind: 'weekly' as const, interval: 1, weekdays: [1, 2, 3, 4, 5] }
      : preset.value === 'weekly' ? { kind: 'weekly' as const, interval: 1, weekdays: weekdays.value.length ? weekdays.value : [1] }
        : preset.value === 'monthly' ? { kind: 'monthly' as const, interval: 1, dayOfMonth: 1 }
          : preset.value === 'yearly' ? { kind: 'yearly' as const, interval: 1, month: 1, dayOfMonth: 1 }
            : customCadence()
  const end = endKind.value === 'on' && endDate.value ? { kind: 'on' as const, date: endDate.value }
    : endKind.value === 'after' ? { kind: 'after' as const, count: Math.max(1, Number(endCount.value) || 1) }
      : { kind: 'never' as const }
  return { cadence, basis: basis.value, end }
})

function customCadence(): RecurrenceCadence {
  const safeInterval = Math.max(1, Number(interval.value) || 1)
  if (cadenceKind.value === 'daily') return { kind: 'daily', interval: safeInterval }
  if (cadenceKind.value === 'weekly') return { kind: 'weekly', interval: safeInterval, weekdays: weekdays.value.length ? weekdays.value : [1] }
  if (cadenceKind.value === 'monthly') return { kind: 'monthly', interval: safeInterval, dayOfMonth: 1 }
  return { kind: 'yearly', interval: safeInterval, month: 1, dayOfMonth: 1 }
}
function toggleWeekday(day: number) { weekdays.value = weekdays.value.includes(day) ? weekdays.value.filter((item) => item !== day) : [...weekdays.value, day].sort() }
</script>

<template>
  <section class="recurrence-editor" aria-label="重复规则">
    <div class="field"><span>重复</span><Listbox v-model="preset" :options="presetOptions" label="重复频率" /></div>
    <div v-if="preset === 'custom'" class="custom-fields">
      <div class="field"><span>间隔</span><Input v-model="interval" inputmode="numeric" aria-label="重复间隔" /></div>
      <div class="field"><span>频率</span><Listbox v-model="cadenceKind" :options="cadenceOptions" label="自定义频率" /></div>
      <div v-if="cadenceKind === 'weekly'" class="field"><span>星期</span><div class="weekday-buttons"><button v-for="day in weekdaysOptions" :key="day.value" type="button" :class="{ selected: weekdays.includes(day.value) }" :aria-pressed="weekdays.includes(day.value)" @click="toggleWeekday(day.value)">{{ day.label }}</button></div></div>
      <div class="field"><span>依据</span><Listbox v-model="basis" :options="basisOptions" label="重复依据" /></div>
      <div class="field"><span>结束</span><Listbox v-model="endKind" :options="endOptions" label="结束条件" /></div>
      <div v-if="endKind === 'on'" class="field"><span>日期</span><Input v-model="endDate" placeholder="YYYY-MM-DD" aria-label="重复截止日期" /></div>
      <div v-if="endKind === 'after'" class="field"><span>次数</span><Input v-model="endCount" inputmode="numeric" aria-label="重复次数" /></div>
    </div>
    <Button variant="secondary" size="sm" @click="emit('save', rule)">保存重复</Button>
  </section>
</template>

<style scoped>
.recurrence-editor { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--material-thin); }.custom-fields { display: grid; gap: var(--space-3); }.field { display: grid; gap: var(--space-1); }.field > span { color: var(--muted); font-size: var(--text-xs); font-weight: 600; }.weekday-buttons { display: flex; flex-wrap: wrap; gap: 6px; }.weekday-buttons button { width: 36px; min-height: 36px; border: 1px solid var(--hairline); border-radius: var(--radius-full); background: var(--control-fill); color: var(--text); }.weekday-buttons button.selected { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
</style>
