<script setup lang="ts">
import { CalendarClock, Check, Forward, SkipForward } from '@lucide/vue'
import type { TaskOccurrence } from '../../domain/workspace/types'

const props = defineProps<{ occurrence: TaskOccurrence; title: string; scheduledLabel: string }>()
const emit = defineEmits<{ complete: [id: string]; skip: [id: string]; reschedule: [id: string] }>()
</script>

<template>
  <article class="occurrence-row" :class="`status-${occurrence.status}`">
    <div><strong>{{ title }}</strong><small><CalendarClock :size="13" />{{ scheduledLabel }}</small></div>
    <div v-if="occurrence.status === 'pending'" class="actions">
      <button type="button" :aria-label="`完成 ${title}`" title="完成" @click="emit('complete', occurrence.id)"><Check :size="16" /></button>
      <button type="button" :aria-label="`跳过 ${title}`" title="跳过" @click="emit('skip', occurrence.id)"><SkipForward :size="16" /></button>
      <button type="button" :aria-label="`改期 ${title}`" title="改期" @click="emit('reschedule', occurrence.id)"><Forward :size="16" /></button>
    </div>
  </article>
</template>

<style scoped>
.occurrence-row { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); }.occurrence-row strong { display: block; font-size: var(--text-sm); font-weight: 600; }.occurrence-row small { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; color: var(--muted); font-size: var(--text-xs); }.actions { display: flex; gap: 2px; }.actions button { width: max(36px, var(--icon-hit)); height: max(36px, var(--icon-hit)); display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); }.status-completed, .status-skipped { opacity: .62; }
</style>
