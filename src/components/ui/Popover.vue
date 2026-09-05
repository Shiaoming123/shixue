<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue'
import { releaseOverlay, useOverlay, type OverlayCloseReason, type OverlayKind } from './use-overlay'

const props = withDefaults(defineProps<{
  open: boolean
  kind?: Extract<OverlayKind, 'popover' | 'menu' | 'tooltip'>
  align?: 'start' | 'end'
  offset?: number
  matchTriggerWidth?: boolean
  mobileSheet?: boolean
  inline?: boolean
}>(), {
  kind: 'popover',
  align: 'start',
  offset: 8,
  matchTriggerWidth: false,
  mobileSheet: false,
  inline: false,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: [reason: OverlayCloseReason]
}>()

const id = `popover-${useId()}`
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const mobileSheetActive = ref(false)
const position = reactive({ top: '0px', left: '0px', minWidth: '' })
let compactMedia: MediaQueryList | undefined
const registration = {
  id,
  kind: props.kind as OverlayKind,
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
  const restoreAfterPointer = (mobileSheetActive.value || props.inline) && reason === 'outside'
  releaseOverlay(layerId, !restoreAfterPointer && (reason === 'escape' || reason === 'select'))
  emit('update:open', false)
  emit('close', reason)
  if (restoreAfterPointer) {
    const target = trigger.value
    nextTick(() => requestAnimationFrame(() => target?.focus({ preventScroll: true })))
  }
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

function syncMobileSheet() {
  mobileSheetActive.value = Boolean(props.mobileSheet && compactMedia?.matches)
  registration.kind = mobileSheetActive.value ? 'sheet' : props.kind
}

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements() {
  return panel.value
    ? Array.from(panel.value.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hidden)
    : []
}

function onKeydown(event: KeyboardEvent) {
  if (!mobileSheetActive.value || event.key !== 'Tab') return
  const focusable = focusableElements()
  if (!focusable.length) {
    event.preventDefault()
    panel.value?.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !panel.value?.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => [props.open, mobileSheetActive.value] as const, async ([open, sheet]) => {
  removePositionListeners()
  if (!open) {
    releaseOverlay(layerId)
    return
  }
  rememberTrigger()
  await nextTick()
  if (!sheet && !props.inline) updatePosition()
  bringToFront()
  if (sheet) (focusableElements()[0] ?? panel.value)?.focus({ preventScroll: true })
  else if (!props.inline) addPositionListeners()
}, { immediate: true })

onMounted(() => {
  if (!props.mobileSheet) return
  compactMedia = window.matchMedia('(max-width: 819px)')
  syncMobileSheet()
  compactMedia.addEventListener('change', syncMobileSheet)
})

onUnmounted(() => {
  removePositionListeners()
  compactMedia?.removeEventListener('change', syncMobileSheet)
})

defineExpose({ close: requestClose, updatePosition })
</script>

<template>
  <slot name="trigger" :open="open" :toggle="toggle" :trigger-props="triggerProps" />
  <Teleport defer to="#ui-overlay-host" :disabled="inline">
    <Transition name="popover">
      <div v-if="open" class="popover-layer" :class="{ 'popover-layer--mobile-sheet': mobileSheetActive, 'popover-layer--inline': inline }">
        <div
          :id="id"
          ref="panel"
          class="popover-panel"
          :class="{ 'popover-panel--mobile-sheet': mobileSheetActive, 'popover-panel--inline': inline }"
          :data-overlay-layer="layerId"
          :style="mobileSheetActive || inline ? undefined : position"
          :tabindex="mobileSheetActive ? -1 : undefined"
          @keydown="onKeydown"
        >
          <slot :close="requestClose" :modal="mobileSheetActive" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.popover-layer {
  position: fixed;
  z-index: calc(var(--z-modal) + 1);
  inset: 0;
  pointer-events: none;
}

.popover-layer--mobile-sheet {
  background: color-mix(in srgb, var(--text) 24%, transparent);
  backdrop-filter: blur(12px) saturate(118%);
  -webkit-backdrop-filter: blur(12px) saturate(118%);
  pointer-events: auto;
}

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

.popover-enter-active .popover-panel,
.popover-leave-active .popover-panel {
  transition: opacity var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease);
}

.popover-layer--inline {
  position: static;
  pointer-events: auto;
}

.popover-panel--inline {
  position: static;
  width: 100%;
  max-width: none;
  margin-top: var(--space-1);
}

.popover-enter-from .popover-panel,
.popover-leave-to .popover-panel {
  opacity: 0;
  transform: translateY(4px);
}

@media (max-width: 819px) {
  .popover-panel--mobile-sheet {
    top: auto !important;
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    left: 12px !important;
    width: auto;
    max-width: none;
    max-height: calc(100dvh - 32px - env(safe-area-inset-bottom, 0px));
    border-radius: var(--radius-2xl);
    background: var(--surface);
  }
}

@media (max-width: 819px) {
  .popover-panel--mobile-sheet {
    bottom: calc(84px + env(safe-area-inset-bottom, 0px));
    max-height: calc(100dvh - 104px - env(safe-area-inset-bottom, 0px));
  }
}

@media (prefers-reduced-transparency: reduce) {
  .popover-layer--mobile-sheet { backdrop-filter: none; -webkit-backdrop-filter: none; }
  .popover-panel {
    background: var(--surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
