<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { Check } from '@lucide/vue'
import type { CalendarItem } from '../../domain/calendar/project'
import Tooltip from '../ui/Tooltip.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ item: CalendarItem; title: string }>()
const attrs = useAttrs()
const emit = defineEmits<{ toggle: [value: { taskId: string; occurrenceId: string | null }] }>()
const visible = computed(() => props.item.taskId !== undefined && props.item.kind !== 'deadline-marker' && (props.item.occurrenceId === null || props.item.presentation?.status === 'pending'))
const completed = computed(() => props.item.presentation?.status === 'completed')
function toggle() { if (props.item.taskId !== undefined) emit('toggle', { taskId: props.item.taskId, occurrenceId: props.item.occurrenceId }) }
</script>

<template>
  <Tooltip v-if="visible" :label="`${completed ? '重新打开' : '完成'} ${title}`"><template #trigger="{ triggerProps }"><button v-bind="{ ...attrs, ...triggerProps }" type="button" class="calendar-task-toggle" :aria-label="`${completed ? '重新打开' : '完成'} ${title}`" :aria-pressed="completed" @pointerdown.stop @click.stop="toggle"><Check :size="14" aria-hidden="true" /></button></template></Tooltip>
</template>

<style scoped>
.calendar-task-toggle { flex: 0 0 auto; min-width: 28px; min-height: 28px; display: inline-grid; place-items: center; padding: 4px; border: 1px solid var(--hairline); border-radius: var(--radius-full); background: var(--control-fill); color: var(--muted); }
.calendar-task-toggle[aria-pressed='true'] { color: var(--accent); border-color: var(--accent); }.calendar-task-toggle:focus-visible { outline: 0; box-shadow: var(--focus-ring); }
@media (max-width: 819px) { .calendar-task-toggle { min-width: 44px; min-height: 44px; } }
</style>
