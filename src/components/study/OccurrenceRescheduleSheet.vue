<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import Button from '../ui/Button.vue'
import DateTimePicker from '../ui/DateTimePicker.vue'
import Dialog from '../ui/Dialog.vue'

const props = defineProps<{ open: boolean; title: string; modelValue: string; timed: boolean }>()
const emit = defineEmits<{ close: []; submit: [value: string] }>()
const value = ref('')
const formId = `occurrence-reschedule-${useId()}`

watch(() => [props.open, props.modelValue] as const, ([open, modelValue]) => {
  if (open) value.value = modelValue
}, { immediate: true })
</script>

<template>
  <Dialog :open="open" title="本次改期" :description="title" size="sm" :show-close="false" @close="emit('close')">
    <form :id="formId" @submit.prevent="value && emit('submit', value)">
      <DateTimePicker v-model="value" :mode="timed ? 'datetime' : 'date'" label="新的计划时间" required />
    </form>
    <template #footer>
      <Button class="footer-button" variant="secondary" @click="emit('close')">取消</Button>
      <Button class="footer-button" variant="primary" type="submit" :form="formId" :disabled="!value">保存本次</Button>
    </template>
  </Dialog>
</template>

<style scoped>
form { min-width: 0; }
.footer-button { min-height: max(44px, var(--control-hit)); }
.footer-button:focus-visible { outline: 0; box-shadow: var(--focus-ring); }
</style>
