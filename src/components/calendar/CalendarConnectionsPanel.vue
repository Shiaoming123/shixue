<script setup lang="ts">
import { ref } from 'vue'
import type { CalendarConnectionsController } from '../../lib/use-calendar-connections'
import Button from '../ui/Button.vue'
import Checkbox from '../ui/Checkbox.vue'
import Listbox from '../ui/Listbox.vue'
defineProps<{ controller: CalendarConnectionsController }>()
const mode = ref('freebusy')
const revoke = ref(true)
const statusCopy = { unavailable: '当前构建未配置可用的 Google 日历连接。', disconnected: '尚未连接', ready: '已连接', 'session-only': '已连接；会话到期后需要重新授权。' }
</script>

<template>
  <section class="calendar-connections" aria-label="外部日历连接">
    <header><h3>Google 日历</h3><Button size="sm" :disabled="controller.state.busy" @click="controller.inspect">检查连接</Button></header>
    <p>{{ statusCopy[controller.state.status] }}</p>
    <Listbox v-model="mode" label="读取范围" :disabled="controller.state.busy" :options="[{ value: 'freebusy', label: '仅忙闲（不读取会议详情）' }, { value: 'details', label: '会议详情与忙闲（只读）' }]" />
    <Button :disabled="controller.state.busy" @click="controller.connect(mode as 'freebusy' | 'details')">{{ controller.state.busy ? '处理中…' : '在浏览器中连接 Google' }}</Button>
    <p>授权后可选择同步日历。同步不会创建任务或修改远端会议。</p>
    <article v-for="calendar in controller.state.calendars" :key="calendar.id">
      <strong>{{ calendar.title }}</strong><span>{{ calendar.access === 'details' ? '会议只读' : calendar.access === 'freebusy' ? '仅忙闲' : '无访问权限' }}</span>
      <div class="actions"><Button size="sm" :disabled="controller.state.busy" @click="controller.synchronize(calendar.remoteId)">{{ calendar.access === 'details' ? '同步日程' : '更新访问权限' }}</Button><Button v-if="calendar.access !== 'none'" size="sm" :disabled="controller.state.busy" @click="controller.queryBusy(calendar.remoteId)">查询未来7天忙闲</Button></div>
      <p v-for="result in controller.state.busyResults.filter((item) => item.calendarId === calendar.remoteId)" :key="result.calendarId">{{ result.error ? '忙闲未知' : `${result.intervals.length} 个忙碌时段` }} · 有效至 {{ new Date(result.expiresAt).toLocaleTimeString() }}</p>
    </article>
    <template v-if="['ready', 'session-only'].includes(controller.state.status)">
      <Checkbox v-model="revoke" label="断开时撤销 Google 授权" :disabled="controller.state.busy" />
      <p>撤销可能同时影响此 Google 应用项目的其他授权。断开后保留已缓存日程和本地任务。</p>
      <Button :disabled="controller.state.busy" @click="controller.disconnect(revoke)">断开连接并保留缓存</Button>
    </template>
    <p v-if="controller.state.error" role="alert">{{ controller.state.error }}</p><p v-if="controller.state.message" role="status">{{ controller.state.message }}</p>
    <p>飞书连接需要配置安全的授权服务，当前构建尚不可用。</p>
  </section>
</template>

<style scoped>
.calendar-connections { display: grid; gap: var(--space-3); border-top: 1px solid var(--hairline); padding-top: var(--space-4); }
header, .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; justify-content: space-between; }
article { display: grid; gap: var(--space-2); padding: var(--space-3); background: var(--surface-alt); border-radius: var(--radius-md); overflow-wrap: anywhere; }
h3, p { margin: 0; } p, article > span { font-size: var(--text-sm); color: var(--muted); } [role='alert'] { color: var(--danger); }
</style>
