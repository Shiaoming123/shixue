<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CalendarItem } from '../../domain/calendar/project.ts'
import { groupCalendarItems, monthOverflow } from '../../domain/calendar/view.ts'
import Button from '../ui/Button.vue'
import Popover from '../ui/Popover.vue'

const props = defineProps<{
  days: readonly string[]
  anchor: string
  weekStartsOn: 0 | 1
  items: readonly CalendarItem[]
  titles: ReadonlyMap<string, string>
}>()
const emit = defineEmits<{ 'select-date': [date: string] }>()

const itemsByDate = computed(() => new Map(groupCalendarItems(props.items).map((group) => [group.date, group.items])))
const openDay = ref('')
const month = computed(() => props.anchor.slice(0, 7))
const weekdays = computed(() => props.weekStartsOn === 1 ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六'])
const dayFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })

function facts(day: string) { return itemsByDate.value.get(day) ?? [] }
function overflow(day: string) { return monthOverflow(facts(day)) }
function titleFor(item: CalendarItem) { return props.titles.get(item.taskId) ?? '未命名任务' }
function dayNumber(day: string) { return Number(day.slice(8, 10)) }
function dayLabel(day: string) { return dayFormatter.format(new Date(`${day}T00:00:00.000Z`)).replace('星期', '周') }
function timeLabel(item: CalendarItem) {
  if (item.kind === 'all-day') return '全天'
  if (item.kind === 'deadline-marker' && item.displayMinute === null) return '截止'
  const time = formatMinute(item.displayMinute ?? 0)
  return item.kind === 'deadline-marker' ? `截止 ${time}` : time
}
function formatMinute(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` }
</script>

<template>
  <section class="month-grid" aria-label="月历">
    <div class="month-grid__weekdays" aria-hidden="true">
      <span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span>
    </div>
    <div class="month-grid__days">
      <section v-for="day in days" :key="day" class="month-grid__day" :class="{ 'month-grid__day--outside': !day.startsWith(month) }" :aria-label="dayLabel(day)">
        <button type="button" class="month-grid__date" :aria-label="`打开 ${dayLabel(day)}`" @click="emit('select-date', day)">{{ dayNumber(day) }}</button>
        <div class="month-grid__facts">
          <div v-for="item in overflow(day).visible" :key="item.key" class="month-grid__fact" :class="`month-grid__fact--${item.kind}`" :aria-label="`${timeLabel(item)} ${titleFor(item)}`">
            <span>{{ timeLabel(item) }}</span><strong>{{ titleFor(item) }}</strong>
          </div>
        </div>
        <Popover v-if="overflow(day).hiddenCount" :open="openDay === day" mobile-sheet @update:open="openDay = $event ? day : ''">
          <template #trigger="{ triggerProps }">
            <Button variant="ghost" size="sm" class="month-grid__more" v-bind="triggerProps" :aria-label="`${dayLabel(day)}还有 ${overflow(day).hiddenCount} 项，查看全部`">+{{ overflow(day).hiddenCount }}</Button>
          </template>
          <template #default="{ close }">
            <div class="month-grid__disclosure">
              <header><div><p>{{ dayLabel(day) }}</p><h2>当日安排</h2></div><Button variant="ghost" size="sm" @click="close('select')">关闭</Button></header>
              <ol>
                <li v-for="item in facts(day)" :key="item.key" :class="`month-grid__disclosure-row--${item.kind}`">
                  <span>{{ timeLabel(item) }}</span><strong>{{ titleFor(item) }}</strong>
                </li>
              </ol>
            </div>
          </template>
        </Popover>
      </section>
    </div>
  </section>
</template>

<style scoped>
.month-grid { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: auto; background: var(--surface); }
.month-grid__weekdays, .month-grid__days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.month-grid__weekdays { position: sticky; top: 0; z-index: 1; border-bottom: 1px solid var(--hairline); background: var(--surface); }
.month-grid__weekdays span { padding: 8px; color: var(--muted); font-size: var(--text-xs); font-weight: var(--font-semibold); text-align: center; }
.month-grid__days { min-height: 792px; grid-template-rows: repeat(6, minmax(132px, 1fr)); }
.month-grid__day { min-width: 0; padding: 6px; border-right: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); background: var(--surface); }
.month-grid__day:nth-child(7n) { border-right: 0; }
.month-grid__day--outside { background: color-mix(in srgb, var(--surface-alt) 58%, var(--surface)); color: var(--muted); }
.month-grid__date { width: 30px; height: 30px; display: grid; place-items: center; margin: 0 0 3px auto; border: 0; border-radius: var(--radius-md); background: transparent; color: inherit; font: inherit; font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.month-grid__date:hover, .month-grid__date:focus-visible { background: var(--control-fill); color: var(--accent); outline: 0; box-shadow: var(--focus-ring); }
.month-grid__facts { display: grid; gap: 2px; }
.month-grid__fact { min-width: 0; display: flex; align-items: baseline; gap: 4px; padding: 1px 4px; border-left: 2px solid var(--accent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; background: color-mix(in srgb, var(--accent) 8%, var(--surface)); font-size: var(--text-xs); line-height: 1.35; }
.month-grid__fact--deadline-marker { border-left-style: dashed; border-left-color: var(--danger); background: color-mix(in srgb, var(--danger) 6%, var(--surface)); }
.month-grid__fact--all-day { border-left-color: var(--muted); background: var(--surface-alt); }
.month-grid__fact span { flex: 0 0 auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.month-grid__fact strong { min-width: 0; overflow: hidden; color: var(--text); font-weight: var(--font-medium); text-overflow: ellipsis; white-space: nowrap; }
.month-grid__more { width: 100%; margin-top: 2px; justify-content: flex-start; color: var(--accent); }
.month-grid__disclosure { width: min(360px, calc(100vw - 32px)); padding: var(--space-3); }
.month-grid__disclosure header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-2); }
.month-grid__disclosure p, .month-grid__disclosure h2 { margin: 0; }
.month-grid__disclosure p { color: var(--muted); font-size: var(--text-xs); }
.month-grid__disclosure h2 { color: var(--text); font-size: var(--text-md); }
.month-grid__disclosure ol { margin: 0; padding: 0; list-style: none; }
.month-grid__disclosure li { display: flex; gap: var(--space-2); padding: 9px 0; border-top: 1px solid var(--hairline); }
.month-grid__disclosure li span { width: 72px; flex: 0 0 auto; color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.month-grid__disclosure li strong { color: var(--text); font-size: var(--text-sm); font-weight: var(--font-medium); }
@media (max-width: 819px) {
  .month-grid__days { min-height: 888px; grid-template-rows: repeat(6, minmax(148px, 1fr)); }
  .month-grid__day { padding: 3px; }
  .month-grid__date { width: 44px; height: 44px; margin-bottom: 0; }
  .month-grid__fact { padding: 1px 2px; }
  .month-grid__fact span, .month-grid__fact strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .month-grid__more { min-height: 44px; }
  .month-grid__disclosure { width: 100%; padding: var(--space-4); }
}
@media (pointer: coarse) and (max-width: 819px) {
  .month-grid__date, .month-grid__more { min-height: 48px; }
}
</style>
