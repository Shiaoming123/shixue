<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import Icon from '../Icon.vue'
import Popover from './Popover.vue'

export interface ListboxOption {
  value: string
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string
  options: readonly ListboxOption[]
  label: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  variant?: 'default' | 'compact' | 'title'
}>(), {
  placeholder: '请选择',
  disabled: false,
  required: false,
  variant: 'default',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const id = `listbox-${useId()}`
const open = ref(false)
const activeIndex = ref(-1)
const list = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const selectedIndex = computed(() => props.options.findIndex((option) => option.value === props.modelValue))
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label ?? props.placeholder)
const activeId = computed(() => activeIndex.value >= 0 ? `${id}-option-${activeIndex.value}` : undefined)

function enabledIndices() {
  return props.options.flatMap((option, index) => option.disabled ? [] : [index])
}

function initialIndex(direction: 1 | -1 = 1) {
  if (selectedIndex.value >= 0 && !props.options[selectedIndex.value]?.disabled) return selectedIndex.value
  const indices = enabledIndices()
  return direction === 1 ? indices[0] ?? -1 : indices[indices.length - 1] ?? -1
}

async function setOpen(value: boolean) {
  if (props.disabled) return
  open.value = value
  if (!value) return
  activeIndex.value = initialIndex()
  await nextTick()
  list.value?.focus({ preventScroll: true })
  scrollActiveIntoView()
}

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) nextTick(() => trigger.value?.focus({ preventScroll: true }))
}

function select(index: number) {
  const option = props.options[index]
  if (!option || option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  close(true)
}

function move(step: 1 | -1) {
  const indices = enabledIndices()
  if (!indices.length) return
  const current = indices.indexOf(activeIndex.value)
  const next = current < 0
    ? (step === 1 ? 0 : indices.length - 1)
    : (current + step + indices.length) % indices.length
  activeIndex.value = indices[next]
  scrollActiveIntoView()
}

function goToBoundary(boundary: 'first' | 'last') {
  const indices = enabledIndices()
  activeIndex.value = boundary === 'first' ? indices[0] ?? -1 : indices[indices.length - 1] ?? -1
  scrollActiveIntoView()
}

function scrollActiveIntoView() {
  nextTick(() => document.getElementById(activeId.value ?? '')?.scrollIntoView({ block: 'nearest' }))
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    void setOpen(true).then(() => {
      activeIndex.value = initialIndex(event.key === 'ArrowDown' ? 1 : -1)
      scrollActiveIntoView()
    })
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    void setOpen(true).then(() => goToBoundary(event.key === 'Home' ? 'first' : 'last'))
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    void setOpen(!open.value)
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  }
}

function onListKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    goToBoundary(event.key === 'Home' ? 'first' : 'last')
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    select(activeIndex.value)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  }
}

watch(() => props.options.length, () => {
  if (activeIndex.value >= props.options.length) activeIndex.value = initialIndex()
})
</script>

<template>
  <span class="listbox" :class="[`listbox--${variant}`, { 'listbox--disabled': disabled }]">
    <Popover :open="open" kind="menu" match-trigger-width @update:open="setOpen">
      <template #trigger="{ triggerProps }">
        <button
          v-bind="triggerProps"
          :id="`${id}-trigger`"
          ref="trigger"
          type="button"
          class="listbox-trigger"
          :class="{ 'listbox-trigger--placeholder': selectedIndex < 0 }"
          :aria-label="label"
          aria-haspopup="listbox"
          data-ui-control="listbox"
          :aria-required="required || undefined"
          :disabled="disabled"
          @keydown="onTriggerKeydown"
        >
          <span>{{ selectedLabel }}</span>
          <i aria-hidden="true" />
        </button>
      </template>

      <div
        ref="list"
        class="listbox-options"
        role="listbox"
        tabindex="-1"
        :aria-label="label"
        :aria-labelledby="`${id}-trigger`"
        :aria-activedescendant="activeId"
        @keydown="onListKeydown"
      >
        <div
          v-for="(option, index) in options"
          :id="`${id}-option-${index}`"
          :key="option.value"
          class="listbox-option"
          :class="{ active: activeIndex === index, selected: modelValue === option.value, disabled: option.disabled }"
          role="option"
          :aria-selected="modelValue === option.value"
          :aria-disabled="option.disabled || undefined"
          @click="select(index)"
          @pointermove="option.disabled ? undefined : (activeIndex = index)"
        >
          <span>{{ option.label }}</span>
          <Icon v-if="modelValue === option.value" name="circle-check" :size="16" :stroke-width="1.8" />
        </div>
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.listbox {
  display: block;
  min-width: 0;
}

.listbox-trigger {
  width: 100%;
  min-height: 44px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  background: var(--control-fill);
  color: var(--text);
  font-size: var(--text-base);
  text-align: left;
}

.listbox-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.listbox-trigger > i {
  width: 7px;
  height: 7px;
  justify-self: end;
  transform: translateY(-2px) rotate(45deg);
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  color: var(--muted);
  transition: transform var(--motion-fast) var(--ease);
}

.listbox-trigger[aria-expanded='true'] {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: var(--focus-ring);
}

.listbox-trigger[aria-expanded='true'] > i {
  transform: translateY(2px) rotate(225deg);
}

.listbox-trigger--placeholder {
  color: var(--muted);
}

.listbox--compact .listbox-trigger {
  min-height: 36px;
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
}

.listbox--title .listbox-trigger {
  min-height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  font-size: var(--text-xl);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.listbox--disabled {
  opacity: 0.5;
}

.listbox-options {
  min-width: 180px;
  max-height: min(320px, calc(100dvh - 24px));
  overflow-y: auto;
  padding: var(--space-1);
  outline: 0;
}

.listbox-option {
  min-height: 38px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text);
  font-size: var(--text-sm);
  cursor: default;
}

.listbox-option.active {
  background: var(--press-fill);
}

.listbox-option.selected {
  color: var(--accent);
  font-weight: var(--font-medium);
}

.listbox-option.disabled {
  opacity: 0.42;
}

.listbox-option > svg {
  justify-self: end;
}
</style>
