<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CalendarEvent } from '../../domain/calendar/types'
import type { WorkspaceStateV4 } from '../../domain/workspace/types'
import { getEventOutcomeEnd, type EventOutcomeCommand } from '../../domain/capabilities/event-outcome-commands'
import Input from '../ui/Input.vue'
import Listbox from '../ui/Listbox.vue'
import Button from '../ui/Button.vue'

const props = defineProps<{ workspace: WorkspaceStateV4; event: CalendarEvent; originalStart: string | null; now: string; busy?: boolean; error?: string }>()
const emit = defineEmits<{ command: [command: EventOutcomeCommand]; 'open-task': [taskId: string] }>()
const action = ref('')
const title = ref('')
const listId = ref('')
const note = ref('')
const linkedTaskId = ref('')
const localError = ref('')
const actionOptions = [{ value: 'followup', label: '创建跟进任务' }, { value: 'note', label: '记录纪要' }, { value: 'dismiss', label: '无需跟进' }]
const labels = { followup: '跟进任务', note: '纪要', dismiss: '无需跟进' }
const source = computed(() => props.workspace.calendarSources.find(({ id }) => id === props.event.sourceId))
const occurrence = computed(() => !props.event.recurrence ? null : props.event.time.kind === 'fixed' && props.originalStart ? new Date(props.originalStart).toISOString() : props.originalStart)
const outcomes = computed(() => props.workspace.eventOutcomes.filter((entry) => entry.eventId === props.event.id && entry.occurrenceId === occurrence.value))
const existing = computed(() => outcomes.value.find((entry) => entry.action === action.value))
const links = computed(() => props.workspace.calendarEventLinks.filter((entry) => entry.eventId === props.event.id))
const lists = computed(() => props.workspace.lists.filter((entry) => entry.archivedAt === null).map((entry) => ({ value: entry.id, label: entry.title })))
const taskOptions = computed(() => props.workspace.tasks.filter((entry) => entry.deletedAt === null && entry.status !== 'cancelled' && !links.value.some((link) => link.taskId === entry.id)).map((entry) => ({ value: entry.id, label: entry.title })))
const unavailableReason = computed(() => {
  if (!source.value || source.value.archivedAt || props.event.deletedAt) return '日程已删除或日历已归档，已有结果仍可查看；不能创建新的结果。'
  try {
    const end = getEventOutcomeEnd(props.event, occurrence.value, source.value.timezone)
    if (end === null) return '本次日程已取消或不可用，不能创建新的结果。'
    if (!Number.isFinite(Date.parse(props.now))) return '当前时间无效，暂时不能确认日程是否结束。'
    if (Date.parse(props.now) < Date.parse(end)) return '日程尚未结束。结束后可创建跟进任务、记录纪要或选择无需跟进。'
    return ''
  } catch (error) { return error instanceof Error ? error.message : '无法确认本次日程的结束时间。' }
})
const canCreate = computed(() => !props.busy && !unavailableReason.value)

// Keep drafts through refreshes and command failures; reset only when switching the fact.
watch([() => props.event.id, () => props.originalStart], () => {
  title.value = `跟进：${props.event.title}`
  action.value = ''; listId.value = ''; note.value = ''; linkedTaskId.value = ''; localError.value = ''
}, { immediate: true })

function taskTitle(taskId: string) { return props.workspace.tasks.find(({ id }) => id === taskId)?.title ?? '任务已不可用' }
function taskAvailable(taskId: string) { return props.workspace.tasks.some((task) => task.id === taskId && task.deletedAt === null) }
function save() {
  if (!canCreate.value || existing.value) return
  localError.value = ''
  const base = { type: 'event.outcome.create' as const, eventId: props.event.id, originalStart: occurrence.value, expectedEventRevision: props.event.revision }
  if (action.value === 'followup') {
    if (!title.value.trim() || !lists.value.some((list) => list.value === listId.value)) { localError.value = '请输入任务标题，并选择未归档的目标清单。'; return }
    emit('command', { ...base, action: 'followup', title: title.value.trim(), listId: listId.value, note: note.value })
  } else if (action.value === 'note') {
    if (!note.value.trim()) { localError.value = '请输入需要记录的纪要。'; return }
    emit('command', { ...base, action: 'note', note: note.value })
  } else if (action.value === 'dismiss') emit('command', { ...base, action: 'dismiss' })
}
function link() {
  if (canCreate.value && taskOptions.value.some((entry) => entry.value === linkedTaskId.value)) emit('command', { type: 'event.link', eventId: props.event.id, taskId: linkedTaskId.value })
}
function keepDraft(event: KeyboardEvent) {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault()
}
</script>

<template>
  <section class="outcome-panel" aria-label="日程后续" @keydown="keepDraft">
    <header><h3>日程后续</h3><span v-if="event.recurrence">仅记录本次结果</span></header>
    <p v-if="unavailableReason" class="hint" role="status">{{ unavailableReason }}</p>
    <ul v-if="outcomes.length" class="outcomes" aria-label="已记录的本次结果">
      <li v-for="outcome in outcomes" :key="outcome.id">
        <strong>已记录：{{ labels[outcome.action] }}</strong>
        <p v-if="outcome.note" class="saved-note">{{ outcome.note }}</p>
        <Button v-if="outcome.taskId" :disabled="!taskAvailable(outcome.taskId)" @click="emit('open-task', outcome.taskId)">打开 {{ taskTitle(outcome.taskId) }}</Button>
      </li>
    </ul>
    <Listbox v-model="action" :options="actionOptions" label="选择后续处理" placeholder="选择一项操作" :disabled="busy" />
    <template v-if="action === 'followup'">
      <Input v-model="title" label="跟进任务标题" :disabled="busy" />
      <Listbox v-model="listId" :options="lists" label="跟进任务目标清单" placeholder="选择未归档的清单" :disabled="busy" />
    </template>
    <label v-if="action === 'followup' || action === 'note'"><span>{{ action === 'note' ? '纪要' : '跟进说明（可选）' }}</span><textarea v-model="note" :aria-label="action === 'note' ? '纪要内容' : '跟进说明'" :disabled="busy" /></label>
    <p v-if="existing" class="hint" role="status">本次已记录{{ labels[existing.action] }}，重复操作会返回上面的已有结果，不会创建重复内容。</p>
    <Button v-if="action" variant="primary" :disabled="!canCreate || Boolean(existing)" @click="save">{{ action === 'followup' ? '创建跟进任务' : action === 'note' ? '保存纪要' : '确认无需跟进' }}</Button>
    <section class="links" aria-label="关联任务">
      <h4>关联任务</h4>
      <p class="hint">{{ event.recurrence ? '关联关系属于整个日程系列。' : '' }}取消关联只移除关系，日程、任务和已记录的结果都会保留。</p>
      <ul v-if="links.length"><li v-for="entry in links" :key="entry.id"><Button :disabled="!taskAvailable(entry.taskId)" @click="emit('open-task', entry.taskId)">{{ taskTitle(entry.taskId) }}</Button><Button variant="ghost" :disabled="busy" :aria-label="`取消关联 ${taskTitle(entry.taskId)}`" @click="emit('command', { type: 'event.unlink', eventId: event.id, taskId: entry.taskId })">取消关联</Button></li></ul>
      <Listbox v-model="linkedTaskId" :options="taskOptions" label="关联已有跟进任务" placeholder="选择已有任务" :disabled="!canCreate" />
      <Button :disabled="!canCreate || !taskOptions.some((entry) => entry.value === linkedTaskId)" @click="link">关联所选任务</Button>
    </section>
    <p v-if="localError || error" class="error" role="alert">{{ localError || error }}</p>
  </section>
</template>

<style scoped>
.outcome-panel { display: grid; gap: var(--space-3); min-width: 0; padding-top: var(--space-4); border-top: 1px solid var(--hairline); }
header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }h3, h4, p { margin: 0; }h3 { font-size: var(--text-base); }h4 { font-size: var(--text-sm); }.hint, header > span { color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
ul { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }.outcomes li { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); }.outcomes strong { font-size: var(--text-sm); }.saved-note { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--text-sm); }
label > span { display: block; margin-bottom: 7px; color: var(--muted); font-size: var(--text-xs); font-weight: 600; }textarea { width: 100%; min-height: 72px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--control-fill); color: var(--text); font: inherit; resize: vertical; }textarea:focus { outline: 0; border-color: var(--accent); box-shadow: var(--focus-ring); }
.links { display: grid; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--hairline); }.links li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }.error { color: var(--danger); font-size: var(--text-sm); }:deep(.btn) { min-height: 44px; white-space: normal; overflow-wrap: anywhere; }
</style>
