<script setup lang="ts">
/**
 * Button 按钮 —— 设计系统基础组件。
 *
 * 角色：prominent / standard / quiet / destructive。
 * primary / secondary / ghost / danger 保留为兼容别名。
 *
 * 尺寸：sm / md（默认）
 * 语义：按钮是唯一「可点击动作」入口，文案用祈使句（如「保存更改」而非「提交」）。
 */
withDefaults(
  defineProps<{
    variant?: 'prominent' | 'standard' | 'quiet' | 'destructive' | 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
    loading?: boolean
    icon?: boolean
    type?: 'button' | 'submit'
    /** 图标的视觉描述（无障碍），有 icon 时建议填写 */
    title?: string
  }>(),
  { variant: 'standard', size: 'md', disabled: false, loading: false, icon: false, type: 'button' },
)

defineEmits<{ click: [e: MouseEvent] }>()
</script>

<template>
  <button
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'btn--icon': icon, 'btn--loading': loading }]"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
    :type="type"
    :title="title"
    @click="$emit('click', $event)"
  >
    <span class="btn__content"><slot /></span>
    <span v-if="loading" class="btn__spinner" aria-hidden="true" />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-family: inherit;
  font-weight: var(--font-medium);
  line-height: 1;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--motion-fast) var(--ease),
    border-color var(--motion-fast) var(--ease),
    opacity var(--motion-fast) var(--ease),
    transform var(--motion-fast) var(--ease);
}

.btn:focus-visible {
  outline: 0;
  box-shadow: var(--focus-ring);
}

.btn:active:not(:disabled) {
  opacity: var(--press-opacity);
  transform: scale(var(--press-scale));
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 尺寸 */
.btn--md {
  min-height: var(--control-hit);
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-base);
}
.btn--sm {
  min-height: max(28px, var(--control-hit));
  padding: 4px var(--space-3);
  font-size: var(--text-sm);
}

.btn--icon {
  width: var(--icon-hit);
  min-width: var(--icon-hit);
  height: var(--icon-hit);
  min-height: var(--icon-hit);
  padding: 0;
}

.btn__content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: inherit;
}

.btn--loading {
  position: relative;
}

.btn--loading .btn__content {
  opacity: 0;
}

.btn__spinner {
  position: absolute;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-pill);
  animation: btn-spin 0.8s linear infinite;
}

@keyframes btn-spin {
  to { transform: rotate(360deg); }
}

/* 变体 */
.btn--prominent,
.btn--primary {
  background: var(--accent);
  color: var(--accent-text);
}
.btn--prominent:hover:not(:disabled),
.btn--primary:hover:not(:disabled) {
  filter: brightness(0.96);
}

.btn--standard,
.btn--secondary {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}
.btn--standard:hover:not(:disabled),
.btn--secondary:hover:not(:disabled) {
  background: var(--surface-alt);
}

.btn--quiet,
.btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text);
}
.btn--quiet:hover:not(:disabled),
.btn--ghost:hover:not(:disabled) {
  background: var(--surface-alt);
}

.btn--destructive,
.btn--danger {
  background: var(--danger);
  color: var(--danger-text);
}
.btn--destructive:hover:not(:disabled),
.btn--danger:hover:not(:disabled) {
  filter: brightness(0.94);
}
</style>
