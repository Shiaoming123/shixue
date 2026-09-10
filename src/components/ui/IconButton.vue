<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import Button from './Button.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    ariaLabel?: string
    title?: string
    variant?: 'prominent' | 'standard' | 'quiet' | 'destructive' | 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
    loading?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'quiet', size: 'md', disabled: false, loading: false, type: 'button' },
)

const attrs = useAttrs()
const label = computed(() => {
  const value = props.ariaLabel?.trim() ? props.ariaLabel : attrs['aria-label']
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('IconButton requires an accessible name')
  return value.trim()
})

defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <Button
    v-bind="$attrs"
    icon
    :aria-label="label"
    :title="title ?? label"
    :variant="variant"
    :size="size"
    :disabled="disabled"
    :loading="loading"
    :type="type"
    @click="$emit('click', $event)"
  >
    <slot />
  </Button>
</template>
