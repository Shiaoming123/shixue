<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle } from '@lucide/vue'
import type { CalendarInteractionCommand } from './use-calendar-drag.ts'
import { layoutTimedItems } from '../../domain/calendar/layout.ts'
import type { CalendarItem } from '../../domain/calendar/project.ts'
import { queryCalendar, type CalendarFilters } from '../../domain/calendar/query.ts'
import { calendarRange, type CalendarView } from '../../domain/calendar/range.ts'
import { calendarTimedTarget, type CalendarTargetClock } from '../../domain/calendar/target.ts'
import { resolveCalendarMode } from '../../domain/calendar/view.ts'
import type { CommandEnvelope } from '../../domain/capabilities/types.ts'
import type { Task, WorkspaceStateV4 } from '../../domain/workspace/types.ts'
import Button from '../ui/Button.vue'
import Dialog from '../ui/Dialog.vue'
import type { CalendarCreateSlot, CalendarSlot } from './calendar-slot'
import Input from '../ui/Input.vue'
import Listbox from '../ui/Listbox.vue'
import Popover from '../ui/Popover.vue'
import CalendarToolbar from './CalendarToolbar.vue'
import TimeGrid from './TimeGrid.vue'
import MonthGrid from './MonthGrid.vue'
import AgendaView from './AgendaView.vue'
import UnscheduledTray from './UnscheduledTray.vue'
import {
  createCalendarDragController,
  calendarCommandForPreview,
  durationMinutes,
  calendarItemInteractive,
  type CalendarDragPreview,
} from './use-calendar-drag.ts'
import { calendarDeadlineConflict } from './calendar-conflicts.ts'

const props = withDefaults(defineProps<{
  workspace: WorkspaceStateV4 | null
  weekStartsOn?: 0 | 1
  defaultEstimateMinutes?: number | null
  initialMode?: CalendarView
  now?: string
  targetOffset?: string
  executeCommand: (command: CalendarInteractionCommand, source: CommandEnvelope['source']) => Promise<void>
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
const createSlot = ref<CalendarSlot | null>(null)
function chooseSlot(kind: 'task' | 'event') {
  const slot = createSlot.value
  createSlot.value = null
  if (slot) emit('create-slot', { ...slot, kind })
}
const statusMessage = ref('')
const pendingCommand = ref<{ command: CalendarInteractionCommand; source: CommandEnvelope['source']; message: string } | null>(null)
const timeGrid = ref<InstanceType<typeof TimeGrid> | null>(null)
const search = ref('')
const filtersOpen = ref(false)
const tagId = ref('')
const priority = ref<NonNullable<CalendarFilters['priority']>>('all')
const status = ref<NonNullable<CalendarFilters['status']>>('all')
const priorityOptions = [{ value: 'all', label: '所有优先级' }, { value: 'high', label: '高优先级' }, { value: 'medium', label: '中优先级' }, { value: 'low', label: '低优先级' }, { value: 'none', label: '无优先级' }]
const statusOptions = [{ value: 'all', label: '全部状态' }, { value: 'active', label: '未完成' }, { value: 'completed', label: '已完成' }]
const tagOptions = computed(() => [{ value: '', label: '所有标签' }, ...(props.workspace?.tags ?? []).map((tag) => ({ value: tag.id, label: tag.title }))])
const hasFilters = computed(() => search.value || tagId.value || priority.value !== 'all' || status.value !== 'all')
let compactMedia: MediaQueryList | undefined

const compact = computed(() => viewportWidth.value <= 819)
const effectiveMode = computed(() => resolveCalendarMode(requestedMode.value, viewportWidth.value))
const range = computed(() => calendarRange(effectiveMode.value, anchor.value, props.weekStartsOn))
const days = computed(() => datesBetween(range.value.start, range.value.end))
const displayTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const results = computed(() => props.workspace ? queryCalendar(props.workspace, range.value, { text: search.value, tagId: tagId.value, priority: priority.value, status: status.value }, displayTimezone) : { items: [], allItems: [], tasks: [] })
const items = computed(() => results.value.items)
const timedItems = computed(() => layoutTimedItems(items.value))
const conflictItems = computed(() => layoutTimedItems(results.value.allItems))
const titles = computed(() => new Map([...(props.workspace?.tasks ?? []), ...(props.workspace?.calendarEvents ?? [])].map((item) => [item.id, item.title])))
const defaultDropDuration = computed(() => props.defaultEstimateMinutes ?? 30)
const anchorLabel = computed(() => {
  if (effectiveMode.value === 'week' || effectiveMode.value === 'agenda') return `${shortDate(days.value[0])}–${shortDate(days.value[days.value.length - 1])}`
  const options = effectiveMode.value === 'month' ? { year: 'numeric', month: 'long' } as const : { month: 'long', day: 'numeric' } as const
  return new Intl.DateTimeFormat('zh-CN', options).format(new Date(`${anchor.value}T00:00:00`))
})

const emit = defineEmits<{ 'suggest-task': [taskId: string]; 'desktop-mode-selected': [mode: CalendarView]; open: [taskId: string, occurrenceId: string | null]; 'open-event': [eventId: string, originalStart: string]; 'create-event': [date: string]; 'create-slot': [value: CalendarCreateSlot]; 'toggle-task': [value: { taskId: string; occurrenceId: string | null }] }>()
function openItem(item: CalendarItem) {
  if (item.eventId !== undefined) emit('open-event', item.eventId, item.originalStart)
  else emit('open', item.taskId, item.occurrenceId)
}
function clearFilters() { search.value = ''; tagId.value = ''; priority.value = 'all'; status.value = 'all' }

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
function selectToday() { anchor.value = localDate(new Date(props.now)); timeGrid.value?.locate() }

function beginItemPointer(event: PointerEvent, item: CalendarItem, action: 'move' | 'resize') {
  if (!calendarItemInteractive(item, targetClock(item))) return
  drag.begin(event, { itemKey: item.key, item, action, sourceStart: item.start, sourceDuration: durationMinutes(item) })
}

function beginTrayPointer(event: PointerEvent, task: Task) {
  if (event.button !== 0) return
  const duration = task.schedule.estimateMinutes ?? defaultDropDuration.value
  const target = calendarTimedTarget(anchor.value, 9 * 60, targetClock())
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
  if (!item || !session || !preview?.valid) {
    await drag.release(event, null, item?.key ?? '')
    return
  }
  try {
    const command = calendarCommandForPreview(item, session.action, preview, session.sourceStart === null, targetClock(item))
    await drag.release(event, command, item.key)
  } catch (error) {
    drag.cancelActive()
    statusMessage.value = error instanceof Error ? error.message : '调整未保存。'
  }
}

function cancelPointer(event?: PointerEvent) {
  timeGrid.value?.cancelBlank()
  if (event) drag.cancel(event)
  else drag.cancelActive()
}

async function requestCommand(command: CalendarInteractionCommand, source: CommandEnvelope['source']) {
  const warning = 'taskId' in command ? calendarDeadlineConflict(props.workspace, command) : null
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

async function executeRequested(command: CalendarInteractionCommand, source: CommandEnvelope['source']) {
  try {
    await props.executeCommand(command, source)
    statusMessage.value = '日历安排已保存。'
  } catch {
    statusMessage.value = '调整未保存，已恢复原安排。'
  }
}

function withDeadlineConflict(item: CalendarItem, preview: CalendarDragPreview): CalendarDragPreview {
  if (item.eventId !== undefined || !preview.valid) return preview
  const command = calendarCommandForPreview(item, drag.session.value?.action ?? 'move', preview, drag.session.value?.sourceStart === null)
  const warning = 'taskId' in command ? calendarDeadlineConflict(props.workspace, command) : null
  if (!warning) return preview
  return { ...preview, conflict: preview.conflict ? `${preview.conflict}；${warning}` : warning }
}

function targetClock(_item?: CalendarItem): CalendarTargetClock {
  return { kind: 'timezone', timezone: displayTimezone }
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
    <div class="calendar-workspace__tools">
      <slot name="quick-add" :anchor="anchor" />
      <Button variant="secondary" size="sm" @click="emit('create-event', anchor)">新建日程</Button>
      <Popover v-model:open="filtersOpen" mobile-sheet mobile-sheet-label="筛选日历">
        <template #trigger="{ triggerProps }"><Button v-bind="triggerProps" variant="ghost" size="sm">{{ hasFilters ? '筛选（已启用）' : '筛选' }}</Button></template>
        <template #default="{ close }"><div class="calendar-workspace__filters">
        <Input v-model="search" label="搜索日历任务" type="search" placeholder="标题、内容或标签" />
        <Listbox v-model="tagId" :options="tagOptions" label="标签" variant="compact" />
        <Listbox :model-value="priority" :options="priorityOptions" label="优先级" variant="compact" @update:model-value="priority = $event as typeof priority" />
        <Listbox :model-value="status" :options="statusOptions" label="状态" variant="compact" @update:model-value="status = $event as typeof status" />
        <Button v-if="hasFilters" variant="ghost" size="sm" @click="clearFilters">清除筛选</Button>
        <Button variant="primary" size="sm" @click="close('select')">查看结果</Button>
      </div></template>
      </Popover>
    </div>
    <UnscheduledTray :tasks="results.tasks" :anchor="anchor" :range="range" :now="now" :default-duration="defaultDropDuration" :target-offset="targetOffset" :timezone="displayTimezone" @suggest-task="emit('suggest-task', $event)" @pointer-start="beginTrayPointer" @command="requestCommand" @open="emit('open', $event, null)" />
    <p v-if="hasFilters && !items.length" class="calendar-workspace__empty" role="status">当前日期范围没有匹配的安排，可清除筛选或查看未安排任务。</p>
    <div v-if="pendingCommand" class="calendar-workspace__confirmation" role="alert">
      <AlertTriangle :size="17" aria-hidden="true" /><span>{{ pendingCommand.message }}</span>
      <Button variant="secondary" size="sm" @click="pendingCommand = null; statusMessage = ''">取消</Button>
      <Button variant="primary" size="sm" @click="confirmPending">仍然安排</Button>
    </div>
    <p class="sr-only" aria-live="polite">{{ statusMessage }}{{ drag.preview.value?.conflict ? ` ${drag.preview.value.conflict}` : '' }}</p>
    <TimeGrid v-if="effectiveMode === 'day' || effectiveMode === 'week'" ref="timeGrid" :days="days" :items="items" :timed-items="timedItems" :conflict-items="conflictItems" :titles="titles" :selected-key="selectedKey" :preview="drag.preview.value" :now="now" :target-clock="targetClock" @select="selectedKey = $event" @pointer-start="beginItemPointer" @command="requestCommand" @open="openItem" @blank-slot="createSlot = $event" @toggle-task="emit('toggle-task', $event)" />
    <MonthGrid v-else-if="effectiveMode === 'month'" :days="days" :anchor="anchor" :week-starts-on="weekStartsOn" :items="items" :titles="titles" @select-date="anchor = $event" @open="openItem" @toggle-task="emit('toggle-task', $event)" />
    <AgendaView v-else :items="items" :titles="titles" @open="openItem" @toggle-task="emit('toggle-task', $event)" />
    <Dialog :open="Boolean(createSlot)" title="创建安排" :description="createSlot ? `${createSlot.date} ${String(Math.floor(createSlot.minute / 60)).padStart(2, '0')}:${String(createSlot.minute % 60).padStart(2, '0')} · ${createSlot.duration} 分钟` : ''" size="sm" @close="createSlot = null">
      <p>把这段时间用于任务，或创建独立日程。</p>
      <template #footer><Button @click="createSlot = null">取消</Button><Button @click="chooseSlot('task')">创建任务</Button><Button variant="primary" @click="chooseSlot('event')">创建日程</Button></template>
    </Dialog>
  </section>
</template>

<style scoped>
.calendar-workspace { width: 100%; min-width: 0; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); }
.calendar-workspace__tools { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--hairline); }
.calendar-workspace__tools :deep(.quick-add-composer) { flex: 1 1 280px; min-width: 0; margin: 0; }
.calendar-workspace__filters { display: grid; width: min(360px, calc(100vw - 32px)); padding: 12px; gap: 12px; }
.calendar-workspace__empty { margin: 0; padding: 8px 16px; color: var(--muted); font-size: var(--text-xs); }
.calendar-workspace__confirmation { display: flex; align-items: center; gap: var(--space-2); padding: 8px 22px; border-bottom: 1px solid color-mix(in srgb, var(--danger) 24%, var(--hairline)); background: color-mix(in srgb, var(--danger) 7%, var(--surface)); color: var(--text); font-size: var(--text-sm); }
.calendar-workspace__confirmation > span { min-width: 0; flex: 1; }
.calendar-workspace__confirmation > svg { color: var(--danger); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 819px) {
  .calendar-workspace { height: calc(100% - 84px - env(safe-area-inset-bottom, 0px)); overflow-y: auto; }
  .calendar-workspace__tools :deep(.quick-add-composer) { order: -1; flex-basis: 100%; }
  .calendar-workspace__tools :deep(.btn) { min-height: 44px; }
  .calendar-workspace__confirmation { flex-wrap: wrap; padding: 8px 16px; }
  .calendar-workspace__confirmation > span { flex-basis: calc(100% - 28px); }
  .calendar-workspace__confirmation :deep(.btn) { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) { .calendar-workspace, .calendar-workspace * { scroll-behavior: auto !important; } }
</style>
