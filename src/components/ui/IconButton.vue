<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import Tooltip from './Tooltip.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  label: string
  variant?: 'quiet' | 'standard' | 'destructive'
  iconSize?: 16 | 18 | 20
  disabled?: boolean
  type?: 'button' | 'submit'
}>(), {
  variant: 'quiet',
  iconSize: 18,
  disabled: false,
  type: 'button',
})

const attrs = useAttrs()
function buttonBindings(triggerProps: Record<string, unknown>) {
  return { ...attrs, ...triggerProps }
}
function callerDescribedBy() {
  const value = attrs['aria-describedby']
  return value === undefined || value === null ? undefined : String(value)
}
const accessibleLabel = computed(() => {
  const label = String(props.label ?? '').trim()
  if (!label) throw new TypeError('IconButton requires a non-empty accessible label')
  return label
})
const glyphStyle = computed(() => ({ '--icon-button-glyph-size': `${props.iconSize}px` }))
</script>

<template>
  <Tooltip :label="accessibleLabel" :described-by="callerDescribedBy()">
    <template #trigger="{ triggerProps }">
      <button
        v-bind="buttonBindings(triggerProps)"
        class="icon-button"
        :class="`icon-button--${variant}`"
        :aria-label="accessibleLabel"
        :disabled="disabled"
        :type="type"
      >
        <span class="icon-button__glyph" :style="glyphStyle" aria-hidden="true"><slot /></span>
      </button>
    </template>
  </Tooltip>
</template>

<style scoped>
.icon-button {
  display: inline-grid;
  place-items: center;
  flex: 0 0 44px;
  inline-size: 44px;
  block-size: 44px;
  min-inline-size: 44px;
  min-block-size: 44px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text);
  font: inherit;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease),
    border-color var(--motion-fast) var(--ease),
    color var(--motion-fast) var(--ease),
    opacity var(--motion-fast) var(--ease),
    transform var(--motion-fast) var(--ease);
}

.icon-button__glyph {
  display: inline-grid;
  place-items: center;
  inline-size: var(--icon-button-glyph-size);
  block-size: var(--icon-button-glyph-size);
  pointer-events: none;
}

.icon-button__glyph :deep(svg) {
  inline-size: 100%;
  block-size: 100%;
}

.icon-button--quiet {
  background: transparent;
}

.icon-button--quiet:hover:not(:disabled) {
  background: var(--surface-alt);
}

.icon-button--standard {
  border-color: var(--border);
  background: var(--control-fill);
}

.icon-button--standard:hover:not(:disabled) {
  background: var(--surface-alt);
}

.icon-button--destructive {
  background: transparent;
  color: var(--danger);
}

.icon-button--destructive:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.icon-button:active:not(:disabled) {
  opacity: var(--press-opacity);
  transform: scale(var(--press-scale));
}

.icon-button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
