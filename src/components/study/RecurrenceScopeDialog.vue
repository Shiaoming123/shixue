<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CommandPreview, EntityType } from '../../domain/capabilities/types'
import Button from '../ui/Button.vue'
import Dialog from '../ui/Dialog.vue'

export type RecurrenceScope = 'occurrence' | 'future' | 'series'
export type RecurrenceRuleScope = Exclude<RecurrenceScope, 'occurrence'>
const props = defineProps<{ open: boolean; preview: CommandPreview | null; previewing?: boolean; executing?: boolean }>()
const emit = defineEmits<{ close: []; editOccurrence: []; preview: [scope: RecurrenceRuleScope]; execute: [scope: RecurrenceRuleScope] }>()
const choices: Array<{ value: RecurrenceScope; label: string; description: string }> = [
  { value: 'occurrence', label: '本次', description: '仅改本次计划' },
  { value: 'future', label: '本次及以后', description: '从本次起应用新规则' },
  { value: 'series', label: '整个系列', description: '全部应用新规则' },
]
const entityLabels: Record<EntityType, string> = {
  workspace: '工作区', list_group: '清单分组', list: '清单', task: '关联任务', recurrence_series: '重复规则',
  occurrence: '一次计划', session: '专注记录', checklist_item: '检查项', completion_record: '完成记录',
}
const affectedCount = () => props.preview?.affected.length ?? 0
const selectedScope = ref<RecurrenceRuleScope>('future')
const previewExamples = computed(() => (props.preview?.affected ?? []).slice(0, 3).map((entity, index) => ({
  key: `${entity.type}:${entity.id}`,
  label: entity.type === 'occurrence' ? `${entityLabels[entity.type]} ${index + 1}` : entityLabels[entity.type],
})))
const affectedOverflow = computed(() => Math.max(0, affectedCount() - previewExamples.value.length))

watch(() => props.open, (open) => { if (open) selectedScope.value = 'future' })

function requestScope(scope: RecurrenceScope) {
  if (scope === 'occurrence') { emit('editOccurrence'); return }
  selectedScope.value = scope
  emit('preview', scope)
}
</script>

<template>
  <Dialog :open="open" title="应用重复规则" description="选择单次计划，或预览重复规则范围。" @close="emit('close')">
    <div class="scope-choices"><Button v-for="choice in choices" :key="choice.value" variant="secondary" :disabled="previewing" :aria-pressed="choice.value !== 'occurrence' && selectedScope === choice.value" @click="requestScope(choice.value)"><span>{{ choice.label }}</span><small>{{ choice.description }}</small></Button></div>
    <div v-if="preview" class="preview" :class="{ error: !preview.accepted }">
      <p>{{ preview.accepted ? `将影响 ${affectedCount()} 项` : (preview.validationErrors[0]?.message ?? '无法预览更改') }}</p>
      <ul v-if="preview.accepted && previewExamples.length"><li v-for="example in previewExamples" :key="example.key">{{ example.label }}</li></ul>
      <p v-if="preview.accepted && affectedOverflow" class="overflow">另有 {{ affectedOverflow }} 项</p>
    </div>
    <template #footer>
      <Button variant="secondary" @click="emit('close')">取消</Button>
      <Button variant="primary" :disabled="!preview?.accepted || executing" @click="emit('execute', selectedScope)">保存更改</Button>
    </template>
  </Dialog>
</template>

<style scoped>
.scope-choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }.scope-choices button { min-width: 0; flex-direction: column; white-space: normal; }.scope-choices small { color: var(--muted); font-size: var(--text-xs); font-weight: 400; }.scope-choices button[aria-pressed='true'] { border-color: var(--accent); box-shadow: var(--focus-ring); }.preview { margin: var(--space-4) 0 0; color: var(--muted); font-size: var(--text-sm); }.preview p { margin: 0; }.preview ul { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0 0; padding: 0; list-style: none; }.preview li { padding: 3px 8px; border-radius: var(--radius-full); background: var(--control-fill); }.preview .overflow { margin-top: var(--space-2); font-size: var(--text-xs); }.preview.error { color: var(--danger); } @media (max-width: 420px) { .scope-choices { grid-template-columns: 1fr; } }
</style>
