<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Settings } from '@lucide/vue'
import { applyTheme } from './assets/themes'
import AppSidebar, { type StudyPage } from './components/study/AppSidebar.vue'
import BottomTabs from './components/study/BottomTabs.vue'
import CompletionSheet, { type CompletionPayload } from './components/study/CompletionSheet.vue'
import ContextRail, { type RailReviewItem } from './components/study/ContextRail.vue'
import FocusView from './components/study/FocusView.vue'
import ReviewView, { type CompletionRecordViewItem, type ReviewViewItem } from './components/study/ReviewView.vue'
import SettingsSheet from './components/study/SettingsSheet.vue'
import TaskActionSheet, { type TaskActionMode, type TaskActionPayload } from './components/study/TaskActionSheet.vue'
import TaskDetailDrawer, { type TaskEventViewItem } from './components/study/TaskDetailDrawer.vue'
import TasksView, { type TaskViewItem, type TaskViewStatus } from './components/study/TasksView.vue'
import TodayView, { type TodayTaskItem } from './components/study/TodayView.vue'
import TopicsView, { type TopicViewItem } from './components/study/TopicsView.vue'
import {
  addTaskChecklistItem,
  captureStudyTask,
  completeStudyTask,
  createTaskFromNextAction,
  exportStudyState,
  loadStudyState,
  pauseStudySession,
  planStudyTask,
  reviewCompletionRecord,
  rescheduleStudyTask,
  reorderStudyTasks,
  resumeStudySession,
  saveStudyScratchpad,
  saveStudyState,
  saveStudyTopic,
  startStudyTask,
  switchStudyTask,
  setTaskChecklistItem,
  transitionStudyTask,
  type CompletionRecord,
  type ReviewResult,
  type StudyState,
  type StudyTask,
  type StudyTopic,
  type TaskEvent,
} from './lib/study'
import { createSeedStudyState } from './storage/study/types'

const page = ref<StudyPage>('today')
const state = ref<StudyState>(createSeedStudyState())
const loading = ref(true)
const showFocus = ref(false)
const completionOpen = ref(false)
const settingsOpen = ref(false)
const topicEditorOpen = ref(false)
const topicTitle = ref('')
const topicGoal = ref('')
const topicMinutes = ref(120)
const selectedTopicId = ref(state.value.topics[0]?.id ?? '')
const selectedTaskId = ref('')
const taskFilter = ref<TaskViewStatus>('inbox')
const taskActionOpen = ref(false)
const taskActionMode = ref<TaskActionMode>('plan')
const taskActionTaskId = ref('')
const reviewRevealed = ref(false)
const reviewMode = ref<'review' | 'records'>('review')
const appearanceDark = ref(false)
const compact = ref(false)
const clock = ref(Date.now())
const toast = ref('')
const toastAction = ref<{ label: string; run: () => Promise<void> } | null>(null)
const storageError = ref('')
let clockTimer: ReturnType<typeof setInterval> | undefined
let scratchSaveTimer: ReturnType<typeof setTimeout> | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined
let compactMedia: MediaQueryList | undefined

const today = computed(() => new Date().toLocaleDateString('sv-SE'))
const dateLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()).replace('星期', '周'))
const activeSession = computed(() => state.value.sessions.find((session) => !session.deletedAt && (session.state === 'running' || session.state === 'paused')))
const activeTask = computed(() => state.value.tasks.find((task) => task.id === activeSession.value?.taskId && !task.deletedAt))
const selectedTask = computed(() => state.value.tasks.find((task) => task.id === selectedTaskId.value && !task.deletedAt))
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
const inboxCount = computed(() => liveTasks.value.filter((task) => task.status === 'inbox').length)
const todayTaskModels = computed(() => {
  const completedToday = new Set(state.value.completionRecords.filter((record) => !record.deletedAt && record.completedAt.startsWith(today.value)).map((record) => record.taskId))
  const tasks = liveTasks.value.filter((task) => (task.plannedOn === today.value && ['planned', 'in_progress', 'blocked'].includes(task.status)) || completedToday.has(task.id))
  const activeId = activeSession.value?.taskId
  return activeId ? tasks.sort((left, right) => left.id === activeId ? -1 : right.id === activeId ? 1 : 0) : tasks
})
const overdueTaskModels = computed(() => liveTasks.value.filter((task) => task.plannedOn !== null && task.plannedOn < today.value && ['planned', 'in_progress', 'blocked'].includes(task.status)))
const todayTasks = computed<TodayTaskItem[]>(() => todayTaskModels.value.map(toTodayTask))
const overdueTasks = computed<TodayTaskItem[]>(() => overdueTaskModels.value.map(toTodayTask))

function toTodayTask(task: StudyTask): TodayTaskItem {
  return {
  id: task.id,
  topic: topicTitleFor(task.topicId),
  title: task.title,
  estimateMinutes: task.estimateMinutes,
  criteria: task.acceptanceCriteria,
  status: task.status === 'completed' ? 'completed' : task.status as TodayTaskItem['status'],
  plannedLabel: formatPlanDate(task.plannedOn),
  isActive: activeSession.value?.taskId === task.id,
  activeLabel: activeSession.value?.taskId === task.id ? `继续 ${timeLabel.value}` : undefined,
  }
}
const taskViews = computed<TaskViewItem[]>(() => liveTasks.value.map(toTaskView))

const startOfWeek = computed(() => {
  const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date.getTime()
})
const completedRecords = computed(() => state.value.completionRecords.filter((record) => !record.deletedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt)))
const weeklyRecords = computed(() => completedRecords.value.filter((record) => new Date(record.completedAt).getTime() >= startOfWeek.value))
const weeklyMinutes = computed(() => weeklyRecords.value.reduce((sum, record) => sum + recordMinutes(record), 0))
const weeklyTarget = computed(() => Math.max(1, Math.round(state.value.topics.reduce((sum, topic) => sum + topic.weeklyTargetMinutes, 0) / 45)))
const reviewQueue = computed(() => completedRecords.value.filter((record) => record.nextReviewOn && record.nextReviewOn <= today.value).sort((a, b) => (a.nextReviewOn ?? '').localeCompare(b.nextReviewOn ?? '')))
const reviewItems = computed<ReviewViewItem[]>(() => reviewQueue.value.map((record) => ({ id: record.id, topic: topicTitleFor(record.topicId), learned: record.learned, evidence: record.evidence, ageLabel: formatAge(record.completedAt) })))
const recordViews = computed<CompletionRecordViewItem[]>(() => completedRecords.value.map((record) => ({ id: record.id, taskId: record.taskId, topicId: record.topicId, topic: topicTitleFor(record.topicId), taskTitle: record.taskTitleSnapshot, learned: record.learned, evidence: record.evidence, blocker: record.blocker, nextAction: record.nextAction, mastery: record.mastery, completedLabel: formatShortDate(record.completedAt), minutes: recordMinutes(record) })))
const railReviews = computed<RailReviewItem[]>(() => reviewQueue.value.map((record) => ({ id: record.id, topic: topicTitleFor(record.topicId), summary: record.learned, reviewedOn: record.lastReviewedAt ? formatShortDate(record.lastReviewedAt) : '尚未复习' })))

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
  appearanceDark.value = localStorage.getItem('meow-study-appearance') === 'dark'
  applyTheme('study', appearanceDark.value)
  compactMedia = window.matchMedia('(max-width: 799px)')
  compact.value = compactMedia.matches
  compactMedia.addEventListener('change', onCompactChange)
  try {
    state.value = await loadStudyState()
    selectedTopicId.value = state.value.topics.find((topic) => !topic.archivedAt)?.id ?? ''
    showFocus.value = Boolean(activeSession.value)
  } catch (error) { reportStorageError(error) } finally { loading.value = false }
  clockTimer = setInterval(() => (clock.value = Date.now()), 1000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (scratchSaveTimer) clearTimeout(scratchSaveTimer)
  if (toastTimer) clearTimeout(toastTimer)
  compactMedia?.removeEventListener('change', onCompactChange)
})

function onCompactChange(event: MediaQueryListEvent) { compact.value = event.matches; if (event.matches && page.value === 'tasks') selectedTaskId.value = '' }
async function refreshState() { state.value = await loadStudyState() }

function navigate(next: StudyPage) {
  page.value = next; showFocus.value = false; reviewRevealed.value = false
  if (next === 'tasks' && !compact.value && !selectedTaskId.value) selectedTaskId.value = taskViews.value.find((task) => task.status === taskFilter.value)?.id ?? ''
}
function openInbox() { page.value = 'tasks'; taskFilter.value = 'inbox'; selectedTaskId.value = compact.value ? '' : taskViews.value.find((task) => task.status === 'inbox')?.id ?? ''; showFocus.value = false }
function openTask(taskId: string) { selectedTaskId.value = taskId; if (page.value !== 'tasks') page.value = 'tasks'; showFocus.value = false }
function openRecords() { page.value = 'review'; reviewMode.value = 'records'; showFocus.value = false }
function setTaskFilter(filter: TaskViewStatus) { taskFilter.value = filter; selectedTaskId.value = compact.value ? '' : taskViews.value.find((task) => task.status === filter)?.id ?? '' }

async function captureTask(title: string) {
  const now = new Date().toISOString()
  try {
    const task = await captureStudyTask({ title, notes: '' }, { taskId: crypto.randomUUID(), eventId: crypto.randomUUID(), now })
    await refreshState(); taskFilter.value = 'inbox'; selectedTaskId.value = task.id; notify('已放入收件箱。')
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
    taskFilter.value = taskActionMode.value === 'cancel' ? 'cancelled' : taskActionMode.value === 'block' ? 'blocked' : 'planned'
    notify(taskActionMode.value === 'defer' ? `已延期到${formatShortDate(payload.plannedOn)}。` : taskActionMode.value === 'cancel' ? '任务已取消。' : taskActionMode.value === 'block' ? '已记录阻碍。' : taskActionMode.value === 'reopen' ? '任务已重开。' : '任务已安排。', undo)
  } catch (error) { reportStorageError(error) }
}

async function moveOverdueToToday(taskId: string) {
  try {
    await rescheduleStudyTask(taskId, today.value, { eventId: crypto.randomUUID(), now: new Date().toISOString(), reason: '从逾期移到今天' })
    await refreshState(); notify('已放到今天。')
  } catch (error) { reportStorageError(error) }
}

async function reorderToday(taskIds: string[]) {
  try {
    await reorderStudyTasks(taskIds, { now: new Date().toISOString() })
    await refreshState(); notify('今日顺序已保存。')
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
  const topic: StudyTopic = { id: crypto.randomUUID(), title, goal: topicGoal.value.trim() || `围绕“${title}”完成一个可验证的学习成果`, successCriteria: ['能用自己的话解释核心概念', '完成一个可以展示或运行的成果'], weeklyTargetMinutes: Math.max(30, topicMinutes.value), createdAt: now, updatedAt: now, archivedAt: null }
  try { await saveStudyTopic(topic); await refreshState(); selectedTopicId.value = topic.id; topicEditorOpen.value = false; topicTitle.value = ''; topicGoal.value = ''; notify('主题已创建。') } catch (error) { reportStorageError(error) }
}

async function exportData() {
  try { const content = await exportStudyState(); const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `拾学记录-${today.value}.json`; anchor.click(); URL.revokeObjectURL(url); notify('学习记录已导出。') } catch (error) { reportStorageError(error) }
}
async function resetDemo() { try { await saveStudyState(createSeedStudyState()); await refreshState(); settingsOpen.value = false; selectedTaskId.value = ''; notify('已恢复拾学的演示数据。') } catch (error) { reportStorageError(error) } }
function setAppearance(mode: 'light' | 'dark') { appearanceDark.value = mode === 'dark'; localStorage.setItem('meow-study-appearance', mode); applyTheme('study', appearanceDark.value) }

function topicTitleFor(topicId: string | null) { return topicId ? topicMap.value.get(topicId)?.title ?? '未知主题' : '未归类' }
function taskStatus(task: StudyTask): TaskViewStatus { return task.status === 'planned' && !task.plannedOn ? 'backlog' : task.status }
function toTaskView(task: StudyTask): TaskViewItem { return { id: task.id, title: task.title, topic: topicTitleFor(task.topicId), status: taskStatus(task), plannedLabel: formatPlanDate(task.plannedOn), estimateMinutes: task.estimateMinutes, acceptanceCriteria: task.acceptanceCriteria, checklist: task.checklist.map((item) => ({ id: item.id, text: item.text, checked: item.checked })), blockedReason: task.blockedReason ?? '' } }
function toEventView(event: TaskEvent): TaskEventViewItem {
  const labels: Record<TaskEvent['type'], string> = { captured: '加入收件箱', migrated: '从旧版记录迁移', planned: '安排任务', started: '开始学习', paused: '暂停学习', resumed: '继续学习', blocked: '标记受阻', completed: '完成学习', reopened: '重开任务', cancelled: '取消任务', rescheduled: '调整计划日期' }
  const tones: Record<TaskEvent['type'], TaskEventViewItem['tone']> = { captured: 'accent', migrated: 'muted', planned: 'accent', started: 'accent', paused: 'muted', resumed: 'accent', blocked: 'warning', completed: 'success', reopened: 'accent', cancelled: 'danger', rescheduled: 'muted' }
  return { id: event.id, time: formatEventTime(event.occurredAt), title: labels[event.type], detail: event.reason || (event.type === 'planned' || event.type === 'rescheduled' ? `计划日期：${formatPlanDate(selectedTask.value?.plannedOn ?? null)}` : statusDetail(event)), tone: tones[event.type] }
}
function statusDetail(event: TaskEvent) { return event.toStatus ? `状态变为${({ inbox: '收件箱', planned: '已计划', in_progress: '进行中', blocked: '已阻塞', completed: '已完成', cancelled: '已取消' } as const)[event.toStatus]}` : '保留此次变化' }
function recordMinutes(record: CompletionRecord) { return Math.max(1, Math.round(state.value.sessions.filter((session) => record.sessionIds.includes(session.id)).reduce((sum, session) => sum + session.elapsedSeconds, 0) / 60)) }
function formatPlanDate(value: string | null) { if (!value) return '待安排'; if (value === today.value) return '今天'; const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); if (value === tomorrow.toLocaleDateString('sv-SE')) return '明天'; return formatShortDate(value) }
function formatShortDate(value: string | null | undefined) { if (!value) return '今天'; const date = new Date(value.length === 10 ? `${value}T00:00:00` : value); return `${date.getMonth() + 1} 月 ${date.getDate()} 日` }
function formatAge(value: string) { const diff = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86_400_000)); return diff === 0 ? '今天' : `${diff} 天前` }
function formatEventTime(value: string) { const date = new Date(value); return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function notify(message: string, action?: { label: string; run: () => Promise<void> }) { toast.value = message; toastAction.value = action ?? null; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.value = ''; toastAction.value = null }, action ? 6000 : 3200) }
async function runToastAction() {
  const action = toastAction.value
  if (!action) return
  toast.value = ''; toastAction.value = null
  if (toastTimer) clearTimeout(toastTimer)
  try { await action.run(); notify('已撤销。') } catch (error) { reportStorageError(error) }
}
function reportStorageError(error: unknown) { storageError.value = error instanceof Error ? error.message : String(error); notify('这次更改还没写入本地，内容仍保留在页面中。') }
</script>

<template>
  <div class="shell">
    <AppSidebar v-if="!showFocus" :active="page" @navigate="navigate" @settings="settingsOpen = true" />
    <div class="workspace">
      <header v-if="!showFocus" class="mobile-header"><div><img src="/shixue-mark.svg" alt="" /><strong>拾学</strong></div><button title="设置" @click="settingsOpen = true"><Settings :size="22" /></button></header>
      <main :class="{ 'focus-main': showFocus, 'tasks-main': page === 'tasks' && !showFocus }">
        <div v-if="loading" class="loading">正在打开你的学习记录…</div>
        <FocusView v-else-if="showFocus && activeSession && activeTask" :topic-title="topicTitleFor(activeTask.topicId)" :task-title="activeTask.title" :criteria="activeTask.acceptanceCriteria" :time-label="timeLabel" :running="activeSession.state === 'running'" :scratchpad="activeSession.scratchpad" @back="showFocus = false" @toggle="toggleFocus" @finish="completionOpen = true" @update:scratchpad="updateScratchpad" />
        <div v-else-if="page === 'today'" class="today-layout">
          <TodayView :date-label="dateLabel" :tasks="todayTasks" :overdue-tasks="overdueTasks" :inbox-count="inboxCount" :weekly-completed="weeklyRecords.length" :weekly-target="weeklyTarget" :weekly-minutes="weeklyMinutes" @start="startFocus" @open="openTask" @open-tasks="openInbox" @open-inbox="openInbox" @open-records="openRecords" @move-to-today="moveOverdueToToday" @defer="openTaskAction($event, 'defer')" @cancel="openTaskAction($event, 'cancel')" @reorder="reorderToday" />
          <ContextRail :day-index="(new Date().getDay() + 6) % 7" :completed-days="weeklyRecords.length" :reviews="railReviews" @open-review="navigate('review')" />
        </div>
        <div v-else-if="page === 'tasks'" class="tasks-layout">
          <div class="tasks-scroll"><TasksView :tasks="taskViews" :date-label="dateLabel" :selected-id="selectedTaskId" :filter="taskFilter" @filter-change="setTaskFilter" @capture="captureTask" @open="openTask" @plan="openTaskAction($event, 'plan')" @start="startFocus" @reopen="openTaskAction($event, 'reopen')" /></div>
          <TaskDetailDrawer :task="selectedTaskView" :events="selectedTaskEvents" :due-label="selectedTask?.dueOn ? formatPlanDate(selectedTask.dueOn) : ''" :mobile="compact" @close="selectedTaskId = ''" @primary="taskPrimary" @defer="openTaskAction($event, 'defer')" @block="openTaskAction($event, 'block')" @cancel="openTaskAction($event, 'cancel')" @toggle-checklist="toggleTaskChecklist" @add-checklist="addTaskChecklist" />
        </div>
        <TopicsView v-else-if="page === 'topics'" :topics="topicViews" :selected-id="selectedTopicId" @select="selectedTopicId = $event" @create="topicEditorOpen = true" @start="taskPrimary(liveTasks.find((task) => task.topicId === $event && (task.status === 'in_progress' || task.status === 'planned'))?.id ?? '')" />
        <ReviewView v-else-if="page === 'review'" :item="reviewItems[0]" :remaining="reviewItems.length" :revealed="reviewRevealed" :weekly-completed="weeklyRecords.length" :weekly-minutes="weeklyMinutes" :weekly-highlight="weeklyHighlight" :weekly-blocker="weeklyBlocker" :weekly-next="weeklyNext" :records="recordViews" :topics="state.topics" :initial-mode="reviewMode" @reveal="reviewRevealed = true" @rate="rateReview" @create-task="createFromNextAction" @open-task="openTask" />
      </main>
      <BottomTabs v-if="!showFocus" :active="page" @navigate="navigate" />
    </div>

    <CompletionSheet :open="completionOpen" :task-title="activeTask?.title ?? ''" :scratchpad="activeSession?.scratchpad ?? ''" @close="completionOpen = false" @save="completeFocus" />
    <TaskActionSheet :open="taskActionOpen" :mode="taskActionMode" :task-title="actionTask?.title ?? ''" :topics="state.topics" :default-topic-id="actionTask?.topicId" :default-planned-on="actionTask?.plannedOn" :default-due-on="actionTask?.dueOn" :default-minutes="actionTask?.estimateMinutes" :default-criteria="actionTask?.acceptanceCriteria" @close="taskActionOpen = false" @submit="submitTaskAction" />
    <SettingsSheet :open="settingsOpen" :dark="appearanceDark" @close="settingsOpen = false" @export="exportData" @reset-demo="resetDemo" @set-appearance="setAppearance" />

    <div v-if="topicEditorOpen" class="editor-backdrop" @click.self="topicEditorOpen = false"><form class="editor-sheet" @submit.prevent="saveTopic"><p>新建学习主题</p><h2>最近最想真正学会什么？</h2><label><span>主题名称</span><input v-model="topicTitle" required /></label><label><span>做到什么才算真的学会？</span><textarea v-model="topicGoal" placeholder="写下一个可以验证的最终成果" /></label><label><span>每周投入</span><div class="duration-input"><input v-model.number="topicMinutes" type="number" min="30" max="1200" /><span>分钟</span></div></label><footer><button type="button" class="cancel" @click="topicEditorOpen = false">取消</button><button type="submit" class="save">创建主题</button></footer></form></div>
    <div v-if="toast" class="toast" :class="{ 'detail-toast': compact && Boolean(selectedTaskId) }" role="status"><span>{{ toast }}</span><button v-if="toastAction" @click="runToastAction">{{ toastAction.label }}</button></div>
    <div v-if="storageError" class="error-banner" role="alert"><span>上一次更改未保存。拾学不会用演示数据覆盖现有记录。</span><button @click="storageError = ''">知道了</button></div>
  </div>
</template>

<style scoped>
.shell { width: 100vw; height: 100vh; height: 100dvh; display: flex; overflow: hidden; background: var(--bg); }.workspace { min-width: 0; flex: 1; height: 100%; overflow: hidden; } main { width: 100%; height: 100%; overflow-y: auto; overscroll-behavior-y: contain; scroll-behavior: smooth; scrollbar-gutter: stable; }.tasks-main { overflow: hidden; }.today-layout { min-height: 100%; display: flex; justify-content: center; }.today-layout > :first-child { flex: 1 1 auto; }.tasks-layout { height: 100%; display: flex; }.tasks-scroll { min-width: 0; flex: 1; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; }.focus-main { background: radial-gradient(circle at 50% -25%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 42%), var(--bg); }.mobile-header { display: none; }.loading { min-height: 100%; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 13px; }
.editor-backdrop { position: fixed; z-index: var(--z-modal); inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, var(--text) 22%, transparent); backdrop-filter: saturate(120%) blur(12px); }.editor-sheet { width: min(100%, 470px); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 28px; border: 1px solid var(--hairline); border-radius: var(--radius-2xl); background: var(--material-regular); box-shadow: var(--shadow-lg); animation: editor-in var(--motion-slow) var(--ease-spring); }.editor-sheet > p { margin: 0 0 5px; color: var(--accent); font-size: 11px; font-weight: 600; }.editor-sheet h2 { margin: 0 0 22px; font-size: 23px; font-weight: 650; letter-spacing: -.025em; }.editor-sheet label { display: block; margin-top: 16px; }.editor-sheet label > span { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; }.editor-sheet input, .editor-sheet textarea { width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); outline: 0; background: var(--control-fill); color: var(--text); font-size: 13px; transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease); }.editor-sheet input:focus, .editor-sheet textarea:focus { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }.editor-sheet textarea { min-height: 88px; resize: vertical; }.duration-input { display: flex; align-items: center; gap: 9px; }.duration-input input { width: 110px; }.duration-input span { color: var(--muted); font-size: 12px; }.editor-sheet footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--hairline); }.editor-sheet footer button { min-height: 46px; padding: 0 18px; border-radius: var(--radius-lg); font-size: 13px; font-weight: 600; }.cancel { border: 1px solid var(--hairline); background: var(--control-fill); color: var(--text); }.save { border: 0; background: var(--accent); color: var(--accent-text); box-shadow: 0 5px 14px color-mix(in srgb, var(--accent) 20%, transparent); }
.toast { position: fixed; z-index: var(--z-toast); left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; align-items: center; gap: 13px; margin: 0; padding: 8px 9px 8px 16px; border: 1px solid color-mix(in srgb, white 11%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--text) 88%, transparent); color: var(--bg); font-size: 12px; box-shadow: var(--shadow-lg); backdrop-filter: saturate(140%) blur(18px); animation: toast-in var(--motion-base) var(--ease-spring); }.toast button { min-height: 30px; padding: 0 11px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--bg) 16%, transparent); color: var(--bg); font-size: 12px; font-weight: 650; }.error-banner { position: fixed; z-index: var(--z-toast); left: 232px; right: 16px; top: 14px; min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 10px 8px 14px; border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border)); border-radius: var(--radius-lg); background: var(--material-regular); color: var(--danger); font-size: 11px; box-shadow: var(--shadow-md); backdrop-filter: saturate(130%) blur(18px); }.error-banner button { min-height: 30px; border: 0; background: transparent; color: var(--danger); font-weight: 600; }
@keyframes editor-in { from { transform: translateY(18px) scale(.985); opacity: 0; } }
@keyframes toast-in { from { transform: translate(-50%, 10px) scale(.97); opacity: 0; } }
@media (max-width: 799px) {
  .shell { flex-direction: column; }.workspace { width: 100%; }.mobile-header { height: calc(64px + env(safe-area-inset-top, 0px)); display: flex; align-items: center; justify-content: space-between; padding: calc(8px + env(safe-area-inset-top, 0px)) 16px 8px; border-bottom: 1px solid var(--hairline); background: var(--material-thin); backdrop-filter: saturate(170%) blur(24px); -webkit-backdrop-filter: saturate(170%) blur(24px); }.mobile-header > div { display: flex; align-items: center; gap: 8px; }.mobile-header img { width: 34px; height: 34px; }.mobile-header strong { font-size: 18px; font-weight: 650; letter-spacing: .04em; }.mobile-header button { width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--text); }.mobile-header button:active { background: var(--control-fill); } main { height: calc(100% - 64px - env(safe-area-inset-top, 0px)); scrollbar-gutter: auto; } main.focus-main { height: 100%; }.tasks-layout { display: block; }.editor-backdrop { align-items: flex-end; padding: 0; }.editor-sheet { position: relative; max-height: 94dvh; border-width: 1px 0 0; border-radius: var(--radius-2xl) var(--radius-2xl) 0 0; padding: 32px 20px calc(22px + env(safe-area-inset-bottom, 0px)); animation-name: sheet-up; }.editor-sheet::before { content: ''; position: absolute; top: 9px; left: 50%; width: 36px; height: 5px; transform: translateX(-50%); border-radius: 999px; background: color-mix(in srgb, var(--muted) 32%, transparent); }.toast { bottom: calc(92px + env(safe-area-inset-bottom, 0px)); max-width: calc(100vw - 32px); white-space: nowrap; }.toast.detail-toast { bottom: calc(148px + env(safe-area-inset-bottom, 0px)); }.error-banner { left: 12px; right: 12px; top: calc(70px + env(safe-area-inset-top, 0px)); }
}
@keyframes sheet-up { from { transform: translateY(36px); opacity: .75; } }
</style>
