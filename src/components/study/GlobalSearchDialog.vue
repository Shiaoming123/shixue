<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { FileCheck2, ListTodo, Search } from '@lucide/vue'
import { searchWorkspace, type WorkspaceSearchQuery, type WorkspaceSearchResult } from '../../domain/search/workspace-search.ts'
import { SYSTEM_LEARNING_LIST_ID } from '../../domain/workspace/migrate.ts'
import type { TaskStatus, WorkspaceStateV4 } from '../../domain/workspace/types.ts'
import Button from '../ui/Button.vue'
import DateTimePicker from '../ui/DateTimePicker.vue'
import Dialog from '../ui/Dialog.vue'
import EmptyState from '../ui/EmptyState.vue'
import Listbox, { type ListboxOption } from '../ui/Listbox.vue'

const props = defineProps<{
  open: boolean
  workspace: WorkspaceStateV4 | null
  timezone: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: []
  openTask: [taskId: string]
  openRecord: [recordId: string]
  manageTags: []
}>()

const EMPTY_RESULTS: WorkspaceSearchResult = { tasks: [], completionRecords: [] }
const MAX_VISIBLE_RESULTS_PER_KIND = 100
const text = ref('')
const kind = ref('')
const topic = ref('')
const status = ref('')
const from = ref('')
const to = ref('')
const selectedTagIds = ref<string[]>([])
const searchInput = ref<HTMLInputElement | null>(null)

const kindOptions: readonly ListboxOption[] = [
  { value: '', label: '全部类型' },
  { value: 'task', label: '任务' },
  { value: 'completion_record', label: '完成记录' },
]
const statusOptions: readonly ListboxOption[] = [
  { value: '', label: '全部状态' },
  { value: 'inbox', label: '收件箱' },
  { value: 'planned', label: '已计划' },
  { value: 'in_progress', label: '进行中' },
  { value: 'blocked', label: '有卡点' },
  { value: 'completed', label: '已完成任务' },
  { value: 'cancelled', label: '已取消' },
  { value: 'recorded', label: '已沉淀记录' },
]
const statusLabels = new Map(statusOptions.map((option) => [option.value, option.label]))

const orderedLists = computed(() => [...(props.workspace?.lists ?? [])]
  .sort((left, right) => left.position - right.position || compareText(left.id, right.id)))
const orderedTags = computed(() => [...(props.workspace?.tags ?? [])]
  .sort((left, right) => left.position - right.position || compareText(left.id, right.id)))
const listTitles = computed(() => new Map(orderedLists.value.map((list) => [list.id, list.title])))
const tagTitles = computed(() => new Map(orderedTags.value.map((tag) => [tag.id, tag.title])))
const topicOptions = computed<readonly ListboxOption[]>(() => [
  { value: '', label: '全部主题' },
  ...orderedLists.value.map((list) => ({
    value: list.id === SYSTEM_LEARNING_LIST_ID ? 'learning' : `id:${list.id}`,
    label: `${list.title}${list.archivedAt ? '（已归档）' : ''}`,
  })),
])
const dateError = computed(() => from.value && to.value && from.value > to.value
  ? '开始日期不能晚于结束日期。'
  : '')
const hasFilters = computed(() => Boolean(
  text.value.trim() || kind.value || topic.value || status.value || from.value || to.value || selectedTagIds.value.length,
))
const query = computed<WorkspaceSearchQuery>(() => {
  const value: WorkspaceSearchQuery = {}
  if (text.value) value.text = text.value
  if (kind.value) value.kinds = [kind.value as 'task' | 'completion_record']
  if (topic.value) value.topicIds = [topic.value === 'learning' ? null : topic.value.slice(3)]
  if (selectedTagIds.value.length) value.tagIds = [...selectedTagIds.value]
  if (status.value) value.statuses = [status.value as TaskStatus | 'recorded']
  if (from.value || to.value) {
    value.date = {
      ...(from.value ? { from: from.value } : {}),
      ...(to.value ? { to: to.value } : {}),
      timezone: props.timezone,
    }
  }
  return value
})
const results = computed<WorkspaceSearchResult>(() => {
  if (!props.workspace || dateError.value || !hasFilters.value) return EMPTY_RESULTS
  return searchWorkspace(props.workspace, query.value)
})
const resultCount = computed(() => results.value.tasks.length + results.value.completionRecords.length)
const visibleTasks = computed(() => results.value.tasks.slice(0, MAX_VISIBLE_RESULTS_PER_KIND))
const visibleCompletionRecords = computed(() => results.value.completionRecords.slice(0, MAX_VISIBLE_RESULTS_PER_KIND))
const visibleResultCount = computed(() => visibleTasks.value.length + visibleCompletionRecords.value.length)
const resultsTruncated = computed(() => visibleResultCount.value < resultCount.value)

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  searchInput.value?.focus({ preventScroll: true })
})

function toggleTag(tagId: string) {
  selectedTagIds.value = selectedTagIds.value.includes(tagId)
    ? selectedTagIds.value.filter((value) => value !== tagId)
    : [...selectedTagIds.value, tagId]
}

function clearFilters() {
  text.value = ''
  kind.value = ''
  topic.value = ''
  status.value = ''
  from.value = ''
  to.value = ''
  selectedTagIds.value = []
  nextTick(() => searchInput.value?.focus({ preventScroll: true }))
}

function selectTask(taskId: string) {
  emit('openTask', taskId)
  requestClose()
}

function selectRecord(recordId: string) {
  emit('openRecord', recordId)
  requestClose()
}

function openTagManager() {
  emit('manageTags')
  requestClose()
}

function requestClose() {
  emit('update:open', false)
  emit('close')
}

function taskTopicTitle(listId: string): string {
  return listTitles.value.get(listId) ?? '未命名主题'
}

function recordTopicTitle(topicId: string | null): string {
  return listTitles.value.get(topicId ?? SYSTEM_LEARNING_LIST_ID) ?? '学习'
}

function tagsFor(tagIds: readonly string[]): string[] {
  return tagIds.map((tagId) => tagTitles.value.get(tagId) ?? tagId)
}

function taskSummary(hit: WorkspaceSearchResult['tasks'][number]): string {
  const { task, matchedFields } = hit
  if (matchedFields.includes('notes') && task.notes) return task.notes
  if (matchedFields.includes('acceptance_criteria') && task.learning?.acceptanceCriteria.length) {
    return firstMatching(task.learning.acceptanceCriteria) ?? task.learning.acceptanceCriteria[0]!
  }
  if (matchedFields.includes('checklist') && task.checklist.length) {
    return firstMatching(task.checklist.map(({ text }) => text)) ?? task.checklist[0]!.text
  }
  if (matchedFields.includes('blocker') && task.learning?.blockedReason) return task.learning.blockedReason
  return task.notes || task.learning?.acceptanceCriteria[0] || statusLabels.get(task.status) || task.status
}

function firstMatching(values: readonly string[]): string | undefined {
  const needle = normalizeText(text.value)
  return needle ? values.find((value) => normalizeText(value).includes(needle)) : undefined
}

function recordSummary(hit: WorkspaceSearchResult['completionRecords'][number]): string {
  const { record, matchedFields } = hit
  if (matchedFields.includes('evidence') && record.evidence) return `证据：${record.evidence}`
  if (matchedFields.includes('blocker') && record.blocker) return `卡点：${record.blocker}`
  if (matchedFields.includes('next_action') && record.nextAction) return `下一步：${record.nextAction}`
  return record.learned || record.evidence || record.nextAction
}

function taskDate(hit: WorkspaceSearchResult['tasks'][number]): string {
  const { task, matchedDates } = hit
  if (matchedDates.includes('due')) return `截止 ${task.deadline.dueOn ?? localDate(task.deadline.dueAt)}`
  if (matchedDates.includes('scheduled')) return `计划 ${task.schedule.startOn ?? localDate(task.schedule.startAt)}`
  const scheduled = task.schedule.startOn ?? localDate(task.schedule.startAt)
  return scheduled ? `计划 ${scheduled}` : ''
}

function completionDate(value: string): string {
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: props.timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(instant)
}

function localDate(value: string | null): string {
  if (!value) return ''
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: props.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}
</script>

<template>
  <Dialog
    :open="open"
    title="搜索学习事实"
    description="同时查找任务内容、检查项，以及完成时留下的收获、证据和下一步。"
    size="xl"
    @update:open="emit('update:open', $event)"
    @close="emit('close')"
  >
    <label class="search-box">
      <Search :size="19" :stroke-width="1.8" />
      <input
        ref="searchInput"
        v-model="text"
        type="search"
        autofocus
        aria-label="搜索任务与完成记录"
        autocomplete="off"
        placeholder="搜索任务、标签、检查项、收获或证据"
      />
      <span v-if="resultCount" aria-live="polite">{{ resultCount }} 条</span>
    </label>

    <div class="search-layout">
      <aside class="filters" aria-label="搜索筛选">
        <div class="filter-heading">
          <strong>筛选</strong>
          <div>
            <Button variant="ghost" size="sm" @click="openTagManager">管理标签</Button>
            <Button v-if="hasFilters" variant="ghost" size="sm" @click="clearFilters">清除</Button>
          </div>
        </div>
        <Listbox v-model="kind" :options="kindOptions" label="按结果类型筛选" variant="compact" />
        <Listbox v-model="topic" :options="topicOptions" label="按主题筛选" variant="compact" />
        <Listbox v-model="status" :options="statusOptions" label="按状态筛选" variant="compact" />

        <div class="date-range">
          <div class="date-field"><span>开始日期</span><DateTimePicker v-model="from" label="开始日期" placeholder="不限制开始日期" /></div>
          <div class="date-field"><span>结束日期</span><DateTimePicker v-model="to" label="结束日期" placeholder="不限制结束日期" /></div>
          <p v-if="dateError" role="alert">{{ dateError }}</p>
        </div>

        <fieldset v-if="orderedTags.length" class="tag-filter">
          <legend>标签（同时满足）</legend>
          <div>
            <button
              v-for="tag in orderedTags"
              :key="tag.id"
              type="button"
              :class="{ selected: selectedTagIds.includes(tag.id) }"
              :aria-pressed="selectedTagIds.includes(tag.id)"
              @click="toggleTag(tag.id)"
            >
              {{ tag.title }}<small v-if="tag.archivedAt">已归档</small>
            </button>
          </div>
        </fieldset>
      </aside>

      <section class="results" aria-label="搜索结果" aria-live="polite">
        <template v-if="workspace && !dateError && resultCount">
          <section v-if="results.tasks.length" class="result-group">
            <h3>任务 <span>{{ results.tasks.length }}</span></h3>
            <button v-for="hit in visibleTasks" :key="hit.id" type="button" class="result-row" @click="selectTask(hit.id)">
              <span class="result-icon"><ListTodo :size="18" :stroke-width="1.8" /></span>
              <span class="result-copy">
                <strong>{{ hit.task.title }}</strong>
                <span>{{ taskSummary(hit) }}</span>
                <small>
                  <span>{{ taskTopicTitle(hit.task.listId) }}</span>
                  <span v-if="taskDate(hit)">{{ taskDate(hit) }}</span>
                  <span v-for="tag in tagsFor(hit.tagIds)" :key="tag">#{{ tag }}</span>
                </small>
              </span>
            </button>
          </section>

          <section v-if="results.completionRecords.length" class="result-group">
            <h3>完成记录 <span>{{ results.completionRecords.length }}</span></h3>
            <button v-for="hit in visibleCompletionRecords" :key="hit.id" type="button" class="result-row" @click="selectRecord(hit.id)">
              <span class="result-icon result-icon--record"><FileCheck2 :size="18" :stroke-width="1.8" /></span>
              <span class="result-copy">
                <strong>{{ hit.record.taskTitleSnapshot }}</strong>
                <span>{{ recordSummary(hit) }}</span>
                <small>
                  <span>{{ recordTopicTitle(hit.topicId) }}</span>
                  <span>{{ completionDate(hit.record.completedAt) }}</span>
                  <span v-for="tag in tagsFor(hit.tagIds)" :key="tag">#{{ tag }}</span>
                </small>
              </span>
            </button>
          </section>
          <p v-if="resultsTruncated" class="result-limit" role="status">显示前 {{ visibleResultCount }} 条结果，请增加筛选条件以缩小范围。</p>
        </template>

        <EmptyState
          v-else-if="!workspace"
          icon="inbox"
          title="正在载入学习资料"
          description="资料准备好后就能开始搜索。"
        />
        <EmptyState
          v-else-if="dateError"
          icon="inbox"
          title="日期范围需要调整"
          description="修改开始或结束日期后，搜索结果会自动更新。"
        />
        <EmptyState
          v-else
          icon="inbox"
          :title="hasFilters ? '没有匹配的学习事实' : '输入关键词或选择筛选条件'"
          :description="hasFilters ? '换个关键词，或清除部分筛选后再试。' : '搜索会在你开始输入或选择筛选后运行。'"
        >
          <Button v-if="hasFilters" variant="secondary" size="sm" @click="clearFilters">清除筛选</Button>
        </EmptyState>
      </section>
    </div>
  </Dialog>
</template>

<style scoped>
.search-box {
  min-height: var(--field-min-height);
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--field-fill);
  color: var(--muted);
  transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease);
}

.search-box:focus-within {
  border-color: var(--accent);
  background: var(--field-focus-fill);
  box-shadow: var(--field-focus-ring);
}

.search-box:hover:not(:focus-within) { background: var(--field-hover-fill); }

.search-box input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--text-md);
}

.search-box input::placeholder { color: var(--muted); }
.search-box > span { font-size: var(--text-xs); white-space: nowrap; }

.search-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--space-5);
  margin-top: var(--space-5);
}

.filters {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-right: var(--space-5);
  border-right: 1px solid var(--hairline);
}

.filter-heading {
  min-height: var(--control-hit);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.filter-heading strong { font-size: var(--text-sm); font-weight: 650; }
.filter-heading > div { display: flex; align-items: center; gap: 2px; }
.date-range { display: grid; gap: var(--space-2); padding-top: var(--space-1); }
.date-field { display: grid; gap: var(--space-1); color: var(--muted); font-size: var(--text-sm); font-weight: var(--font-medium); }
.date-range :deep(.date-trigger) { min-height: var(--control-hit); font-size: var(--text-sm); }
.date-range p { margin: 0; color: var(--danger); font-size: var(--text-xs); line-height: 1.45; }

.tag-filter { min-width: 0; margin: 0; padding: var(--space-2) 0 0; border: 0; }
.tag-filter legend { padding: 0; color: var(--muted); font-size: var(--text-sm); font-weight: var(--font-medium); }
.tag-filter > div { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.tag-filter button {
  min-height: max(32px, var(--control-hit));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 var(--space-3);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-full);
  background: var(--control-fill);
  color: var(--muted);
  font: inherit;
  font-size: var(--text-xs);
}
.tag-filter button.selected { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
.tag-filter button small { font-size: 9px; opacity: .72; }

.results {
  min-width: 0;
  max-height: min(62dvh, 620px);
  overflow-y: auto;
  padding-right: var(--space-1);
}

.result-group + .result-group { margin-top: var(--space-5); }
.result-group h3 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  color: var(--muted);
  font-size: var(--text-sm);
  font-weight: 650;
}
.result-group h3 span {
  min-width: 20px;
  padding: 2px 6px;
  border-radius: var(--radius-full);
  background: var(--control-fill);
  color: var(--text);
  font-size: var(--text-xs);
  text-align: center;
}

.result-row {
  width: 100%;
  min-height: 84px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: start;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
}
.result-row:hover, .result-row:focus-visible { background: var(--control-fill); }
.result-row:focus-visible { outline: 0; box-shadow: var(--focus-ring); }
.result-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent);
}
.result-icon--record { border-radius: var(--radius-full); }
.result-copy { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.result-copy strong, .result-copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-copy strong { font-size: var(--text-base); font-weight: 620; }
.result-copy > span { color: var(--muted); font-size: var(--text-sm); }
.result-copy small { display: flex; flex-wrap: wrap; gap: 4px var(--space-2); color: var(--muted); font-size: var(--text-xs); }
.result-copy small span:not(:first-child) { color: color-mix(in srgb, var(--muted) 84%, var(--accent)); }
.result-limit { margin: var(--space-4) 0 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }

@media (max-width: 819px) {
  .search-layout { grid-template-columns: 1fr; gap: var(--space-4); }
  .filters { padding: 0 0 var(--space-4); border-right: 0; border-bottom: 1px solid var(--hairline); }
  .results { max-height: none; overflow: visible; }
  .result-row { min-height: 88px; padding-inline: var(--space-2); }
}

@media (max-width: 439px) {
  .search-box { padding-inline: var(--space-3); }
  .search-box > span { display: none; }
  .result-copy small { gap: 3px var(--space-1); }
}
</style>
