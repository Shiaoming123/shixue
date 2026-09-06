<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CalendarCapabilityCommand } from '../../domain/capabilities/calendar-commands.ts'
import type { LaidOutCalendarItem } from '../../domain/calendar/layout.ts'
import type { CalendarItem as CalendarItemModel } from '../../domain/calendar/project.ts'
import CalendarItem from './CalendarItem.vue'
import { durationMinutes, snapCalendarMinutes, type CalendarDragPreview } from './use-calendar-drag.ts'

const HALF_HOUR = 30
const MINUTES_PER_DAY = 1440

const props = defineProps<{
  days: string[]
  items: readonly CalendarItemModel[]
  timedItems: readonly LaidOutCalendarItem[]
  titles: ReadonlyMap<string, string>
  selectedKey: string
  preview: CalendarDragPreview | null
  now: string
}>()
const emit = defineEmits<{
  select: [key: string]
  'pointer-start': [event: PointerEvent, item: CalendarItemModel, action: 'move' | 'resize']
  command: [command: CalendarCapabilityCommand, source: 'human-ui' | 'keyboard']
}>()

const columns = ref<HTMLElement | null>(null)
const allDayColumns = ref<HTMLElement | null>(null)
const halfHours = Array.from({ length: MINUTES_PER_DAY / HALF_HOUR }, (_, index) => index * HALF_HOUR)
const dayFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })
const currentDate = computed(() => dateKey(new Date(props.now)))
const currentMinute = computed(() => {
  const date = new Date(props.now)
  return date.getHours() * 60 + date.getMinutes()
})

function itemsForDay(day: string) {
  return props.timedItems.filter((item) => dateForItem(item) === day)
}
function factsForDay(day: string) {
  return props.items.filter((item) => item.kind !== 'timed' && dateForItem(item) === day)
}
function preciseDeadlinesForDay(day: string) {
  return props.items.filter((item) => item.kind === 'deadline-marker' && item.start.includes('T') && dateForItem(item) === day)
}
function dateOnlyFactsForDay(day: string) {
  return factsForDay(day).filter((item) => !item.start.includes('T'))
}
function titleFor(item: CalendarItemModel) { return props.titles.get(item.taskId) ?? '未命名任务' }
function itemStyle(item: LaidOutCalendarItem) {
  const start = minuteOfDay(item.start)
  const duration = durationMinutes(item)
  const width = 100 / item.columnCount
  return { top: `${start}px`, height: `${Math.max(20, duration)}px`, left: `${item.column * width}%`, width: `${width}%` }
}
function deadlineStyle(item: CalendarItemModel) { return { top: `${minuteOfDay(item.start)}px` } }
function previewStyle(day: string) {
  if (!props.preview || dateForValue(props.preview.proposedStart) !== day || !props.preview.proposedStart.includes('T')) return null
  return { top: `${minuteOfDay(props.preview.proposedStart)}px`, height: `${Math.max(20, props.preview.proposedDuration)}px` }
}
function allDayPreview(day: string) { return props.preview?.proposedStart === day ? props.preview : null }
function dayLabel(day: string) { return dayFormatter.format(new Date(`${day}T00:00:00`)).replace('星期', '周') }
function timeLabel(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
function forwardPointer(event: PointerEvent, item: CalendarItemModel, action: 'move' | 'resize') { emit('pointer-start', event, item, action) }
function forwardCommand(command: CalendarCapabilityCommand, source: 'human-ui' | 'keyboard') { emit('command', command, source) }

function propose(clientX: number, clientY: number, item: CalendarItemModel, action: 'move' | 'resize'): CalendarDragPreview | null {
  const columnBox = columns.value?.getBoundingClientRect()
  const allDayBox = allDayColumns.value?.getBoundingClientRect()
  if (!columnBox || !allDayBox || props.days.length === 0) return null
  const dayWidth = columnBox.width / props.days.length
  const dayIndex = Math.min(props.days.length - 1, Math.max(0, Math.floor((clientX - columnBox.left) / dayWidth)))
  const proposedDate = props.days[dayIndex]!
  const originalDuration = durationMinutes(item)

  if (action === 'move' && clientY >= allDayBox.top && clientY <= allDayBox.bottom) {
    return { itemKey: item.key, proposedStart: proposedDate, proposedDuration: originalDuration, valid: true, conflict: null }
  }

  const pointerMinute = Math.min(MINUTES_PER_DAY - 1, Math.max(0, clientY - columnBox.top))
  if (action === 'resize') {
    const startMinute = minuteOfDay(item.start)
    const proposedDuration = Math.min(1440, Math.max(15, snapCalendarMinutes(pointerMinute - startMinute)))
    return { itemKey: item.key, proposedStart: item.start, proposedDuration, valid: true, conflict: overlapMessage(item.key, dateForItem(item), startMinute, proposedDuration) }
  }

  const proposedMinute = Math.min(MINUTES_PER_DAY - originalDuration, Math.max(0, snapCalendarMinutes(pointerMinute)))
  const proposedStart = localInstant(proposedDate, proposedMinute)
  return {
    itemKey: item.key,
    proposedStart,
    proposedDuration: originalDuration,
    valid: true,
    conflict: overlapMessage(item.key, proposedDate, proposedMinute, originalDuration),
  }
}

function overlapMessage(itemKey: string, day: string, start: number, duration: number): string | null {
  const end = start + duration
  const count = props.timedItems.filter((item) => item.key !== itemKey && dateForItem(item) === day)
    .filter((item) => minuteOfDay(item.start) < end && minuteOfDay(item.start) + durationMinutes(item) > start).length
  return count ? `与 ${count} 个任务重叠` : null
}

function dateForItem(item: CalendarItemModel) { return dateForValue(item.start) }
function dateForValue(value: string) { return value.includes('T') ? dateKey(new Date(value)) : value }
function dateKey(date: Date) { return date.toLocaleDateString('sv-SE') }
function minuteOfDay(value: string) { const date = new Date(value); return date.getHours() * 60 + date.getMinutes() }
function localInstant(day: string, minutes: number) {
  const hours = Math.floor(minutes / 60)
  const minute = minutes % 60
  return new Date(`${day}T${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).toISOString()
}

defineExpose({ propose })
</script>

<template>
  <section class="time-grid" aria-label="日历时间网格" data-snap="15-minute">
    <div class="time-grid__header" :style="{ '--day-count': days.length }">
      <span class="time-grid__corner" aria-hidden="true"></span>
      <time v-for="day in days" :key="day" :datetime="day" :aria-current="day === currentDate ? 'date' : undefined">{{ dayLabel(day) }}</time>
    </div>
    <div class="time-grid__all-day" :style="{ '--day-count': days.length }">
      <span class="time-grid__all-day-label">全天</span>
      <div ref="allDayColumns" class="time-grid__all-day-columns">
        <div v-for="day in days" :key="day" class="time-grid__all-day-day">
          <CalendarItem v-for="item in dateOnlyFactsForDay(day)" :key="item.key" :item="item" :title="titleFor(item)" :selected="selectedKey === item.key" :previewing="preview?.itemKey === item.key" :interactive="item.kind !== 'deadline-marker'" @select="emit('select', $event)" @pointer-start="forwardPointer" @command="forwardCommand" />
          <div v-if="allDayPreview(day)" class="time-grid__preview time-grid__preview--all-day" :class="{ 'time-grid__preview--conflict': preview?.conflict }"><strong>预览</strong><span>{{ preview?.conflict ?? '全天' }}</span></div>
        </div>
      </div>
    </div>
    <div class="time-grid__scroll">
      <div class="time-grid__body">
        <div class="time-grid__spine" aria-hidden="true">
          <span v-for="minute in halfHours" :key="minute" :style="{ top: `${minute}px` }">{{ timeLabel(minute) }}</span>
        </div>
        <div ref="columns" class="time-grid__columns" :style="{ '--day-count': days.length }">
          <section v-for="day in days" :key="day" class="time-grid__day" :aria-label="dayLabel(day)">
            <i v-for="minute in halfHours" :key="minute" class="time-grid__half-hour" :style="{ top: `${minute}px` }" aria-hidden="true"></i>
            <div v-if="day === currentDate" class="current-time-line" :style="{ top: `${currentMinute}px` }"><span aria-hidden="true"></span><em class="sr-only">当前时间 {{ timeLabel(currentMinute) }}</em></div>
            <CalendarItem v-for="item in itemsForDay(day)" :key="item.key" :item="item" :title="titleFor(item)" :selected="selectedKey === item.key" :previewing="preview?.itemKey === item.key" :style="itemStyle(item)" @select="emit('select', $event)" @pointer-start="forwardPointer" @command="forwardCommand" />
            <CalendarItem v-for="item in preciseDeadlinesForDay(day)" :key="item.key" :item="item" :title="titleFor(item)" :interactive="false" :style="deadlineStyle(item)" />
            <div v-if="previewStyle(day)" class="time-grid__preview" :class="{ 'time-grid__preview--conflict': preview?.conflict }" :style="previewStyle(day) ?? undefined"><strong>预览</strong><span>{{ preview?.conflict ?? timeLabel(minuteOfDay(preview!.proposedStart)) }}</span></div>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.time-grid { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); }
.time-grid__header, .time-grid__all-day { display: grid; grid-template-columns: 58px minmax(0, 1fr); border-bottom: 1px solid var(--hairline); }
.time-grid__header { min-height: 38px; }
.time-grid__header time { min-width: 0; display: grid; place-items: center; grid-column: auto; color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.time-grid__header { grid-template-columns: 58px repeat(var(--day-count), minmax(108px, 1fr)); }
.time-grid__header time[aria-current='date'] { color: var(--accent); font-weight: var(--font-semibold); }
.time-grid__corner, .time-grid__all-day-label { border-right: 1px solid var(--hairline); }
.time-grid__all-day { min-height: 42px; max-height: 150px; overflow: hidden; }
.time-grid__all-day-label { display: grid; place-items: start center; padding-top: 8px; color: var(--muted); font-size: 10px; }
.time-grid__all-day-columns { min-width: 0; display: grid; grid-template-columns: repeat(var(--day-count), minmax(108px, 1fr)); overflow-y: auto; align-items: start; }
.time-grid__all-day-day { position: relative; min-width: 0; display: grid; align-content: start; gap: 3px; padding: 4px; border-right: 1px solid var(--hairline); }
.time-grid__scroll { min-width: 0; min-height: 0; flex: 1; overflow: auto; scrollbar-color: var(--border) transparent; }
.time-grid__body { min-width: calc(58px + var(--day-count, 1) * 108px); height: 1440px; display: grid; grid-template-columns: 58px minmax(0, 1fr); }
.time-grid__spine { position: relative; border-right: 1px solid var(--hairline); background: color-mix(in srgb, var(--surface-alt) 56%, var(--surface)); }
.time-grid__spine::after { content: ''; position: absolute; top: 0; right: -1px; bottom: 0; width: 2px; background: color-mix(in srgb, var(--accent) 20%, transparent); }
.time-grid__spine span { position: absolute; right: 9px; transform: translateY(-50%); color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.time-grid__columns { min-width: 0; display: grid; grid-template-columns: repeat(var(--day-count), minmax(108px, 1fr)); }
.time-grid__day { position: relative; min-width: 0; height: 1440px; border-right: 1px solid var(--hairline); }
.time-grid__half-hour { position: absolute; right: 0; left: 0; height: 1px; background: color-mix(in srgb, var(--hairline) 72%, transparent); }
.time-grid__day > :deep(.calendar-item) { position: absolute; z-index: 2; }
.time-grid__day > :deep(.calendar-item--deadline-marker) { right: 4px; left: 4px; z-index: 3; transform: translateY(-50%); }
.current-time-line { position: absolute; z-index: 4; right: 0; left: -1px; height: 1px; background: var(--accent); pointer-events: none; }
.current-time-line span { position: absolute; left: -4px; top: -4px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.time-grid__preview { position: absolute; z-index: 5; right: 3px; left: 3px; min-height: 20px; display: flex; flex-direction: column; padding: 4px 7px; border: 1px dashed var(--accent); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 18%, var(--surface)); color: var(--accent); pointer-events: none; }
.time-grid__preview strong, .time-grid__preview span { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.time-grid__preview--all-day { position: static; }
.time-grid__preview--conflict { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--surface)); color: var(--danger); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 819px) {
  .time-grid__header { grid-template-columns: 58px repeat(var(--day-count), minmax(160px, 1fr)); }
  .time-grid__all-day-columns, .time-grid__columns { grid-template-columns: repeat(var(--day-count), minmax(160px, 1fr)); }
  .time-grid__all-day { min-width: calc(58px + var(--day-count) * 160px); max-height: 132px; }
  .time-grid__body { min-width: calc(58px + var(--day-count, 1) * 160px); }
}
</style>
