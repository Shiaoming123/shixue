<script setup lang="ts">
import { isTauri } from '../../lib/platform'
import { computed, ref, toRaw, watch } from 'vue'
import type { CalendarEvent, CalendarEventTime, CalendarSource } from '../../domain/calendar/types'
import type { EventCapabilityCommand } from '../../domain/capabilities/event-commands'
import type { RecurrenceCadence, RecurrenceSeries } from '../../domain/workspace/types'
import { eventTimeDraft, eventTimeFromDraft, type EventTimeDraft } from '../../domain/calendar/event-form'
import { parseCalendarEvent } from '../../domain/workspace/parse.ts'
import Input from '../ui/Input.vue'
import Listbox from '../ui/Listbox.vue'
import Sheet from '../ui/Sheet.vue'
import Button from '../ui/Button.vue'
import DateTimePicker from '../ui/DateTimePicker.vue'
import TimePicker from '../ui/TimePicker.vue'

const props = defineProps<{ open: boolean; event: CalendarEvent | null; sources: CalendarSource[]; initialDate: string; initialTime?: CalendarEventTime; initialTitle?: string; initialSourceId?: string; submitting?: boolean; error?: string }>()
const emit = defineEmits<{ close: []; save: [command: EventCapabilityCommand]; delete: [command: EventCapabilityCommand] }>()
const base = ref<CalendarEvent | null>(null)
const sourceId = ref('')
const title = ref('')
const notes = ref('')
const location = ref('')
const meetingUrl = ref('')
const participantsOpen = ref(false)
const organizerName = ref('')
const organizerEmail = ref('')
const attendees = ref<CalendarEvent['attendees']>([])
const availability = ref<CalendarEvent['availability']>('busy')
const status = ref<CalendarEvent['status']>('confirmed')
const time = ref<EventTimeDraft>({ kind: 'fixed', startDate: '', endDate: '', startTime: '09:00', endTime: '10:00', timezone: 'UTC' })
const startValid = ref(true)
const endValid = ref(true)
const cadenceKind = ref('none')
const interval = ref('1')
const weekdays = ref<number[]>([])
const dayOfMonth = ref('1')
const month = ref('1')
const endKind = ref('never')
const endDate = ref('')
const count = ref('10')
const localError = ref('')
const source = computed(() => props.sources.find((entry) => entry.id === sourceId.value))
const writable = computed(() => source.value?.provider === 'local' && source.value.permission === 'write' && source.value.archivedAt === null && !base.value?.deletedAt)
const disabled = computed(() => !writable.value || Boolean(props.submitting))
const hasExceptions = computed(() => Boolean(base.value?.recurrence?.exceptions.length))
const timeDisabled = computed(() => disabled.value || hasExceptions.value)
const sourceOptions = computed(() => props.sources.filter((entry) => entry.id === sourceId.value || (entry.provider === 'local' && entry.permission === 'write' && entry.archivedAt === null)).map((entry) => ({ value: entry.id, label: entry.title })))
const timeOptions = [{ value: 'all-day', label: '全天' }, { value: 'fixed', label: '固定时区' }, { value: 'floating', label: '浮动时间' }]
const cadenceOptions = [{ value: 'none', label: '不重复' }, { value: 'daily', label: '每天' }, { value: 'weekly', label: '每周' }, { value: 'monthly', label: '每月' }, { value: 'yearly', label: '每年' }]
const endOptions = [{ value: 'never', label: '一直重复' }, { value: 'on', label: '截止日期' }, { value: 'after', label: '指定次数' }]
const roleOptions = [{ value: 'required', label: '必选' }, { value: 'optional', label: '可选' }]
const responseOptions = [{ value: 'unknown', label: '未记录' }, { value: 'accepted', label: '接受' }, { value: 'declined', label: '拒绝' }, { value: 'tentative', label: '待定' }]
const weekOptions = [{ value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' }, { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' }, { value: 0, label: '日' }]

// Capture revision only when opening/switching the editor, never on external updates.
watch([() => props.open, () => props.event?.id], ([open]) => {
  if (!open) return
  base.value = props.event ? structuredClone(toRaw(props.event)) : null
  const value = base.value
  sourceId.value = value?.sourceId ?? props.sources.find((entry) => entry.id === props.initialSourceId && entry.provider === 'local' && entry.permission === 'write' && entry.archivedAt === null)?.id ?? props.sources.find((entry) => entry.provider === 'local' && entry.permission === 'write' && entry.archivedAt === null)?.id ?? ''
  title.value = value?.title ?? props.initialTitle ?? ''; notes.value = value?.notes ?? ''; location.value = value?.location ?? ''; meetingUrl.value = value?.meetingUrl ?? ''
  participantsOpen.value = false; organizerName.value = value?.organizer?.name ?? ''; organizerEmail.value = value?.organizer?.email ?? ''
  attendees.value = structuredClone(toRaw(value?.attendees ?? []))
  availability.value = value?.availability ?? 'busy'; status.value = value?.status ?? 'confirmed'
  time.value = value || props.initialTime ? eventTimeDraft(value?.time ?? props.initialTime!, source.value?.timezone) : { kind: 'fixed', startDate: props.initialDate, endDate: props.initialDate, startTime: '09:00', endTime: '10:00', timezone: source.value?.timezone ?? 'UTC' }
  const recurrence = value?.recurrence
  cadenceKind.value = recurrence?.cadence.kind ?? 'none'; interval.value = String(recurrence?.cadence.interval ?? 1)
  weekdays.value = recurrence?.cadence.kind === 'weekly' ? [...recurrence.cadence.weekdays] : [new Date(`${time.value.startDate}T00:00:00Z`).getUTCDay()]
  dayOfMonth.value = String(recurrence && 'dayOfMonth' in recurrence.cadence ? recurrence.cadence.dayOfMonth : Number(time.value.startDate.slice(8)))
  month.value = String(recurrence?.cadence.kind === 'yearly' ? recurrence.cadence.month : Number(time.value.startDate.slice(5, 7)))
  endKind.value = recurrence?.end.kind ?? 'never'; endDate.value = recurrence?.end.kind === 'on' ? recurrence.end.date : time.value.startDate
  count.value = String(recurrence?.end.kind === 'after' ? recurrence.end.count : 10)
  localError.value = ''; startValid.value = true; endValid.value = true
}, { immediate: true })

function addAttendee() { if (!disabled.value) attendees.value.push({ name: '', email: '', role: 'required', response: 'unknown' }) }
function removeAttendee(index: number) { if (!disabled.value) attendees.value.splice(index, 1) }

function positive(value: string, label: string, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error(`${label}请输入 1 至 ${max} 之间的整数。`)
  return number
}
function recurrenceValue() {
  if (cadenceKind.value === 'none') return null
  const every = positive(interval.value, '重复间隔')
  let cadence: RecurrenceCadence
  if (cadenceKind.value === 'weekly') {
    if (weekdays.value.length === 0) throw new Error('请选择至少一个重复星期。')
    cadence = { kind: 'weekly', interval: every, weekdays: [...weekdays.value].sort() }
  } else if (cadenceKind.value === 'monthly') cadence = { kind: 'monthly', interval: every, dayOfMonth: positive(dayOfMonth.value, '每月日期', 31) }
  else if (cadenceKind.value === 'yearly') cadence = { kind: 'yearly', interval: every, month: positive(month.value, '月份', 12), dayOfMonth: positive(dayOfMonth.value, '每月日期', 31) }
  else cadence = { kind: 'daily', interval: every }
  const end: RecurrenceSeries['end'] = endKind.value === 'after' ? { kind: 'after', count: positive(count.value, '重复次数') } : endKind.value === 'on' ? { kind: 'on', date: endDate.value } : { kind: 'never' }
  if (end.kind === 'on' && (!end.date || end.date < time.value.startDate)) throw new Error('重复截止日期不能早于开始日期。')
  return { cadence, end }
}
function save() {
  if (disabled.value) return
  localError.value = ''
  try {
    if (!title.value.trim()) throw new Error('请输入日程标题。')
    if (time.value.kind !== 'all-day' && (!startValid.value || !endValid.value)) throw new Error('请修正开始和结束时间。')
    const organizer = organizerName.value || organizerEmail.value ? { name: organizerName.value, email: organizerEmail.value } : null
    const fields = { title: title.value.trim(), notes: notes.value, location: location.value, meetingUrl: meetingUrl.value.trim() || null, availability: availability.value, status: status.value, organizer, attendees: structuredClone(toRaw(attendees.value)) }
    if (fields.meetingUrl) {
      const url = new URL(fields.meetingUrl)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('会议链接需为不含账号密码的 HTTP 或 HTTPS 地址。')
    }
    if (base.value) {
      const patch: Extract<EventCapabilityCommand, { type: 'event.update' }>['patch'] = { ...fields }
      if (!hasExceptions.value) {
        const nextTime = eventTimeFromDraft(time.value, base.value.time)
        if (JSON.stringify(nextTime) !== JSON.stringify(base.value.time)) patch.time = nextTime
        const nextRecurrence = recurrenceValue()
        const previous = base.value.recurrence ? { cadence: base.value.recurrence.cadence, end: base.value.recurrence.end } : null
        if (JSON.stringify(nextRecurrence) !== JSON.stringify(previous)) patch.recurrence = nextRecurrence
      }
      parseCalendarEvent({ ...toRaw(base.value), ...patch, recurrence: 'recurrence' in patch ? patch.recurrence ? { ...patch.recurrence, exceptions: [] } : null : base.value.recurrence })
      emit('save', { type: 'event.update', eventId: base.value.id, expectedRevision: base.value.revision, scope: base.value.recurrence || patch.recurrence ? 'series' : 'single', patch })
    } else {
      const event = { ...fields, time: eventTimeFromDraft(time.value), recurrence: recurrenceValue() }
      parseCalendarEvent({ ...event, id: 'draft', sourceId: sourceId.value, revision: 1, recurrence: event.recurrence ? { ...event.recurrence, exceptions: [] } : null, createdAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z', deletedAt: null })
      emit('save', { type: 'event.create', sourceId: sourceId.value, event })
    }
  } catch (error) { localError.value = error instanceof Error ? error.message : '无法保存日程。' }
}
function remove() {
  if (disabled.value || !base.value) return
  emit('delete', { type: 'event.delete', eventId: base.value.id, expectedRevision: base.value.revision, scope: base.value.recurrence ? 'series' : 'single' })
}
function close() { if (!props.submitting) emit('close') }
async function openSource() {
  const url = base.value?.sourceUrl
  if (!url) return
  try {
    if (isTauri()) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url) }
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch { localError.value = '无法打开来源日历，请稍后重试。' }
}
</script>

<template>
  <Sheet :open="open" :label="base ? '日程详情' : '新建日程'" @close="close">
    <form class="event-editor" @submit.prevent="save">
      <header><h2>{{ base ? '日程详情' : '新建日程' }}</h2><Button variant="ghost" :disabled="submitting" @click="close">关闭</Button></header>
      <div class="event-editor__body">
      <slot name="occurrence-actions" :event="base" :disabled="disabled" />
      <p v-if="!writable" class="hint">此日历只支持查看；请选择可写的本地日历创建日程。</p>
      <Button v-if="base?.sourceUrl" @click="openSource">在来源日历中打开</Button>
      <Input v-model="title" label="日程标题" :disabled="disabled" required />
      <label class="notes"><span>备注</span><textarea v-model="notes" aria-label="日程备注" :disabled="disabled" /></label>
      <Listbox v-model="sourceId" :options="sourceOptions" label="日历" :disabled="Boolean(base) || submitting" />
      <Input v-model="location" label="地点" :disabled="disabled" />
      <Input v-model="meetingUrl" label="会议链接" placeholder="https://" :disabled="disabled" />
      <section class="participants">
        <Button variant="ghost" :aria-expanded="participantsOpen" aria-controls="event-participants" @click="participantsOpen = !participantsOpen">参与者 · {{ attendees.length }}</Button>
        <div v-if="participantsOpen" id="event-participants" class="participants__body">
          <p class="hint">{{ writable ? '仅保存本地记录，不会发送邀请或 RSVP。响应由你手动记录，不代表对方已回复。' : '以下为来源日历的只读记录，不能在此修改他人的远端响应。' }}</p>
          <div class="field-grid"><Input v-model="organizerName" label="组织者姓名" :disabled="disabled" /><Input v-model="organizerEmail" label="组织者邮箱" :disabled="disabled" /></div>
          <p v-if="!attendees.length" class="hint">暂无参与者。</p>
          <section v-for="(attendee, index) in attendees" :key="index" class="participants__person" :aria-label="`参与者 ${index + 1}`">
            <div class="field-grid"><Input v-model="attendee.name" :label="`参与者 ${index + 1} 姓名`" :disabled="disabled" /><Input v-model="attendee.email" :label="`参与者 ${index + 1} 邮箱`" :disabled="disabled" required /></div>
            <div class="field-grid">
              <Listbox :model-value="attendee.role" :options="roleOptions" :label="`参与者 ${index + 1} 类型`" :disabled="disabled" @update:model-value="attendee.role = $event as CalendarEvent['attendees'][number]['role']" />
              <Listbox :model-value="attendee.response" :options="responseOptions" :label="`参与者 ${index + 1} ${writable ? '本地响应记录' : '来源响应'}`" :disabled="disabled" @update:model-value="attendee.response = $event as CalendarEvent['attendees'][number]['response']" />
            </div>
            <Button v-if="writable" variant="ghost" :disabled="disabled" :aria-label="`移除参与者 ${index + 1}`" @click="removeAttendee(index)">移除</Button>
          </section>
          <Button v-if="writable" :disabled="disabled" @click="addAttendee">添加参与者</Button>
        </div>
      </section>
      <Listbox :model-value="time.kind" :options="timeOptions" label="时间类型" :disabled="timeDisabled" @update:model-value="time.kind = $event as EventTimeDraft['kind']" />
      <p v-if="hasExceptions" class="hint">此系列已有单次修改。为保留这些修改，时间和重复规则暂不可在此更改；其他信息仍可编辑。</p>
      <div class="field-grid">
        <div><span class="field-label">开始日期</span><DateTimePicker v-model="time.startDate" label="日程开始日期" :disabled="timeDisabled" required /></div>
        <div><span class="field-label">{{ time.kind === 'all-day' ? '结束日期（包含当天）' : '结束日期' }}</span><DateTimePicker v-model="time.endDate" label="日程结束日期" :disabled="timeDisabled" required /></div>
      </div>
      <div v-if="time.kind !== 'all-day'" class="field-grid event-times">
        <TimePicker v-model="time.startTime" v-model:valid="startValid" label="开始时间" :disabled="timeDisabled" />
        <TimePicker v-model="time.endTime" v-model:valid="endValid" label="结束时间" :disabled="timeDisabled" />
      </div>
      <template v-if="time.kind === 'fixed'"><Input v-model="time.timezone" label="IANA 时区" placeholder="Asia/Shanghai" :disabled="timeDisabled" /><p class="hint">按此时区保存。夏令时回拨产生两个相同时间时，新选择使用首次发生的时间。</p></template>
      <p v-else-if="time.kind === 'floating'" class="hint">保持输入的墙钟时间，不随查看时区换算。提醒按日历时区 {{ source?.timezone ?? 'UTC' }} 计算。</p>
      <div class="field-grid">
        <Listbox :model-value="availability" :options="[{ value: 'busy', label: '忙碌' }, { value: 'free', label: '空闲' }]" label="占用状态" :disabled="disabled" @update:model-value="availability = $event as CalendarEvent['availability']" />
        <Listbox :model-value="status" :options="[{ value: 'confirmed', label: '已确认' }, { value: 'tentative', label: '待定' }, { value: 'cancelled', label: '已取消' }]" label="日程状态" :disabled="disabled" @update:model-value="status = $event as CalendarEvent['status']" />
      </div>
      <Listbox v-model="cadenceKind" :options="cadenceOptions" label="重复" :disabled="timeDisabled" />
      <template v-if="cadenceKind !== 'none'">
        <Input v-model="interval" label="重复间隔" type="number" min="1" :disabled="timeDisabled" />
        <div v-if="cadenceKind === 'weekly'" class="weekdays" aria-label="重复星期"><Button v-for="day in weekOptions" :key="day.value" :variant="weekdays.includes(day.value) ? 'primary' : 'secondary'" :aria-pressed="weekdays.includes(day.value)" :aria-label="`星期${day.label}`" :disabled="timeDisabled" @click="weekdays = weekdays.includes(day.value) ? weekdays.filter((value) => value !== day.value) : [...weekdays, day.value]">{{ day.label }}</Button></div>
        <Input v-if="cadenceKind === 'yearly'" v-model="month" label="月份" type="number" min="1" max="12" :disabled="timeDisabled" />
        <Input v-if="cadenceKind === 'monthly' || cadenceKind === 'yearly'" v-model="dayOfMonth" label="每月日期（短月份取最后一天）" type="number" min="1" max="31" :disabled="timeDisabled" />
        <Listbox v-model="endKind" :options="endOptions" label="重复结束" :disabled="timeDisabled" />
        <DateTimePicker v-if="endKind === 'on'" v-model="endDate" label="重复截止日期" :disabled="timeDisabled" required />
        <Input v-if="endKind === 'after'" v-model="count" label="重复次数" type="number" min="1" :disabled="timeDisabled" />
        <p class="hint">保存和删除将作用于整个系列。</p>
      </template>
      <slot name="reminders" :event="base" :disabled="disabled" />
      <slot name="outcomes" />
      <p v-if="localError || error" class="error" role="alert">{{ localError || error }}</p>
      </div>
      <footer><Button v-if="base && writable" variant="danger" :disabled="submitting" @click="remove">{{ base.recurrence ? '删除整个系列' : '删除日程' }}</Button><Button :disabled="submitting" @click="close">取消</Button><Button v-if="writable" variant="primary" type="submit" :disabled="submitting || !title.trim()">{{ submitting ? '保存中…' : base?.recurrence ? '保存整个系列' : '保存日程' }}</Button></footer>
    </form>
  </Sheet>
</template>

<style scoped>
.event-editor { min-width: 0; width: 100%; height: min(760px, calc(100dvh - 88px)); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; }
.event-editor__body { min-width: 0; min-height: 0; display: grid; align-content: start; gap: 14px; overflow-y: auto; overscroll-behavior: contain; padding: 14px 2px; }
:global(.sheet-panel:has(> .sheet-body > .event-editor)) { overflow: hidden; }
@media (min-width: 820px) { :global(.sheet-panel:has(> .sheet-body > .event-editor)) { width: min(calc(100vw - 40px), 760px); } }
.participants, .participants__body, .participants__person { display: grid; gap: 12px; min-width: 0; }
.participants__person { border: 1px solid var(--hairline); border-radius: var(--radius-lg); padding: 12px; }
header, footer { display: flex; flex: 0 0 auto; align-items: center; gap: 9px; } header { justify-content: space-between; padding-bottom: 15px; border-bottom: 1px solid var(--hairline); } h2 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.field-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }.field-grid > * { min-width: 0; }
.field-label, .notes > span { display: block; margin-bottom: 7px; color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
textarea { width: 100%; min-height: 72px; padding: 10px 12px; border: 1px solid transparent; border-radius: var(--radius-md); outline: 0; background: var(--field-fill); color: var(--text); font: inherit; resize: vertical; } textarea:hover:not(:focus) { background: var(--field-hover-fill); } textarea:focus { border-color: var(--accent); background: var(--field-focus-fill); box-shadow: var(--field-focus-ring); } textarea:disabled { opacity: .6; }
.hint { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }.error { margin: 0; color: var(--danger); font-size: var(--text-sm); }.weekdays { display: flex; flex-wrap: wrap; gap: 6px; }
.event-times :deep(.note), .event-times :deep(.clear) { display: none; }
footer { flex-wrap: wrap; justify-content: flex-end; padding-top: 18px; border-top: 1px solid var(--hairline); } :deep(.btn) { min-height: 44px; }
@media (max-width: 819px) { .event-editor { height: calc(94dvh - 58px - env(safe-area-inset-bottom, 0px)); }.field-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
