<script setup lang="ts">
import { ref } from 'vue'
import type { CommandPreview } from '../../domain/capabilities/types'
import Button from '../ui/Button.vue'
import Dialog from '../ui/Dialog.vue'

export type RecurrenceScope = 'occurrence' | 'future' | 'series'
const props = defineProps<{ open: boolean; preview: CommandPreview | null; previewing?: boolean; executing?: boolean }>()
const emit = defineEmits<{ close: []; preview: [scope: RecurrenceScope]; execute: [scope: RecurrenceScope] }>()
const choices: Array<{ value: RecurrenceScope; label: string }> = [{ value: 'occurrence', label: '本次' }, { value: 'future', label: '本次及以后' }, { value: 'series', label: '整个系列' }]
const affectedCount = () => props.preview?.affected.length ?? 0
const selectedScope = ref<RecurrenceScope>('occurrence')
function requestPreview(scope: RecurrenceScope) { selectedScope.value = scope; emit('preview', scope) }
</script>

<template>
  <Dialog :open="open" title="应用重复规则" description="先预览影响范围，再保存更改。" @close="emit('close')">
    <div class="scope-choices"><Button v-for="choice in choices" :key="choice.value" variant="secondary" :disabled="previewing" @click="requestPreview(choice.value)">{{ choice.label }}</Button></div>
    <p v-if="preview" class="preview" :class="{ error: !preview.accepted }">{{ preview.accepted ? `将影响 ${affectedCount()} 项` : (preview.validationErrors[0]?.message ?? '无法预览更改') }}</p>
    <template #footer>
      <Button variant="secondary" @click="emit('close')">取消</Button>
      <Button variant="primary" :disabled="!preview?.accepted || executing" @click="emit('execute', selectedScope)">保存更改</Button>
    </template>
  </Dialog>
</template>

<style scoped>
.scope-choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }.preview { margin: var(--space-4) 0 0; color: var(--muted); font-size: var(--text-sm); }.preview.error { color: var(--danger); } @media (max-width: 420px) { .scope-choices { grid-template-columns: 1fr; } }
</style>
