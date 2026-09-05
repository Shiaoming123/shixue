<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Settings } from '@lucide/vue'
import { applyTheme } from './assets/themes'
import AppSidebar, { type StudyPage, type StudySmartView, type StudySmartViewCounts } from './components/study/AppSidebar.vue'
import BottomTabs from './components/study/BottomTabs.vue'
import CompletionSheet, { type CompletionPayload } from './components/study/CompletionSheet.vue'
import FocusView from './components/study/FocusView.vue'
import ReviewView, { type CompletionRecordViewItem, type ReviewViewItem } from './components/study/ReviewView.vue'
import SettingsSheet, { type CloudAccountStatus } from './components/study/SettingsSheet.vue'
import TaskActionSheet, { type TaskActionMode, type TaskActionPayload } from './components/study/TaskActionSheet.vue'
import TaskDetailDrawer, { type TaskEventViewItem } from './components/study/TaskDetailDrawer.vue'
import TaskEditSheet, { type TaskEditValue } from './components/study/TaskEditSheet.vue'
import RecurrenceScopeDialog, { type RecurrenceRuleScope } from './components/study/RecurrenceScopeDialog.vue'
import OccurrenceRescheduleSheet from './components/study/OccurrenceRescheduleSheet.vue'
import { type RecurrenceRule } from './components/study/RecurrenceEditor.vue'
import TasksView, { type OccurrenceViewItem, type TaskViewItem, type TaskViewStatus } from './components/study/TasksView.vue'
import TopicsView, { type TopicViewItem } from './components/study/TopicsView.vue'
import Listbox from './components/ui/Listbox.vue'
import OverlayHost from './components/ui/OverlayHost.vue'
import ToastRegion from './components/ui/ToastRegion.vue'
import { projectTaskItems, queryStudyTasks, selectStudyTaskSmartView, type StudyTaskQuerySort, type StudyTaskSmartView, type TaskProjectionReason } from './lib/study-task-query'
import { selectStudyReminders, selectTaskReminderTriggers } from './lib/study-reminders'
import { loadPlanningPreferences, savePlanningPreferences, type PlanningPreferences } from './lib/planning-preferences'
import { detectRuntimeInfo, hasRuntimeCapability } from './lib/platform'
import {
  addTaskChecklistItem,
  archiveStudyListGroup,
  bulkDeleteStudyTasks,
  bulkRescheduleStudyTasks,
  completeStudyTask,
  createTaskFromNextAction,
  deleteStudyTask,
  exportStudyState,
  importStudyState,
  loadStudyState,
  pauseStudySession,
  planStudyTask,
  reviewCompletionRecord,
  rescheduleStudyTask,
  resumeStudySession,
  saveStudyScratchpad,
  saveStudyListGroup,
  saveStudyTopic,
  resetStudyState,
  startStudyTask,
  switchStudyTask,
  setTaskChecklistItem,
  transitionStudyTask,
  toggleStudyTaskCompletion,
  updateStudyTask,
  type CompletionRecord,
  type ReviewResult,
  type StudyState,
  type StudyListGroup,
  type StudyTask,
  type StudyTaskPriority,
  type StudyTopic,
  type TaskEvent,
} from './lib/study'
import { createSeedStudyState } from './storage/study/types'
import { getWorkspaceStore } from './storage/workspace/registry'
import { createTaskCapabilityService } from './domain/capabilities/service'
import { CAPABILITY_PROTOCOL_VERSION, type CapabilityCommand, type CommandEnvelope, type CommandPreview, type EntityRef } from './domain/capabilities/types'
import type { WorkspaceStateV3 } from './domain/workspace/types'
import { parseZonedDateTime, zonedDateTimeToInstant } from './domain/recurrence/timezone'

const page = ref<StudyPage>('today')
const state = ref<StudyState>(createSeedStudyState())
const loading = ref(true)
const showFocus = ref(false)
const completionOpen = ref(false)
const settingsOpen = ref(false)
const topicEditorOpen = ref(false)
const groupEditorOpen = ref(false)
const topicTitle = ref('')
const topicGoal = ref('')
const topicMinutes = ref(120)
const topicGroupId = ref('')
const selectedGroupId = ref('')
const groupTitle = ref('')
const selectedTopicId = ref(state.value.topics[0]?.id ?? '')
const selectedTaskId = ref('')
const selectedOccurrenceId = ref('')
const activeSmartView = ref<StudyTaskSmartView>('today')
const taskSearch = ref('')
const taskTopicFilter = ref('all')
const taskPriorityFilter = ref<StudyTaskPriority | 'all'>('all')
const taskSort = ref<StudyTaskQuerySort>('manual')
const taskActionOpen = ref(false)
const taskActionMode = ref<TaskActionMode>('plan')
const taskActionTaskId = ref('')
const taskEditorOpen = ref(false)
const recurrenceWorkspace = ref<WorkspaceStateV3 | null>(null)
const recurrenceScopeOpen = ref(false)
const recurrencePreview = ref<CommandPreview | null>(null)
const recurrencePreviewing = ref(false)
const recurrenceExecuting = ref(false)
const occurrenceRescheduleOpen = ref(false)
const occurrenceRescheduleId = ref('')
const occurrenceRescheduleValue = ref('')
const occurrenceRescheduleTimed = ref(false)
let pendingRecurrenceRule: RecurrenceRule | null = null
type RecurrenceUpdateEnvelope = CommandEnvelope<Extract<CapabilityCommand, { type: 'recurrence.update' }>>
let recurrencePreviewEnvelope: RecurrenceUpdateEnvelope | null = null
let recurrencePreviewVersion = 0
const reviewRevealed = ref(false)
const reviewMode = ref<'review' | 'records'>('review')
const appearanceDark = ref(false)
const compact = ref(false)
const clock = ref(Date.now())
const toast = ref('')
const toastAction = ref<{ label: string; run: () => Promise<void> } | null>(null)
const toastVersion = ref(0)
const storageError = ref('')
const remindersEnabled = ref(false)
const planningPreferences = ref(loadPlanningPreferences())
const tasksView = ref<InstanceType<typeof TasksView> | null>(null)
const runtime = detectRuntimeInfo()
const capabilityService = createTaskCapabilityService(getWorkspaceStore(), () => new Date().toISOString(), (kind) => `${kind}:${crypto.randomUUID()}`)
const remindersAvailable = hasRuntimeCapability(runtime, 'native-notification')
const cloudConfig = import.meta.env.VITE_STUDY_SUPABASE_URL?.trim() && import.meta.env.VITE_STUDY_SUPABASE_PUBLISHABLE_KEY?.trim() ? {
  provider: 'supabase' as const,
  projectUrl: import.meta.env.VITE_STUDY_SUPABASE_URL.trim(),
  publishableKey: import.meta.env.VITE_STUDY_SUPABASE_PUBLISHABLE_KEY.trim(),
} : undefined
const cloudAvailable = runtime.platform === 'desktop' && Boolean(cloudConfig)
const cloudStatus = ref<CloudAccountStatus>('signed-out')
const cloudEmail = ref('')
const cloudMessage = ref('')
let clockTimer: ReturnType<typeof setInterval> | undefined
let reminderTimer: ReturnType<typeof setInterval> | undefined
let cloudTimer: ReturnType<typeof setInterval> | undefined
let cloudDebounceTimer: ReturnType<typeof setTimeout> | undefined
let scratchSaveTimer: ReturnType<typeof setTimeout> | undefined
let compactMedia: MediaQueryList | undefined

const today = computed(() => new Date().toLocaleDateString('sv-SE'))
const dateLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()).replace('星期', '周'))
const activeSession = computed(() => state.value.sessions.find((session) => !session.deletedAt && (session.state === 'running' || session.state === 'paused')))
const activeTask = computed(() => state.value.tasks.find((task) => task.id === activeSession.value?.taskId && !task.deletedAt))
const selectedTask = computed(() => state.value.tasks.find((task) => task.id === selectedTaskId.value && !task.deletedAt))
const selectedOccurrence = computed(() => recurrenceWorkspace.value?.occurrences.find((occurrence) => occurrence.id === selectedOccurrenceId.value) ?? null)
const selectedRecurrence = computed(() => {
  const workspace = recurrenceWorkspace.value
  const task = workspace?.tasks.find((item) => item.id === selectedTask.value?.id)
  return task?.recurrenceSeriesId ? workspace?.recurrenceSeries.find((series) => series.id === task.recurrenceSeriesId) ?? null : null
})
const selectedRecurrenceRule = computed<RecurrenceRule | null>(() => selectedRecurrence.value ? ({ cadence: selectedRecurrence.value.cadence, basis: selectedRecurrence.value.basis, end: selectedRecurrence.value.end }) : null)
const selectedTaskView = computed(() => selectedTask.value ? toTaskView(selectedTask.value) : undefined)
const selectedTaskEvents = computed(() => selectedTask.value ? state.value.taskEvents.filter((event) => event.taskId === selectedTask.value?.id).sort((a, b) => b.sequence - a.sequence).map(toEventView) : [])
const actionTask = computed(() => state.value.tasks.find((task) => task.id === taskActionTaskId.value))

const elapsedSeconds = computed(() => {
  const session = activeSession.value
  if (!session) return 0
  if (session.state !== 'running' || !session.activeSince) return session.elapsedSeconds
  return session.elapsedSeconds + Math.max(0, Math.floor((clock.value - new Date(session.activeSince).getTime()) / 1000))
})
const timeLabel = computed(() => `${String(Math.floor(elapsedSeconds.value / 60)).padStart(2, '0')}:${String(elapsedSeconds.value % 60).padStart(2, '0')}`)

const topicMap = computed(() => new Map(state.value.topics.map((topic) => [topic.id, topic])))
const liveTasks = computed(() => state.value.tasks.filter((task) => !task.deletedAt))
const filteredTaskViews = computed<TaskViewItem[]>(() => queryStudyTasks(liveTasks.value, state.value.topics, {
  search: taskSearch.value,
  sort: taskSort.value,
  topicId: taskTopicFilter.value === 'all' ? undefined : taskTopicFilter.value === 'unassigned' ? null : taskTopicFilter.value,
  smartView: activeSmartView.value === 'today' ? 'all' : activeSmartView.value,
  today: today.value,
}).filter((task) => taskPriorityFilter.value === 'all' || task.priority === taskPriorityFilter.value).map(toTaskView))
const todayProjections = computed(() => recurrenceWorkspace.value ? projectTaskItems(recurrenceWorkspace.value, { from: today.value, to: today.value }) : [])
const taskViews = computed<TaskViewItem[]>(() => {
  if (activeSmartView.value !== 'today' || !recurrenceWorkspace.value) return filteredTaskViews.value
  const eligible = new Map(filteredTaskViews.value.map((task) => [task.id, task]))
  return todayProjections.value.filter((projection) => projection.occurrenceId === null).map((projection) => eligible.get(projection.taskId)).filter((task): task is TaskViewItem => task !== undefined)
})
const occurrenceViews = computed<OccurrenceViewItem[]>(() => {
  const workspace = recurrenceWorkspace.value
  if (!workspace) return []
  const tasks = new Map(liveTasks.value.map((task) => [task.id, task]))
  const visibleTaskIds = new Set(filteredTaskViews.value.map((task) => task.id))
  if (activeSmartView.value === 'today') {
    return todayProjections.value.filter((projection) => projection.occurrence?.status === 'pending' && visibleTaskIds.has(projection.taskId)).map((projection) => ({
      id: projection.key,
      title: tasks.get(projection.taskId)?.title ?? projection.task.title,
      scheduledLabel: formatPlanDate(projection.scheduledOn ?? projection.scheduledAt),
      deadlineLabel: projection.dueOn || projection.dueAt ? formatPlanDate(projection.dueOn ?? projection.dueAt) : '',
      reasons: projection.reasons.map(projectionReasonLabel),
      occurrence: projection.occurrence!,
    }))
  }
  return workspace.occurrences.filter((occurrence) => occurrence.status === 'pending').map((occurrence) => {
    const series = workspace.recurrenceSeries.find((item) => item.id === occurrence.seriesId)
    const task = series ? tasks.get(series.taskId) : undefined
    const scheduled = occurrence.override?.scheduledOn ?? occurrence.override?.scheduledAt ?? occurrence.scheduledOn ?? occurrence.scheduledAt
    return task && visibleTaskIds.has(task.id) ? { id: `occurrence:${occurrence.id}`, title: task.title, scheduledLabel: formatPlanDate(scheduled), deadlineLabel: task.dueOn ? formatPlanDate(task.dueOn) : '', reasons: ['重复'], occurrence } : null
  }).filter((item): item is OccurrenceViewItem => item !== null)
})

const smartViewCounts = computed<StudySmartViewCounts>(() => ({
  inbox: selectStudyTaskSmartView(liveTasks.value, 'inbox', today.value).length,
  today: recurrenceWorkspace.value ? todayProjections.value.filter((projection) => projection.occurrence?.status !== 'completed' && projection.occurrence?.status !== 'skipped').length : selectStudyTaskSmartView(liveTasks.value, 'today', today.value).length,
  next7: selectStudyTaskSmartView(liveTasks.value, 'next7', today.value).length,
  all: selectStudyTaskSmartView(liveTasks.value, 'all', today.value).length,
  completed: selectStudyTaskSmartView(liveTasks.value, 'completed', today.value).length,
}))
const smartViewTitle = computed(() => ({ inbox: '收件箱', today: '今天', next7: '最近 7 天', all: '全部任务', completed: '已完成' })[activeSmartView.value])
const smartViewSubtitle = computed(() => `${taskViews.value.length + occurrenceViews.value.length} 项 · ${dateLabel.value}`)
const quickAddDestinationListId = computed(() => taskTopicFilter.value !== 'all' && taskTopicFilter.value !== 'unassigned'
  ? taskTopicFilter.value
  : 'list:system:learning')
const activeListGroups = computed(() => (state.value.listGroups ?? []).filter(({ archivedAt }) => !archivedAt).sort((left, right) => left.position - right.position))
const topicGroupOptions = computed(() => [
  { value: '', label: '无分组' },
  ...activeListGroups.value.map((group) => ({ value: group.id, label: group.title })),
])
const listNavItems = computed(() => state.value.topics.filter((topic) => !topic.archivedAt).map((topic) => ({ id: topic.id, groupId: topic.groupId ?? null, title: topic.title, count: liveTasks.value.filter((task) => task.topicId === topic.id && task.status !== 'completed' && task.status !== 'cancelled').length })))

const startOfWeek = computed(() => {
  const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date.getTime()
})
const completedRecords = computed(() => state.value.completionRecords.filter((record) => !record.deletedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt)))
const weeklyRecords = computed(() => completedRecords.value.filter((record) => new Date(record.completedAt).getTime() >= startOfWeek.value))
const weeklyMinutes = computed(() => weeklyRecords.value.reduce((sum, record) => sum + recordMinutes(record), 0))
const reviewQueue = computed(() => completedRecords.value.filter((record) => record.nextReviewOn && record.nextReviewOn <= today.value).sort((a, b) => (a.nextReviewOn ?? '').localeCompare(b.nextReviewOn ?? '')))
const reviewItems = computed<ReviewViewItem[]>(() => reviewQueue.value.map((record) => ({ id: record.id, topic: topicTitleFor(record.topicId), learned: record.learned, evidence: record.evidence, ageLabel: formatAge(record.completedAt) })))
const recordViews = computed<CompletionRecordViewItem[]>(() => completedRecords.value.map((record) => ({ id: record.id, taskId: record.taskId, topicId: record.topicId, topic: topicTitleFor(record.topicId), taskTitle: record.taskTitleSnapshot, learned: record.learned, evidence: record.evidence, blocker: record.blocker, nextAction: record.nextAction, mastery: record.mastery, completedLabel: formatShortDate(record.completedAt), minutes: recordMinutes(record) })))

const topicViews = computed<TopicViewItem[]>(() => state.value.topics.filter((topic) => !topic.archivedAt).map((topic) => {
  const tasks = liveTasks.value.filter((task) => task.topicId === topic.id)
  const records = completedRecords.value.filter((record) => record.topicId === topic.id)
  const current = tasks.find((task) => task.status === 'in_progress') ?? tasks.find((task) => task.status === 'blocked') ?? tasks.find((task) => task.status === 'planned')
  return {
    id: topic.id, title: topic.title, goal: topic.goal, successCriteria: topic.successCriteria,
    totalSteps: tasks.length, completedSteps: tasks.filter((task) => task.status === 'completed').length,
    currentStep: current?.title ?? '这个主题暂时没有待办任务', nextAction: records[0]?.nextAction || current?.title || '从收件箱安排下一步',
    recentLabel: records[0] ? formatShortDate(records[0].completedAt) : '还没有记录',
    evidence: records.map((record) => ({ id: record.id, date: formatShortDate(record.completedAt), minutes: recordMinutes(record), learned: record.learned, evidence: record.evidence, blocker: record.blocker })),
  }
}))

const weeklyHighlight = computed(() => weeklyRecords.value[0]?.learned || '开始建立一条可追溯的学习证据链')
const weeklyBlocker = computed(() => weeklyRecords.value.find((record) => record.blocker)?.blocker || '还没有记录反复出现的问题')
const weeklyNext = computed(() => liveTasks.value.find((task) => task.status === 'in_progress' || task.status === 'planned')?.title || '从收件箱选择一个下一步')

onMounted(async () => {
  window.addEventListener('shixue:quick-add', handleQuickAdd)
  window.addEventListener('shixue:module-error', handleModuleError)
  appearanceDark.value = localStorage.getItem('meow-study-appearance') === 'dark'
  remindersEnabled.value = localStorage.getItem('meow-study-reminders') === 'enabled'
  applyTheme('study', appearanceDark.value)
  compactMedia = window.matchMedia('(max-width: 799px)')
  compact.value = compactMedia.matches
  compactMedia.addEventListener('change', onCompactChange)
  try {
    state.value = await loadStudyState()
    recurrenceWorkspace.value = await getWorkspaceStore().load()
    selectedTopicId.value = state.value.topics.find((topic) => !topic.archivedAt)?.id ?? ''
    showFocus.value = Boolean(activeSession.value)
  } catch (error) { reportStorageError(error) } finally { loading.value = false }
  if (cloudAvailable) void refreshCloudSession()
  if (remindersEnabled.value) void deliverReminders()
  if (runtime.platform !== 'desktop' && remindersEnabled.value) void deliverExactTaskReminders()
  clockTimer = setInterval(() => (clock.value = Date.now()), 1000)
  reminderTimer = setInterval(() => {
    if (runtime.platform !== 'desktop' && remindersEnabled.value) void deliverExactTaskReminders()
  }, 30_000)
  cloudTimer = setInterval(() => { if (cloudStatus.value === 'signed-in') void syncStudyCloud() }, 30_000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (reminderTimer) clearInterval(reminderTimer)
  if (cloudTimer) clearInterval(cloudTimer)
  if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer)
  if (scratchSaveTimer) clearTimeout(scratchSaveTimer)
  compactMedia?.removeEventListener('change', onCompactChange)
  window.removeEventListener('shixue:quick-add', handleQuickAdd)
  window.removeEventListener('shixue:module-error', handleModuleError)
})

function handleQuickAdd() {
  settingsOpen.value = false
  completionOpen.value = false
  taskActionOpen.value = false
  taskEditorOpen.value = false
  recurrenceScopeOpen.value = false
  occurrenceRescheduleOpen.value = false
  topicEditorOpen.value = false
  groupEditorOpen.value = false
  selectSmartView('inbox')
  selectedTaskId.value = ''
  selectedOccurrenceId.value = ''
  requestAnimationFrame(() => tasksView.value?.focusQuickAdd())
}
function handleModuleError() {
  storageError.value = '部分系统能力未能启动。任务数据与核心界面仍可使用。'
}

function onCompactChange(event: MediaQueryListEvent) { compact.value = event.matches; if (event.matches && page.value === 'tasks') selectedTaskId.value = '' }
async function refreshState() { state.value = await loadStudyState(); recurrenceWorkspace.value = await getWorkspaceStore().load(); scheduleCloudSync() }

function scheduleCloudSync() {
  if (!cloudAvailable || cloudStatus.value !== 'signed-in') return
  if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer)
  cloudDebounceTimer = setTimeout(() => void syncStudyCloud(), 1500)
}

async function cloudAdapter() {
  const { createStudyCloudSupabaseTauriAdapter } = await import('./lib/study-cloud-supabase-tauri')
  return createStudyCloudSupabaseTauriAdapter()
}

async function refreshCloudSession() {
  if (!cloudConfig) return
  try {
    const session = await (await cloudAdapter()).sessionStatus(cloudConfig)
    cloudStatus.value = session.state
    cloudEmail.value = session.state === 'signed-in' ? session.email ?? '' : ''
    cloudMessage.value = session.state === 'signed-in' ? '账号同步可用；本地记录仍优先写入。' : ''
  } catch {
    cloudStatus.value = 'failed'
    cloudMessage.value = '原生同步能力不可用。请确认构建启用了 sync feature。'
  }
}

async function signInStudyCloud(email: string, password: string) {
  if (!cloudConfig) return
  cloudStatus.value = 'syncing'; cloudMessage.value = ''
  try {
    const session = await (await cloudAdapter()).signIn(cloudConfig, { email, password })
    cloudStatus.value = 'signed-in'; cloudEmail.value = session.email ?? email
    await syncStudyCloud()
  } catch {
    cloudStatus.value = 'failed'; cloudMessage.value = '登录失败。请检查账号、项目配置与网络后重试。'
  }
}

async function signOutStudyCloud() {
  if (!cloudConfig) return
  cloudStatus.value = 'syncing'
  try {
    await (await cloudAdapter()).signOut(cloudConfig)
    cloudStatus.value = 'signed-out'; cloudEmail.value = ''; cloudMessage.value = '已退出；本地记录没有删除。'
  } catch {
    cloudStatus.value = 'failed'; cloudMessage.value = '退出失败，钥匙串 session 仍按原状态保留。'
  }
}

async function syncStudyCloud() {
  if (!cloudConfig || cloudStatus.value === 'syncing') return
  cloudStatus.value = 'syncing'; cloudMessage.value = ''
  try {
    const { createStudyCloudSyncController } = await import('./lib/study-cloud-sync')
    const controller = createStudyCloudSyncController({
      enabled: true,
      config: cloudConfig,
      deviceId: localDeviceId(),
      store: getWorkspaceStore(),
      adapter: await cloudAdapter(),
    })
    const result = await controller.syncOnce()
    if (result.state === 'success') {
      if (result.action === 'downloaded') state.value = await loadStudyState()
      cloudStatus.value = 'signed-in'
      cloudMessage.value = result.action === 'uploaded' ? '本地更新已同步。' : result.action === 'downloaded' ? '已接收较新的云端记录。' : '本地与云端一致。'
    } else if (result.state === 'skipped' && result.reason === 'signed-out') {
      cloudStatus.value = 'signed-out'; cloudEmail.value = ''; cloudMessage.value = '登录已过期，请重新登录。'
    } else {
      cloudStatus.value = 'failed'
      cloudMessage.value = result.state === 'conflict' ? '云端同时发生了更新；本地记录未被覆盖，请稍后重试。' : '同步失败，本地记录保持不变。'
    }
  } catch {
    cloudStatus.value = 'failed'; cloudMessage.value = '同步失败，本地记录保持不变。'
  }
}

function localDeviceId() {
  const key = 'meow-study-device-id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const id = crypto.randomUUID(); localStorage.setItem(key, id); return id
}

function navigate(next: StudyPage) {
  page.value = next; showFocus.value = false; reviewRevealed.value = false; selectedOccurrenceId.value = ''
  if (next === 'today') activeSmartView.value = 'today'
  if (next === 'tasks' && activeSmartView.value === 'today') activeSmartView.value = 'inbox'
  if ((next === 'tasks' || next === 'today') && !compact.value && !selectedTaskId.value) selectedTaskId.value = taskViews.value[0]?.id ?? ''
}
function selectSmartView(view: StudySmartView) {
  taskTopicFilter.value = 'all'
  taskPriorityFilter.value = 'all'
  activeSmartView.value = view
  page.value = view === 'today' ? 'today' : 'tasks'
  showFocus.value = false
  selectedOccurrenceId.value = ''
  selectedTaskId.value = compact.value ? '' : taskViews.value[0]?.id ?? ''
}
function selectList(id: string) { taskTopicFilter.value = id; activeSmartView.value = 'all'; page.value = 'tasks'; showFocus.value = false; selectedOccurrenceId.value = ''; selectedTaskId.value = compact.value ? '' : taskViews.value[0]?.id ?? '' }
function openTopicEditor(topic?: StudyTopic) { topicEditorOpen.value = true; selectedTopicId.value = topic?.id ?? ''; topicTitle.value = topic?.title ?? ''; topicGoal.value = topic?.goal ?? ''; topicMinutes.value = topic?.weeklyTargetMinutes ?? 120; topicGroupId.value = topic?.groupId ?? '' }
function openGroupEditor(group?: StudyListGroup) { groupEditorOpen.value = true; selectedGroupId.value = group?.id ?? ''; groupTitle.value = group?.title ?? '' }
function openTask(taskId: string) { selectedOccurrenceId.value = ''; selectedTaskId.value = taskId; if (page.value !== 'tasks' && page.value !== 'today') page.value = 'tasks'; showFocus.value = false }
function openOccurrence(occurrenceId: string) {
  const workspace = recurrenceWorkspace.value
  const occurrence = workspace?.occurrences.find((item) => item.id === occurrenceId)
  const series = occurrence ? workspace?.recurrenceSeries.find((item) => item.id === occurrence.seriesId) : undefined
  if (!occurrence || !series) return
  selectedOccurrenceId.value = occurrence.id
  selectedTaskId.value = series.taskId
  showFocus.value = false
}
function alignTaskSelection() {
  if (compact.value) { selectedTaskId.value = ''; return }
  if (!taskViews.value.some((task) => task.id === selectedTaskId.value)) selectedTaskId.value = taskViews.value[0]?.id ?? ''
}
function setTaskSearch(value: string) { taskSearch.value = value; alignTaskSelection() }
function setTaskTopicFilter(value: string) { taskTopicFilter.value = value; alignTaskSelection() }
function setTaskPriorityFilter(value: StudyTaskPriority | 'all') { taskPriorityFilter.value = value; alignTaskSelection() }
function setTaskSort(value: StudyTaskQuerySort) { taskSort.value = value; alignTaskSelection() }

async function quickAddCreated(entity: EntityRef) {
  try {
    await refreshState(); selectedTaskId.value = entity.id; selectedOccurrenceId.value = ''; notify(activeSmartView.value === 'today' ? '已加入今天。' : '已加入收件箱。')
  } catch (error) { reportStorageError(error) }
}

function openTaskAction(taskId: string, mode: TaskActionMode) { taskActionTaskId.value = taskId; taskActionMode.value = mode; taskActionOpen.value = true }
async function submitTaskAction(payload: TaskActionPayload) {
  const task = actionTask.value
  if (!task) return
  const now = new Date().toISOString()
  try {
    let undo: { label: string; run: () => Promise<void> } | undefined
    if (taskActionMode.value === 'defer') {
      const previousPlannedOn = task.plannedOn
      const changed = await rescheduleStudyTask(task.id, payload.plannedOn, { eventId: crypto.randomUUID(), now, reason: payload.reason || undefined })
      undo = { label: '撤销', run: async () => {
        await rescheduleStudyTask(task.id, previousPlannedOn, { expectedRevision: changed.revision, eventId: crypto.randomUUID(), now: new Date().toISOString(), reason: '撤销延期' })
        await refreshState()
      } }
    } else if (taskActionMode.value === 'plan') {
      let changed = await planStudyTask(task.id, { topicId: payload.topicId ?? task.topicId, plannedOn: payload.plannedOn, dueOn: payload.dueOn ?? task.dueOn, estimateMinutes: payload.estimateMinutes ?? task.estimateMinutes, acceptanceCriteria: payload.acceptanceCriteria.length ? payload.acceptanceCriteria : task.acceptanceCriteria }, { eventId: crypto.randomUUID(), now })
      const existingItems = new Set(changed.checklist.map((item) => item.text.trim()))
      for (const criterion of changed.acceptanceCriteria.map((item) => item.trim()).filter(Boolean)) {
        if (existingItems.has(criterion)) continue
        await addTaskChecklistItem(changed.id, criterion, { itemId: crypto.randomUUID(), expectedRevision: changed.revision, now })
        existingItems.add(criterion)
        changed = (await loadStudyState()).tasks.find((item) => item.id === changed.id) ?? changed
      }
    } else if (taskActionMode.value === 'block') {
      await transitionStudyTask(task.id, 'blocked', { reason: payload.reason, eventId: crypto.randomUUID(), now })
    } else if (taskActionMode.value === 'cancel') {
      const changed = await transitionStudyTask(task.id, 'cancelled', { reason: payload.reason || undefined, eventId: crypto.randomUUID(), now })
      undo = { label: '撤销', run: async () => {
        await transitionStudyTask(task.id, 'planned', { expectedRevision: changed.revision, eventId: crypto.randomUUID(), now: new Date().toISOString(), reason: '撤销取消' })
        await refreshState()
      } }
    } else {
      await planStudyTask(task.id, { topicId: task.topicId, plannedOn: payload.plannedOn, dueOn: task.dueOn, estimateMinutes: task.estimateMinutes, acceptanceCriteria: task.acceptanceCriteria }, { eventId: crypto.randomUUID(), now })
    }
    await refreshState(); taskActionOpen.value = false
    activeSmartView.value = taskActionMode.value === 'cancel' ? 'all' : activeSmartView.value
    notify(taskActionMode.value === 'defer' ? `已延期到${formatShortDate(payload.plannedOn)}。` : taskActionMode.value === 'cancel' ? '任务已取消。' : taskActionMode.value === 'block' ? '已记录阻碍。' : taskActionMode.value === 'reopen' ? '任务已重开。' : '任务已安排。', undo)
  } catch (error) { reportStorageError(error) }
}

async function toggleTaskChecklist(taskId: string, itemId: string, checked: boolean) {
  const task = state.value.tasks.find((item) => item.id === taskId)
  if (!task) return
  try {
    await setTaskChecklistItem(taskId, itemId, checked, new Date().toISOString(), task.revision)
    await refreshState()
  } catch (error) { reportStorageError(error) }
}

async function addTaskChecklist(taskId: string, text: string) {
  const task = state.value.tasks.find((item) => item.id === taskId)
  if (!task) return
  try {
    await addTaskChecklistItem(taskId, text, { itemId: crypto.randomUUID(), expectedRevision: task.revision, now: new Date().toISOString() })
    await refreshState()
  } catch (error) { reportStorageError(error) }
}

function openTaskEditor(taskId: string) {
  selectedTaskId.value = taskId
  taskEditorOpen.value = true
}

async function saveTaskEdit(value: TaskEditValue) {
  const task = selectedTask.value
  if (!task) return
  try {
    await updateStudyTask(task.id, value, { expectedRevision: task.revision, now: new Date().toISOString() })
    await refreshState()
    taskEditorOpen.value = false
    notify('任务内容已更新。')
  } catch (error) { reportStorageError(error) }
}

function cloneRecurrenceRuleDto(rule: RecurrenceRule): RecurrenceRule {
  const cadence = rule.cadence.kind === 'weekly'
    ? { ...rule.cadence, weekdays: [...rule.cadence.weekdays] }
    : { ...rule.cadence }
  return { cadence, basis: rule.basis, end: { ...rule.end } }
}

async function requestRecurrenceEdit(rule: RecurrenceRule) {
  const portableRule = cloneRecurrenceRuleDto(rule)
  if (!selectedRecurrence.value) {
    const workspace = recurrenceWorkspace.value
    const task = workspace?.tasks.find((item) => item.id === selectedTask.value?.id)
    if (!workspace || !task) return
    recurrenceExecuting.value = true
    try {
      await capabilityService.execute({
        protocolVersion: CAPABILITY_PROTOCOL_VERSION,
        idempotencyKey: `recurrence:${crypto.randomUUID()}`,
        source: 'human-ui',
        expectedWorkspaceRevision: workspace.revision,
        command: {
          type: 'recurrence.create', taskId: task.id, expectedTaskRevision: task.revision,
          cadence: portableRule.cadence, basis: portableRule.basis, anchorOn: selectedTask.value?.plannedOn ?? today.value,
          end: portableRule.end, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
      })
      await refreshState(); taskEditorOpen.value = false; notify('已创建重复规则。')
    } catch (error) { reportStorageError(error) } finally { recurrenceExecuting.value = false }
    return
  }
  pendingRecurrenceRule = portableRule
  clearRecurrencePreview()
  recurrenceScopeOpen.value = true
}

function editableRecurrenceOccurrence() {
  const workspace = recurrenceWorkspace.value
  const series = selectedRecurrence.value
  if (!workspace || !series) return null
  const selected = selectedOccurrence.value
  if (selected?.seriesId === series.id && selected.status === 'pending') return selected
  return workspace.occurrences.find((item) => item.seriesId === series.id && item.status === 'pending') ?? null
}

function editSingleOccurrence() {
  const occurrence = editableRecurrenceOccurrence()
  recurrenceScopeOpen.value = false
  clearRecurrencePreview()
  pendingRecurrenceRule = null
  if (!occurrence) { reportStorageError(new Error('没有可编辑的重复实例。')); return }
  taskEditorOpen.value = false
  openOccurrenceReschedule(occurrence.id)
}

async function previewRecurrenceScope(scope: RecurrenceRuleScope) {
  const series = selectedRecurrence.value
  const rule = pendingRecurrenceRule
  const workspace = recurrenceWorkspace.value
  if (!series || !rule || !workspace) return
  clearRecurrencePreview()
  const version = recurrencePreviewVersion
  recurrencePreviewing.value = true
  try {
    const occurrence = editableRecurrenceOccurrence()
    if (!occurrence) throw new Error('没有可编辑的重复实例。')
    const envelope: RecurrenceUpdateEnvelope = {
      protocolVersion: CAPABILITY_PROTOCOL_VERSION, idempotencyKey: `recurrence:${crypto.randomUUID()}`, source: 'human-ui', expectedWorkspaceRevision: workspace.revision,
      command: { type: 'recurrence.update', occurrenceId: occurrence.id, expectedOccurrenceRevision: occurrence.revision, scope, patch: { cadence: rule.cadence, basis: rule.basis, end: rule.end } },
    }
    const preview = await capabilityService.preview(envelope)
    if (version !== recurrencePreviewVersion) return
    recurrencePreview.value = preview
    recurrencePreviewEnvelope = envelope
  } catch (error) { reportStorageError(error) } finally { recurrencePreviewing.value = false }
}

async function executeRecurrenceScope(scope: RecurrenceRuleScope) {
  const preview = recurrencePreview.value
  const envelope = recurrencePreviewEnvelope
  if (!preview?.accepted || !envelope || envelope.command.scope !== scope) return
  recurrenceExecuting.value = true
  try {
    await capabilityService.execute({ ...envelope, explicitConfirmation: preview.confirmation === 'explicit' && preview.previewReceiptId ? { previewReceiptId: preview.previewReceiptId, confirmedAt: new Date().toISOString() } : undefined })
    await refreshState(); recurrenceScopeOpen.value = false; clearRecurrencePreview(); pendingRecurrenceRule = null
    notify('重复规则已更新。')
  } catch (error) { reportStorageError(error) } finally { recurrenceExecuting.value = false }
}

function clearRecurrencePreview() { recurrencePreviewVersion += 1; recurrencePreview.value = null; recurrencePreviewEnvelope = null }

async function executeOccurrence(id: string, type: 'recurrence.complete' | 'recurrence.skip') {
  const workspace = recurrenceWorkspace.value
  const occurrence = workspace?.occurrences.find((item) => item.id === id)
  if (!workspace || !occurrence) return
  try {
    await capabilityService.execute({ protocolVersion: CAPABILITY_PROTOCOL_VERSION, idempotencyKey: `recurrence:${crypto.randomUUID()}`, source: 'human-ui', expectedWorkspaceRevision: workspace.revision, command: { type, occurrenceId: occurrence.id, expectedOccurrenceRevision: occurrence.revision } })
    await refreshState(); notify(type === 'recurrence.complete' ? '本次已完成。' : '本次已跳过。')
  } catch (error) { reportStorageError(error) }
}

function openOccurrenceReschedule(id: string) {
  const workspace = recurrenceWorkspace.value
  const occurrence = workspace?.occurrences.find((item) => item.id === id)
  const series = occurrence ? workspace?.recurrenceSeries.find((item) => item.id === occurrence.seriesId) : undefined
  if (!occurrence || !series) return
  const at = occurrence.override?.scheduledAt ?? occurrence.scheduledAt
  const on = occurrence.override?.scheduledOn ?? occurrence.scheduledOn
  occurrenceRescheduleId.value = id
  occurrenceRescheduleTimed.value = at !== null
  occurrenceRescheduleValue.value = at ? toZonedDateTimeInput(at, series.timezone) : on ?? today.value
  occurrenceRescheduleOpen.value = true
}

async function rescheduleOccurrence(value: string) {
  const workspace = recurrenceWorkspace.value
  const occurrence = workspace?.occurrences.find((item) => item.id === occurrenceRescheduleId.value)
  const series = occurrence ? workspace?.recurrenceSeries.find((item) => item.id === occurrence.seriesId) : undefined
  if (!workspace || !occurrence || !series) return
  try {
    await capabilityService.execute({
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      idempotencyKey: `recurrence:${crypto.randomUUID()}`,
      source: 'human-ui',
      expectedWorkspaceRevision: workspace.revision,
      command: {
        type: 'recurrence.update', occurrenceId: occurrence.id, expectedOccurrenceRevision: occurrence.revision, scope: 'occurrence',
        patch: occurrenceRescheduleTimed.value ? { scheduledAt: zonedDateTimeToInstant(value.slice(0, 10), value.slice(11, 16), series.timezone).toISOString(), scheduledOn: null } : { scheduledAt: null, scheduledOn: value },
      },
    })
    await refreshState(); occurrenceRescheduleOpen.value = false; notify('本次计划已更新。')
  } catch (error) { reportStorageError(error) }
}

function toZonedDateTimeInput(value: string, timezone: string) {
  const local = parseZonedDateTime(value, timezone)
  return `${local.date}T${local.time}`
}

async function deleteTask(taskId: string) {
  const task = state.value.tasks.find((item) => item.id === taskId && !item.deletedAt)
  if (!task) return
  try {
    await deleteStudyTask(task.id, { expectedRevision: task.revision, eventId: crypto.randomUUID(), now: new Date().toISOString() })
    await refreshState()
    selectedTaskId.value = ''
    notify('任务已删除，学习证据仍保留。')
  } catch (error) { reportStorageError(error) }
}

function bulkTargets(taskIds: string[]) {
  return taskIds.map((taskId) => {
    const task = state.value.tasks.find((item) => item.id === taskId && !item.deletedAt)
    if (!task) throw new Error(`Study task not found: ${taskId}.`)
    return { taskId, expectedRevision: task.revision, eventId: crypto.randomUUID() }
  })
}

async function bulkDeleteTasks(taskIds: string[]) {
  try {
    await bulkDeleteStudyTasks(bulkTargets(taskIds), { reason: '从任务列表批量删除', now: new Date().toISOString() })
    await refreshState(); selectedTaskId.value = ''; notify(`已删除 ${taskIds.length} 项，学习证据仍保留。`)
  } catch (error) { reportStorageError(error) }
}

async function bulkMoveTasksToToday(taskIds: string[]) {
  try {
    await bulkRescheduleStudyTasks(bulkTargets(taskIds), today.value, { reason: '从任务列表批量移到今天', now: new Date().toISOString() })
    await refreshState(); selectedTaskId.value = ''; activeSmartView.value = 'today'; page.value = 'today'; notify(`已把 ${taskIds.length} 项移到今天。`)
  } catch (error) { reportStorageError(error) }
}

async function toggleTaskCompletion(taskId: string) {
  const task = state.value.tasks.find((item) => item.id === taskId && !item.deletedAt)
  if (!task || task.status === 'cancelled') return
  try {
    const changed = await toggleStudyTaskCompletion(task.id, { expectedRevision: task.revision, eventId: crypto.randomUUID(), now: new Date().toISOString() })
    await refreshState()
    notify(changed.status === 'completed' ? '任务已完成。' : '任务已重新打开。')
  } catch (error) { reportStorageError(error) }
}

async function bulkCompleteTasks(taskIds: string[]) {
  try {
    for (const taskId of taskIds) {
      const task = (await loadStudyState()).tasks.find((item) => item.id === taskId && !item.deletedAt)
      if (task && task.status !== 'completed' && task.status !== 'cancelled') await toggleStudyTaskCompletion(task.id, { expectedRevision: task.revision, eventId: crypto.randomUUID(), now: new Date().toISOString() })
    }
    await refreshState(); selectedTaskId.value = ''; notify(`已完成 ${taskIds.length} 项。`)
  } catch (error) { reportStorageError(error) }
}

async function taskPrimary(taskId: string) {
  const task = state.value.tasks.find((item) => item.id === taskId)
  if (!task) return
  if (task.status === 'inbox' || (task.status === 'planned' && !task.plannedOn)) return openTaskAction(task.id, 'plan')
  if (task.status === 'completed' || task.status === 'cancelled') return openTaskAction(task.id, 'reopen')
  if (task.status === 'blocked') {
    try { await transitionStudyTask(task.id, 'planned', { reason: '阻碍已解除', eventId: crypto.randomUUID(), now: new Date().toISOString() }); await refreshState(); notify('阻碍已解除。') } catch (error) { reportStorageError(error) }
    return
  }
  await startFocus(task.id)
}

async function startFocus(taskId: string) {
  if (activeSession.value) {
    if (activeSession.value.taskId === taskId) { showFocus.value = true; return }
    try {
      await switchStudyTask(taskId, { sessionId: crypto.randomUUID(), pausedEventId: crypto.randomUUID(), eventId: crypto.randomUUID(), now: new Date().toISOString(), reason: `从“${activeTask.value?.title ?? '上一项任务'}”切换` })
      await refreshState(); selectedTaskId.value = taskId; showFocus.value = true; notify('上一项学习已暂停，随手记和计时均已保留。')
    } catch (error) { reportStorageError(error) }
    return
  }
  try {
    await startStudyTask(taskId, { sessionId: crypto.randomUUID(), eventId: crypto.randomUUID(), now: new Date().toISOString() })
    await refreshState(); selectedTaskId.value = taskId; showFocus.value = true
  } catch (error) { reportStorageError(error) }
}

async function toggleFocus() {
  const session = activeSession.value
  if (!session) return
  const now = new Date().toISOString()
  try {
    if (session.state === 'running') await pauseStudySession(session.id, { now, eventId: crypto.randomUUID() })
    else await resumeStudySession(session.id, { now, eventId: crypto.randomUUID() })
    await refreshState()
  } catch (error) { reportStorageError(error) }
}

function updateScratchpad(value: string) {
  const session = activeSession.value
  if (!session) return
  const sessionId = session.id
  session.scratchpad = value
  if (scratchSaveTimer) clearTimeout(scratchSaveTimer)
  scratchSaveTimer = setTimeout(async () => { try { await saveStudyScratchpad(sessionId, value, { now: new Date().toISOString() }) } catch (error) { reportStorageError(error) } }, 450)
}

async function completeFocus(payload: CompletionPayload) {
  const session = activeSession.value
  const task = activeTask.value
  if (!session || !task) return
  const now = new Date().toISOString()
  try {
    await completeStudyTask({ taskId: task.id, sessionId: session.id, learned: payload.learned, evidence: payload.evidence, blocker: payload.blocker, nextAction: payload.nextAction, mastery: payload.mastery }, { recordId: crypto.randomUUID(), eventId: crypto.randomUUID(), now })
    await refreshState(); completionOpen.value = false; showFocus.value = false; page.value = 'today'; notify(`已记录这次学习。下一项：${weeklyNext.value}`)
  } catch (error) { reportStorageError(error) }
}

async function rateReview(result: ReviewResult) {
  const record = reviewQueue.value[0]
  if (!record) return
  try { await reviewCompletionRecord(record.id, result, today.value, { now: new Date().toISOString() }); await refreshState(); reviewRevealed.value = false; notify(result === 'clear' ? '已安排下一次回顾。' : result === 'fuzzy' ? '明天会再见到这条记录。' : '已标记为需要重新学习。') } catch (error) { reportStorageError(error) }
}

async function createFromNextAction(recordId: string) {
  try {
    const task = await createTaskFromNextAction(recordId, { taskId: crypto.randomUUID(), eventId: crypto.randomUUID(), now: new Date().toISOString(), plannedOn: today.value })
    await refreshState(); page.value = 'today'; selectedTaskId.value = task.id; notify('下一步已加入今天。')
  } catch (error) { reportStorageError(error) }
}

async function saveTopic() {
  const title = topicTitle.value.trim()
  if (!title) return
  const now = new Date().toISOString()
  const existing = state.value.topics.find((topic) => topic.id === selectedTopicId.value)
  const topic: StudyTopic = { id: existing?.id ?? crypto.randomUUID(), groupId: topicGroupId.value || null, title, goal: topicGoal.value.trim() || `围绕“${title}”完成一个可验证的学习成果`, successCriteria: existing?.successCriteria ?? ['能用自己的话解释核心概念', '完成一个可以展示或运行的成果'], weeklyTargetMinutes: Math.max(30, topicMinutes.value), createdAt: existing?.createdAt ?? now, updatedAt: now, archivedAt: null }
  try { await saveStudyTopic(topic); await refreshState(); selectedTopicId.value = topic.id; topicEditorOpen.value = false; topicTitle.value = ''; topicGoal.value = ''; notify(existing ? '清单已更新。' : '清单已创建。') } catch (error) { reportStorageError(error) }
}

async function saveGroup() {
  const title = groupTitle.value.trim()
  if (!title) return
  const now = new Date().toISOString()
  const existing = (state.value.listGroups ?? []).find(({ id }) => id === selectedGroupId.value)
  const group: StudyListGroup = { id: existing?.id ?? crypto.randomUUID(), title, position: existing?.position ?? activeListGroups.value.length, createdAt: existing?.createdAt ?? now, updatedAt: now, archivedAt: null }
  try { await saveStudyListGroup(group); await refreshState(); groupEditorOpen.value = false; selectedGroupId.value = ''; groupTitle.value = ''; notify(existing ? '分组已更新。' : '分组已创建。') } catch (error) { reportStorageError(error) }
}

async function archiveGroup() {
  if (!selectedGroupId.value) return
  try { await archiveStudyListGroup(selectedGroupId.value); await refreshState(); groupEditorOpen.value = false; selectedGroupId.value = ''; groupTitle.value = ''; notify('分组已归档，清单已移到顶层。') } catch (error) { reportStorageError(error) }
}

async function archiveTopic(id: string) {
  const topic = state.value.topics.find((item) => item.id === id)
  if (!topic) return
  try { await saveStudyTopic({ ...topic, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); await refreshState(); selectedTopicId.value = state.value.topics.find((item) => !item.archivedAt)?.id ?? ''; if (taskTopicFilter.value === id) taskTopicFilter.value = 'all'; notify('清单已归档。') } catch (error) { reportStorageError(error) }
}

async function exportData() {
  try { const content = await exportStudyState(); const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `拾学记录-${today.value}.json`; anchor.click(); URL.revokeObjectURL(url); notify('学习记录已导出。') } catch (error) { reportStorageError(error) }
}
async function importData(content: string) {
  try {
    await importStudyState(content)
    await refreshState()
    settingsOpen.value = false
    selectedTaskId.value = ''
    notify('学习记录已验证并导入。')
  } catch (error) {
    reportStorageError(error)
  }
}
async function deliverReminders(ignoreDailyMarker = false): Promise<'none' | 'sent' | 'unavailable'> {
  if (!remindersAvailable) return 'unavailable'
  const reminders = selectStudyReminders(state.value, today.value)
  const counts = { dueTaskCount: reminders.tasks.length, dueReviewCount: reminders.reviews.length }
  if (counts.dueTaskCount + counts.dueReviewCount === 0) return 'none'
  const marker = `meow-study-reminders-sent:${today.value}`
  if (!ignoreDailyMarker && localStorage.getItem(marker) === 'yes') return 'sent'
  const { sendStudyReminderNotification } = await import('./modules/notification')
  const sent = await sendStudyReminderNotification(counts)
  if (sent) localStorage.setItem(marker, 'yes')
  return sent ? 'sent' : 'unavailable'
}
async function deliverExactTaskReminders() {
  if (!remindersAvailable) return
  const marker = 'meow-study-task-reminders-delivered'
  let delivered: Record<string, string> = {}
  try { delivered = JSON.parse(localStorage.getItem(marker) ?? '{}') as Record<string, string> } catch { delivered = {} }
  const deliveredIds = state.value.tasks.filter((task) => task.reminderAt && delivered[task.id] === task.reminderAt).map((task) => task.id)
  const due = selectTaskReminderTriggers(state.value.tasks, new Date().toISOString(), deliveredIds)
  if (!due.length) return
  const { sendTaskReminderNotification } = await import('./modules/notification')
  for (const task of due) if (await sendTaskReminderNotification(task.title)) delivered[task.id] = task.reminderAt ?? ''
  localStorage.setItem(marker, JSON.stringify(delivered))
}
async function setReminders(enabled: boolean) {
  remindersEnabled.value = enabled
  localStorage.setItem('meow-study-reminders', enabled ? 'enabled' : 'disabled')
  if (!enabled) { notify('学习提醒已关闭。'); return }
  const result = await deliverReminders(true)
  notify(result === 'sent' ? '提醒已开启，并发送了当前待办摘要。' : result === 'none' ? '提醒已开启，目前没有到期任务或待复习记录。' : '提醒已开启；系统权限暂不可用，可稍后在系统设置中允许。')
}
async function resetDemo() {
  try {
    await resetStudyState()
    await refreshState()
    settingsOpen.value = false
    selectedTaskId.value = ''
    taskSearch.value = ''
    taskTopicFilter.value = 'all'
    taskSort.value = 'manual'
    activeSmartView.value = 'inbox'
    taskPriorityFilter.value = 'all'
    notify('已恢复拾学的演示数据。')
  } catch (error) { reportStorageError(error) }
}
function setAppearance(mode: 'light' | 'dark') { appearanceDark.value = mode === 'dark'; localStorage.setItem('meow-study-appearance', mode); applyTheme('study', appearanceDark.value) }
function updatePlanningPreferences(patch: Partial<PlanningPreferences>) {
  try {
    planningPreferences.value = savePlanningPreferences(patch)
  } catch {
    notify('快速新增设置未能保存，请重试。')
  }
}

function topicTitleFor(topicId: string | null) { return topicId ? topicMap.value.get(topicId)?.title ?? '未知主题' : '未归类' }
function projectionReasonLabel(reason: TaskProjectionReason) { return ({ overdue: '已过期', planned: '已计划', due: '今日截止', repeating: '重复' } as const)[reason] }
function taskStatus(task: StudyTask): TaskViewStatus { return task.status === 'planned' && !task.plannedOn ? 'backlog' : task.status }
function toTaskView(task: StudyTask): TaskViewItem { return { id: task.id, title: task.title, notes: task.notes, topic: topicTitleFor(task.topicId), topicId: task.topicId, status: taskStatus(task), plannedOn: task.plannedOn, dueOn: task.dueOn, reminderAt: task.reminderAt, priority: task.priority, plannedLabel: task.plannedOn ? formatPlanDate(task.plannedOn) : '', dueLabel: task.dueOn ? formatPlanDate(task.dueOn) : '', reminderLabel: formatReminder(task.reminderAt), estimateMinutes: task.estimateMinutes, acceptanceCriteria: task.acceptanceCriteria, checklist: task.checklist.map((item) => ({ id: item.id, text: item.text, checked: item.checked })), blockedReason: task.blockedReason ?? '' } }
function toEventView(event: TaskEvent): TaskEventViewItem {
  const labels: Record<TaskEvent['type'], string> = { captured: '加入收件箱', migrated: '从旧版记录迁移', planned: '安排任务', started: '开始学习', paused: '暂停学习', resumed: '继续学习', blocked: '标记受阻', completed: '完成学习', reopened: '重开任务', cancelled: '取消任务', rescheduled: '调整计划日期', deleted: '移入回收状态' }
  const tones: Record<TaskEvent['type'], TaskEventViewItem['tone']> = { captured: 'accent', migrated: 'muted', planned: 'accent', started: 'accent', paused: 'muted', resumed: 'accent', blocked: 'warning', completed: 'success', reopened: 'accent', cancelled: 'danger', rescheduled: 'muted', deleted: 'danger' }
  return { id: event.id, time: formatEventTime(event.occurredAt), title: labels[event.type], detail: event.reason || (event.type === 'planned' || event.type === 'rescheduled' ? `计划日期：${formatPlanDate(selectedTask.value?.plannedOn ?? null)}` : statusDetail(event)), tone: tones[event.type] }
}
function statusDetail(event: TaskEvent) { return event.toStatus ? `状态变为${({ inbox: '收件箱', planned: '已计划', in_progress: '进行中', blocked: '已阻塞', completed: '已完成', cancelled: '已取消' } as const)[event.toStatus]}` : '保留此次变化' }
function recordMinutes(record: CompletionRecord) { return Math.max(1, Math.round(state.value.sessions.filter((session) => record.sessionIds.includes(session.id)).reduce((sum, session) => sum + session.elapsedSeconds, 0) / 60)) }
function formatPlanDate(value: string | null) { if (!value) return '待安排'; if (value === today.value) return '今天'; const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); if (value === tomorrow.toLocaleDateString('sv-SE')) return '明天'; return formatShortDate(value) }
function formatShortDate(value: string | null | undefined) { if (!value) return '今天'; const date = new Date(value.length === 10 ? `${value}T00:00:00` : value); return `${date.getMonth() + 1} 月 ${date.getDate()} 日` }
function formatAge(value: string) { const diff = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86_400_000)); return diff === 0 ? '今天' : `${diff} 天前` }
function formatEventTime(value: string) { const date = new Date(value); return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function formatReminder(value: string | null) { if (!value) return ''; const date = new Date(value); const day = date.toLocaleDateString('sv-SE') === today.value ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`; return `${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function notify(message: string, action?: { label: string; run: () => Promise<void> }) { toast.value = message; toastAction.value = action ?? null; toastVersion.value += 1 }
function dismissToast() { toast.value = ''; toastAction.value = null }
async function runToastAction() {
  const action = toastAction.value
  if (!action) return
  dismissToast()
  try { await action.run(); notify('已撤销。') } catch (error) { reportStorageError(error) }
}
function reportStorageError(error: unknown) { storageError.value = error instanceof Error ? error.message : String(error); notify('这次更改还没写入本地，内容仍保留在页面中。') }
</script>

<template>
  <div class="shell">
    <OverlayHost />
    <AppSidebar v-if="!showFocus" :active="page" :active-smart-view="activeSmartView" :counts="smartViewCounts" :groups="activeListGroups" :lists="listNavItems" :active-list-id="taskTopicFilter === 'all' || taskTopicFilter === 'unassigned' ? undefined : taskTopicFilter" @navigate="navigate" @smart-view="selectSmartView" @select-list="selectList" @create-list="openTopicEditor()" @create-group="openGroupEditor()" @edit-group="openGroupEditor(activeListGroups.find((group) => group.id === $event))" @settings="settingsOpen = true" />
    <div class="workspace">
      <header v-if="!showFocus" class="mobile-header"><div><img src="/shixue-mark.svg" alt="" /><strong>拾学</strong></div><button title="设置" @click="settingsOpen = true"><Settings :size="22" /></button></header>
      <main :class="{ 'focus-main': showFocus, 'tasks-main': (page === 'tasks' || page === 'today') && !showFocus }">
        <div v-if="loading" class="loading">正在打开你的学习记录…</div>
        <FocusView v-else-if="showFocus && activeSession && activeTask" :topic-title="topicTitleFor(activeTask.topicId)" :task-title="activeTask.title" :criteria="activeTask.acceptanceCriteria" :time-label="timeLabel" :running="activeSession.state === 'running'" :scratchpad="activeSession.scratchpad" @back="showFocus = false" @toggle="toggleFocus" @finish="completionOpen = true" @update:scratchpad="updateScratchpad" />
        <div v-else-if="page === 'tasks' || page === 'today'" class="tasks-layout">
          <div class="tasks-scroll"><TasksView ref="tasksView" :tasks="taskViews" :occurrences="occurrenceViews" :topics="state.topics.filter((topic) => !topic.archivedAt)" :title="smartViewTitle" :subtitle="smartViewSubtitle" :selected-id="selectedTaskId" :smart-view="activeSmartView" :search="taskSearch" :topic-filter="taskTopicFilter" :priority-filter="taskPriorityFilter" :sort="taskSort" :quick-add-destination-list-id="quickAddDestinationListId" :quick-add-default-start-on="activeSmartView === 'today' ? today : undefined" :quick-add-default-estimate-minutes="planningPreferences.defaultEstimateMinutes" :quick-add-remove-recognized-text="planningPreferences.quickAddRemoveRecognizedText" @smart-view-change="selectSmartView" @search-change="setTaskSearch" @topic-filter-change="setTaskTopicFilter" @priority-filter-change="setTaskPriorityFilter" @sort-change="setTaskSort" @created="quickAddCreated" @open="openTask" @toggle-complete="toggleTaskCompletion" @edit="openTaskEditor" @delete="deleteTask" @bulk-delete="bulkDeleteTasks" @bulk-complete="bulkCompleteTasks" @bulk-move-to-today="bulkMoveTasksToToday" @occurrence-open="openOccurrence" @occurrence-complete="executeOccurrence($event, 'recurrence.complete')" @occurrence-skip="executeOccurrence($event, 'recurrence.skip')" @occurrence-reschedule="openOccurrenceReschedule" /></div>
          <TaskDetailDrawer :task="selectedTaskView" :events="selectedTaskEvents" :due-label="selectedTask?.dueOn ? formatPlanDate(selectedTask.dueOn) : ''" :occurrence-id="selectedOccurrence?.id" :occurrence-status="selectedOccurrence?.status" :occurrence-schedule-label="selectedOccurrence ? formatPlanDate(selectedOccurrence.override?.scheduledOn ?? selectedOccurrence.override?.scheduledAt ?? selectedOccurrence.scheduledOn ?? selectedOccurrence.scheduledAt) : ''" :deadline-label="selectedTask?.dueOn ? formatPlanDate(selectedTask.dueOn) : ''" :mobile="compact" @close="selectedTaskId = ''; selectedOccurrenceId = ''" @edit="openTaskEditor" @delete="deleteTask" @toggle-complete="toggleTaskCompletion" @primary="taskPrimary" @defer="openTaskAction($event, 'defer')" @block="openTaskAction($event, 'block')" @cancel="openTaskAction($event, 'cancel')" @toggle-checklist="toggleTaskChecklist" @add-checklist="addTaskChecklist" @occurrence-complete="executeOccurrence($event, 'recurrence.complete')" @occurrence-skip="executeOccurrence($event, 'recurrence.skip')" @occurrence-reschedule="openOccurrenceReschedule" />
        </div>
        <TopicsView v-else-if="page === 'topics'" :topics="topicViews" :groups="activeListGroups" :selected-id="selectedTopicId" @select="selectedTopicId = $event" @create="openTopicEditor()" @create-group="openGroupEditor()" @edit-group="openGroupEditor(activeListGroups.find((group) => group.id === $event))" @edit="openTopicEditor(state.topics.find((topic) => topic.id === $event))" @archive="archiveTopic" @start="taskPrimary(liveTasks.find((task) => task.topicId === $event && (task.status === 'in_progress' || task.status === 'planned'))?.id ?? '')" />
        <ReviewView v-else-if="page === 'review'" :item="reviewItems[0]" :remaining="reviewItems.length" :revealed="reviewRevealed" :weekly-completed="weeklyRecords.length" :weekly-minutes="weeklyMinutes" :weekly-highlight="weeklyHighlight" :weekly-blocker="weeklyBlocker" :weekly-next="weeklyNext" :records="recordViews" :topics="state.topics" :initial-mode="reviewMode" @reveal="reviewRevealed = true" @rate="rateReview" @create-task="createFromNextAction" @open-task="openTask" />
      </main>
      <BottomTabs v-if="!showFocus" :active="page" @navigate="navigate" @smart-view="selectSmartView" />
    </div>

    <CompletionSheet :open="completionOpen" :task-title="activeTask?.title ?? ''" :scratchpad="activeSession?.scratchpad ?? ''" @close="completionOpen = false" @save="completeFocus" />
    <TaskActionSheet :open="taskActionOpen" :mode="taskActionMode" :task-title="actionTask?.title ?? ''" :topics="state.topics" :default-topic-id="actionTask?.topicId" :default-planned-on="actionTask?.plannedOn" :default-due-on="actionTask?.dueOn" :default-minutes="actionTask?.estimateMinutes" :default-criteria="actionTask?.acceptanceCriteria" @close="taskActionOpen = false" @submit="submitTaskAction" />
    <TaskEditSheet :open="taskEditorOpen" :task="selectedTask" :topics="state.topics" :recurrence-rule="selectedRecurrenceRule" @close="taskEditorOpen = false" @save="saveTaskEdit" @recurrence-save="requestRecurrenceEdit" />
    <RecurrenceScopeDialog :open="recurrenceScopeOpen" :preview="recurrencePreview" :previewing="recurrencePreviewing" :executing="recurrenceExecuting" @close="recurrenceScopeOpen = false; clearRecurrencePreview()" @edit-occurrence="editSingleOccurrence" @preview="previewRecurrenceScope" @execute="executeRecurrenceScope" />
    <OccurrenceRescheduleSheet :open="occurrenceRescheduleOpen" :title="selectedTask?.title ?? ''" :model-value="occurrenceRescheduleValue" :timed="occurrenceRescheduleTimed" @close="occurrenceRescheduleOpen = false" @submit="rescheduleOccurrence" />
    <SettingsSheet :open="settingsOpen" :dark="appearanceDark" :reminders-available="remindersAvailable" :reminders-enabled="remindersEnabled" :quick-add-remove-recognized-text="planningPreferences.quickAddRemoveRecognizedText" :default-estimate-minutes="planningPreferences.defaultEstimateMinutes" :cloud-available="cloudAvailable" :cloud-status="cloudStatus" :cloud-email="cloudEmail" :cloud-message="cloudMessage" @close="settingsOpen = false" @export="exportData" @import="importData" @reset-demo="resetDemo" @set-appearance="setAppearance" @set-reminders="setReminders" @set-quick-add-remove-recognized-text="updatePlanningPreferences({ quickAddRemoveRecognizedText: $event })" @set-default-estimate-minutes="updatePlanningPreferences({ defaultEstimateMinutes: $event })" @cloud-sign-in="signInStudyCloud" @cloud-sign-out="signOutStudyCloud" @cloud-sync="syncStudyCloud" />

    <div v-if="topicEditorOpen" class="editor-backdrop" @click.self="topicEditorOpen = false"><form class="editor-sheet" @submit.prevent="saveTopic"><h2>{{ state.topics.some((topic) => topic.id === selectedTopicId) ? '编辑清单' : '新建清单' }}</h2><label><span>名称</span><input v-model="topicTitle" required placeholder="清单名称" /></label><label><span>分组</span><Listbox v-model="topicGroupId" :options="topicGroupOptions" label="分组" /></label><label><span>目标</span><textarea v-model="topicGoal" placeholder="学习目标" /></label><label><span>每周分钟</span><div class="duration-input"><input v-model.number="topicMinutes" type="number" min="30" max="1200" /><span>分钟</span></div></label><footer><button type="button" class="cancel" @click="topicEditorOpen = false">取消</button><button type="submit" class="save">保存</button></footer></form></div>
    <div v-if="groupEditorOpen" class="editor-backdrop" @click.self="groupEditorOpen = false"><form class="editor-sheet compact-editor" @submit.prevent="saveGroup"><h2>{{ selectedGroupId ? '编辑分组' : '新建分组' }}</h2><label><span>名称</span><input v-model="groupTitle" required placeholder="分组名称" /></label><footer><button v-if="selectedGroupId" type="button" class="cancel danger" @click="archiveGroup">归档</button><span class="footer-spacer"></span><button type="button" class="cancel" @click="groupEditorOpen = false">取消</button><button type="submit" class="save">保存</button></footer></form></div>
    <ToastRegion :key="toastVersion" :message="toast" :action-label="toastAction?.label" :duration="toastAction ? 6000 : 3200" :raised="compact && Boolean(selectedTaskId)" @action="runToastAction" @dismiss="dismissToast" />
    <div v-if="storageError" class="error-banner" role="alert"><span>上一次更改未保存。拾学不会用演示数据覆盖现有记录。</span><button @click="storageError = ''">知道了</button></div>
  </div>
</template>

<style scoped>
.shell { width: 100vw; height: 100vh; height: 100dvh; display: flex; overflow: hidden; background: var(--bg); }.workspace { min-width: 0; flex: 1; height: 100%; overflow: hidden; } main { width: 100%; height: 100%; overflow-y: auto; overscroll-behavior-y: contain; scroll-behavior: smooth; scrollbar-gutter: stable; }.tasks-main { overflow: hidden; }.today-layout { min-height: 100%; display: flex; justify-content: center; }.today-layout > :first-child { flex: 1 1 auto; }.tasks-layout { height: 100%; display: flex; }.tasks-scroll { min-width: 0; flex: 1; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; }.focus-main { background: radial-gradient(circle at 50% -25%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 42%), var(--bg); }.mobile-header { display: none; }.loading { min-height: 100%; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 13px; }
.editor-backdrop { position: fixed; z-index: var(--z-modal); inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, var(--text) 22%, transparent); backdrop-filter: saturate(120%) blur(12px); }.editor-sheet { width: min(100%, 470px); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 28px; border: 1px solid var(--hairline); border-radius: var(--radius-2xl); background: var(--material-regular); box-shadow: var(--shadow-lg); animation: editor-in var(--motion-slow) var(--ease-spring); }.editor-sheet.compact-editor { width: min(100%, 420px); }.editor-sheet > p { margin: 0 0 5px; color: var(--accent); font-size: 11px; font-weight: 600; }.editor-sheet h2 { margin: 0 0 22px; font-size: 23px; font-weight: 650; letter-spacing: -.025em; }.editor-sheet label { display: block; margin-top: 16px; }.editor-sheet label > span { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; }.editor-sheet input, .editor-sheet textarea { width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); outline: 0; background: var(--control-fill); color: var(--text); font-size: 13px; transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease); }.editor-sheet input:focus, .editor-sheet textarea:focus { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }.editor-sheet textarea { min-height: 88px; resize: vertical; }.duration-input { display: flex; align-items: center; gap: 9px; }.duration-input input { width: 110px; }.duration-input span { color: var(--muted); font-size: 12px; }.editor-sheet footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--hairline); }.editor-sheet footer button { min-height: 46px; padding: 0 18px; border-radius: var(--radius-lg); font-size: 13px; font-weight: 600; }.footer-spacer { flex: 1; }.cancel { border: 1px solid var(--hairline); background: var(--control-fill); color: var(--text); }.save { border: 0; background: var(--accent); color: var(--accent-text); box-shadow: 0 5px 14px color-mix(in srgb, var(--accent) 20%, transparent); }
.error-banner { position: fixed; z-index: var(--z-toast); left: 232px; right: 16px; top: 14px; min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 10px 8px 14px; border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border)); border-radius: var(--radius-lg); background: var(--material-regular); color: var(--danger); font-size: 11px; box-shadow: var(--shadow-md); backdrop-filter: saturate(130%) blur(18px); }.error-banner button { min-height: 30px; border: 0; background: transparent; color: var(--danger); font-weight: 600; }
@keyframes editor-in { from { transform: translateY(18px) scale(.985); opacity: 0; } }
@media (max-width: 799px) {
  .shell { flex-direction: column; }.workspace { width: 100%; }.mobile-header { height: calc(64px + env(safe-area-inset-top, 0px)); display: flex; align-items: center; justify-content: space-between; padding: calc(8px + env(safe-area-inset-top, 0px)) 16px 8px; border-bottom: 1px solid var(--hairline); background: var(--material-thin); backdrop-filter: saturate(170%) blur(24px); -webkit-backdrop-filter: saturate(170%) blur(24px); }.mobile-header > div { display: flex; align-items: center; gap: 8px; }.mobile-header img { width: 34px; height: 34px; }.mobile-header strong { font-size: 18px; font-weight: 650; letter-spacing: .04em; }.mobile-header button { width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--text); }.mobile-header button:active { background: var(--control-fill); } main { height: calc(100% - 64px - env(safe-area-inset-top, 0px)); scrollbar-gutter: auto; } main.focus-main { height: 100%; }.tasks-layout { display: block; }.editor-backdrop { align-items: flex-end; padding: 0; }.editor-sheet { position: relative; max-height: 94dvh; border-width: 1px 0 0; border-radius: var(--radius-2xl) var(--radius-2xl) 0 0; padding: 32px 20px calc(22px + env(safe-area-inset-bottom, 0px)); animation-name: sheet-up; }.editor-sheet::before { content: ''; position: absolute; top: 9px; left: 50%; width: 36px; height: 5px; transform: translateX(-50%); border-radius: 999px; background: color-mix(in srgb, var(--muted) 32%, transparent); }.error-banner { left: 12px; right: 12px; top: calc(70px + env(safe-area-inset-top, 0px)); }
}
@keyframes sheet-up { from { transform: translateY(36px); opacity: .75; } }
</style>
