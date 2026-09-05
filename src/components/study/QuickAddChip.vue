<script setup lang="ts">
import { AlertCircle, X } from '@lucide/vue'
import type { QuickAddCandidateKind } from '../../domain/quick-add/types'

const props = defineProps<{
  kind: QuickAddCandidateKind
  label: string
  ambiguous?: boolean
  active?: boolean
  triggerProps?: Record<string, unknown>
}>()

const emit = defineEmits<{ edit: [event: MouseEvent]; remove: [] }>()
</script>

<template>
  <span class="quick-add-chip" :class="{ ambiguous, active }">
    <button v-bind="triggerProps" type="button" class="chip-main" :aria-label="`${ambiguous ? '确认' : '编辑'}${label}`" @click="emit('edit', $event)">
      <AlertCircle v-if="ambiguous" :size="14" aria-hidden="true" />
      <span>{{ label }}</span>
    </button>
    <button type="button" class="chip-remove" :aria-label="`移除${label}`" @click="emit('remove')"><X :size="13" aria-hidden="true" /></button>
  </span>
</template>

<style scoped>
.quick-add-chip { min-height: 32px; display: inline-flex; align-items: stretch; overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--hairline)); border-radius: 999px; background: color-mix(in srgb, var(--accent) 7%, var(--surface)); color: var(--accent); }
.quick-add-chip.ambiguous { border-color: color-mix(in srgb, var(--warning) 56%, var(--border)); background: color-mix(in srgb, var(--warning) 8%, var(--surface)); color: var(--warning); }
.quick-add-chip.active { box-shadow: var(--focus-ring); }
.quick-add-chip button { min-width: 32px; min-height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; color: inherit; font: inherit; }
.chip-main { gap: var(--space-1); padding: 0 var(--space-2) 0 var(--space-3); font-size: var(--text-xs); }
.chip-remove { border-left: 1px solid color-mix(in srgb, currentColor 16%, transparent) !important; }
.quick-add-chip button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
@media (max-width: 819px) {
  .quick-add-chip, .quick-add-chip button { min-height: 44px; }
  .quick-add-chip button { min-width: 44px; }
}
</style>
