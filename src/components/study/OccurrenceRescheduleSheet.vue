<script setup lang="ts">
import { ref, watch } from 'vue'
import DateTimePicker from '../ui/DateTimePicker.vue'

const props = defineProps<{ open: boolean; title: string; modelValue: string; timed: boolean }>()
const emit = defineEmits<{ close: []; submit: [value: string] }>()
const value = ref('')

watch(() => [props.open, props.modelValue] as const, ([open, modelValue]) => {
  if (open) value.value = modelValue
}, { immediate: true })
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="emit('close')">
    <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="occurrence-reschedule-title" @submit.prevent="value && emit('submit', value)">
      <h2 id="occurrence-reschedule-title">本次改期</h2>
      <p>{{ title }}</p>
      <DateTimePicker v-model="value" :mode="timed ? 'datetime' : 'date'" label="新的计划时间" required />
      <footer><button type="button" class="cancel" @click="emit('close')">取消</button><button class="save" type="submit" :disabled="!value">保存本次</button></footer>
    </form>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; z-index: var(--z-modal); inset: 0; display: grid; place-items: center; padding: 20px; background: color-mix(in srgb, var(--text) 22%, transparent); backdrop-filter: blur(12px); }.sheet { width: min(100%, 420px); padding: 24px; border: 1px solid var(--hairline); border-radius: var(--radius-2xl); background: var(--material-regular); box-shadow: var(--shadow-lg); }.sheet h2 { margin: 0; font-size: var(--text-xl); }.sheet p { margin: 7px 0 18px; color: var(--muted); font-size: var(--text-sm); }.sheet footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 22px; }.sheet button { min-height: 42px; padding: 0 15px; border-radius: var(--radius-lg); font-weight: 650; }.cancel { border: 1px solid var(--hairline); background: var(--control-fill); color: var(--text); }.save { border: 0; background: var(--accent); color: var(--accent-text); }.save:disabled { opacity: .4; }
</style>
