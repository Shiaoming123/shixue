<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MoreHorizontal, MoveVertical } from '@lucide/vue'
import type { CalendarCapabilityCommand } from '../../domain/capabilities/calendar-commands.ts'
import type { CalendarItem } from '../../domain/calendar/project.ts'
import Button from '../ui/Button.vue'
import DatePicker from '../ui/DatePicker.vue'
import Popover from '../ui/Popover.vue'
import TimePicker from '../ui/TimePicker.vue'
import { calendarKeyboardCommand, calendarMoveCommand, durationMinutes } from './use-calendar-drag.ts'

const props = withDefaults(defineProps<{
  item: CalendarItem
  title: string
  selected?: boolean
  previewing?: boolean
  interactive?: boolean
}>(), { selected: false, previewing: false, interactive: true })
const emit = defineEmits<{
  select: [key: string]
  'pointer-start': [event: PointerEvent, item: CalendarItem, action: 'move' | 'resize']
  command: [command: CalendarCapabilityCommand, source: 'human-ui' | 'keyboard']
}>()

const menuOpen = ref(false)
const moveDate = ref(datePart(props.item.start))
const moveTime = ref(timePart(props.item.start))
const timeValid = ref(true)
const duration = ref(durationMinutes(props.item))
const durationOptions = [15, 30, 45, 60, 90, 120]
const accessibleLabel = computed(() => props.item.kind === 'all-day'
  ? `${props.title}，全天`
  : props.item.kind === 'deadline-marker'
    ? `${props.title}，截止 ${formatTime(props.item.start)}`
    : `${props.title}，${formatTime(props.item.start)}，${durationMinutes(props.item)} 分钟`)
const keyboardShortcuts = computed(() => props.item.kind === 'all-day'
  ? 'Alt+ArrowLeft Alt+ArrowRight'
  : 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Shift+Alt+ArrowUp Shift+Alt+ArrowDown')

watch(() => props.item, (item) => {
  moveDate.value = datePart(item.start)
  moveTime.value = timePart(item.start)
  duration.value = durationMinutes(item)
}, { deep: true })

function onKeydown(event: KeyboardEvent) {
  if (props.interactive && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault()
    menuOpen.value = true
    return
  }
  if (!props.interactive || !event.altKey || !isArrow(event.key)) return
  const command = calendarKeyboardCommand(props.item, event.key, event.shiftKey)
  if (!command) return
  event.preventDefault()
  emit('command', command, 'keyboard')
}

function applyMove(close: (reason: 'select') => void) {
  if (!moveDate.value || !timeValid.value) return
  const target = moveTime.value
    ? { startAt: new Date(`${moveDate.value}T${moveTime.value}:00`).toISOString() }
    : { startOn: moveDate.value }
  emit('command', calendarMoveCommand(props.item, target, props.item.kind === 'timed' ? duration.value : undefined), 'human-ui')
  close('select')
}

function applyDuration(value: number) {
  duration.value = value
}

function beginPointer(event: PointerEvent, action: 'move' | 'resize') {
  if (!props.interactive || event.button !== 0) return
  emit('select', props.item.key)
  emit('pointer-start', event, props.item, action)
}

function isArrow(key: string): key is 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)
}
function datePart(value: string) { return value.includes('T') ? new Date(value).toLocaleDateString('sv-SE') : value }
function timePart(value: string) { const date = new Date(value); return value.includes('T') && !Number.isNaN(date.getTime()) ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '' }
function formatTime(value: string) { return timePart(value) || datePart(value) }
</script>

<template>
  <article
    class="calendar-item"
    :class="[`calendar-item--${item.kind}`, { 'calendar-item--selected': selected, 'calendar-item--previewing': previewing }]"
    :tabindex="interactive ? 0 : undefined"
    :aria-label="accessibleLabel"
    :aria-selected="interactive ? selected : undefined"
    :aria-keyshortcuts="interactive ? keyboardShortcuts : undefined"
    @focus="interactive && emit('select', item.key)"
    @keydown="onKeydown"
  >
    <button v-if="interactive" type="button" class="calendar-item__body" :aria-label="`移动 ${title}`" @pointerdown="beginPointer($event, 'move')">
      <strong>{{ title }}</strong><span>{{ item.kind === 'all-day' ? '全天' : formatTime(item.start) }}</span>
    </button>
    <div v-else class="calendar-item__fact"><strong>{{ title }}</strong><span>{{ formatTime(item.start) }}</span></div>

    <Popover v-if="interactive" v-model:open="menuOpen" align="end" mobile-sheet>
      <template #trigger="{ triggerProps }">
        <button class="calendar-item__menu" type="button" v-bind="triggerProps" :aria-label="`安排 ${title}`" title="安排任务" @pointerdown.stop><MoreHorizontal :size="15" /></button>
      </template>
      <template #default="{ close }">
        <section class="calendar-item__panel" :aria-label="`安排 ${title}`">
          <header><strong>{{ title }}</strong><span>移动与时长</span></header>
          <DatePicker v-model="moveDate" label="移动到日期" />
          <TimePicker v-model="moveTime" v-model:valid="timeValid" label="开始时间" />
          <fieldset v-if="item.kind === 'timed'">
            <legend>预计时长</legend>
            <div class="calendar-item__durations">
              <button v-for="value in durationOptions" :key="value" type="button" :aria-pressed="duration === value" @click="applyDuration(value)">{{ value }} 分</button>
            </div>
          </fieldset>
          <footer><Button variant="ghost" @click="close('select')">取消</Button><Button variant="primary" :disabled="!moveDate || !timeValid" @click="applyMove(close)">保存安排</Button></footer>
        </section>
      </template>
    </Popover>

    <button v-if="interactive && item.kind === 'timed'" class="calendar-item__resize" type="button" :aria-label="`调整 ${title} 时长`" @pointerdown.stop="beginPointer($event, 'resize')"><MoveVertical :size="12" /></button>
  </article>
</template>

<style scoped>
.calendar-item { position: relative; min-width: 0; overflow: hidden; border-left: 3px solid var(--accent); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--text); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, var(--hairline)); }
.calendar-item:focus-visible { outline: 0; box-shadow: var(--focus-ring), inset 0 0 0 1px var(--accent); }
.calendar-item--selected { background: color-mix(in srgb, var(--accent) 18%, var(--surface)); }
.calendar-item--previewing { opacity: .35; }
.calendar-item--all-day { min-height: 32px; border-left-width: 2px; }
.calendar-item--deadline-marker { min-height: 28px; border-left-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 20%, var(--hairline)); }
.calendar-item__body { width: 100%; height: 100%; min-height: 28px; display: flex; align-items: flex-start; flex-direction: column; gap: 1px; padding: 4px 28px 6px 7px; overflow: hidden; border: 0; background: transparent; color: inherit; text-align: left; touch-action: none; }
.calendar-item__body strong, .calendar-item__fact strong { max-width: 100%; overflow: hidden; font-size: var(--text-xs); font-weight: var(--font-semibold); text-overflow: ellipsis; white-space: nowrap; }
.calendar-item__body span, .calendar-item__fact span { color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.calendar-item__fact { display: flex; align-items: center; gap: var(--space-1); padding: 5px 7px; }
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
@media (max-width: 819px) { .calendar-item__menu { width: 44px; height: 44px; top: 0; right: 0; } .calendar-item__durations button { min-height: 44px; } }
</style>
