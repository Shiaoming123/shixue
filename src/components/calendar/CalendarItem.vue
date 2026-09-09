<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MoreHorizontal, MoveVertical } from '@lucide/vue'
import type { CalendarInteractionCommand } from './use-calendar-drag.ts'
import type { CalendarItem } from '../../domain/calendar/project.ts'
import Button from '../ui/Button.vue'
import CalendarTaskLabel from './CalendarTaskLabel.vue'
import CalendarTaskToggle from './CalendarTaskToggle.vue'
import DatePicker from '../ui/DatePicker.vue'
import Popover from '../ui/Popover.vue'
import TimePicker from '../ui/TimePicker.vue'
import { calendarKeyboardCommand, calendarMenuMoveCommand, durationMinutes } from './use-calendar-drag.ts'
import type { CalendarTargetClock } from '../../domain/calendar/target.ts'

const props = withDefaults(defineProps<{
  item: CalendarItem
  title: string
  selected?: boolean
  previewing?: boolean
  interactive?: boolean
  targetClock: CalendarTargetClock
}>(), { selected: false, previewing: false, interactive: true })
const emit = defineEmits<{
  open: [item: CalendarItem]
  select: [key: string]
  'pointer-start': [event: PointerEvent, item: CalendarItem, action: 'move' | 'resize']
  command: [command: CalendarInteractionCommand, source: 'human-ui' | 'keyboard']
  'toggle-task': [value: { taskId: string; occurrenceId: string | null }]
}>()

const menuOpen = ref(false)
const menuItem = ref<CalendarItem | null>(null)
const interactionError = ref('')
let pointerOrigin: { x: number; y: number } | null = null
let moved = false
function trackPointer(event: PointerEvent) {
  if (pointerOrigin && Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y) >= 4) moved = true
}
function openTask(event: MouseEvent) { if (event.detail === 0 || !moved) emit('open', props.item); pointerOrigin = null }
const moveDate = ref(props.item.displayDate)
const moveTime = ref(timePart(props.item))
const timeValid = ref(true)
const duration = ref(durationMinutes(props.item))
const durationOptions = [15, 30, 45, 60, 90, 120]
const accessibleLabel = computed(() => props.item.kind === 'all-day'
  ? `${props.title}，全天`
  : props.item.kind === 'deadline-marker'
    ? `${props.title}，截止 ${formatTime(props.item)}`
    : `${props.title}，${formatTime(props.item)}，${durationMinutes(props.item)} 分钟`)
const keyboardShortcuts = computed(() => props.item.kind === 'all-day'
  ? 'Alt+ArrowLeft Alt+ArrowRight'
  : 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Shift+Alt+ArrowUp Shift+Alt+ArrowDown')

watch(() => props.item, (item) => {
  if (menuOpen.value) return
  moveDate.value = item.displayDate
  moveTime.value = timePart(item)
  duration.value = durationMinutes(item)
}, { deep: true })
watch(menuOpen, (open) => {
  menuItem.value = open ? JSON.parse(JSON.stringify(props.item)) as CalendarItem : null
  if (open) {
    moveDate.value = props.item.displayDate
    moveTime.value = timePart(props.item)
    duration.value = durationMinutes(props.item)
    interactionError.value = ''
  }
})

function onKeydown(event: KeyboardEvent) {
  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault()
    emit('open', props.item)
    return
  }
  if (!props.interactive || !event.altKey || !isArrow(event.key)) return
  event.preventDefault()
  interactionError.value = ''
  try {
    const command = calendarKeyboardCommand(props.item, event.key, event.shiftKey, props.targetClock)
    if (command) emit('command', command, 'keyboard')
  } catch (error) { interactionError.value = error instanceof Error ? error.message : '无法调整此日程。' }
}

function applyMove(close: (reason: 'select') => void) {
  if (!moveDate.value || !timeValid.value) return
  const minute = moveTime.value ? Number(moveTime.value.slice(0, 2)) * 60 + Number(moveTime.value.slice(3, 5)) : null
  interactionError.value = ''
  try {
    emit('command', calendarMenuMoveCommand(menuItem.value ?? props.item, moveDate.value, minute, duration.value, props.targetClock), 'human-ui')
    close('select')
  } catch (error) { interactionError.value = error instanceof Error ? error.message : '无法调整此日程。' }
}

function applyDuration(value: number) {
  duration.value = value
}

function beginPointer(event: PointerEvent, action: 'move' | 'resize') {
  if (!props.interactive || event.button !== 0) return
  pointerOrigin = { x: event.clientX, y: event.clientY }
  moved = action === 'resize'
  emit('select', props.item.key)
  emit('pointer-start', event, props.item, action)
}

function isArrow(key: string): key is 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)
}
function timePart(item: CalendarItem) { return item.displayMinute === null ? '' : `${String(Math.floor(item.displayMinute / 60)).padStart(2, '0')}:${String(item.displayMinute % 60).padStart(2, '0')}` }
function formatTime(item: CalendarItem) { return timePart(item) || item.displayDate }
</script>

<template>
  <article
    class="calendar-item"
    :data-priority="item.presentation?.priority"
    :data-status="item.presentation?.status"
    :class="[`calendar-item--${item.kind}`, { 'calendar-item--selected': selected, 'calendar-item--previewing': previewing }]"
    tabindex="0"
    :aria-label="accessibleLabel"
    :aria-selected="interactive ? selected : undefined"
    :aria-keyshortcuts="interactive ? keyboardShortcuts : undefined"
    @focus="interactive && emit('select', item.key)"
    @keydown="onKeydown"
    @pointermove="trackPointer"
  >
    <CalendarTaskToggle class="calendar-item__complete" :item="item" :title="title" @toggle="emit('toggle-task', $event)" />
    <button v-if="interactive" type="button" class="calendar-item__body" :aria-label="`打开 ${title}`" @pointerdown="beginPointer($event, 'move')" @click="openTask">
      <CalendarTaskLabel :item="item" :title="title" /><span>{{ item.kind === 'all-day' ? '全天' : formatTime(item) }}</span>
    </button>
    <button v-else type="button" class="calendar-item__fact" :aria-label="`打开 ${title}`" :title="item.eventId && !item.calendar.readOnly ? '跨日日程请打开详情调整完整起止时间' : undefined" @click="emit('open', item)"><CalendarTaskLabel :item="item" :title="title" /><span>{{ item.kind === 'deadline-marker' ? `截止 ${formatTime(item)}` : formatTime(item) }}</span><span v-if="item.eventId && !item.calendar.readOnly">跨日 · 详情调整</span></button>
    <span v-if="interactionError && !menuOpen" class="calendar-item__error" role="alert">{{ interactionError }}</span>

    <Popover v-if="interactive" v-model:open="menuOpen" align="end" mobile-sheet :mobile-sheet-label="`安排 ${title}`">
      <template #trigger="{ triggerProps }">
        <button class="calendar-item__menu" type="button" v-bind="triggerProps" :aria-label="`安排 ${title}`" :title="item.eventId ? '安排日程' : '安排任务'" @pointerdown.stop><MoreHorizontal :size="15" /></button>
      </template>
      <template #default="{ close }">
        <section class="calendar-item__panel" :class="{ 'calendar-item__panel--event': item.eventId }" :aria-label="`安排 ${title}`">
          <header><strong>{{ title }}</strong><span>移动与时长</span></header>
          <div v-if="item.taskId" class="calendar-item__completion-action"><CalendarTaskToggle :item="item" :title="title" @toggle="emit('toggle-task', $event); close('select')" /><span>{{ item.presentation?.status === 'completed' ? '重新打开任务' : '完成任务' }}</span></div>
          <DatePicker v-model="moveDate" label="移动到日期" />
          <TimePicker v-if="!item.eventId || item.kind !== 'all-day'" v-model="moveTime" v-model:valid="timeValid" label="开始时间" />
          <p v-if="item.eventId" class="calendar-item__note">{{ item.calendar.time.kind === 'floating' ? '保持浮动墙钟时间。' : item.calendar.time.kind === 'fixed' && targetClock.kind === 'timezone' ? `按显示时区 ${targetClock.timezone} 调整。` : '保持全天日期。' }}{{ item.calendar.event.recurrence ? '仅修改本次日程。' : '' }}</p>
          <fieldset v-if="moveTime">
            <legend>预计时长</legend>
            <div class="calendar-item__durations">
              <button v-for="value in durationOptions" :key="value" type="button" :aria-pressed="duration === value" @click="applyDuration(value)">{{ value }} 分</button>
            </div>
          </fieldset>
          <p v-if="interactionError" class="calendar-item__error" role="alert">{{ interactionError }}</p>
          <footer><Button variant="ghost" @click="close('select')">取消</Button><Button variant="primary" :disabled="!moveDate || !timeValid" @click="applyMove(close)">保存安排</Button></footer>
        </section>
      </template>
    </Popover>

    <button v-if="interactive && item.kind === 'timed'" class="calendar-item__resize" type="button" :aria-label="`调整 ${title} 时长`" @pointerdown.stop="beginPointer($event, 'resize')"><MoveVertical :size="12" /></button>
  </article>
</template>

<style scoped>
.calendar-item { container-type: inline-size; position: relative; min-width: 0; overflow: hidden; border-left: 3px solid var(--accent); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--text); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, var(--hairline)); }
.calendar-item:focus-visible { outline: 0; box-shadow: var(--focus-ring), inset 0 0 0 1px var(--accent); }
.calendar-item--selected { background: color-mix(in srgb, var(--accent) 18%, var(--surface)); }
.calendar-item--previewing { opacity: .35; }
.calendar-item[data-priority='high'] { border-left-color: var(--danger); }
.calendar-item[data-priority='medium'] { border-left-color: var(--warning); }
.calendar-item[data-status='completed'], .calendar-item[data-status='skipped'] { background: var(--surface-alt); }
.calendar-item--all-day { min-height: 32px; border-left-width: 2px; }
.calendar-item--deadline-marker { min-height: 28px; border-left-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 20%, var(--hairline)); }
.calendar-item__body { width: 100%; height: 100%; min-height: 28px; display: flex; align-items: flex-start; flex-direction: column; gap: 1px; padding: 4px 28px 6px 7px; overflow: hidden; border: 0; background: transparent; color: inherit; text-align: left; touch-action: none; }
.calendar-item__body strong, .calendar-item__fact strong { max-width: 100%; overflow: hidden; font-size: var(--text-xs); font-weight: var(--font-semibold); text-overflow: ellipsis; white-space: nowrap; }
.calendar-item__body span, .calendar-item__fact span { color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.calendar-item__fact { width: 100%; display: flex; align-items: center; gap: var(--space-1); padding: 5px 7px; border: 0; background: transparent; color: inherit; font: inherit; }
.calendar-item__menu { position: absolute; top: 2px; right: 2px; width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); }
.calendar-item__menu:hover { background: var(--control-fill); color: var(--text); }
.calendar-item__resize { position: absolute; right: 1px; bottom: 0; left: 1px; width: calc(100% - 2px); height: 12px; display: grid; place-items: center; border: 0; background: transparent; color: var(--muted); cursor: ns-resize; touch-action: none; }
.calendar-item__panel { width: min(360px, calc(100vw - 32px)); display: grid; gap: var(--space-3); padding: var(--space-3); }
.calendar-item__panel header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.calendar-item__panel header span, legend { color: var(--muted); font-size: var(--text-xs); }
.calendar-item__panel fieldset { padding: 0; border: 0; }
.calendar-item__panel footer { display: flex; justify-content: flex-end; gap: var(--space-2); }
.calendar-item__durations { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-1); margin-top: var(--space-1); }
.calendar-item__durations button { min-height: max(34px, var(--control-hit)); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font: inherit; font-size: var(--text-xs); }
.calendar-item__durations button[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
.calendar-item__panel--event :deep(.note), .calendar-item__panel--event :deep(.clear) { display: none; }
.calendar-item__note { margin: 0; color: var(--muted); font-size: var(--text-xs); }
.calendar-item__error { color: var(--danger); font-size: var(--text-xs); }
.calendar-item__completion-action { display: flex; align-items: center; gap: var(--space-2); }
.calendar-item__completion-action:not(:has(button)) { display: none; }
.calendar-item__complete { position: absolute; top: 1px; left: 1px; z-index: 1; }.calendar-item:has(.calendar-item__complete) .calendar-item__body { padding-left: 33px; }
@media (max-width: 819px) { .calendar-item__body { padding-right: 46px; } .calendar-item:has(.calendar-item__complete) .calendar-item__body { padding-left: 47px; } }
@media (max-width: 819px) { .calendar-item__menu { width: 44px; height: 44px; top: 0; right: 0; } .calendar-item__durations button { min-height: 44px; } }
@container (max-width: 160px) {
  .calendar-item__complete { display: none; }
  .calendar-item:has(.calendar-item__complete) .calendar-item__body { padding-left: 7px; }
  .calendar-item__body { width: calc(100% - 28px); padding-right: 2px; }
  @media (max-width: 819px) { .calendar-item__body { width: calc(100% - 44px); padding-right: 2px; } }
}
</style>
