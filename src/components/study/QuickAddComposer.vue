<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Check, LoaderCircle, Plus } from '@lucide/vue'
import { CAPABILITY_PROTOCOL_VERSION, type EntityRef } from '../../domain/capabilities/types'
import { createTaskCapabilityService } from '../../domain/capabilities/service'
import { buildQuickAddCommand } from '../../domain/quick-add/command'
import { parseQuickAdd } from '../../domain/quick-add/parse'
import type { QuickAddCandidate, QuickAddCandidateKind } from '../../domain/quick-add/types'
import { parseZonedDateTime, zonedDateTimeToInstant } from '../../domain/recurrence/timezone'
import { getWorkspaceStore } from '../../storage/workspace/registry'
import DatePicker from '../ui/DatePicker.vue'
import Listbox, { type ListboxOption } from '../ui/Listbox.vue'
import Popover from '../ui/Popover.vue'
import TimePicker from '../ui/TimePicker.vue'
import QuickAddChip from './QuickAddChip.vue'

const props = withDefaults(defineProps<{
  destinationListId: string
  defaultStartOn?: string
  defaultEstimateMinutes?: number | null
  quickAddRemoveRecognizedText?: boolean
  catalogRevision?: number
}>(), {
  defaultStartOn: undefined,
  defaultEstimateMinutes: null,
  quickAddRemoveRecognizedText: false,
})

const emit = defineEmits<{ created: [entity: EntityRef] }>()
const input = ref('')
const inputElement = ref<HTMLInputElement | null>(null)
const lists = ref<Array<{ id: string; title: string }>>([])
const tags = ref<Array<{ id: string; title: string }>>([])
const removedIds = ref<string[]>([])
const editedCandidates = ref<Record<string, QuickAddCandidate>>({})
const activeCandidateId = ref('')
const editDate = ref('')
const editTime = ref('')
const editTimeValid = ref(true)
const editValue = ref('')
const error = ref('')
const submitting = ref(false)
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const capabilityService = createTaskCapabilityService(
  getWorkspaceStore(),
  () => new Date().toISOString(),
  (kind) => `${kind}:${crypto.randomUUID()}`,
)

const parsed = computed(() => {
  const now = new Date().toISOString()
  return parseQuickAdd(input.value, { now, timezone, lists: lists.value, tags: tags.value })
})
const acceptedCandidates = computed(() => parsed.value.candidates
  .filter(({ id }) => !removedIds.value.includes(id))
  .map((candidate) => editedCandidates.value[candidate.id] ?? candidate))
const hasAmbiguousCandidate = computed(() => acceptedCandidates.value.some((candidate) => candidate.status === 'ambiguous'))
const canSubmit = computed(() => {
  if (!input.value.trim() || hasAmbiguousCandidate.value || submitting.value) return false
  try {
    buildCommand()
    return true
  } catch {
    return false
  }
})

const priorityOptions: ListboxOption[] = [
  { value: 'high', label: '高优先级' },
  { value: 'medium', label: '中优先级' },
  { value: 'low', label: '低优先级' },
  { value: 'none', label: '无优先级' },
]
const recurrenceOptions: ListboxOption[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
]
const listOptions = computed<ListboxOption[]>(() => lists.value.map(({ id, title }) => ({ value: id, label: title })))
const tagOptions = computed<ListboxOption[]>(() => tags.value.map(({ id, title }) => ({ value: id, label: title })))

watch(input, () => {
  removedIds.value = []
  editedCandidates.value = {}
  activeCandidateId.value = ''
  error.value = ''
})

watch(() => props.catalogRevision, () => void refreshCatalog().catch((reason) => {
  error.value = reason instanceof Error ? reason.message : '无法读取清单与标签。'
}))

onMounted(() => void refreshCatalog().catch((reason) => {
  error.value = reason instanceof Error ? reason.message : '无法读取清单与标签。'
}))

async function refreshCatalog() {
  const snapshot = await capabilityService.query({ type: 'workspace.snapshot' })
  lists.value = snapshot.lists.filter(({ archivedAt }) => archivedAt === null).map(({ id, title }) => ({ id, title }))
  tags.value = snapshot.tags.filter(({ archivedAt }) => archivedAt === null).map(({ id, title }) => ({ id, title }))
}

function buildCommand() {
  return buildQuickAddCommand({
    input: input.value,
    candidates: acceptedCandidates.value,
    destinationListId: props.destinationListId,
    defaultStartOn: props.defaultStartOn,
    fallbackRecurrenceAnchorOn: localToday(),
    timezone,
    defaultEstimateMinutes: props.defaultEstimateMinutes,
    removeRecognizedText: props.quickAddRemoveRecognizedText,
  })
}

async function submit() {
  if (!canSubmit.value) {
    if (hasAmbiguousCandidate.value) error.value = '请先确认标有提醒的识别结果。'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const snapshot = await capabilityService.query({ type: 'workspace.snapshot' })
    const taskId = crypto.randomUUID()
    const command = buildQuickAddCommand({
      input: input.value,
      candidates: acceptedCandidates.value,
      destinationListId: props.destinationListId,
      defaultStartOn: props.defaultStartOn,
      fallbackRecurrenceAnchorOn: localToday(),
      timezone,
      defaultEstimateMinutes: props.defaultEstimateMinutes,
      removeRecognizedText: props.quickAddRemoveRecognizedText,
      taskId,
      eventId: crypto.randomUUID(),
      seriesId: acceptedCandidates.value.some(({ kind }) => kind === 'recurrence') ? crypto.randomUUID() : undefined,
    })
    const envelope = {
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      idempotencyKey: `quick-add:${crypto.randomUUID()}`,
      source: 'human-ui' as const,
      expectedWorkspaceRevision: snapshot.revision,
      command,
    }
    const result = await capabilityService.execute(envelope)
    const created = result.affected.find(({ type, id }) => type === 'task' && id === taskId)
    if (!created) throw new Error('Quick add did not return the created task.')
    input.value = ''
    await refreshCatalog()
    emit('created', created)
    inputElement.value?.focus({ preventScroll: true })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '任务未能保存，请重试。'
  } finally {
    submitting.value = false
  }
}

function removeCandidate(candidate: QuickAddCandidate) {
  removedIds.value = [...removedIds.value, candidate.id]
  if (activeCandidateId.value === candidate.id) activeCandidateId.value = ''
}

async function setEditorOpen(candidate: QuickAddCandidate, open: boolean) {
  if (!open) {
    activeCandidateId.value = ''
    return
  }
  activeCandidateId.value = candidate.id
  editValue.value = candidate.value
  editTimeValid.value = true
  if (candidate.kind === 'schedule' || candidate.kind === 'deadline') {
    if (candidate.value.length === 10) {
      editDate.value = candidate.value
      editTime.value = ''
    } else {
      const parts = parseZonedDateTime(candidate.value, timezone)
      editDate.value = parts.date
      editTime.value = parts.time
    }
  }
  await nextTick()
  document.getElementById(`quick-add-editor-${candidate.id}`)?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true })
}

function applyEdit(candidate: QuickAddCandidate, close: (reason: 'select') => void) {
  let value = editValue.value
  if (candidate.kind === 'schedule' || candidate.kind === 'deadline') {
    if (!editDate.value || !editTimeValid.value) return
    value = editTime.value
      ? zonedDateTimeToInstant(editDate.value, editTime.value, timezone).toISOString()
      : editDate.value
  }
  editedCandidates.value = {
    ...editedCandidates.value,
    [candidate.id]: { ...candidate, value, status: 'resolved' },
  }
  error.value = ''
  close('select')
}

function optionsFor(kind: QuickAddCandidateKind): readonly ListboxOption[] {
  if (kind === 'priority') return priorityOptions
  if (kind === 'recurrence') return recurrenceOptions
  if (kind === 'list') return listOptions.value
  if (kind === 'tag') return tagOptions.value
  return []
}

function candidateLabel(candidate: QuickAddCandidate): string {
  const valueLabels: Record<string, string> = {
    high: '高优先级', medium: '中优先级', low: '低优先级', none: '无优先级',
    daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月', yearly: '每年',
  }
  const entity = candidate.kind === 'list'
    ? lists.value.find(({ id }) => id === candidate.value)?.title
    : candidate.kind === 'tag'
      ? tags.value.find(({ id }) => id === candidate.value)?.title
      : undefined
  const prefix: Record<QuickAddCandidateKind, string> = {
    schedule: '计划', deadline: '截止', priority: '优先级', recurrence: '重复', list: '清单', tag: '标签',
  }
  return `${prefix[candidate.kind]} · ${entity ?? valueLabels[candidate.value] ?? formatCandidateDate(candidate.value)}`
}

function formatCandidateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/u.test(value)) return value
  const local = value.length === 10 ? { date: value, time: '' } : parseZonedDateTime(value, timezone)
  const [year, month, day] = local.date.split('-').map(Number)
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day))
  return local.time ? `${date} ${local.time}` : date
}

function localToday(): string {
  return parseZonedDateTime(new Date().toISOString(), timezone).date
}

function focus() {
  inputElement.value?.focus({ preventScroll: true })
}

defineExpose({ focus })
</script>

<template>
  <form class="quick-add-composer" @submit.prevent="submit">
    <div class="quick-add-input-row">
      <Plus :size="19" aria-hidden="true" />
      <input
        ref="inputElement"
        v-model="input"
        aria-label="新建任务"
        :aria-invalid="hasAmbiguousCandidate || Boolean(error)"
        :placeholder="defaultStartOn ? '添加到今天，也可以输入时间、优先级或重复' : '添加任务，也可以输入日期、优先级或重复'"
      />
      <button type="submit" :disabled="!canSubmit" :aria-label="submitting ? '正在添加' : '添加'">
        <LoaderCircle v-if="submitting" class="spinner" :size="17" aria-hidden="true" />
        <Check v-else :size="17" aria-hidden="true" />
      </button>
    </div>

    <div v-if="acceptedCandidates.length" class="quick-add-chips" aria-label="识别结果">
      <Popover
        v-for="candidate in acceptedCandidates"
        :key="candidate.id"
        :open="activeCandidateId === candidate.id"
        align="start"
        mobile-sheet
        @update:open="setEditorOpen(candidate, $event)"
      >
        <template #trigger="{ triggerProps }">
          <QuickAddChip
            :kind="candidate.kind"
            :label="candidateLabel(candidate)"
            :ambiguous="candidate.status === 'ambiguous'"
            :active="activeCandidateId === candidate.id"
            :trigger-props="triggerProps"
            @remove="removeCandidate(candidate)"
          />
        </template>
        <template #default="{ close }">
        <section
          :id="`quick-add-editor-${candidate.id}`"
          class="candidate-editor"
          role="dialog"
          aria-modal="false"
          :aria-labelledby="`quick-add-editor-title-${candidate.id}`"
        >
          <h2 :id="`quick-add-editor-title-${candidate.id}`" class="visually-hidden">编辑{{ candidateLabel(candidate) }}</h2>
          <template v-if="candidate.kind === 'schedule' || candidate.kind === 'deadline'">
            <DatePicker v-model="editDate" :label="candidate.kind === 'schedule' ? '计划日期' : '截止日期'" />
            <TimePicker v-model="editTime" v-model:valid="editTimeValid" label="本地时间，可选" placeholder="仅日期" />
          </template>
          <Listbox v-else v-model="editValue" :options="optionsFor(candidate.kind)" :label="`选择${candidateLabel(candidate)}`" />
          <p v-if="candidate.status === 'ambiguous'" class="ambiguous-note">这项有多种解释，请确认后再创建。</p>
          <footer>
            <button type="button" class="cancel" @click="close('select')">取消</button>
            <button type="button" class="apply" :disabled="(candidate.kind === 'schedule' || candidate.kind === 'deadline') ? (!editDate || !editTimeValid) : !editValue" @click="applyEdit(candidate, close)">应用</button>
          </footer>
        </section>
        </template>
      </Popover>
    </div>
    <p v-if="hasAmbiguousCandidate || error" class="quick-add-message" :class="{ error: Boolean(error) }" aria-live="polite">
      {{ error || '请确认有歧义的识别结果，或移除对应 chip。' }}
    </p>
  </form>
</template>

<style scoped>
.quick-add-composer { margin-top: var(--space-4); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); box-shadow: var(--shadow-sm); }
.quick-add-composer:focus-within { border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); box-shadow: var(--focus-ring); }
.quick-add-input-row { min-height: max(48px, var(--field-min-height)); display: grid; grid-template-columns: 24px minmax(0, 1fr) max(36px, var(--icon-hit)); align-items: center; gap: var(--space-2); padding: 0 var(--space-1) 0 var(--space-3); }
.quick-add-input-row > svg { color: var(--accent); }
.quick-add-input-row input { min-width: 0; min-height: 44px; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: var(--text-base); }
.quick-add-input-row > button { width: max(36px, var(--icon-hit)); height: max(36px, var(--icon-hit)); display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: var(--accent); color: var(--accent-text); }
.quick-add-input-row > button:disabled { opacity: .28; }
.quick-add-chips { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: 0 var(--space-3) var(--space-3); }
.quick-add-message { margin: calc(-1 * var(--space-1)) var(--space-3) var(--space-3); color: var(--warning); font-size: var(--text-xs); }
.quick-add-message.error { color: var(--danger); }
.candidate-editor { width: min(360px, calc(100vw - 16px)); display: grid; gap: var(--space-2); padding: var(--space-3); color: var(--text); }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.candidate-editor footer { display: flex; justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-1); }
.candidate-editor footer button { min-height: max(36px, var(--control-hit)); padding: 0 var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font: inherit; font-size: var(--text-sm); }
.candidate-editor footer .apply { border-color: transparent; background: var(--accent); color: var(--accent-text); }
.candidate-editor footer .apply:disabled { opacity: .42; }
.ambiguous-note { margin: 0; color: var(--warning); font-size: var(--text-xs); }
.spinner { animation: quick-add-spin .8s linear infinite; }
@keyframes quick-add-spin { to { transform: rotate(360deg); } }
@media (max-width: 819px) {
  .quick-add-composer { margin-top: var(--space-3); }
  .quick-add-input-row { min-height: 52px; }
  .quick-add-input-row > button { width: 44px; height: 44px; }
  .quick-add-chips { gap: var(--space-2); }
  .candidate-editor { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
