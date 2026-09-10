<script setup lang="ts">
import { ref, useId } from 'vue'
import { X } from '@lucide/vue'
import { useModalOverlay, type OverlayCloseReason } from './use-overlay'
import IconButton from './IconButton.vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  role?: 'dialog' | 'alertdialog'
  size?: 'sm' | 'md' | 'lg' | 'xl'
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
const { layerId } = useModalOverlay(() => props.open, panel, requestClose, {
  closeOnOutside: () => props.closeOnOutside,
})

function requestClose(reason: OverlayCloseReason = 'select') {
  emit('update:open', false)
  emit('close', reason)
}
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
        >
          <header class="dialog-header">
            <div>
              <h2 :id="titleId">{{ title }}</h2>
              <p v-if="description" :id="descriptionId">{{ description }}</p>
            </div>
            <IconButton v-if="showClose" class="dialog-close" label="关闭" @click="requestClose('select')"><X :size="18" /></IconButton>
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
  pointer-events: auto;
}

.dialog-panel {
  width: min(100%, 480px);
  max-height: calc(100dvh - 40px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-xl);
  outline: 0;
  background: var(--material-regular);
  box-shadow: var(--shadow-lg);
}

.dialog-panel--sm { width: min(100%, 400px); }
.dialog-panel--lg { width: min(100%, 680px); }
.dialog-panel--xl { width: min(100%, 920px); }

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--hairline);
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
  margin: -10px -10px 0 0;
}

.dialog-body {
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px;
  overscroll-behavior: contain;
  color: var(--text);
  font-size: var(--text-base);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: 14px 22px 18px;
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
  transform: translateY(8px);
}

@media (max-width: 599px) {
  .dialog-backdrop {
    align-items: end;
    padding: 0;
  }

  .dialog-panel,
  .dialog-panel--sm,
  .dialog-panel--lg,
  .dialog-panel--xl {
    width: 100%;
    max-height: 92dvh;
    padding: 0;
    border-width: 1px 0 0;
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .dialog-backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; }
  .dialog-panel { background: var(--surface); }
}
</style>
