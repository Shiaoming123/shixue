<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean
  label: string
  description?: string
  disabled?: boolean
}>(), {
  description: '',
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [checked: boolean] }>()
</script>

<template>
  <label class="switch" :class="{ disabled }">
    <input
      class="ui-native-underlay"
      type="checkbox"
      role="switch"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="label"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span v-if="$slots.leading" class="switch-leading" aria-hidden="true"><slot name="leading" /></span>
    <span class="switch-copy"><strong>{{ label }}</strong><small v-if="description">{{ description }}</small></span>
    <span class="switch-track" aria-hidden="true"><i /></span>
  </label>
</template>

<style scoped>
.switch {
  position: relative;
  width: 100%;
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 2px;
  border-bottom: 1px solid var(--border);
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

.switch-leading {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
}

.switch-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.switch-copy strong {
  font-size: var(--text-base);
  font-weight: 600;
}

.switch-copy small {
  color: var(--muted);
  font-size: 10px;
}

.switch-track {
  width: 34px;
  height: 20px;
  display: block;
  flex: 0 0 34px;
  padding: 2px;
  border-radius: var(--radius-full);
  background: var(--border);
  transition: background var(--motion-fast) var(--ease);
}

.switch-track i {
  width: 16px;
  height: 16px;
  display: block;
  border-radius: var(--radius-full);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: transform var(--motion-fast) var(--ease-spring);
}

.ui-native-underlay:checked ~ .switch-track {
  background: var(--accent);
}

.ui-native-underlay:checked ~ .switch-track i {
  transform: translateX(14px);
}

.ui-native-underlay:focus-visible ~ .switch-track {
  outline: 2px solid color-mix(in srgb, var(--accent) 88%, white);
  outline-offset: 3px;
}

.switch.disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
