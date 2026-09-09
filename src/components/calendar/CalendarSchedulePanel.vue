<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue'
import type { WorkspaceStateV4 } from '../../domain/workspace/types.ts'
import type { BusyResult } from '../../calendar-connections/types.ts'
import { suggestTaskSchedule, type ScheduleQuery, type ScheduleReason, type ScheduleSuggestion } from '../../domain/calendar/scheduling.ts'
import { addCalendarDays } from '../../domain/recurrence/calculate.ts'
import { parseZonedDateTime } from '../../domain/recurrence/timezone.ts'
import Button from '../ui/Button.vue'
import Sheet from '../ui/Sheet.vue'
import DateTimePicker from '../ui/DateTimePicker.vue'
import TimePicker from '../ui/TimePicker.vue'
import Listbox from '../ui/Listbox.vue'

const props = defineProps<{ workspace: WorkspaceStateV4; taskId: string | null; open: boolean; timezone: string; now: string; externalBusy: BusyResult[]; busy: boolean; error: string }>()
const emit = defineEmits<{ close: []; 'preview-result': [value: { taskId: string; reason: ScheduleReason | null }]; 'refresh-busy': [query: Omit<ScheduleQuery, 'now' | 'externalBusy'>]; confirm: [value: { query: Omit<ScheduleQuery, 'now' | 'externalBusy'>; expectedTaskRevision: number; expectedWorkspaceRevision: number; availabilityFingerprint: string; startAt: string }] }>()
const task = computed(() => props.workspace.tasks.find((entry) => entry.id === props.taskId))
const startDate = ref(''), endDate = ref(''), startTime = ref('09:00'), endTime = ref('18:00'), days = ref('weekdays')
const startValid = ref(true), endValid = ref(true), loading = ref(false), previewError = ref('')
const preview = ref<ScheduleSuggestion | null>(null)
let previewQuery: Omit<ScheduleQuery, 'now' | 'externalBusy'> | null = null
let generation = 0
let previewExpiresAt = Infinity
const reasonLabels: Record<ScheduleReason, string> = {
  'task-unavailable': '这个任务当前不能安排。', 'already-scheduled': '任务已有开始时间，请先调整现有安排。',
  'recurring-task': '重复任务请在日历中安排具体发生项。', 'missing-estimate': '请先打开任务详情，填写预计时长，再回来查找空闲时间。',
  'invalid-estimate': '请先在任务详情填写有效预计时长（5 至 1440 分钟，5 分钟的倍数）。',
  'deadline-passed': '截止时间已过，当前范围无法安排。', 'outside-working-hours': '所选日期没有符合条件的工作时段。',
  'insufficient-capacity': '截止前没有足够的连续空闲时间，请调整日期或工作时间。',
  'availability-unknown': '部分忙闲信息未知或已过期，请刷新外部忙闲信息后重试。',
}
function invalidate() { generation++; preview.value = null; previewQuery = null; loading.value = false; previewError.value = '' }
watch(() => [props.open, props.taskId], () => {
  if (props.open) { startDate.value = parseZonedDateTime(props.now, props.timezone).date; endDate.value = addCalendarDays(startDate.value, 6); startTime.value = '09:00'; endTime.value = '18:00'; days.value = 'weekdays' }
}, { immediate: true })
watch(() => [props.open, props.taskId, props.workspace, props.externalBusy, props.timezone, startDate.value, endDate.value, startTime.value, endTime.value, startValid.value, endValid.value, days.value], invalidate, { deep: true, flush: 'sync' })
function expirePreview() {
  const now = Date.parse(props.now)
  if (preview.value && (now >= previewExpiresAt || preview.value.candidates.some((candidate) => Date.parse(candidate.startAt) < now))) invalidate()
}
watch(() => props.now, expirePreview, { flush: 'sync' })
const canPreview = computed(() => Boolean(props.open && task.value && task.value.schedule.estimateMinutes !== null && startDate.value && endDate.value >= startDate.value && startValid.value && endValid.value && /^\d{2}:\d{2}$/.test(startTime.value) && /^\d{2}:\d{2}$/.test(endTime.value) && startTime.value < endTime.value && !props.busy))
function minute(value: string) { const [hour = 0, minutes = 0] = value.split(':').map(Number); return hour * 60 + minutes }
async function generate() {
  invalidate()
  if (!canPreview.value || !props.taskId) return
  const request = generation
  const query: Omit<ScheduleQuery, 'now' | 'externalBusy'> = { taskId: props.taskId, range: { start: startDate.value, end: addCalendarDays(endDate.value, 1) }, timezone: props.timezone, workingHours: [{ weekdays: days.value === 'weekdays' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6], startMinute: minute(startTime.value), endMinute: minute(endTime.value) }], lockedIntervals: [], maxCandidates: 5 }
  loading.value = true
  try {
    const now = props.now
    const externalBusy = structuredClone(toRaw(props.externalBusy))
    const result = await suggestTaskSchedule(structuredClone(toRaw(props.workspace)), { ...query, now, externalBusy })
    if (request !== generation) return
    previewExpiresAt = Math.min(Infinity, ...externalBusy.map((entry) => Date.parse(entry.expiresAt)).filter((expiry) => expiry > Date.parse(now)))
    previewQuery = query; preview.value = result
    expirePreview()
    if (preview.value) emit('preview-result', { taskId: result.taskId, reason: result.reason })
  } catch { if (request === generation) previewError.value = '无法生成建议，请检查日期、时间和忙闲信息。' }
  finally { if (request === generation) loading.value = false }
}
function adopt(startAt: string) {
  expirePreview()
  if (props.busy || !props.open || !previewQuery || !preview.value || preview.value.taskRevision === null || !preview.value.candidates.some((entry) => entry.startAt === startAt)) return
  emit('confirm', { query: structuredClone(previewQuery), expectedTaskRevision: preview.value.taskRevision, expectedWorkspaceRevision: preview.value.workspaceRevision, availabilityFingerprint: preview.value.availabilityFingerprint, startAt })
}
function refreshBusy() { if (!props.busy && previewQuery) emit('refresh-busy', structuredClone(previewQuery)) }
function localTime(value: string) { const local = parseZonedDateTime(value, props.timezone); return `${local.date} ${local.time}` }
</script>

<template>
  <Sheet :open="open" label="建议安排" @close="emit('close')">
    <section class="schedule-panel">
      <header><h2>建议安排</h2><Button variant="ghost" @click="emit('close')">关闭</Button></header>
      <p>{{ task?.title ?? '请选择任务' }}</p>
      <p v-if="task?.schedule.estimateMinutes != null">预计 {{ task.schedule.estimateMinutes }} 分钟 · {{ timezone }}</p>
      <p v-else role="status">{{ reasonLabels['missing-estimate'] }}</p>
      <div class="schedule-panel__fields">
        <div><span class="schedule-panel__label">开始日期</span><DateTimePicker v-model="startDate" mode="date" label="开始日期" required /></div>
        <div><span class="schedule-panel__label">结束日期（含当天）</span><DateTimePicker v-model="endDate" mode="date" label="结束日期（含当天）" required /></div>
      </div>
      <Listbox v-model="days" label="可安排日期" :options="[{ value: 'weekdays', label: '工作日（周一至周五）' }, { value: 'everyday', label: '每天' }]" />
      <div class="schedule-panel__fields"><TimePicker v-model="startTime" v-model:valid="startValid" label="工作开始" /><TimePicker v-model="endTime" v-model:valid="endValid" label="工作结束" /></div>
      <p class="schedule-panel__hint">仅查找空闲时间；点击“采用”后才保存安排。日期和时间均使用 {{ timezone }}。</p>
      <Button variant="primary" :disabled="!canPreview || loading" @click="generate">{{ loading ? '正在查找…' : '查找建议时间' }}</Button>
      <p v-if="error || previewError" role="alert">{{ error || previewError }}</p>
      <p v-if="preview?.reason" role="status">{{ reasonLabels[preview.reason] }}</p>
      <Button v-if="preview?.reason === 'availability-unknown'" :disabled="busy" @click="refreshBusy">查询此范围忙闲</Button>
      <ul v-if="preview?.candidates.length" class="schedule-panel__candidates" aria-label="建议时间">
        <li v-for="candidate in preview.candidates" :key="candidate.startAt"><span>{{ localTime(candidate.startAt) }} — {{ localTime(candidate.endAt) }}<small>{{ timezone }}</small></span><Button :disabled="busy" @click="adopt(candidate.startAt)">采用</Button></li>
      </ul>
    </section>
  </Sheet>
</template>

<style scoped>
.schedule-panel { min-width: 0; padding: var(--space-4); display: grid; gap: var(--space-3); color: var(--text); overflow-wrap: anywhere; }
.schedule-panel header, .schedule-panel__candidates li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.schedule-panel h2, .schedule-panel p { margin: 0; }
.schedule-panel h2 { font-size: var(--text-lg); }
.schedule-panel__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
.schedule-panel__fields > div { min-width: 0; }
.schedule-panel__label { display: block; margin-bottom: var(--space-1); color: var(--muted); font-size: var(--text-xs); }
.schedule-panel__hint, .schedule-panel small { color: var(--muted); font-size: var(--text-xs); }
.schedule-panel small { display: block; }
.schedule-panel__candidates { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.schedule-panel__candidates li { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-md); }
@media (max-width: 479px) { .schedule-panel__fields { grid-template-columns: 1fr; } }
</style>
