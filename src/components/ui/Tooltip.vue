<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from 'vue'
import Popover from './Popover.vue'
import type { OverlayCloseReason } from './use-overlay'

const props = withDefaults(defineProps<{
  label: string
  delay?: number
  disabled?: boolean
  align?: 'start' | 'end'
  offset?: number
  describedBy?: string
}>(), {
  delay: 500,
  disabled: false,
  align: 'start',
  offset: 6,
})

const open = ref(false)
const tooltipId = `tooltip-${useId()}`
let hovered = false
let focused = false
let openTimer: ReturnType<typeof setTimeout> | undefined

type Toggle = (event?: Event) => void

function clearOpenTimer() {
  if (openTimer === undefined) return
  clearTimeout(openTimer)
  openTimer = undefined
}

function normalizedLabel() {
  const label = props.label.trim()
  if (!label) throw new TypeError('Tooltip requires a non-empty label')
  return label
}

function describedByIds() {
  const existing = props.describedBy?.trim()
  if (!open.value) return existing || undefined
  return existing ? `${existing} ${tooltipId}` : tooltipId
}

function openFromPointer(event: MouseEvent, toggle: Toggle) {
  hovered = true
  clearOpenTimer()
  if (props.disabled || open.value) return
  const trigger = event.currentTarget
  openTimer = setTimeout(() => {
    openTimer = undefined
    if (!hovered || props.disabled || open.value) return
    toggle({ currentTarget: trigger } as unknown as Event)
  }, Math.max(0, props.delay))
}

function closeFromPointer() {
  hovered = false
  clearOpenTimer()
  if (!focused) open.value = false
}

function openFromFocus(event: FocusEvent, toggle: Toggle) {
  focused = true
  clearOpenTimer()
  if (!props.disabled && !open.value) toggle(event)
}

function closeFromFocus() {
  focused = false
  clearOpenTimer()
  if (!hovered) open.value = false
}

function closeFromKeyboard(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  clearOpenTimer()
  hovered = false
  focused = false
  open.value = false
}

function handlePopoverClose(reason: OverlayCloseReason) {
  clearOpenTimer()
  if (reason === 'escape') {
    hovered = false
    focused = false
  }
  open.value = false
}

function tooltipTriggerProps(toggle: Toggle) {
  return {
    'aria-describedby': describedByIds(),
    onMouseenter: (event: MouseEvent) => openFromPointer(event, toggle),
    onMouseleave: closeFromPointer,
    onFocus: (event: FocusEvent) => openFromFocus(event, toggle),
    onBlur: closeFromFocus,
    onKeydown: closeFromKeyboard,
  }
}

watch(() => props.disabled, (disabled) => {
  if (!disabled) return
  clearOpenTimer()
  open.value = false
})

onBeforeUnmount(clearOpenTimer)
</script>

<template>
  <Popover v-model:open="open" kind="tooltip" :align="align" :offset="offset" @close="handlePopoverClose">
    <template #trigger="{ toggle }">
      <slot name="trigger" :open="open" :trigger-props="tooltipTriggerProps(toggle)" />
    </template>
    <span :id="tooltipId" class="tooltip-content" role="tooltip">{{ normalizedLabel() }}</span>
  </Popover>
</template>

<style scoped>
:deep(.popover-panel) {
  max-width: min(260px, calc(100vw - 16px));
  overflow: visible;
  border-color: transparent;
  border-radius: var(--radius-sm);
  background: var(--text);
  color: var(--surface);
  box-shadow: var(--shadow-md);
  pointer-events: none;
}

.tooltip-content {
  display: block;
  padding: 6px 8px;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: 1.35;
  overflow-wrap: anywhere;
}
</style>
