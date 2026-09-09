<script setup lang="ts">
import type { CalendarItem } from '../../domain/calendar/project.ts'
defineProps<{ item: CalendarItem; title: string }>()
const priorities = { none: '', low: '低优先级', medium: '中优先级', high: '高优先级' }
</script>

<template>
  <span class="calendar-task-label" :data-status="item.presentation?.status">
    <strong>{{ title }}</strong>
    <span v-if="item.eventId !== undefined" class="calendar-task-label__meta"><span :style="{ color: item.calendar.color }">●</span>{{ item.calendar.title }}<span v-if="item.calendar.readOnly">只读</span></span>
    <span v-if="item.presentation" class="calendar-task-label__meta">
      <span v-if="item.presentation.priority !== 'none'" class="calendar-task-label__priority" :data-priority="item.presentation.priority">{{ priorities[item.presentation.priority] }}</span>
      <span v-if="item.presentation.status === 'completed'">已完成</span>
      <span v-else-if="item.presentation.status === 'skipped'">已跳过</span>
      <span v-for="tag in item.presentation.tags" :key="tag">#{{ tag }}</span>
    </span>
  </span>
</template>

<style scoped>
.calendar-task-label { min-width: 0; max-width: 100%; display: grid; text-align: left; color: var(--text); }
.calendar-task-label strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); font-weight: var(--font-semibold); }
.calendar-task-label__meta { display: flex; gap: 4px; overflow: hidden; white-space: nowrap; color: var(--muted); font-size: 10px; }
.calendar-task-label__priority { border-left: 3px solid var(--accent); padding-left: 3px; }
.calendar-task-label__priority[data-priority='high'] { border-color: var(--danger); }
.calendar-task-label__priority[data-priority='medium'] { border-color: var(--warning); }
.calendar-task-label[data-status='completed'] strong, .calendar-task-label[data-status='skipped'] strong { color: var(--muted); text-decoration: line-through; }
</style>
