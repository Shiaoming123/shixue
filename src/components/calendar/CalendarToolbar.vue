<script setup lang="ts">
import { ref } from 'vue'
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue'
import Button from '../ui/Button.vue'
import IconButton from '../ui/IconButton.vue'
import PageHeader from '../ui/PageHeader.vue'
import DatePicker from '../ui/DatePicker.vue'
import Popover from '../ui/Popover.vue'
import type { CalendarView } from '../../domain/calendar/range.ts'

defineProps<{ mode: CalendarView; anchor: string; anchorLabel: string; compact?: boolean }>()
const emit = defineEmits<{
  'update:mode': [mode: CalendarView]
  'update:anchor': [anchor: string]
  previous: []
  next: []
  today: []
}>()
const dateOpen = ref(false)
</script>

<template>
  <PageHeader class="calendar-toolbar" title="日历" subtitle="时间规划">
    <template #actions><div class="calendar-toolbar__actions">
      <IconButton size="sm" aria-label="上一段时间" @click="emit('previous')"><ChevronLeft :size="17" /></IconButton>
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
      <IconButton size="sm" aria-label="下一段时间" @click="emit('next')"><ChevronRight :size="17" /></IconButton>
      <Button variant="quiet" size="sm" @click="emit('today')">今天</Button>
      <div class="calendar-toolbar__modes" aria-label="日历视图">
        <Button variant="quiet" size="sm" :aria-pressed="mode === 'day'" @click="emit('update:mode', 'day')">日</Button>
        <Button variant="quiet" size="sm" :aria-pressed="mode === 'week'" :title="compact ? '窄屏使用日视图' : undefined" @click="emit('update:mode', 'week')">周</Button>
        <Button variant="quiet" size="sm" :aria-pressed="mode === 'month'" @click="emit('update:mode', 'month')">月</Button>
        <Button variant="quiet" size="sm" :aria-pressed="mode === 'agenda'" @click="emit('update:mode', 'agenda')">议程</Button>
      </div>
    </div></template>
  </PageHeader>
</template>

<style scoped>
.calendar-toolbar { display: flex; align-items: end; justify-content: space-between; gap: var(--space-4); padding: 24px; border-bottom: 1px solid var(--hairline); background: var(--material-thin); }
.calendar-toolbar__actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-1); }
.calendar-toolbar__modes { display: flex; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--control-fill); }
.calendar-toolbar__modes button { min-width: 40px; min-height: max(30px, var(--control-hit)); padding: 0 var(--space-2); border: 0; border-radius: calc(var(--radius-md) - 2px); background: transparent; color: var(--muted); font: inherit; font-size: var(--text-sm); }
.calendar-toolbar__modes button[aria-pressed='true'] { background: var(--surface); color: var(--accent); }
.calendar-toolbar__date-panel { width: min(360px, calc(100vw - 32px)); padding: var(--space-3); }
@media (max-width: 819px) {
  .calendar-toolbar { align-items: stretch; flex-direction: column; padding: 14px 16px 10px; }
  .calendar-toolbar__actions { justify-content: flex-start; overflow-x: auto; padding-bottom: 2px; }
  .calendar-toolbar__actions :deep(.btn) { min-height: 44px; }
  .calendar-toolbar__modes button { min-width: 44px; min-height: 44px; }
}
@media (pointer: coarse) and (max-width: 819px) { .calendar-toolbar__modes button { min-width: 48px; min-height: 48px; } }
</style>
