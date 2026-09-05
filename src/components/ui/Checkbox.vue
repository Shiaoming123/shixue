<script setup lang="ts">
import Icon from '../Icon.vue'

withDefaults(defineProps<{
  modelValue: boolean
  label?: string
  accessibleLabel?: string
  disabled?: boolean
  indeterminate?: boolean
  shape?: 'square' | 'round'
}>(), {
  label: '',
  accessibleLabel: '',
  disabled: false,
  indeterminate: false,
  shape: 'square',
})

const emit = defineEmits<{ 'update:modelValue': [checked: boolean] }>()

function onChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <label class="checkbox" :class="[`checkbox--${shape}`, { disabled }]">
    <input
      class="ui-native-underlay"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :indeterminate="indeterminate"
      :aria-label="accessibleLabel || label"
      @change="onChange"
    />
    <span class="checkbox-mark" aria-hidden="true">
      <Icon v-if="modelValue && !indeterminate" name="circle-check" :size="17" :stroke-width="2.2" />
      <i v-else-if="indeterminate" />
    </span>
    <span v-if="label || $slots.default" class="checkbox-label"><slot>{{ label }}</slot></span>
  </label>
</template>

<style scoped>
.checkbox {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text);
  cursor: pointer;
}

.ui-native-underlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.checkbox-mark {
  width: 22px;
  height: 22px;
  display: grid;
  flex: 0 0 22px;
  place-items: center;
  border: 1.5px solid color-mix(in srgb, var(--muted) 78%, transparent);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: transparent;
  transition: border-color var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease);
}

.checkbox--round .checkbox-mark {
  border-radius: var(--radius-full);
}

.ui-native-underlay:checked + .checkbox-mark,
.ui-native-underlay:indeterminate + .checkbox-mark {
  border-color: var(--success);
  background: var(--success);
  color: var(--accent-text);
}

.ui-native-underlay:focus-visible + .checkbox-mark {
  outline: 2px solid color-mix(in srgb, var(--accent) 88%, white);
  outline-offset: 3px;
}

.checkbox-mark i {
  width: 10px;
  height: 2px;
  border-radius: var(--radius-full);
  background: currentColor;
}

.checkbox-label {
  font-size: var(--text-base);
}

.checkbox.disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
