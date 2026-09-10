<script setup lang="ts">
import { ref, watch } from 'vue'
import { useModalOverlay, type OverlayCloseReason } from './use-overlay'

const props = withDefaults(defineProps<{
  open: boolean
  label: string
  placement?: 'responsive' | 'right' | 'inline'
  size?: 'sm' | 'md' | 'lg'
  closeOnOutside?: boolean
  width?: number
  resizable?: boolean
}>(), {
  placement: 'responsive',
  size: 'md',
  closeOnOutside: true,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: [reason: OverlayCloseReason]
  resize: [width: number]
}>()

let resizeStart: { pointerId: number; x: number; width: number } | null = null
const clampWidth = (width: number) => Math.min(620, Math.max(340, Math.round(width)))
function beginResize(event: PointerEvent) {
  resizeStart = { pointerId: event.pointerId, x: event.clientX, width: props.width ?? 420 }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveResize(event: PointerEvent) {
  if (resizeStart?.pointerId === event.pointerId) emit('resize', clampWidth(resizeStart.width - event.clientX + resizeStart.x))
}
function endResize(event: PointerEvent) {
  if (resizeStart?.pointerId !== event.pointerId) return
  resizeStart = null
  try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId) } catch { /* capture may already be lost */ }
}
function resizeByKeyboard(event: KeyboardEvent) {
  const current = props.width ?? 420
  const next = event.key === 'Home' ? 340 : event.key === 'End' ? 620 : event.key === 'ArrowLeft' ? current + 8 : event.key === 'ArrowRight' ? current - 8 : null
  if (next === null) return
  event.preventDefault(); emit('resize', clampWidth(next))
}

const panel = ref<HTMLElement | null>(null)
const renderedPlacement = ref(props.placement)
watch(
  () => [props.open, props.placement] as const,
  ([open, placement]) => {
    if (open) renderedPlacement.value = placement
  },
  { flush: 'sync' },
)
const modal = () => props.open && renderedPlacement.value !== 'inline'
const { layerId } = useModalOverlay(modal, panel, requestClose, {
  kind: 'sheet',
  closeOnOutside: () => props.closeOnOutside,
})

function requestClose(reason: OverlayCloseReason) {
  emit('update:open', false)
  emit('close', reason)
}
</script>

<template>
  <Teleport defer to="#ui-overlay-host" :disabled="renderedPlacement === 'inline'">
    <Transition name="sheet-overlay" :css="renderedPlacement !== 'inline'">
      <div v-if="open" class="sheet-layer" :class="`sheet-layer--${renderedPlacement}`">
        <section
          ref="panel"
          class="sheet-panel"
          :class="[`sheet-panel--${renderedPlacement}`, `sheet-panel--${size}`]"
          :style="width && renderedPlacement !== 'responsive' ? { '--sheet-width': `${width}px` } : undefined"
          :data-overlay-layer="renderedPlacement === 'inline' ? undefined : layerId"
          :role="renderedPlacement === 'inline' ? undefined : 'dialog'"
          :aria-modal="renderedPlacement === 'inline' ? undefined : 'true'"
          :aria-label="renderedPlacement === 'inline' ? undefined : label"
          :tabindex="renderedPlacement === 'inline' ? undefined : -1"
        >
          <button v-if="resizable && renderedPlacement !== 'responsive'" class="sheet-resizer" type="button" role="separator" aria-orientation="vertical" aria-label="调整检查器宽度" :aria-valuenow="width ?? 420" aria-valuemin="340" aria-valuemax="620" @pointerdown.prevent="beginResize" @pointermove="moveResize" @pointerup="endResize" @pointercancel="endResize" @keydown="resizeByKeyboard" />
          <header v-if="$slots.header" class="sheet-header"><slot name="header" :close="requestClose" /></header>
          <div class="sheet-body"><slot :close="requestClose" /></div>
          <footer v-if="$slots.footer" class="sheet-footer"><slot name="footer" :close="requestClose" /></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-layer {
  position: fixed;
  z-index: var(--z-modal);
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  overflow: hidden;
  background: color-mix(in srgb, var(--text) 24%, transparent);
  pointer-events: auto;
}

.sheet-panel {
  width: min(100%, 600px);
  max-height: calc(100dvh - 40px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  outline: 0;
  background: var(--material-regular);
  box-shadow: var(--shadow-lg), var(--glass-highlight);
  -webkit-backdrop-filter: var(--glass-filter-strong);
  backdrop-filter: var(--glass-filter-strong);
}

.sheet-panel--sm { width: min(100%, 440px); }
.sheet-panel--lg { width: min(100%, 760px); }
.sheet-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 22px; }
.sheet-header { padding: 18px 22px 14px; border-bottom: 1px solid var(--hairline); }
.sheet-footer { padding: 14px 22px 18px; border-top: 1px solid var(--hairline); }

.sheet-layer--right { align-items: stretch; justify-content: flex-end; padding: 12px; }
.sheet-panel--right {
  position: fixed;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: var(--sheet-width, 360px);
  max-height: none;
  padding: 0;
  border-width: 1px;
  border-radius: 18px;
  box-shadow: var(--shadow-lg), var(--glass-highlight);
}
.sheet-panel--right.sheet-panel--lg { width: var(--sheet-width, 420px); }
.sheet-panel--right .sheet-body, .sheet-panel--inline .sheet-body { padding: 0; }

.sheet-layer--inline { position: static; display: contents; padding: 0; background: none; backdrop-filter: none; }
.sheet-panel--inline {
  position: relative;
  width: var(--sheet-width, 360px);
  height: 100%;
  max-height: none;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.sheet-panel--inline.sheet-panel--lg { width: var(--sheet-width, 420px); }
.sheet-resizer { position: absolute; z-index: 3; top: 0; bottom: 0; left: -4px; width: 8px; padding: 0; border: 0; background: transparent; cursor: col-resize; }
.sheet-resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: transparent; }
.sheet-resizer:hover::after, .sheet-resizer:focus-visible::after { background: var(--accent); }

@media (min-width: 820px) and (max-width: 1279px) {
  .sheet-panel--right { position: fixed; }
}

.sheet-overlay-enter-active,
.sheet-overlay-leave-active { transition: opacity var(--motion-base) var(--ease); }
.sheet-overlay-enter-active .sheet-panel,
.sheet-overlay-leave-active .sheet-panel { transition: opacity var(--motion-base) var(--ease), transform var(--motion-base) var(--ease); }
.sheet-overlay-enter-from,
.sheet-overlay-leave-to,
.sheet-overlay-enter-from .sheet-panel,
.sheet-overlay-leave-to .sheet-panel { opacity: 0; }
.sheet-overlay-enter-from .sheet-panel--responsive,
.sheet-overlay-leave-to .sheet-panel--responsive { transform: translateY(8px); }
.sheet-overlay-enter-from .sheet-panel--right,
.sheet-overlay-leave-to .sheet-panel--right { transform: translateX(20px); }

@media (max-width: 819px) {
  .sheet-layer--responsive { align-items: flex-end; padding: 0; }
  .sheet-panel--responsive,
  .sheet-panel--responsive.sheet-panel--sm,
  .sheet-panel--responsive.sheet-panel--lg {
    position: relative;
    width: 100%;
    max-height: 94dvh;
    padding: 0;
    border-width: 1px 0 0;
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
  }
  .sheet-panel--responsive::before {
    content: '';
    position: absolute;
    top: 9px;
    left: 50%;
    width: 36px;
    height: 5px;
    transform: translateX(-50%);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--muted) 32%, transparent);
  }
  .sheet-panel--responsive .sheet-body { padding: 34px 20px calc(24px + env(safe-area-inset-bottom, 0px)); }
  .sheet-panel--right { inset: auto 0 0; width: 100%; border-width: 1px 0 0; border-radius: var(--radius-2xl) var(--radius-2xl) 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .sheet-overlay-enter-active,
  .sheet-overlay-leave-active,
  .sheet-overlay-enter-active .sheet-panel,
  .sheet-overlay-leave-active .sheet-panel { transition: none; }
}

@media (prefers-reduced-transparency: reduce) {
  .sheet-layer { backdrop-filter: none; -webkit-backdrop-filter: none; }
  .sheet-panel { background: var(--surface); }
}

@media (forced-colors: active) {
  .sheet-panel { border: 1px solid CanvasText; }
}
</style>
