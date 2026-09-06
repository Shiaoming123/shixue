<script setup lang="ts">
import { computed } from 'vue'
import type { ReminderDelivery } from '../../domain/workspace/types'
import Button from '../ui/Button.vue'

export type ReminderCardAction = { deliveryId: string; action: 'complete' | 'snooze' | 'open' | 'retry'; minutes?: 10; expectedRevision?: number }
const props = withDefaults(defineProps<{
  delivery: ReminderDelivery
  taskTitle: string
  learning?: boolean
  notificationAvailable?: boolean
  busy?: boolean
  error?: string
}>(), { learning: false, notificationAvailable: false, busy: false, error: '' })
const emit = defineEmits<{ action: [value: ReminderCardAction] }>()
const canAct = computed(() => ['pending', 'delivered', 'snoozed'].includes(props.delivery.status))
const canRetry = computed(() => ['failed', 'ambiguous'].includes(props.delivery.status))
function act(action: ReminderCardAction['action']) {
  if (props.busy || (action === 'retry' ? !canRetry.value : action !== 'open' && !canAct.value)) return
  emit('action', { deliveryId: props.delivery.id, action, ...(action === 'snooze' ? { minutes: 10 as const } : {}), ...(action === 'retry' ? { expectedRevision: props.delivery.revision ?? 1 } : {}) })
}
</script>

<template>
  <article class="reminder-card" aria-label="任务提醒">
    <p class="kind">{{ notificationAvailable ? '任务提醒' : '仅应用内提醒' }}</p>
    <h3>{{ taskTitle }}</h3>
    <p v-if="delivery.status === 'failed'" class="message" role="status">提醒发送失败，可重试。</p>
    <p v-if="delivery.status === 'ambiguous'" class="message" role="status">无法确认提醒是否已送达，重试可能重复通知。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="actions">
      <Button size="sm" :disabled="busy || !canAct" @click="act('complete')">{{ learning ? '记录完成' : '完成' }}</Button>
      <Button size="sm" :disabled="busy || !canAct" @click="act('snooze')">稍后 10 分钟</Button>
      <Button size="sm" :disabled="busy" @click="act('open')">打开任务</Button>
      <Button v-if="canRetry" size="sm" :disabled="busy" @click="act('retry')">{{ delivery.status === 'ambiguous' ? '仍然重试' : '重试提醒' }}</Button>
    </div>
  </article>
</template>

<style scoped>
.reminder-card { padding: var(--space-4); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); color: var(--text); }
h3 { margin: var(--space-1) 0 var(--space-3); font-size: var(--text-base); overflow-wrap: anywhere; }
.kind, .message, .error { margin: var(--space-2) 0; color: var(--muted); font-size: var(--text-xs); }
.error { color: var(--danger); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
