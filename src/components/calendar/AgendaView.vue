<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { CalendarItem } from '../../domain/calendar/project.ts'
import {
  agendaWindow,
  createAgendaMeasurementState,
  finishAgendaMeasurementRestore,
  groupCalendarItems,
  shouldVirtualizeAgenda,
  updateAgendaMeasurements,
} from '../../domain/calendar/view.ts'

type AgendaRow =
  | { kind: 'header'; key: string; date: string }
  | { kind: 'item'; key: string; date: string; item: CalendarItem; position: number }

const props = defineProps<{ items: readonly CalendarItem[]; titles: ReadonlyMap<string, string> }>()
const viewport = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const focusedKey = ref('')
const measurementState = shallowRef(createAgendaMeasurementState())
const rowElements = new Map<string, HTMLElement>()
let observer: ResizeObserver | undefined
let viewportWidth = 0

const groups = computed(() => groupCalendarItems(props.items))
const rows = computed<AgendaRow[]>(() => {
  let position = 0
  return groups.value.flatMap((group) => [
    { kind: 'header' as const, key: `day:${group.date}`, date: group.date },
    ...group.items.map((item) => ({ kind: 'item' as const, key: `item:${item.key}`, date: group.date, item, position: ++position })),
  ])
})
const virtualizationEnabled = computed(() => shouldVirtualizeAgenda(props.items.length))
const measuredWindow = computed(() => virtualizationEnabled.value
  ? agendaWindow(rows.value.map(({ key }) => key), measurementState.value.heights, scrollTop.value, viewportHeight.value, focusedKey.value)
  : null)
const visibleRows = computed(() => measuredWindow.value ? rows.value.slice(measuredWindow.value.start, measuredWindow.value.end) : rows.value)
const listStyle = computed(() => measuredWindow.value ? {
  paddingTop: `${measuredWindow.value.before}px`,
  paddingBottom: `${measuredWindow.value.after}px`,
} : undefined)
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver((entries) => {
    const keys = rows.value.map(({ key }) => key)
    const viewportEntry = entries.find(({ target }) => target === viewport.value)
    const nextWidth = viewportEntry?.contentRect.width ?? viewportWidth
    const invalidate = viewportWidth > 0 && nextWidth !== viewportWidth
    if (viewportEntry) {
      viewportHeight.value = viewportEntry.contentRect.height
      viewportWidth = nextWidth
    }
    const measurements = new Map<string, number>()
    for (const entry of entries) {
      if (entry.target === viewport.value) continue
      const key = (entry.target as HTMLElement).dataset.agendaRowKey
      const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
      if (key && height > 0) measurements.set(key, height)
    }
    const update = updateAgendaMeasurements(
      measurementState.value,
      keys,
      viewport.value?.scrollTop ?? 0,
      viewportHeight.value,
      measurements,
      invalidate,
    )
    measurementState.value = update.state
    if (update.restore) {
      const restore = update.restore
      nextTick(() => {
        if (measurementState.value.generation !== restore.generation) return
        if (viewport.value) viewport.value.scrollTop = restore.top
        scrollTop.value = restore.top
        measurementState.value = finishAgendaMeasurementRestore(measurementState.value, restore.generation)
      })
    }
  })
  if (viewport.value) observer.observe(viewport.value)
  for (const element of rowElements.values()) observer.observe(element)
  viewportHeight.value = viewport.value?.clientHeight ?? 0
})
onUnmounted(() => observer?.disconnect())

function setRowElement(key: string, value: Element | null) {
  const previous = rowElements.get(key)
  if (!(value instanceof HTMLElement)) {
    if (previous) observer?.unobserve(previous)
    rowElements.delete(key)
    return
  }
  if (previous && previous !== value) observer?.unobserve(previous)
  value.dataset.agendaRowKey = key
  rowElements.set(key, value)
  observer?.observe(value)
}
function onScroll() { scrollTop.value = viewport.value?.scrollTop ?? 0 }
function onFocus(key: string) { focusedKey.value = key }
function onBlur(event: FocusEvent) {
  const row = event.currentTarget as HTMLElement
  nextTick(() => { if (!row.contains(document.activeElement)) focusedKey.value = '' })
}
function titleFor(item: CalendarItem) { return props.titles.get(item.taskId) ?? '未命名任务' }
function dateLabel(date: string) { return dateFormatter.format(new Date(`${date}T00:00:00.000Z`)).replace('星期', '周') }
function itemTime(item: CalendarItem) {
  if (item.kind === 'all-day') return '全天'
  if (item.kind === 'deadline-marker' && item.displayMinute === null) return '截止'
  const time = formatMinute(item.displayMinute ?? 0)
  return item.kind === 'deadline-marker' ? `截止 ${time}` : time
}
function formatMinute(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` }
</script>

<template>
  <section ref="viewport" class="agenda-view" aria-label="日历议程" @scroll="onScroll">
    <p v-if="!rows.length" class="agenda-view__empty">这段时间没有安排。</p>
    <ol v-else class="agenda-view__list" :style="listStyle" :aria-label="`议程，共 ${items.length} 项`">
      <li v-for="row in visibleRows" :key="row.key" :ref="(element) => setRowElement(row.key, element as Element | null)" :class="`agenda-view__${row.kind}`">
        <h2 v-if="row.kind === 'header'">{{ dateLabel(row.date) }}</h2>
        <div v-else tabindex="0" class="agenda-view__row" :class="`agenda-view__row--${row.item.kind}`" :aria-label="`${dateLabel(row.date)} ${itemTime(row.item)} ${titleFor(row.item)}`" :aria-posinset="row.position" :aria-setsize="items.length" @focus="onFocus(row.key)" @blur="onBlur">
          <time :datetime="row.item.start">{{ itemTime(row.item) }}</time>
          <strong>{{ titleFor(row.item) }}</strong>
          <span>{{ row.item.kind === 'deadline-marker' ? '截止事项' : row.item.kind === 'all-day' ? '全天安排' : '日程' }}</span>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.agenda-view { min-width: 0; flex: 1; overflow: auto; background: var(--surface); scrollbar-gutter: stable; }
.agenda-view__list { width: min(100%, 900px); margin: 0 auto; padding-right: 22px; padding-left: 22px; list-style: none; }
.agenda-view__header { position: sticky; top: 0; z-index: 1; padding-top: 18px; background: var(--surface); }
.agenda-view__header h2 { margin: 0; padding: 8px 0; border-bottom: 1px solid var(--hairline); color: var(--text); font-size: var(--text-sm); font-weight: var(--font-semibold); }
.agenda-view__item { border-bottom: 1px solid var(--hairline); }
.agenda-view__row { width: 100%; min-height: 52px; display: grid; grid-template-columns: 86px minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); padding: 8px 6px; border: 0; border-left: 3px solid var(--accent); background: transparent; color: var(--text); text-align: left; font: inherit; }
.agenda-view__row:hover { background: var(--control-fill); }
.agenda-view__row:focus-visible { outline: 0; box-shadow: inset var(--focus-ring); }
.agenda-view__row--all-day { border-left-color: var(--muted); }
.agenda-view__row--deadline-marker { border-left-style: dashed; border-left-color: var(--danger); }
.agenda-view__row time { color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.agenda-view__row strong { min-width: 0; font-size: var(--text-sm); font-weight: var(--font-medium); overflow-wrap: anywhere; }
.agenda-view__row > span { color: var(--muted); font-size: var(--text-xs); }
.agenda-view__empty { margin: 48px auto; color: var(--muted); text-align: center; }
@media (max-width: 819px) {
  .agenda-view { scrollbar-gutter: auto; }
  .agenda-view__list { padding-right: 16px; padding-left: 16px; }
  .agenda-view__row { min-height: 48px; grid-template-columns: 76px minmax(0, 1fr); }
  .agenda-view__row > span { grid-column: 2; }
}
</style>
