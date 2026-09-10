<script setup lang="ts">
import { ref } from 'vue'
import { CalendarDays, ChevronLeft, ChevronRight, PanelRight, Plus } from '@lucide/vue'
import Button from '../ui/Button.vue'
import IconButton from '../ui/IconButton.vue'
import DatePicker from '../ui/DatePicker.vue'
import Popover from '../ui/Popover.vue'
import type { CalendarView } from '../../domain/calendar/range.ts'

defineProps<{ mode: CalendarView; anchor: string; anchorLabel: string; compact?: boolean; unscheduledCount?: number; contextOpen?: boolean }>()
const emit = defineEmits<{
  'update:mode': [mode: CalendarView]
  'update:anchor': [anchor: string]
  previous: []
  next: []
  today: []
  'new-event': []
  'toggle-context': []
}>()
const dateOpen = ref(false)
</script>

<template>
  <header class="calendar-toolbar">
    <div class="calendar-toolbar__actions">
      <Button variant="ghost" size="sm" @click="emit('today')">今天</Button>
      <IconButton label="上一段时间" @click="emit('previous')"><ChevronLeft /></IconButton>
      <Popover v-model:open="dateOpen" mobile-sheet mobile-sheet-label="选择日历日期">
        <template #trigger="{ triggerProps }">
          <Button variant="secondary" size="sm" v-bind="triggerProps" title="选择日期"><CalendarDays :size="16" />{{ anchorLabel }}</Button>
        </template>
        <template #default="{ close }">
          <div class="calendar-toolbar__date-panel">
            <DatePicker :model-value="anchor" label="日历日期" @update:model-value="emit('update:anchor', $event); close('select')" />
          </div>
        </template>
      </Popover>
      <IconButton label="下一段时间" @click="emit('next')"><ChevronRight /></IconButton>
      <div class="calendar-toolbar__modes" aria-label="日历视图">
        <button type="button" :aria-pressed="mode === 'day'" @click="emit('update:mode', 'day')">日</button>
        <button type="button" :aria-pressed="mode === 'week'" :title="compact ? '窄屏使用日视图' : undefined" @click="emit('update:mode', 'week')">周</button>
        <button type="button" :aria-pressed="mode === 'month'" @click="emit('update:mode', 'month')">月</button>
        <button type="button" :aria-pressed="mode === 'agenda'" @click="emit('update:mode', 'agenda')">议程</button>
      </div>
      <span class="calendar-toolbar__spacer" />
      <Button variant="ghost" size="sm" :aria-expanded="contextOpen" aria-controls="calendar-context" @click="emit('toggle-context')"><PanelRight :size="16" />未安排 {{ unscheduledCount ?? 0 }}</Button>
      <slot name="filters" />
      <Button variant="primary" size="sm" @click="emit('new-event')"><Plus :size="16" />新建</Button>
    </div>
  </header>
</template>

<style scoped>
.calendar-toolbar { position: relative; z-index: 7; height: 56px; flex: 0 0 56px; display: flex; flex-wrap: nowrap; align-items: center; padding: 8px 16px; border-bottom: 1px solid var(--glass-border); background: var(--material-thin); box-shadow: var(--glass-highlight); -webkit-backdrop-filter: var(--glass-filter); backdrop-filter: var(--glass-filter); }
.calendar-toolbar__actions { min-width: 0; width: 100%; display: flex; flex-wrap: nowrap; align-items: center; gap: var(--space-1); }
.calendar-toolbar__spacer { min-width: 8px; flex: 1; }
.calendar-toolbar__modes { display: flex; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--control-fill); }
.calendar-toolbar__modes button { min-width: 40px; min-height: max(30px, var(--control-hit)); padding: 0 var(--space-2); border: 0; border-radius: calc(var(--radius-md) - 2px); background: transparent; color: var(--muted); font: inherit; font-size: var(--text-sm); }
.calendar-toolbar__modes button[aria-pressed='true'] { background: var(--surface); color: var(--accent); box-shadow: var(--shadow-sm); }
.calendar-toolbar__date-panel { width: min(360px, calc(100vw - 32px)); padding: var(--space-3); }
@media (max-width: 1099px) {
  .calendar-toolbar__actions { justify-content: flex-start; overflow-x: auto; scrollbar-width: none; }
  .calendar-toolbar__actions::-webkit-scrollbar { display: none; }
  .calendar-toolbar__spacer { display: none; }
}
@media (max-width: 819px) {
  .calendar-toolbar { height: auto; min-height: 56px; align-items: stretch; padding: 6px 12px; }
  .calendar-toolbar__actions { padding-bottom: 2px; }
  .calendar-toolbar__actions :deep(.btn) { min-height: 44px; }
  .calendar-toolbar__modes button { min-width: 44px; min-height: 44px; }
}
@media (pointer: coarse) and (max-width: 819px) { .calendar-toolbar__modes button { min-width: 48px; min-height: 48px; } }
</style>
