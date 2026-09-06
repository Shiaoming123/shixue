<script setup lang="ts">
import { ref } from 'vue'
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue'
import Button from '../ui/Button.vue'
import DatePicker from '../ui/DatePicker.vue'
import Popover from '../ui/Popover.vue'

defineProps<{ mode: 'day' | 'week'; anchor: string; anchorLabel: string }>()
const emit = defineEmits<{
  'update:mode': [mode: 'day' | 'week']
  'update:anchor': [anchor: string]
  previous: []
  next: []
  today: []
}>()
const dateOpen = ref(false)
</script>

<template>
  <header class="calendar-toolbar">
    <div>
      <p>时间规划</p>
      <h1>日历</h1>
    </div>
    <div class="calendar-toolbar__actions">
      <Button variant="ghost" size="sm" title="上一段时间" aria-label="上一段时间" @click="emit('previous')"><ChevronLeft :size="17" /></Button>
      <Popover v-model:open="dateOpen" mobile-sheet>
        <template #trigger="{ triggerProps }">
          <Button variant="secondary" size="sm" v-bind="triggerProps" title="选择日期"><CalendarDays :size="16" />{{ anchorLabel }}</Button>
        </template>
        <template #default="{ close }">
          <div class="calendar-toolbar__date-panel">
            <DatePicker :model-value="anchor" label="日历日期" @update:model-value="emit('update:anchor', $event); close('select')" />
          </div>
        </template>
      </Popover>
      <Button variant="ghost" size="sm" title="下一段时间" aria-label="下一段时间" @click="emit('next')"><ChevronRight :size="17" /></Button>
      <Button variant="ghost" size="sm" @click="emit('today')">今天</Button>
      <div class="calendar-toolbar__modes" aria-label="日历视图">
        <button type="button" :aria-pressed="mode === 'day'" @click="emit('update:mode', 'day')">日</button>
        <button type="button" :aria-pressed="mode === 'week'" @click="emit('update:mode', 'week')">周</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.calendar-toolbar { display: flex; align-items: end; justify-content: space-between; gap: var(--space-4); padding: 18px 22px 14px; border-bottom: 1px solid var(--hairline); }
.calendar-toolbar p { margin: 0 0 2px; color: var(--muted); font-size: var(--text-xs); }
.calendar-toolbar h1 { margin: 0; color: var(--text); font-size: var(--text-xl); font-weight: var(--font-semibold); }
.calendar-toolbar__actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-1); }
.calendar-toolbar__modes { display: flex; padding: 2px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); }
.calendar-toolbar__modes button { min-width: 40px; min-height: max(30px, var(--control-hit)); padding: 0 var(--space-2); border: 0; border-radius: calc(var(--radius-md) - 2px); background: transparent; color: var(--muted); font: inherit; font-size: var(--text-sm); }
.calendar-toolbar__modes button[aria-pressed='true'] { background: var(--surface); color: var(--accent); box-shadow: var(--shadow-sm); }
.calendar-toolbar__date-panel { width: min(360px, calc(100vw - 32px)); padding: var(--space-3); }
@media (max-width: 819px) {
  .calendar-toolbar { align-items: stretch; flex-direction: column; padding: 14px 16px 10px; }
  .calendar-toolbar__actions { justify-content: flex-start; overflow-x: auto; padding-bottom: 2px; }
  .calendar-toolbar__actions :deep(.btn) { min-height: 44px; }
}
</style>
