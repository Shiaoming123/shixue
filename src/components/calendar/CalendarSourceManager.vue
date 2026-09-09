<script setup lang="ts">
import { computed, ref, toRaw } from 'vue'
import type { CalendarSource } from '../../domain/calendar/types'
import type { EventCapabilityCommand } from '../../domain/capabilities/event-commands'
import type { CapabilityCommand } from '../../domain/capabilities/types'
import Button from '../ui/Button.vue'
import Checkbox from '../ui/Checkbox.vue'
import Input from '../ui/Input.vue'
import Sheet from '../ui/Sheet.vue'

type SourceCommand = EventCapabilityCommand | Extract<CapabilityCommand, { type: 'calendar_source.preferences' }>
const props = defineProps<{ sources: CalendarSource[]; timezone: string; execute: (command: SourceCommand) => Promise<void> }>()
const open = ref(false)
const base = ref<CalendarSource | null>(null)
const preferenceOnly = computed(() => Boolean(base.value && (base.value.provider !== 'local' || base.value.permission !== 'write')))
const title = ref('')
const color = ref('#668575')
const group = ref('')
const zone = ref(props.timezone)
const busy = ref(false)
const error = ref('')
function edit(source: CalendarSource | null) {
  base.value = source ? structuredClone(toRaw(source)) : null
  title.value = source?.title ?? ''
  color.value = source?.color ?? '#668575'
  group.value = source?.group ?? ''
  zone.value = source?.timezone ?? props.timezone
  error.value = ''
}
async function run(command: SourceCommand, reset = false) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await props.execute(command); if (reset) edit(null) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '日历未保存。' }
  finally { busy.value = false }
}
function save() {
  const patch = { title: title.value.trim(), color: color.value, group: group.value.trim() || null, timezone: zone.value.trim() }
  if (base.value && preferenceOnly.value) return run({ type: 'calendar_source.preferences', sourceId: base.value.id, expectedRevision: base.value.revision, patch: { color: patch.color, group: patch.group } }, true)
  return run(base.value ? { type: 'calendar_source.update', sourceId: base.value.id, expectedRevision: base.value.revision, patch }
    : { type: 'calendar_source.create', source: { ...patch, selected: true, hidden: false } }, true)
}
</script>

<template>
  <Button size="sm" @click="open = true; edit(null)">管理日历</Button>
  <Sheet :open="open" label="管理日历" @close="!busy && (open = false)">
    <section class="source-manager">
      <header><h2>管理日历</h2><Button variant="ghost" :disabled="busy" @click="open = false">关闭</Button></header>
      <article v-for="source in sources.filter((item) => !item.archivedAt)" :key="source.id">
        <Checkbox :model-value="source.selected && !source.hidden" :label="`${source.title}${source.group ? ` · ${source.group}` : ''}`" :disabled="busy" @update:model-value="run({ type: 'calendar_source.preferences', sourceId: source.id, expectedRevision: source.revision, patch: { selected: $event, hidden: false } })" />
        <Button size="sm" :disabled="busy" @click="edit(source)">编辑 {{ source.title }}</Button><span v-if="source.provider !== 'local' || source.permission !== 'write'">日程只读</span>
      </article>
      <form @submit.prevent="save">
        <h3>{{ base ? '编辑日历' : '新建日历' }}</h3>
        <Input v-model="title" label="日历名称" required :disabled="busy || preferenceOnly" />
        <Input v-model="color" label="日历颜色（#RRGGBB）" required :disabled="busy" />
        <Input v-model="group" label="分组" :disabled="busy" />
        <Input v-model="zone" label="日历时区（IANA）" required :disabled="busy || preferenceOnly" />
        <p>浮动和全天日程的提醒按此时区计算，全天开始为 00:00。</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <footer><Button v-if="base?.provider === 'local' && base.permission === 'write'" :disabled="busy" @click="run({ type: 'calendar_source.archive', sourceId: base.id, expectedRevision: base.revision }, true)">归档日历</Button><Button v-if="base" :disabled="busy" @click="edit(null)">新增日历</Button><Button variant="primary" type="submit" :disabled="busy || !title.trim()">保存日历</Button></footer>
      </form>
      <slot name="connections" />
    </section>
  </Sheet>
</template>

<style scoped>
.source-manager { display: grid; gap: var(--space-4); padding: var(--space-5); color: var(--text); }
header, article, footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); }
form { display: grid; gap: var(--space-3); }
h2, h3, p { margin: 0; }
p { color: var(--muted); font-size: var(--text-sm); }
[role='alert'] { color: var(--danger); }
</style>
