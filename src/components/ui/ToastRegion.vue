<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  message: string
  actionLabel?: string
  duration?: number
  raised?: boolean
}>(), {
  actionLabel: '',
  duration: 3200,
  raised: false,
})

const emit = defineEmits<{ action: []; dismiss: [] }>()
let timer: ReturnType<typeof setTimeout> | undefined
let startedAt = 0
const remaining = ref(props.duration)

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = undefined
}

function schedule() {
  clearTimer()
  if (!props.message || props.actionLabel || props.duration <= 0) return
  startedAt = Date.now()
  timer = setTimeout(() => emit('dismiss'), remaining.value)
}

function pause() {
  if (!timer) return
  remaining.value = Math.max(0, remaining.value - (Date.now() - startedAt))
  clearTimer()
}

function resume() {
  if (remaining.value > 0) schedule()
}

function onFocusout(event: FocusEvent) {
  const current = event.currentTarget
  if (current instanceof HTMLElement && event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) return
  resume()
}

watch(() => [props.message, props.duration, props.actionLabel] as const, ([message, duration]) => {
  clearTimer()
  remaining.value = duration
  if (message) schedule()
}, { immediate: true })

onUnmounted(clearTimer)
</script>

<template>
  <Teleport defer to="#ui-overlay-host">
    <Transition name="toast">
      <div
        v-if="message"
        class="toast-region"
        :class="{ raised }"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        @mouseenter="pause"
        @mouseleave="resume"
        @focusin="pause"
        @focusout="onFocusout"
      >
        <span>{{ message }}</span>
        <button v-if="actionLabel" class="toast-action" type="button" @click="emit('action')">{{ actionLabel }}</button>
        <button v-if="actionLabel" class="toast-dismiss" type="button" aria-label="关闭通知" @click="emit('dismiss')">×</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-region {
  position: fixed;
  z-index: var(--z-toast);
  left: 50%;
  bottom: var(--space-6);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: calc(100vw - 32px);
  padding: var(--space-2) 9px var(--space-2) var(--space-4);
  border: 1px solid color-mix(in srgb, var(--surface) 14%, transparent);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--text) 88%, transparent);
  color: var(--bg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px) saturate(118%);
  -webkit-backdrop-filter: blur(18px) saturate(118%);
  font-size: var(--text-sm);
  pointer-events: auto;
}

.toast-region > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-region button {
  min-height: max(30px, var(--control-hit));
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--bg) 16%, transparent);
  color: var(--bg);
  font-size: var(--text-sm);
  font-weight: 650;
}

.toast-dismiss {
  min-width: max(30px, var(--icon-hit));
  padding: 0 !important;
  background: transparent !important;
  font-size: var(--text-lg) !important;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--motion-base) var(--ease), transform var(--motion-base) var(--ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px) scale(0.98);
}

@media (max-width: 799px) {
  .toast-region { bottom: calc(92px + env(safe-area-inset-bottom, 0px)); }
  .toast-region.raised { bottom: calc(148px + env(safe-area-inset-bottom, 0px)); }
}

@media (prefers-reduced-transparency: reduce) {
  .toast-region {
    background: var(--text);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
