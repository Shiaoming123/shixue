<script setup lang="ts">
import { computed, ref } from 'vue'
import { Clock3, MoreHorizontal } from '@lucide/vue'
import type { CalendarCapabilityCommand } from '../../domain/capabilities/calendar-commands.ts'
import type { Task } from '../../domain/workspace/types.ts'
import Button from '../ui/Button.vue'
import DatePicker from '../ui/DatePicker.vue'
import Popover from '../ui/Popover.vue'
import TimePicker from '../ui/TimePicker.vue'
import { calendarMenuMoveCommand, filterUnscheduledTasks } from './use-calendar-drag.ts'

const props = defineProps<{ tasks: readonly Task[]; anchor: string; defaultDuration: number; targetOffset: string }>()
const emit = defineEmits<{
  'pointer-start': [event: PointerEvent, task: Task]
  command: [command: CalendarCapabilityCommand, source: 'human-ui' | 'keyboard']
}>()
const openTaskId = ref('')
const planDate = ref(props.anchor)
const planTime = ref('09:00')
const timeValid = ref(true)
const duration = ref(props.defaultDuration)
const unscheduled = computed(() => filterUnscheduledTasks(props.tasks))
const durationOptions = [15, 30, 45, 60, 90]

function openPlanner(taskId: string) {
  planDate.value = props.anchor
  planTime.value = '09:00'
  timeValid.value = true
  duration.value = props.defaultDuration
  openTaskId.value = taskId
}

function plan(task: Task, close: (reason: 'select') => void) {
  if (!planDate.value || !timeValid.value) return
  const [hours = 0, minutes = 0] = planTime.value.split(':').map(Number)
  const minute = planTime.value ? hours * 60 + minutes : null
  emit('command', calendarMenuMoveCommand(
    { taskId: task.id, occurrenceId: null },
    planDate.value,
    minute,
    duration.value,
    { kind: 'offset', offset: props.targetOffset },
  ), 'human-ui')
  close('select')
}
</script>

<template>
  <section class="unscheduled-tray" aria-labelledby="unscheduled-title">
    <header><div><Clock3 :size="16" aria-hidden="true" /><h2 id="unscheduled-title">未安排</h2></div><span>{{ unscheduled.length }}</span></header>
    <p v-if="unscheduled.length === 0" class="unscheduled-tray__empty">任务都已有时间位置</p>
    <div v-else class="unscheduled-tray__items">
      <div v-for="task in unscheduled" :key="task.id" class="unscheduled-tray__item">
        <button type="button" class="unscheduled-tray__drag" :aria-label="`拖动安排 ${task.title}`" @pointerdown="emit('pointer-start', $event, task)">{{ task.title }}</button>
        <Popover :open="openTaskId === task.id" align="end" mobile-sheet @update:open="$event ? openPlanner(task.id) : openTaskId = ''">
          <template #trigger="{ triggerProps }">
            <button type="button" class="unscheduled-tray__menu" v-bind="triggerProps" :aria-label="`安排 ${task.title}`" title="安排任务" @click="openPlanner(task.id)"><MoreHorizontal :size="16" /></button>
          </template>
          <template #default="{ close }">
            <section class="unscheduled-tray__panel" :aria-label="`安排 ${task.title}`">
              <strong>{{ task.title }}</strong>
              <DatePicker v-model="planDate" label="安排日期" />
              <TimePicker v-model="planTime" v-model:valid="timeValid" label="开始时间" />
              <fieldset><legend>预计时长</legend><div><button v-for="value in durationOptions" :key="value" type="button" :aria-pressed="duration === value" @click="duration = value">{{ value }} 分</button></div></fieldset>
              <footer><Button variant="ghost" @click="close('select')">取消</Button><Button variant="primary" :disabled="!planDate || !timeValid" @click="plan(task, close)">加入日历</Button></footer>
            </section>
          </template>
        </Popover>
      </div>
    </div>
  </section>
</template>

<style scoped>
.unscheduled-tray { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--space-3); padding: 10px 22px; border-bottom: 1px solid var(--hairline); background: var(--material-thin); backdrop-filter: saturate(150%) blur(18px); -webkit-backdrop-filter: saturate(150%) blur(18px); }
.unscheduled-tray > header { display: flex; align-items: center; gap: var(--space-2); }
.unscheduled-tray > header > div { display: flex; align-items: center; gap: var(--space-1); color: var(--muted); }
.unscheduled-tray h2 { margin: 0; color: var(--text); font-size: var(--text-sm); font-weight: var(--font-semibold); }
.unscheduled-tray header > span { min-width: 20px; height: 20px; display: grid; place-items: center; border-radius: var(--radius-full); background: var(--control-fill); color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.unscheduled-tray__items { min-width: 0; display: flex; gap: var(--space-1); overflow-x: auto; }
.unscheduled-tray__item { position: relative; min-width: 156px; max-width: 240px; display: flex; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 88%, transparent); }
.unscheduled-tray__drag { min-width: 0; min-height: 34px; flex: 1; overflow: hidden; padding: 0 30px 0 10px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: var(--text-xs); text-align: left; text-overflow: ellipsis; white-space: nowrap; touch-action: none; }
.unscheduled-tray__menu { position: absolute; top: 2px; right: 2px; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); }
.unscheduled-tray__menu:hover { background: var(--control-fill); color: var(--accent); }
.unscheduled-tray__empty { margin: 0; color: var(--muted); font-size: var(--text-xs); }
.unscheduled-tray__panel { width: min(360px, calc(100vw - 32px)); display: grid; gap: var(--space-3); padding: var(--space-3); }
.unscheduled-tray__panel fieldset { padding: 0; border: 0; }
.unscheduled-tray__panel footer { display: flex; justify-content: flex-end; gap: var(--space-2); }
.unscheduled-tray__panel legend { color: var(--muted); font-size: var(--text-xs); }
.unscheduled-tray__panel fieldset div { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-1); margin-top: var(--space-1); }
.unscheduled-tray__panel fieldset button { min-height: max(34px, var(--control-hit)); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font: inherit; font-size: var(--text-xs); }
.unscheduled-tray__panel fieldset button[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
@media (max-width: 819px) {
  .unscheduled-tray { grid-template-columns: 1fr; padding: 10px 16px; }
  .unscheduled-tray__drag, .unscheduled-tray__menu, .unscheduled-tray__panel fieldset button { min-height: 44px; }
  .unscheduled-tray__menu { width: 44px; height: 44px; top: 0; right: 0; }
}
@media (prefers-reduced-transparency: reduce) { .unscheduled-tray { background: var(--surface); backdrop-filter: none; -webkit-backdrop-filter: none; } }
</style>
