<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, useId, watch } from 'vue'
import { releaseOverlay, useOverlay, type OverlayCloseReason, type OverlayKind } from './use-overlay'

const props = withDefaults(defineProps<{
  open: boolean
  kind?: Extract<OverlayKind, 'popover' | 'menu' | 'tooltip'>
  align?: 'start' | 'end'
  offset?: number
  matchTriggerWidth?: boolean
}>(), {
  kind: 'popover',
  align: 'start',
  offset: 8,
  matchTriggerWidth: false,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: [reason: OverlayCloseReason]
}>()

const id = `popover-${useId()}`
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const position = reactive({ top: '0px', left: '0px', minWidth: '' })
const registration = {
  id,
  kind: props.kind,
  trigger: null as HTMLElement | null,
  close: (reason: OverlayCloseReason) => requestClose(reason),
}
const { layerId, bringToFront } = useOverlay(registration)

const triggerProps = computed(() => ({
  'aria-expanded': props.open,
  'aria-controls': id,
  'aria-haspopup': props.kind === 'menu' ? 'menu' as const : 'dialog' as const,
  onClick: toggle,
}))

function rememberTrigger(event?: Event) {
  const current = event?.currentTarget
  if (current instanceof HTMLElement) trigger.value = current
  if (!trigger.value && document.activeElement instanceof HTMLElement) trigger.value = document.activeElement
  registration.trigger = trigger.value
}

function toggle(event?: Event) {
  rememberTrigger(event)
  if (props.open) requestClose('select')
  else emit('update:open', true)
}

function requestClose(reason: OverlayCloseReason) {
  releaseOverlay(layerId, reason === 'escape' || reason === 'select')
  emit('update:open', false)
  emit('close', reason)
}

function updatePosition() {
  if (!trigger.value || !panel.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const floating = panel.value.getBoundingClientRect()
  const viewportPadding = 8
  const spaceBelow = window.innerHeight - anchor.bottom - props.offset - viewportPadding
  const spaceAbove = anchor.top - props.offset - viewportPadding
  const openAbove = floating.height > spaceBelow && spaceAbove > spaceBelow
  const top = openAbove
    ? Math.max(viewportPadding, anchor.top - floating.height - props.offset)
    : Math.min(window.innerHeight - floating.height - viewportPadding, anchor.bottom + props.offset)
  const alignedLeft = props.align === 'end' ? anchor.right - floating.width : anchor.left
  const left = Math.min(
    Math.max(viewportPadding, alignedLeft),
    Math.max(viewportPadding, window.innerWidth - floating.width - viewportPadding),
  )
  position.top = `${Math.round(top)}px`
  position.left = `${Math.round(left)}px`
  position.minWidth = props.matchTriggerWidth ? `${Math.round(anchor.width)}px` : ''
}

function addPositionListeners() {
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
}

function removePositionListeners() {
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
}

watch(() => props.open, async (open) => {
  removePositionListeners()
  if (!open) {
    releaseOverlay(layerId)
    return
  }
  rememberTrigger()
  await nextTick()
  updatePosition()
  bringToFront()
  addPositionListeners()
}, { immediate: true })

onUnmounted(removePositionListeners)

defineExpose({ close: requestClose, updatePosition })
</script>

<template>
  <slot name="trigger" :open="open" :toggle="toggle" :trigger-props="triggerProps" />
  <Teleport defer to="#ui-overlay-host">
    <Transition name="popover">
      <div
        v-if="open"
        :id="id"
        ref="panel"
        class="popover-panel"
        :data-overlay-layer="layerId"
        :style="position"
      >
        <slot :close="requestClose" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.popover-panel {
  position: fixed;
  z-index: calc(var(--z-modal) + 1);
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow: auto;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  background: var(--material-regular);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(20px) saturate(118%);
  -webkit-backdrop-filter: blur(20px) saturate(118%);
  pointer-events: auto;
}

.popover-enter-active,
.popover-leave-active {
  transition: opacity var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease);
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

@media (prefers-reduced-transparency: reduce) {
  .popover-panel {
    background: var(--surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
