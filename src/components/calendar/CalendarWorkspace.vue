<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle } from '@lucide/vue'
import type { CalendarCapabilityCommand } from '../../domain/capabilities/calendar-commands.ts'
import { layoutTimedItems } from '../../domain/calendar/layout.ts'
import { projectCalendarItems, type CalendarItem } from '../../domain/calendar/project.ts'
import { calendarRange, type CalendarView } from '../../domain/calendar/range.ts'
import { calendarTimedTarget, timestampOffset, type CalendarTargetClock } from '../../domain/calendar/target.ts'
import { resolveCalendarMode } from '../../domain/calendar/view.ts'
import type { CommandEnvelope } from '../../domain/capabilities/types.ts'
import type { Task, WorkspaceStateV3 } from '../../domain/workspace/types.ts'
import Button from '../ui/Button.vue'
import CalendarToolbar from './CalendarToolbar.vue'
import TimeGrid from './TimeGrid.vue'
import MonthGrid from './MonthGrid.vue'
import AgendaView from './AgendaView.vue'
import UnscheduledTray from './UnscheduledTray.vue'
import {
  createCalendarDragController,
  calendarCommandForPreview,
  durationMinutes,
  type CalendarDragPreview,
} from './use-calendar-drag.ts'
import { calendarDeadlineConflict } from './calendar-conflicts.ts'

const props = withDefaults(defineProps<{
  workspace: WorkspaceStateV3 | null
  weekStartsOn?: 0 | 1
  defaultEstimateMinutes?: number | null
  initialMode?: CalendarView
  now?: string
  targetOffset?: string
  executeCommand: (command: CalendarCapabilityCommand, source: CommandEnvelope['source']) => Promise<void>
}>(), {
  weekStartsOn: 1,
  defaultEstimateMinutes: null,
  initialMode: 'week',
  now: () => new Date().toISOString(),
  targetOffset: 'Z',
})

const initialWidth = typeof window === 'undefined' ? 820 : window.innerWidth
const anchor = ref(localDate(new Date(props.now)))
const requestedMode = ref<CalendarView>(initialWidth <= 819 ? 'day' : props.initialMode)
const lastDesktopMode = ref<CalendarView>(props.initialMode)
const viewportWidth = ref(initialWidth)
const selectedKey = ref('')
const statusMessage = ref('')
const pendingCommand = ref<{ command: CalendarCapabilityCommand; source: CommandEnvelope['source']; message: string } | null>(null)
const timeGrid = ref<InstanceType<typeof TimeGrid> | null>(null)
let compactMedia: MediaQueryList | undefined

const compact = computed(() => viewportWidth.value <= 819)
const effectiveMode = computed(() => resolveCalendarMode(requestedMode.value, viewportWidth.value))
const range = computed(() => calendarRange(effectiveMode.value, anchor.value, props.weekStartsOn))
const days = computed(() => datesBetween(range.value.start, range.value.end))
const items = computed(() => props.workspace ? projectCalendarItems(props.workspace, range.value) : [])
const timedItems = computed(() => layoutTimedItems(items.value))
const titles = computed(() => new Map((props.workspace?.tasks ?? []).map((task) => [task.id, task.title])))
const defaultDropDuration = computed(() => props.defaultEstimateMinutes ?? 30)
const anchorLabel = computed(() => {
  if (effectiveMode.value === 'week' || effectiveMode.value === 'agenda') return `${shortDate(days.value[0])}–${shortDate(days.value[days.value.length - 1])}`
  const options = effectiveMode.value === 'month' ? { year: 'numeric', month: 'long' } as const : { month: 'long', day: 'numeric' } as const
  return new Intl.DateTimeFormat('zh-CN', options).format(new Date(`${anchor.value}T00:00:00`))
})

const emit = defineEmits<{ 'desktop-mode-selected': [mode: CalendarView] }>()

const drag = createCalendarDragController(async (command) => {
  try {
    await props.executeCommand(command, 'human-ui')
    statusMessage.value = '日历安排已保存。'
  } catch {
    statusMessage.value = '调整未保存，已恢复原安排。'
    throw new Error(statusMessage.value)
  }
})

onMounted(() => {
  compactMedia = window.matchMedia('(max-width: 819px)')
  viewportWidth.value = compactMedia.matches ? Math.min(window.innerWidth, 819) : Math.max(window.innerWidth, 820)
  compactMedia.addEventListener('change', onCompactChange)
})
onUnmounted(() => {
  drag.cancelActive()
  compactMedia?.removeEventListener('change', onCompactChange)
})

watch(() => props.initialMode, (next) => {
  lastDesktopMode.value = next
  if (!compact.value) requestedMode.value = next
})

function onCompactChange(event: MediaQueryListEvent) {
  viewportWidth.value = event.matches ? 819 : 820
  if (!event.matches) requestedMode.value = lastDesktopMode.value
}
function setMode(next: CalendarView) {
  statusMessage.value = compact.value && next === 'week' ? '窄屏使用日视图。' : ''
  if (compact.value) {
    requestedMode.value = next
    return
  }
  if (next === requestedMode.value) return
  requestedMode.value = next
  lastDesktopMode.value = next
  emit('desktop-mode-selected', next)
}
function moveAnchor(direction: -1 | 1) {
  if (effectiveMode.value === 'month') anchor.value = addMonths(anchor.value, direction)
  else anchor.value = addDays(anchor.value, direction * (effectiveMode.value === 'week' ? 7 : effectiveMode.value === 'agenda' ? 30 : 1))
}
function selectToday() { anchor.value = localDate(new Date()) }

function beginItemPointer(event: PointerEvent, item: CalendarItem, action: 'move' | 'resize') {
  if (item.kind === 'deadline-marker') return
  drag.begin(event, { itemKey: item.key, item, action, sourceStart: item.start, sourceDuration: durationMinutes(item) })
}

function beginTrayPointer(event: PointerEvent, task: Task) {
  if (event.button !== 0) return
  const duration = task.schedule.estimateMinutes ?? defaultDropDuration.value
  const target = calendarTimedTarget(anchor.value, 9 * 60, { kind: 'offset', offset: props.targetOffset })
  const start = target.startAt
  const item: CalendarItem = {
    key: `task:${task.id}`, taskId: task.id, occurrenceId: null,
    kind: 'timed', start, end: new Date(Date.parse(start) + duration * 60_000).toISOString(),
    displayDate: target.displayDate, displayMinute: target.displayMinute,
  }
  if (drag.begin(event, { itemKey: item.key, item, action: 'move', sourceStart: null, sourceDuration: duration })) {
    selectedKey.value = item.key
  }
}

function updatePointer(event: PointerEvent) {
  const session = drag.session.value
  const item = session?.item
  if (!item || !session) return
  const proposed = timeGrid.value?.propose(event.clientX, event.clientY, item, session.action)
  if (!proposed) return
  drag.update(event, withDeadlineConflict(item, proposed))
}

async function finishPointer(event: PointerEvent) {
  const session = drag.session.value
  const item = session?.item
  const preview = drag.preview.value
  if (!item || !session || !preview) {
    await drag.release(event, null, item?.key ?? '')
    return
  }
  const command = calendarCommandForPreview(item, session.action, preview, session.sourceStart === null)
  try { await drag.release(event, command, item.key) } catch { /* App already refreshed and announced the exact failure. */ }
}

function cancelPointer(event?: PointerEvent) {
  if (event) drag.cancel(event)
  else drag.cancelActive()
}

async function requestCommand(command: CalendarCapabilityCommand, source: CommandEnvelope['source']) {
  const warning = calendarDeadlineConflict(props.workspace, command)
  if (warning) {
    pendingCommand.value = { command, source, message: warning }
    statusMessage.value = warning
    return
  }
  await executeRequested(command, source)
}

async function confirmPending() {
  const pending = pendingCommand.value
  pendingCommand.value = null
  if (pending) await executeRequested(pending.command, pending.source)
}

async function executeRequested(command: CalendarCapabilityCommand, source: CommandEnvelope['source']) {
  try {
    await props.executeCommand(command, source)
    statusMessage.value = '日历安排已保存。'
  } catch {
    statusMessage.value = '调整未保存，已恢复原安排。'
  }
}

function withDeadlineConflict(item: CalendarItem, preview: CalendarDragPreview): CalendarDragPreview {
  const warning = calendarDeadlineConflict(props.workspace, calendarCommandForPreview(item, drag.session.value?.action ?? 'move', preview, drag.session.value?.sourceStart === null))
  if (!warning) return preview
  return { ...preview, conflict: preview.conflict ? `${preview.conflict}；${warning}` : warning }
}

function targetClock(item: CalendarItem): CalendarTargetClock {
  if (item.occurrenceId !== null) {
    const occurrence = props.workspace?.occurrences.find(({ id }) => id === item.occurrenceId)
    const series = occurrence && props.workspace?.recurrenceSeries.find(({ id }) => id === occurrence.seriesId)
    if (!series) throw new Error(`Missing recurrence timezone for calendar item: ${item.key}`)
    return { kind: 'timezone', timezone: series.timezone }
  }
  return { kind: 'offset', offset: timestampOffset(item.start) ?? props.targetOffset }
}

function datesBetween(start: string, end: string) { const result: string[] = []; for (let date = start; date < end; date = addDays(date, 1)) result.push(date); return result }
function addDays(value: string, days: number) { const [year, month, day] = value.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10) }
function addMonths(value: string, months: number) { const [year, month, day] = value.split('-').map(Number); const next = new Date(Date.UTC(year, month - 1 + months, 1)); const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate(); next.setUTCDate(Math.min(day, lastDay)); return next.toISOString().slice(0, 10) }
function localDate(date: Date) { return date.toLocaleDateString('sv-SE') }
function shortDate(value?: string) { if (!value) return ''; const date = new Date(`${value}T00:00:00`); return `${date.getMonth() + 1}/${date.getDate()}` }
</script>

<template>
  <section class="calendar-workspace" @pointermove="updatePointer" @pointerup="finishPointer" @pointercancel="cancelPointer($event)" @lostpointercapture="cancelPointer($event)" @keydown.esc="cancelPointer()">
    <CalendarToolbar :mode="effectiveMode" :anchor="anchor" :anchor-label="anchorLabel" :compact="compact" @update:mode="setMode" @update:anchor="anchor = $event" @previous="moveAnchor(-1)" @next="moveAnchor(1)" @today="selectToday" />
    <UnscheduledTray :tasks="workspace?.tasks ?? []" :anchor="anchor" :default-duration="defaultDropDuration" :target-offset="targetOffset" @pointer-start="beginTrayPointer" @command="requestCommand" />
    <div v-if="pendingCommand" class="calendar-workspace__confirmation" role="alert">
      <AlertTriangle :size="17" aria-hidden="true" /><span>{{ pendingCommand.message }}</span>
      <Button variant="secondary" size="sm" @click="pendingCommand = null; statusMessage = ''">取消</Button>
      <Button variant="primary" size="sm" @click="confirmPending">仍然安排</Button>
    </div>
    <p class="sr-only" aria-live="polite">{{ statusMessage }}{{ drag.preview.value?.conflict ? ` ${drag.preview.value.conflict}` : '' }}</p>
    <TimeGrid v-if="effectiveMode === 'day' || effectiveMode === 'week'" ref="timeGrid" :days="days" :items="items" :timed-items="timedItems" :titles="titles" :selected-key="selectedKey" :preview="drag.preview.value" :now="now" :target-clock="targetClock" @select="selectedKey = $event" @pointer-start="beginItemPointer" @command="requestCommand" />
    <MonthGrid v-else-if="effectiveMode === 'month'" :days="days" :anchor="anchor" :week-starts-on="weekStartsOn" :items="items" :titles="titles" @select-date="anchor = $event" />
    <AgendaView v-else :items="items" :titles="titles" />
  </section>
</template>

<style scoped>
.calendar-workspace { width: 100%; min-width: 0; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); }
.calendar-workspace__confirmation { display: flex; align-items: center; gap: var(--space-2); padding: 8px 22px; border-bottom: 1px solid color-mix(in srgb, var(--danger) 24%, var(--hairline)); background: color-mix(in srgb, var(--danger) 7%, var(--surface)); color: var(--text); font-size: var(--text-sm); }
.calendar-workspace__confirmation > span { min-width: 0; flex: 1; }
.calendar-workspace__confirmation > svg { color: var(--danger); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 819px) {
  .calendar-workspace { padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
  .calendar-workspace__confirmation { flex-wrap: wrap; padding: 8px 16px; }
  .calendar-workspace__confirmation > span { flex-basis: calc(100% - 28px); }
  .calendar-workspace__confirmation :deep(.btn) { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) { .calendar-workspace, .calendar-workspace * { scroll-behavior: auto !important; } }
</style>
