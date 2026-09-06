<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ArrowRight, X } from '@lucide/vue'
import DateTimePicker from '../ui/DateTimePicker.vue'
import Listbox from '../ui/Listbox.vue'
import { useModalOverlay } from '../ui/use-overlay'

export type TaskActionMode = 'plan' | 'defer' | 'block' | 'cancel' | 'reopen'
export interface TopicOption { id: string; title: string }
export interface TaskActionPayload {
  topicId: string | null
  plannedOn: string | null
  dueOn: string | null
  estimateMinutes: number | null
  acceptanceCriteria: string[]
  reason: string
}

const props = defineProps<{
  open: boolean
  mode: TaskActionMode
  taskTitle: string
  topics: TopicOption[]
  defaultTopicId?: string | null
  defaultPlannedOn?: string | null
  defaultDueOn?: string | null
  defaultMinutes?: number | null
  defaultCriteria?: string[]
}>()

const emit = defineEmits<{ close: []; submit: [payload: TaskActionPayload] }>()
const panel = ref<HTMLElement | null>(null)
const titleId = `task-action-title-${useId()}`
const { layerId } = useModalOverlay(() => props.open, panel, () => emit('close'))
const topicId = ref('')
const plannedOn = ref('')
const dueOn = ref('')
const minutes = ref<number | null>(45)
const criteria = ref('')
const reason = ref('')
const topicOptions = computed(() => [
  { value: '', label: '选择一个主题', disabled: true },
  ...props.topics.map((topic) => ({ value: topic.id, label: topic.title })),
])

watch(() => props.open, (open) => {
  if (!open) return
  topicId.value = props.defaultTopicId ?? props.topics[0]?.id ?? ''
  plannedOn.value = props.defaultPlannedOn ?? new Date().toLocaleDateString('sv-SE')
  dueOn.value = props.defaultDueOn ?? ''
  minutes.value = props.defaultMinutes ?? 45
  criteria.value = (props.defaultCriteria ?? []).join('\n')
  reason.value = ''
})

const title = computed(() => ({
  plan: '把想法变成可开始的任务',
  defer: '把这项任务移到什么时候？',
  block: '记录当前阻碍',
  cancel: '取消这项学习任务？',
  reopen: '重新开始这项任务',
}[props.mode]))

const submitLabel = computed(() => ({
  plan: '保存任务', defer: '确认延期', block: '标记受阻', cancel: '取消任务', reopen: '重开任务',
}[props.mode]))

const ready = computed(() => {
  if (props.mode === 'plan') return Boolean(topicId.value && plannedOn.value && criteria.value.trim())
  if (props.mode === 'block') return Boolean(reason.value.trim())
  if (props.mode === 'defer' || props.mode === 'reopen') return Boolean(plannedOn.value)
  return true
})

function submit() {
  if (!ready.value) return
  emit('submit', {
    topicId: topicId.value || null,
    plannedOn: plannedOn.value || null,
    dueOn: dueOn.value || null,
    estimateMinutes: minutes.value && minutes.value > 0 ? Math.round(minutes.value) : null,
    acceptanceCriteria: criteria.value.split('\n').map((item) => item.trim()).filter(Boolean),
    reason: reason.value.trim(),
  })
}
</script>

<template>
  <Teleport defer to="#ui-overlay-host">
  <div v-if="open" class="backdrop">
    <form ref="panel" :data-overlay-layer="layerId" tabindex="-1" class="sheet" role="dialog" aria-modal="true" :aria-labelledby="titleId" @submit.prevent="submit">
      <header><div><p>任务操作</p><h2 :id="titleId">{{ title }}</h2></div><button type="button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="20" /></button></header>
      <p class="task-title">{{ taskTitle }}</p>

      <template v-if="mode === 'plan'">
        <label><span>所属主题</span><Listbox v-model="topicId" :options="topicOptions" label="所属主题" required /></label>
        <label><span>完成标准</span><textarea v-model="criteria" placeholder="每行一条可验证结果" /></label>
      </template>

      <template v-if="mode === 'plan' || mode === 'defer' || mode === 'reopen'">
        <div class="date-grid">
          <label><span>{{ mode === 'defer' ? '延期到' : '计划日期' }}</span><DateTimePicker v-model="plannedOn" :label="mode === 'defer' ? '延期到' : '计划日期'" required /></label>
          <label v-if="mode === 'plan'"><span>截止日期 <small>可选</small></span><DateTimePicker v-model="dueOn" label="截止日期" placeholder="不设置截止日期" /></label>
        </div>
        <label v-if="mode === 'plan'"><span>预计时长</span><div class="minutes"><input v-model.number="minutes" type="number" min="5" max="480" /><b>分钟</b></div></label>
      </template>

      <label v-if="mode === 'defer' || mode === 'block' || mode === 'cancel'"><span>{{ mode === 'block' ? '为什么受阻？' : '原因' }} <small v-if="mode !== 'block'">可选</small></span><textarea v-model="reason" :placeholder="mode === 'block' ? '写下缺少的前置条件，方便之后继续' : '时间不够、前置未完成或优先级变化'" /></label>

      <p v-if="mode === 'cancel'" class="danger-note">它会离开今天和主题待办，但已有学习记录与历史事件仍会保留。</p>
      <p v-if="mode === 'reopen'" class="note">原完成记录不会改变；再次完成时会新增一条记录。</p>

      <footer><button type="button" class="cancel" @click="emit('close')">返回</button><button type="submit" class="save" :class="{ danger: mode === 'cancel' }" :disabled="!ready"><span>{{ submitLabel }}</span><ArrowRight :size="18" /></button></footer>
    </form>
  </div>
  </Teleport>
</template>

<style scoped>
.backdrop { pointer-events: auto; }
.backdrop { position: fixed; z-index: var(--z-modal); inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, var(--text) 22%, transparent); backdrop-filter: saturate(120%) blur(12px); }
.sheet { width: min(100%, 560px); max-height: calc(100dvh - 40px); overflow-y: auto; overscroll-behavior: contain; padding: 28px; border: 1px solid var(--hairline); border-radius: var(--radius-2xl); background: var(--material-regular); box-shadow: var(--shadow-lg); animation: sheet-in var(--motion-slow) var(--ease-spring); }
@keyframes sheet-in { from { transform: translateY(20px) scale(.985); opacity: .75; } }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; } header p { margin: 0 0 4px; color: var(--accent); font-size: 11px; } h2 { margin: 0; font-size: 23px; font-weight: 650; } header button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--surface-alt); color: var(--muted); }
.task-title { margin: 20px 0; padding: 12px 0; border-block: 1px solid var(--border); color: var(--muted); font-size: 12px; }
label { display: block; margin-top: 16px; } label > span { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; } label small { color: var(--muted); font-weight: 400; }
input, textarea { width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); outline: 0; background: var(--control-fill); color: var(--text); font-size: 13px; transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease); } textarea { min-height: 82px; resize: vertical; line-height: 1.5; } input:focus, textarea:focus { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }
.date-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.minutes { display: flex; align-items: center; gap: 9px; }.minutes input { width: 110px; }.minutes b { color: var(--muted); font-size: 12px; font-weight: 400; }.note, .danger-note { margin: 18px 0 0; padding: 12px 13px; border-radius: 10px; background: var(--surface-alt); color: var(--muted); font-size: 11px; line-height: 1.55; }.danger-note { color: var(--danger); }
footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--hairline); } footer button { min-height: 46px; padding: 0 18px; border-radius: var(--radius-lg); font-size: 12px; font-weight: 600; }.cancel { border: 1px solid var(--hairline); background: var(--control-fill); color: var(--text); }.save { min-width: 150px; display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; background: var(--accent); color: var(--accent-text); box-shadow: 0 5px 14px color-mix(in srgb, var(--accent) 20%, transparent); }.save.danger { background: var(--danger); }.save:disabled { opacity: .42; box-shadow: none; }
@media (max-width: 819px) { .backdrop { align-items: flex-end; padding: 0; }.sheet { position: relative; max-height: 94dvh; border-width: 1px 0 0; border-radius: var(--radius-2xl) var(--radius-2xl) 0 0; padding: 34px 20px calc(22px + env(safe-area-inset-bottom, 0px)); animation-name: sheet-up; }.sheet::before { content: ''; position: absolute; top: 9px; left: 50%; width: 36px; height: 5px; transform: translateX(-50%); border-radius: 999px; background: color-mix(in srgb, var(--muted) 32%, transparent); }.date-grid { grid-template-columns: 1fr; } footer { align-items: stretch; flex-direction: column-reverse; }.save { width: 100%; min-height: 52px; }.cancel { border-color: transparent; background: transparent; } }
@keyframes sheet-up { from { transform: translateY(36px); opacity: .75; } }
</style>
