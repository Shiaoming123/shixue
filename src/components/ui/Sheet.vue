<script setup lang="ts">
import { ref } from 'vue'
import { useModalOverlay, type OverlayCloseReason } from './use-overlay'

const props = withDefaults(defineProps<{
  open: boolean
  label: string
  placement?: 'responsive' | 'right' | 'inline'
  size?: 'sm' | 'md' | 'lg'
  closeOnOutside?: boolean
}>(), {
  placement: 'responsive',
  size: 'md',
  closeOnOutside: true,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: [reason: OverlayCloseReason]
}>()

const panel = ref<HTMLElement | null>(null)
const modal = () => props.open && props.placement !== 'inline'
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
  <Teleport defer to="#ui-overlay-host" :disabled="placement === 'inline'">
    <Transition name="sheet-overlay">
      <div v-if="open" class="sheet-layer" :class="`sheet-layer--${placement}`">
        <section
          ref="panel"
          class="sheet-panel"
          :class="[`sheet-panel--${placement}`, `sheet-panel--${size}`]"
          :data-overlay-layer="placement === 'inline' ? undefined : layerId"
          :role="placement === 'inline' ? undefined : 'dialog'"
          :aria-modal="placement === 'inline' ? undefined : 'true'"
          :aria-label="placement === 'inline' ? undefined : label"
          :tabindex="placement === 'inline' ? undefined : -1"
        >
          <slot :close="requestClose" />
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
  backdrop-filter: blur(12px) saturate(118%);
  -webkit-backdrop-filter: blur(12px) saturate(118%);
  pointer-events: auto;
}

.sheet-panel {
  width: min(100%, 520px);
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-6);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-2xl);
  outline: 0;
  background: var(--material-regular);
  box-shadow: var(--shadow-lg);
}

.sheet-panel--sm { width: min(100%, 420px); }
.sheet-panel--lg { width: min(100%, 660px); }

.sheet-layer--right { align-items: stretch; justify-content: flex-end; padding: 0; }
.sheet-panel--right {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  max-height: none;
  padding: 0;
  border-width: 0 0 0 1px;
  border-radius: 0;
}

.sheet-layer--inline { position: static; display: contents; padding: 0; background: none; backdrop-filter: none; }
.sheet-panel--inline {
  width: 360px;
  height: 100%;
  max-height: none;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

@media (min-width: 820px) and (max-width: 1279px) {
  .sheet-panel--right { position: fixed; width: 360px; }
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
.sheet-overlay-leave-to .sheet-panel--responsive { transform: translateY(12px) scale(.99); }
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
    padding: 34px 20px calc(24px + env(safe-area-inset-bottom, 0px));
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
  .sheet-panel--right { width: 100%; border-left: 0; }
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
