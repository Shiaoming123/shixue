<script setup lang="ts">
import { CalendarClock, Check, Forward, SkipForward } from '@lucide/vue'
import type { TaskOccurrence } from '../../domain/workspace/types'
import Button from '../ui/Button.vue'

const props = defineProps<{ occurrence: TaskOccurrence; title: string; scheduledLabel: string; deadlineLabel?: string; reasons?: string[] }>()
const emit = defineEmits<{ open: [id: string]; complete: [id: string]; skip: [id: string]; reschedule: [id: string] }>()
</script>

<template>
  <article class="occurrence-row" :class="`status-${occurrence.status}`">
    <Button variant="ghost" class="occurrence-main" @click="emit('open', occurrence.id)"><span class="occurrence-copy"><strong>{{ title }}</strong><small><CalendarClock :size="13" />本次 {{ scheduledLabel }}<template v-if="deadlineLabel"> · 截止 {{ deadlineLabel }}</template></small><span v-if="reasons?.length" class="occurrence-reasons"><small v-for="reason in reasons" :key="reason">{{ reason }}</small></span></span></Button>
    <div v-if="occurrence.status === 'pending'" class="actions">
      <Button variant="ghost" size="sm" class="occurrence-action" :aria-label="`完成 ${title}`" title="完成" @click="emit('complete', occurrence.id)"><Check :size="16" /></Button>
      <Button variant="ghost" size="sm" class="occurrence-action" :aria-label="`跳过 ${title}`" title="跳过" @click="emit('skip', occurrence.id)"><SkipForward :size="16" /></Button>
      <Button variant="ghost" size="sm" class="occurrence-action" :aria-label="`改期 ${title}`" title="改期" @click="emit('reschedule', occurrence.id)"><Forward :size="16" /></Button>
    </div>
  </article>
</template>

<style scoped>
.occurrence-row { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); }.occurrence-main { min-width: 0; min-height: 44px; flex: 1; justify-content: flex-start; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; white-space: normal; }.occurrence-copy { min-width: 0; }.occurrence-row strong { display: block; font-size: var(--text-sm); font-weight: 600; }.occurrence-row small { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; color: var(--muted); font-size: var(--text-xs); }.occurrence-reasons { display: flex; flex-wrap: wrap; gap: 4px; }.occurrence-reasons small { padding: 2px 6px; border-radius: var(--radius-sm); background: var(--control-fill); }.actions { display: flex; gap: 2px; }.occurrence-action { width: max(36px, var(--icon-hit)); height: max(36px, var(--icon-hit)); padding: 0; background: var(--control-fill); color: var(--text); }.occurrence-main:focus-visible, .occurrence-action:focus-visible { outline: 0; box-shadow: var(--focus-ring); }.status-completed, .status-skipped { opacity: .62; }
@media (max-width: 819px) { .occurrence-action { width: max(44px, var(--icon-hit)); height: max(44px, var(--icon-hit)); } }
</style>
