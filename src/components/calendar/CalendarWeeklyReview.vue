<script setup lang="ts">
import type { selectCalendarWeeklySummary } from '../../domain/calendar/calendar-weekly-summary.ts'
import type { ScheduleReason } from '../../domain/calendar/scheduling.ts'
defineProps<{ summary: ReturnType<typeof selectCalendarWeeklySummary>; taskTitles?: Record<string, string> }>()
const reasons: Record<ScheduleReason, string> = { 'task-unavailable': '任务当前不可安排', 'already-scheduled': '已有安排', 'recurring-task': '需安排具体重复发生项', 'missing-estimate': '缺少预计时长', 'invalid-estimate': '预计时长无效', 'deadline-passed': '截止时间已过', 'outside-working-hours': '范围内没有工作时段', 'insufficient-capacity': '连续空闲时间不足', 'availability-unknown': '忙闲信息未知或已过期' }
</script>

<template>
  <section class="weekly-review" aria-label="本周回顾">
    <header><h2>本周回顾</h2><p>{{ summary.range.start }} 起的一周 · {{ summary.timezone }}</p></header>
    <dl>
      <div><dt>计划</dt><dd>{{ summary.plannedCount }} 项 · {{ Math.round(summary.plannedMinutes) }} 分钟</dd></div>
      <div><dt>实际专注</dt><dd>{{ Math.round(summary.actualFocusSeconds / 60) }} 分钟</dd></div>
      <div><dt>完成率</dt><dd>{{ summary.completionRate === null ? '暂无计划' : `${Math.round(summary.completionRate * 100)}%` }} · {{ summary.completedCount }} 项完成</dd></div>
      <div><dt>真实移动</dt><dd>{{ summary.movementCount }} 次</dd></div>
    </dl>
    <p v-if="summary.unestimatedCount">{{ summary.unestimatedCount }} 项缺少预计时长，未计入计划分钟。</p>
    <p v-if="summary.unallocatedSessionIds.length" role="status">跨周或时间边界不完整的专注记录：{{ summary.unallocatedSessionIds.length }} 条，{{ Math.round(summary.unallocatedFocusSeconds / 60) }} 分钟待分配，未计入本周实际专注。</p>
    <div v-if="summary.unscheduledReasons.length"><h3>本次使用中无法排入</h3><ul><li v-for="entry in summary.unscheduledReasons" :key="entry.taskId">{{ taskTitles?.[entry.taskId] ?? entry.taskId }}：{{ reasons[entry.reason] }}</li></ul></div>
    <p v-else>本次使用中暂无无法排入的记录。</p>
  </section>
</template>

<style scoped>
.weekly-review { min-width: 0; padding: var(--space-4); display: grid; gap: var(--space-3); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow-wrap: anywhere; }
.weekly-review h2, .weekly-review h3, .weekly-review p, .weekly-review dl, .weekly-review dd { margin: 0; }
.weekly-review h2 { font-size: var(--text-lg); }.weekly-review h3 { font-size: var(--text-sm); }
.weekly-review p, .weekly-review dt { color: var(--muted); font-size: var(--text-xs); }
.weekly-review dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }.weekly-review dd { margin-top: var(--space-1); }
.weekly-review ul { padding-left: var(--space-4); font-size: var(--text-sm); }
</style>
