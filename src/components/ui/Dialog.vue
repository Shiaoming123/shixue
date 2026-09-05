<script setup lang="ts">
import { nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { releaseOverlay, useOverlay, type OverlayCloseReason } from './use-overlay'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  role?: 'dialog' | 'alertdialog'
  size?: 'sm' | 'md' | 'lg'
  closeOnOutside?: boolean
  showClose?: boolean
}>(), {
  description: '',
  role: 'dialog',
  size: 'md',
  closeOnOutside: true,
  showClose: true,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: [reason: OverlayCloseReason]
}>()

const id = `dialog-${useId()}`
const titleId = `${id}-title`
const descriptionId = `${id}-description`
const panel = ref<HTMLElement | null>(null)
let restoreTarget: HTMLElement | null = null
const registration = {
  id,
  kind: 'dialog' as const,
  trigger: null as HTMLElement | null,
  close(reason: OverlayCloseReason) {
    if (reason === 'outside' && !props.closeOnOutside) {
      bringToFront()
      return
    }
    requestClose(reason)
  },
}
const { layerId, bringToFront } = useOverlay(registration)

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

function focusInitial() {
  const autofocus = panel.value?.querySelector<HTMLElement>('[autofocus]')
  ;(autofocus ?? focusableElements()[0] ?? panel.value)?.focus({ preventScroll: true })
}

function restoreFocus() {
  const target = restoreTarget
  restoreTarget = null
  nextTick(() => target?.focus({ preventScroll: true }))
}

function requestClose(reason: OverlayCloseReason = 'select') {
  releaseOverlay(layerId)
  emit('update:open', false)
  emit('close', reason)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    requestClose('escape')
    return
  }
  if (event.key !== 'Tab') return
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

watch(() => props.open, async (open, previous) => {
  if (open) {
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    registration.trigger = restoreTarget
    await nextTick()
    bringToFront()
    focusInitial()
  } else if (previous) {
    releaseOverlay(layerId)
    restoreFocus()
  }
}, { immediate: true })

onUnmounted(() => releaseOverlay(layerId))
</script>

<template>
  <Teleport defer to="#ui-overlay-host">
    <Transition name="dialog">
      <div v-if="open" class="dialog-backdrop">
        <section
          ref="panel"
          class="dialog-panel"
          :class="`dialog-panel--${size}`"
          :data-overlay-layer="layerId"
          :role="role"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="description ? descriptionId : undefined"
          tabindex="-1"
          @keydown="onKeydown"
        >
          <header class="dialog-header">
            <div>
              <h2 :id="titleId">{{ title }}</h2>
              <p v-if="description" :id="descriptionId">{{ description }}</p>
            </div>
            <button v-if="showClose" type="button" class="dialog-close" aria-label="关闭" @click="requestClose('select')">×</button>
          </header>
          <div v-if="$slots.default" class="dialog-body"><slot /></div>
          <footer v-if="$slots.footer" class="dialog-footer"><slot name="footer" :close="requestClose" /></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  z-index: var(--z-modal);
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-5);
  background: color-mix(in srgb, var(--text) 24%, transparent);
  backdrop-filter: blur(12px) saturate(118%);
  -webkit-backdrop-filter: blur(12px) saturate(118%);
  pointer-events: auto;
}

.dialog-panel {
  width: min(100%, 480px);
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  padding: var(--space-6);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-xl);
  outline: 0;
  background: var(--material-regular);
  box-shadow: var(--shadow-lg);
}

.dialog-panel--sm { width: min(100%, 360px); }
.dialog-panel--lg { width: min(100%, 620px); }

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.dialog-header h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}

.dialog-header p {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--text-sm);
  line-height: 1.55;
}

.dialog-close {
  width: max(34px, var(--icon-hit));
  height: max(34px, var(--icon-hit));
  display: grid;
  flex: 0 0 max(34px, var(--icon-hit));
  place-items: center;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--control-fill);
  color: var(--muted);
  font-size: var(--text-xl);
  font-weight: var(--font-regular);
  line-height: 1;
}

.dialog-body {
  margin-top: var(--space-4);
  color: var(--text);
  font-size: var(--text-base);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--hairline);
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--motion-base) var(--ease);
}

.dialog-enter-active .dialog-panel,
.dialog-leave-active .dialog-panel {
  transition: opacity var(--motion-base) var(--ease), transform var(--motion-base) var(--ease);
}

.dialog-enter-from,
.dialog-leave-to,
.dialog-enter-from .dialog-panel,
.dialog-leave-to .dialog-panel {
  opacity: 0;
}

.dialog-enter-from .dialog-panel,
.dialog-leave-to .dialog-panel {
  transform: translateY(8px) scale(0.99);
}

@media (max-width: 599px) {
  .dialog-backdrop {
    align-items: end;
    padding: 0;
  }

  .dialog-panel,
  .dialog-panel--sm,
  .dialog-panel--lg {
    width: 100%;
    max-height: 92dvh;
    padding: var(--space-5) var(--space-5) calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
    border-width: 1px 0 0;
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .dialog-backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; }
  .dialog-panel { background: var(--surface); }
}
</style>
