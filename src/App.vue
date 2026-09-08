<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Search, Settings } from '@lucide/vue'
import {
  applyThemePreference,
  loadThemePreference,
  prefersDark,
  resolveThemeDark,
  saveThemePreference,
  type ThemeMode,
  type ThemePreference,
} from './assets/themes/apply'
import AppSidebar, { type StudySmartViewCounts } from './components/study/AppSidebar.vue'
import BottomTabs from './components/study/BottomTabs.vue'
import CalendarWorkspace from './components/calendar/CalendarWorkspace.vue'
import CompletionSheet, { type CompletionPayload } from './components/study/CompletionSheet.vue'
import FocusView from './components/study/FocusView.vue'
import ReviewView, { type CompletionRecordViewItem, type ReviewViewItem } from './components/study/ReviewView.vue'
import SettingsView, { type CloudAccountStatus } from './components/study/SettingsView.vue'
import ReminderCard, { type ReminderCardAction } from './components/study/ReminderCard.vue'
import type { ReminderSetValue } from './components/study/ReminderEditor.vue'
import TaskActionSheet, { type TaskActionMode, type TaskActionPayload } from './components/study/TaskActionSheet.vue'
import TaskDetailDrawer, { type TaskEventViewItem } from './components/study/TaskDetailDrawer.vue'
import TaskEditSheet, { type TaskEditChanges, type TaskEditValue } from './components/study/TaskEditSheet.vue'
import TagManagerSheet from './components/study/TagManagerSheet.vue'
import GlobalSearchDialog from './components/study/GlobalSearchDialog.vue'
import LearningRhythmView, { type LearningRhythmViewItem } from './components/study/LearningRhythmView.vue'
import RecurrenceScopeDialog, { type RecurrenceRuleScope } from './components/study/RecurrenceScopeDialog.vue'
import OccurrenceRescheduleSheet from './components/study/OccurrenceRescheduleSheet.vue'
import { type RecurrenceRule } from './components/study/RecurrenceEditor.vue'
import TasksView, { type OccurrenceViewItem, type TaskViewItem, type TaskViewStatus } from './components/study/TasksView.vue'
import TopicsView, { type TopicViewItem } from './components/study/TopicsView.vue'
import Listbox from './components/ui/Listbox.vue'
import Popover from './components/ui/Popover.vue'
import OverlayHost from './components/ui/OverlayHost.vue'
import ToastRegion from './components/ui/ToastRegion.vue'
import Button from './components/ui/Button.vue'
import Dialog from './components/ui/Dialog.vue'
import Sheet from './components/ui/Sheet.vue'
import { queryStudyTasks, selectStudyTaskSmartView, type StudyTaskQuerySort, type StudyTaskSmartView } from './lib/study-task-query'
import { selectToday } from './domain/views/today'
import { selectUpcoming } from './domain/views/upcoming'
import { selectLearningRhythms } from './domain/views/learning-rhythm'
import { selectWeeklyLearningSummary } from './domain/views/weekly-learning-summary'
import { defaultModuleConfig } from './modules/config'
import { installWindowLifecycle, type WindowCloseBehavior } from './lib/window-lifecycle'
import { createReminderRuntime, readNativeLegacyReminderRows, submitNativeReminder } from './lib/reminder-runtime'
import type { NotificationPermissionStatus } from './modules/notification'
import { loadLastDesktopCalendarView, loadPlanningPreferences, saveLastDesktopCalendarView, savePlanningPreferences, type PlanningPreferences } from './lib/planning-preferences'
import type { CalendarView } from './domain/calendar/range'
import { offsetForInstant } from './domain/calendar/target'
import { loadSidebarPreferences, saveSidebarPreferences, type SidebarPreferences } from './lib/sidebar-preferences'
import { shouldAutoSelectTask } from './lib/task-detail-layout'
import { learningBatchBlockers, routeSingleTaskCompletion } from './lib/task-completion-routing'
import {
  desktopWorkspaceNavigation,
  learningWorkspaceNavigation,
  mobileMoreWorkspaceNavigation,
  renderPageForDestination,
  resolveArchivedListTransition,
  resolveTaskTopicFilterTransition,
  shouldResetTaskPriority,
  type ShellDestination,
  type WorkspaceView,
} from './lib/workspace-view'
import { workspaceDestinationFromSmartView } from './lib/sidebar-navigation'
import { hasRuntimeCapability, RUNTIME_INFO_KEY, runtimeInfoForNativePlatform } from './lib/platform'
import { reportSmokePhase } from './lib/smoke'
import { runNativeAndroidPersistenceSmoke } from './lib/android-persistence-smoke'
import {
  addTaskChecklistItem,
  archiveStudyListGroup,
  bulkDeleteStudyTasks,
  completeStudyTask,
  createTaskFromNextAction,
  deleteStudyTask,
  exportLearningRecordsMarkdown,
  exportStudyState,
  importStudyState,
  loadStudyState,
  projectWorkspaceState,
  pauseStudySession,
  planStudyTask,
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
import { CAPABILITY_PROTOCOL_VERSION, type CapabilityCommand, type CommandEnvelope, type CommandPreview, type EntityRef, type TagCapabilityCommand } from './domain/capabilities/types'
import type { CalendarCapabilityCommand } from './domain/capabilities/calendar-commands'
import { createCalendarUndoAction, runCalendarCommand } from './lib/calendar-command-handler'
import { runOverdueBatchMove } from './lib/overdue-batch-command'
import { runTagCommand } from './lib/tag-command-handler'
import { destinationForSearchTask } from './lib/search-result-navigation'
import { resolveRecurrenceEditWrite, resolveReminderEditWrite, resolveTaskEditWrite, runTaskEditCommit } from './lib/task-edit-commit'
import type { RecurrenceCadence, RecurrenceSeries, Task, WorkspaceStateV3 } from './domain/workspace/types'
import { parseZonedDateTime, zonedDateTimeToInstant } from './domain/recurrence/timezone'

const destination = ref<ShellDestination>({ kind: 'today' })
const page = computed(() => renderPageForDestination(destination.value))
const vPageMotion = {
  updated(element: HTMLElement, { value, oldValue }: { value: string; oldValue: string }) {
    if (value === oldValue) return
    for (const animation of element.getAnimations()) animation.cancel()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    element.animate(
      [{ opacity: 0.65 }, { opacity: 1 }],
      { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' },
    )
  },
  beforeUnmount(element: HTMLElement) {
    for (const animation of element.getAnimations()) animation.cancel()
  },
}
const state = ref<StudyState>(createSeedStudyState())
const loading = ref(true)
const showFocus = ref(false)
const completionOpen = ref(false)
const completionTaskId = ref('')
const completionOccurrenceId = ref('')
const completionOccurrenceBusy = ref(false)
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
const activeSmartView = computed<StudyTaskSmartView>(() => {
  if (destination.value.kind === 'today') return 'today'
  if (destination.value.kind === 'upcoming') return 'next7'
  if (destination.value.kind === 'completed') return 'completed'
  if (destination.value.kind === 'inbox') return 'inbox'
  return 'all'
})
const taskSearch = ref('')
const taskTopicFilter = ref('all')
const taskPriorityFilter = ref<StudyTaskPriority | 'all'>('all')
const taskSort = ref<StudyTaskQuerySort>('manual')
const taskActionOpen = ref(false)
const listsMoreOpen = ref(false)
const taskActionMode = ref<TaskActionMode>('plan')
const taskActionTaskId = ref('')
const taskEditorOpen = ref(false)
const globalSearchOpen = ref(false)
const tagManagerOpen = ref(false)
const tagManagerReturnToSearch = ref(false)
const tagManagerBusy = ref(false)
const tagManagerError = ref('')
const tagManager = ref<InstanceType<typeof TagManagerSheet> | null>(null)
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
const reviewBusy = ref(false)
const reviewRefreshRequired = ref(false)
const reviewMode = ref<'review' | 'records'>('review')
const reviewTargetLinkId = ref('')
const recordTarget = ref<{ id: string; requestId: number }>()
let recordTargetRequestId = 0
const themePreference = ref<ThemePreference>(loadThemePreference())
const systemDark = ref(prefersDark())
const appearanceDark = computed(() => resolveThemeDark(themePreference.value.mode, systemDark.value))
const compact = ref(false)
const clock = ref(Date.now())
const calendarTargetOffset = computed(() => offsetForInstant(new Date(clock.value)))
const toast = ref('')
const toastAction = ref<{ label: string; run: () => Promise<void>; successMessage?: string } | null>(null)
const toastVersion = ref(0)
const moduleStartupError = '部分系统能力未能启动。任务数据与核心界面仍可使用。'
const storageError = ref('')
const errorBannerMessage = computed(() => storageError.value === moduleStartupError
  ? moduleStartupError
  : '上一次更改未保存。拾学不会用演示数据覆盖现有记录。')
const remindersEnabled = ref(false)
const planningPreferences = ref(loadPlanningPreferences())
const calendarStartsCompact = typeof window !== 'undefined' && window.innerWidth <= 819
const desktopCalendarMode = ref<CalendarView>(calendarStartsCompact
  ? planningPreferences.value.defaultCalendarView
  : loadLastDesktopCalendarView() ?? planningPreferences.value.defaultCalendarView)
let desktopCalendarModeLoaded = !calendarStartsCompact
const defaultSidebarMenuKeys = [...desktopWorkspaceNavigation.map(({ preferenceKey }) => preferenceKey), 'page:review']
const sidebarPreferences = ref(loadSidebarPreferences(defaultSidebarMenuKeys))
const tasksView = ref<InstanceType<typeof TasksView> | null>(null)
const runtime = inject(RUNTIME_INFO_KEY, () => runtimeInfoForNativePlatform('web'), true)
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const capabilityService = createTaskCapabilityService(getWorkspaceStore(), () => new Date().toISOString(), (kind) => `${kind}:${crypto.randomUUID()}`)
const nativeNotificationAvailable = ref(false)
const notificationPermission = ref<NotificationPermissionStatus>('unavailable')
const reminderSettingBusy = ref(false)
const reminderMessage = ref('')
const lifecycleAvailable = ref(false)
const closeRequestOpen = ref(false)
const autostartAvailable = ref(false)
const autostartEnabled = ref(false)
const autostartBusy = ref(false)
const deviceMessage = ref('')
let unlistenClose: (() => void) | undefined
let resolveClose: ((choice: 'tray' | 'quit' | null) => void) | undefined
let disposed = false
const reminderBusy = ref(false)
const reminderError = ref('')
const reminderCenterOpen = ref(false)
const completionReminderId = ref('')
let reminderWorker: ReturnType<typeof createReminderRuntime> | undefined
let unlistenReminderTick: (() => void) | undefined
const nativeDeliveryAvailable = computed(() => nativeNotificationAvailable.value && notificationPermission.value === 'granted')
const editorReminderPermission = computed(() => notificationPermission.value === 'not-granted' ? 'denied' : notificationPermission.value)
const reminderCards = computed(() => {
  const workspace = recurrenceWorkspace.value
  if (!workspace) return []
  return workspace.reminderDeliveries.flatMap((delivery) => {
    if (!['pending', 'delivered', 'failed', 'ambiguous'].includes(delivery.status) || Date.parse(delivery.scheduledFor) > clock.value) return []
    const rule = workspace.reminderRules.find(({ id }) => id === delivery.reminderRuleId)
    const task = workspace.tasks.find(({ id, deletedAt }) => id === rule?.taskId && !deletedAt)
    return task ? [{ delivery, task }] : []
  })
})
const reminderCompletionTask = computed(() => {
  const workspace = recurrenceWorkspace.value
  const delivery = workspace?.reminderDeliveries.find(({ id }) => id === completionReminderId.value)
  const rule = workspace?.reminderRules.find(({ id }) => id === delivery?.reminderRuleId)
  return workspace?.tasks.find(({ id }) => id === rule?.taskId)
})
const completionOccurrenceTask = computed(() => {
  const workspace = recurrenceWorkspace.value
  const occurrence = workspace?.occurrences.find(({ id }) => id === completionOccurrenceId.value)
  const series = workspace?.recurrenceSeries.find(({ id }) => id === occurrence?.seriesId)
  return workspace?.tasks.find(({ id }) => id === series?.taskId)
})
const completionTask = computed(() => state.value.tasks.find(({ id, deletedAt }) => id === completionTaskId.value && !deletedAt))
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
let scratchSaving = false
const scratchDrafts = new Map<string, string>()
// Keep committed notes until a workspace read confirms them, including reads already in flight.
const scratchNotes = new Map<string, string>()
let refreshVersion = 0
let appliedRefreshVersion = 0
let compactMedia: MediaQueryList | undefined
let appearanceMedia: MediaQueryList | undefined

const today = computed(() => new Date(clock.value).toLocaleDateString('sv-SE'))
const dateLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(clock.value)).replace('星期', '周'))
const activeSession = computed(() => state.value.sessions.find((session) => !session.deletedAt && (session.state === 'running' || session.state === 'paused')))
const activeTask = computed(() => state.value.tasks.find((task) => task.id === activeSession.value?.taskId && !task.deletedAt))
const activeReviewLinkId = computed(() => recurrenceWorkspace.value?.reviewTaskLinks.find(({ reviewTaskId, completedAt }) =>
  reviewTaskId === activeTask.value?.id && completedAt === null)?.id ?? '')
const selectedTask = computed(() => state.value.tasks.find((task) => task.id === selectedTaskId.value && !task.deletedAt))
const selectedWorkspaceTask = computed(() => recurrenceWorkspace.value?.tasks.find((task) => task.id === selectedTaskId.value && !task.deletedAt))
const selectedTaskEditModel = computed(() => selectedTask.value ? ({
  ...selectedTask.value,
  tagIds: [...(selectedWorkspaceTask.value?.tagIds ?? [])],
}) : undefined)
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
  smartView: activeSmartView.value === 'today' || activeSmartView.value === 'next7' ? 'all' : activeSmartView.value,
  today: today.value,
}).filter((task) => taskPriorityFilter.value === 'all' || task.priority === taskPriorityFilter.value).map(toTaskView))
const todayGroups = computed(() => recurrenceWorkspace.value ? selectToday(recurrenceWorkspace.value, today.value, timezone) : [])
const upcomingGroups = computed(() => recurrenceWorkspace.value ? selectUpcoming(recurrenceWorkspace.value, today.value, 7, timezone) : [])
const activeProjectionGroups = computed(() => activeSmartView.value === 'today' ? todayGroups.value : activeSmartView.value === 'next7' ? upcomingGroups.value : [])
const activeProjectionItems = computed(() => activeProjectionGroups.value.flatMap((group) => group.items.map((item) => ({ item, group: 'kind' in group ? group.kind : group.date }))))
const filteredProjectionItems = computed(() => {
  // Selectors own date/occurrence membership; legacy query results only apply the user's text, list, priority and sort choices.
  const eligibleOrder = new Map(filteredTaskViews.value.map((task, index) => [task.id, index]))
  const items = activeProjectionItems.value.flatMap((entry, index) => eligibleOrder.has(entry.item.taskId) ? [{ ...entry, index }] : [])
  if (taskSort.value !== 'manual') items.sort((left, right) => eligibleOrder.get(left.item.taskId)! - eligibleOrder.get(right.item.taskId)! || left.index - right.index)
  return items
})
const taskViews = computed<TaskViewItem[]>(() => {
  if ((activeSmartView.value !== 'today' && activeSmartView.value !== 'next7') || !recurrenceWorkspace.value) return filteredTaskViews.value
  const eligible = new Map(filteredTaskViews.value.map((task) => [task.id, task]))
  return filteredProjectionItems.value.filter(({ item }) => item.occurrenceId === null).flatMap(({ item, group }) => {
    const task = eligible.get(item.taskId)
    return task ? [{ ...task, reasons: item.reasons, projectionGroup: group }] : []
  })
})
const occurrenceViews = computed<OccurrenceViewItem[]>(() => {
  const workspace = recurrenceWorkspace.value
  if (!workspace) return []
  const tasks = new Map(liveTasks.value.map((task) => [task.id, task]))
  const visibleTaskIds = new Set(filteredTaskViews.value.map((task) => task.id))
  if (activeSmartView.value === 'today' || activeSmartView.value === 'next7') {
    return filteredProjectionItems.value.filter(({ item }) => item.occurrence?.status === 'pending').map(({ item, group }) => ({
      id: item.key,
      title: tasks.get(item.taskId)?.title ?? item.task.title,
      scheduledLabel: formatPlanDate(item.scheduledOn ?? item.scheduledAt),
      deadlineLabel: item.dueOn || item.dueAt ? formatPlanDate(item.dueOn ?? item.dueAt) : '',
      reasons: item.reasons,
      projectionGroup: group,
      occurrence: item.occurrence!,
    }))
  }
  return workspace.occurrences.filter((occurrence) => occurrence.status === 'pending').map((occurrence) => {
    const series = workspace.recurrenceSeries.find((item) => item.id === occurrence.seriesId)
    const task = series ? tasks.get(series.taskId) : undefined
    const scheduled = occurrence.override?.scheduledOn ?? occurrence.override?.scheduledAt ?? occurrence.scheduledOn ?? occurrence.scheduledAt
    return task && visibleTaskIds.has(task.id) ? { id: `occurrence:${occurrence.id}`, title: task.title, scheduledLabel: formatPlanDate(scheduled), deadlineLabel: task.dueOn ? formatPlanDate(task.dueOn) : '', reasons: ['recurring'], occurrence } : null
  }).filter((item): item is OccurrenceViewItem => item !== null)
})
const learningRhythmSelection = computed(() => recurrenceWorkspace.value
  ? selectLearningRhythms(recurrenceWorkspace.value, {
      asOf: new Date(clock.value).toISOString(),
      weekStartsOn: planningPreferences.value.weekStartsOn,
    })
  : { items: [], totals: { planned: 0, completedWithEvidence: 0, completedMissingEvidence: 0, skipped: 0, cancelled: 0 } })
const learningRhythmItems = computed<LearningRhythmViewItem[]>(() => {
  const workspace = recurrenceWorkspace.value
  if (!workspace) return []
  const tasks = new Map(workspace.tasks.map((task) => [task.id, task]))
  const lists = new Map(workspace.lists.map((list) => [list.id, list]))
  return learningRhythmSelection.value.items.flatMap((item) => {
    const task = tasks.get(item.taskId)
    if (!task) return []
    return [{
      ...item,
      title: task.title,
      topic: lists.get(item.listId)?.title ?? '未归类',
      cadenceLabel: formatRhythmCadence(item.cadence, item.basis),
      weekLabel: formatRhythmWeek(item.rangeStart, item.rangeEnd),
      nextLabel: item.nextScheduled ? formatPlanDate(item.nextScheduled) : '',
    }]
  })
})

const smartViewCounts = computed<StudySmartViewCounts>(() => ({
  inbox: selectStudyTaskSmartView(liveTasks.value, 'inbox', today.value).length,
  today: recurrenceWorkspace.value ? todayGroups.value.flatMap(({ items }) => items).length : selectStudyTaskSmartView(liveTasks.value, 'today', today.value).length,
  next7: recurrenceWorkspace.value ? upcomingGroups.value.flatMap(({ items }) => items).length : selectStudyTaskSmartView(liveTasks.value, 'next7', today.value).length,
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
const sidebarMenuKeys = computed(() => [
  ...defaultSidebarMenuKeys.slice(0, 5),
  ...listNavItems.value.map(({ id }) => `list:${id}`),
  ...defaultSidebarMenuKeys.slice(5),
])
const sidebarOrderCustomized = computed(() => sidebarPreferences.value.order.join('|') !== sidebarMenuKeys.value.join('|'))
watch(sidebarMenuKeys, (keys) => { sidebarPreferences.value = loadSidebarPreferences(keys) }, { immediate: true })

const completedRecords = computed(() => state.value.completionRecords.filter((record) => !record.deletedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt)))
const weeklyLearningSummary = computed(() => recurrenceWorkspace.value
  ? selectWeeklyLearningSummary(recurrenceWorkspace.value, {
      asOf: new Date(clock.value).toISOString(),
      timezone,
      weekStartsOn: planningPreferences.value.weekStartsOn,
    })
  : {
      rangeStart: today.value,
      rangeEnd: today.value,
      totals: {
        evidenceCompletions: { value: 0, recordIds: [] },
        evidenceMinutes: { value: 0, recordIds: [] },
        completedReviews: { value: 0, recordIds: [] },
      },
      topics: [],
    })
const reviewQueue = computed(() => completedRecords.value.filter((record) => record.nextReviewOn && record.nextReviewOn <= today.value).sort((a, b) => (a.nextReviewOn ?? '').localeCompare(b.nextReviewOn ?? '')))
const reviewItems = computed<ReviewViewItem[]>(() => {
  const targetLink = recurrenceWorkspace.value?.reviewTaskLinks.find(({ id, completedAt }) => id === reviewTargetLinkId.value && completedAt === null)
  const targetRecord = targetLink ? completedRecords.value.find(({ id }) => id === targetLink.completionRecordId) : undefined
  const records = targetRecord ? [targetRecord, ...reviewQueue.value.filter(({ id }) => id !== targetRecord.id)] : reviewQueue.value
  return records.flatMap((record) => {
    const link = recurrenceWorkspace.value?.reviewTaskLinks.find(({ completionRecordId, reviewStage, dueOn, completedAt }) =>
      completionRecordId === record.id && reviewStage === record.reviewStage && dueOn === record.nextReviewOn && completedAt === null)
    return link ? [{ id: record.id, linkId: link.id, topic: topicTitleFor(record.topicId), learned: record.learned, evidence: record.evidence, ageLabel: formatAge(record.completedAt) }] : []
  })
})
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

const weeklyNext = computed(() => liveTasks.value.find((task) => task.status === 'in_progress' || task.status === 'planned')?.title || '从收件箱选择一个下一步')

onMounted(async () => {
  window.addEventListener('shixue:quick-add', handleQuickAdd)
  window.addEventListener('shixue:module-error', handleModuleError)
  window.addEventListener('keydown', handleGlobalSearchShortcut)
  try {
    remindersEnabled.value = localStorage.getItem('meow-study-reminders') === 'enabled'
  } catch {
    notify('设备偏好暂时无法读取，已使用默认显示设置；学习记录仍可打开。')
  }
  applyReducedGlass(planningPreferences.value.reducedGlassOverride)
  appearanceMedia = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = appearanceMedia.matches
  appearanceMedia.addEventListener('change', onAppearanceChange)
  compactMedia = window.matchMedia('(max-width: 819px)')
  compact.value = compactMedia.matches
  compactMedia.addEventListener('change', onCompactChange)
  let workspaceReady = false
  try {
    await refreshState()
    const persistenceSmoke = await runNativeAndroidPersistenceSmoke(capabilityService)
    if (persistenceSmoke?.stage === 'write-confirmed') await refreshState()
    selectedTopicId.value = state.value.topics.find((topic) => !topic.archivedAt)?.id ?? ''
    showFocus.value = Boolean(activeSession.value)
    workspaceReady = true
    await reportSmokePhase('workspace-ready')
  } catch (error) { reportStorageError(error) } finally { loading.value = false }
  if (workspaceReady) await reportSmokePhase('frontend-ready')
  if (cloudAvailable) void refreshCloudSession()
  await initializeDeviceCapabilities()
  await initializeReminders()
  if (disposed) return
  clockTimer = setInterval(() => (clock.value = Date.now()), 1000)
  cloudTimer = setInterval(() => { if (cloudStatus.value === 'signed-in') void syncStudyCloud() }, 30_000)
})

onUnmounted(() => {
  disposed = true
  unlistenClose?.()
  resolveClose?.(null)
  reminderWorker?.stop()
  unlistenReminderTick?.()
  if (clockTimer) clearInterval(clockTimer)
  if (reminderTimer) clearInterval(reminderTimer)
  if (cloudTimer) clearInterval(cloudTimer)
  if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer)
  appearanceMedia?.removeEventListener('change', onAppearanceChange)
  compactMedia?.removeEventListener('change', onCompactChange)
  window.removeEventListener('shixue:quick-add', handleQuickAdd)
  window.removeEventListener('shixue:module-error', handleModuleError)
  window.removeEventListener('keydown', handleGlobalSearchShortcut)
})

async function notificationAdapter() { return import('./modules/notification') }

async function initializeDeviceCapabilities() {
  if (defaultModuleConfig.notification && hasRuntimeCapability(runtime, 'native-notification')) {
    notificationPermission.value = await (await notificationAdapter()).queryNotificationPermission()
    nativeNotificationAvailable.value = notificationPermission.value !== 'unavailable'
  }
  if (runtime.platform !== 'desktop') return
  if (defaultModuleConfig.tray) {
    try {
      const unlisten = await installWindowLifecycle({
        getBehavior: () => planningPreferences.value.closeBehavior,
        onAsk: () => {
          if (document.querySelector('[aria-modal="true"]')) {
            notify('请先完成或关闭当前对话框，再关闭窗口。')
            return Promise.resolve(null)
          }
          closeRequestOpen.value = true
          return new Promise((resolve) => { resolveClose = resolve })
        },
        onError: (error) => { deviceMessage.value = error.message; notify(error.message) },
      })
      if (disposed) unlisten()
      else { unlistenClose = unlisten; lifecycleAvailable.value = true }
    } catch (error) { deviceMessage.value = error instanceof Error ? error.message : '窗口设置暂不可用。' }
  }
  if (defaultModuleConfig.autostart) {
    const { queryAutostartStatus } = await import('./modules/autostart')
    const result = await queryAutostartStatus()
    autostartAvailable.value = result.available
    if (result.available) autostartEnabled.value = result.enabled
    else deviceMessage.value = result.message
  }
}

async function initializeReminders() {
  if (disposed || !recurrenceWorkspace.value) return
  reminderWorker = createReminderRuntime({
    service: capabilityService,
    readLegacyRows: runtime.platform === 'desktop' ? readNativeLegacyReminderRows : async () => [],
    enabled: () => remindersEnabled.value && !disposed,
    sendNotification: (delivery, task) => nativeDeliveryAvailable.value ? submitNativeReminder(delivery, task) : Promise.resolve(true),
    onError: (error) => { reminderMessage.value = error instanceof Error ? error.message : '提醒暂不可用，请重试。' },
    onDelivery: () => notify('有新的任务提醒。', { label: '查看提醒', run: async () => openReminderCenter() }),
  })
  if (runtime.platform === 'desktop') {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const unlisten = await listen('shixue://reminder-tick', () => void pollReminders())
      if (disposed) unlisten()
      else unlistenReminderTick = unlisten
    } catch { reminderMessage.value = '系统唤醒暂不可用，将在应用运行时继续检查。' }
  }
  if (disposed) return
  reminderTimer = setInterval(() => void pollReminders(), 20_000)
  await pollReminders()
}

async function pollReminders() {
  if (!reminderWorker || disposed) return
  try { await reminderWorker.poll(); if (!disposed) await refreshState() }
  catch (error) { reminderMessage.value = error instanceof Error ? error.message : '提醒读取失败。' }
}

function openReminderCenter() {
  if (document.querySelector('[aria-modal="true"]')) { notify('请先关闭当前对话框，再查看提醒。'); return }
  reminderError.value = ''
  reminderCenterOpen.value = true
}

async function executeReminderCommand(command: CapabilityCommand) {
  const workspace = await capabilityService.query({ type: 'workspace.snapshot' })
  await capabilityService.execute({ protocolVersion: CAPABILITY_PROTOCOL_VERSION, idempotencyKey: `reminder-ui:${crypto.randomUUID()}`, source: 'human-ui', expectedWorkspaceRevision: workspace.revision, command })
  await refreshState()
}

async function saveReminderRuleWithoutBusyGuard(command: ReminderSetValue) {
  const first = !recurrenceWorkspace.value?.reminderRules.some(({ enabled }) => enabled)
  if (first && command.enabled && nativeNotificationAvailable.value) notificationPermission.value = await (await notificationAdapter()).ensureNotificationPermission('first-reminder')
  await executeReminderCommand(command)
  notify(remindersEnabled.value ? '提醒规则已保存。' : '提醒规则已保存；请在设置中开启任务提醒。')
  await pollReminders()
}

async function handleReminderAction(action: ReminderCardAction) {
  if (reminderBusy.value) return
  const workspace = recurrenceWorkspace.value
  const delivery = workspace?.reminderDeliveries.find(({ id }) => id === action.deliveryId)
  const rule = workspace?.reminderRules.find(({ id }) => id === delivery?.reminderRuleId)
  const task = workspace?.tasks.find(({ id }) => id === rule?.taskId)
  if (!workspace || !delivery || !task) return
  reminderError.value = ''
  if (action.action === 'open') {
    reminderCenterOpen.value = false
    openTask(task.id)
    selectedOccurrenceId.value = delivery.occurrenceId ?? ''
    return
  }
  const reviewLink = action.action === 'complete' ? workspace.reviewTaskLinks.find(({ reviewTaskId, occurrenceId, completedAt }) =>
    reviewTaskId === task.id && (occurrenceId ?? null) === (delivery.occurrenceId ?? null) && completedAt === null) : undefined
  if (reviewLink) {
    reminderCenterOpen.value = false
    openPendingReviewLink(reviewLink.id)
    return
  }
  if (action.action === 'complete' && task.mode === 'learning') {
    completionOccurrenceId.value = ''
    completionTaskId.value = ''
    completionReminderId.value = delivery.id
    reminderCenterOpen.value = false
    await nextTick()
    completionOpen.value = true
    return
  }
  reminderBusy.value = true
  try {
    if (action.action === 'snooze') await executeReminderCommand({ type: 'reminder.snooze', deliveryId: delivery.id, until: new Date(Date.now() + 10 * 60_000).toISOString() })
    else if (action.action === 'retry') await executeReminderCommand({ type: 'reminder.retry', deliveryId: delivery.id, expectedRevision: action.expectedRevision ?? delivery.revision ?? 1 })
    else if (delivery.occurrenceId) {
      const occurrence = workspace?.occurrences.find(({ id }) => id === delivery.occurrenceId)
      if (!occurrence) throw new Error('提醒对应的重复实例已不存在。')
      await executeReminderCommand({ type: 'recurrence.complete', occurrenceId: occurrence.id, expectedOccurrenceRevision: occurrence.revision, reviewedOn: today.value })
    } else await executeReminderCommand({ type: 'task.complete', taskId: task.id, expectedRevision: task.revision, reviewedOn: today.value })
    await pollReminders()
  } catch (error) { reminderError.value = error instanceof Error ? error.message : '提醒操作未能保存，请重试。' }
  finally { reminderBusy.value = false }
}

async function completeReminderEvidence(payload: CompletionPayload) {
  const workspace = recurrenceWorkspace.value
  const delivery = workspace?.reminderDeliveries.find(({ id }) => id === completionReminderId.value)
  const task = reminderCompletionTask.value
  if (!delivery || !task || reminderBusy.value) return
  reminderBusy.value = true
  try {
    if (delivery.occurrenceId) {
      const occurrence = workspace?.occurrences.find(({ id }) => id === delivery.occurrenceId)
      if (!occurrence) throw new Error('提醒对应的重复实例已不存在，填写内容仍保留。')
      await executeReminderCommand({ type: 'recurrence.complete', occurrenceId: occurrence.id, expectedOccurrenceRevision: occurrence.revision, expectedTaskRevision: task.revision, ...payload, reviewedOn: today.value })
    } else await executeReminderCommand({ type: 'task.complete', taskId: task.id, expectedRevision: task.revision, ...payload, reviewedOn: today.value })
    await pollReminders()
    completionOpen.value = false
    completionReminderId.value = ''
    notify('已记录学习证据并完成任务。')
  } catch (error) { notify(error instanceof Error ? error.message : '学习证据未能保存，请重试。') }
  finally { reminderBusy.value = false }
}

function chooseWindowClose(choice: 'tray' | 'quit' | null) {
  closeRequestOpen.value = false
  resolveClose?.(choice)
  resolveClose = undefined
}

function setCloseBehavior(value: WindowCloseBehavior) {
  updatePlanningPreferences({ closeBehavior: value })
}

async function setLaunchAtLogin(enabled: boolean) {
  if (!autostartAvailable.value || autostartBusy.value) return
  autostartBusy.value = true
  deviceMessage.value = ''
  try {
    const { setAutostartEnabled } = await import('./modules/autostart')
    autostartEnabled.value = await setAutostartEnabled(enabled)
  } catch (error) { deviceMessage.value = error instanceof Error ? error.message : '开机启动设置未能保存。' }
  finally { autostartBusy.value = false }
}

function handleQuickAdd() {
  completionOpen.value = false
  completionReminderId.value = ''
  completionTaskId.value = ''
  taskActionOpen.value = false
  taskEditorOpen.value = false
  recurrenceScopeOpen.value = false
  occurrenceRescheduleOpen.value = false
  topicEditorOpen.value = false
  groupEditorOpen.value = false
  selectSmartView('inbox')
  selectedTaskId.value = ''
  selectedOccurrenceId.value = ''
  requestAnimationFrame(() => tasksView.value?.activateQuickAdd())
}
function handleModuleError() {
  storageError.value = moduleStartupError
}

function onCompactChange(event: MediaQueryListEvent) {
  compact.value = event.matches
  if (event.matches && page.value === 'tasks') selectedTaskId.value = ''
  if (!event.matches && !desktopCalendarModeLoaded) {
    desktopCalendarMode.value = loadLastDesktopCalendarView() ?? planningPreferences.value.defaultCalendarView
    desktopCalendarModeLoaded = true
  }
}
async function refreshState() {
  const version = ++refreshVersion
  const workspace = await getWorkspaceStore().load()
  if (version < appliedRefreshVersion) return
  const projected = projectWorkspaceState(workspace)
  for (const session of projected.sessions) {
    const note = scratchNotes.get(session.id)
    if (note === session.scratchpad) scratchNotes.delete(session.id)
    else if (note !== undefined) session.scratchpad = note
  }
  recurrenceWorkspace.value = workspace
  state.value = projected
  appliedRefreshVersion = version
  scheduleCloudSync()
}

async function executeCalendarCommand(command: CalendarCapabilityCommand, source: CommandEnvelope['source']) {
  await runCalendarCommand({
    preflight: async () => (await capabilityService.query({ type: 'workspace.snapshot' })).revision,
    execute: (expectedWorkspaceRevision) => capabilityService.execute({
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      idempotencyKey: `calendar-ui:${crypto.randomUUID()}`,
      source,
      expectedWorkspaceRevision,
      command,
    }),
    refresh: refreshState,
    notify,
    successAction: calendarUndoAction,
  })
}

function calendarUndoAction(result: Awaited<ReturnType<typeof capabilityService.execute>>) {
  return result.undoToken ? createCalendarUndoAction({
    token: result.undoToken,
    preflight: async () => (await capabilityService.query({ type: 'workspace.snapshot' })).revision,
    execute: (expectedWorkspaceRevision, token) => capabilityService.execute({
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      idempotencyKey: `calendar-undo:${crypto.randomUUID()}`,
      source: 'human-ui',
      expectedWorkspaceRevision,
      command: { type: 'undo.apply', token },
    }),
    refresh: refreshState,
    notify,
  }) : undefined
}

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
      if (result.action === 'downloaded') await refreshState()
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

function setDestination(next: ShellDestination, options: { topicFilter?: string; preservePriority?: boolean } = {}) {
  recordTarget.value = undefined
  reviewMode.value = 'review'
  reviewTargetLinkId.value = ''
  destination.value = next
  listsMoreOpen.value = false
  showFocus.value = false
  reviewRevealed.value = false
  selectedOccurrenceId.value = ''
  const taskDestination = next.kind === 'inbox' || next.kind === 'today' || next.kind === 'upcoming' || next.kind === 'lists' || next.kind === 'list' || next.kind === 'completed'
  if (options.topicFilter !== undefined) taskTopicFilter.value = options.topicFilter
  else if (taskDestination) taskTopicFilter.value = next.kind === 'list' ? next.listId : 'all'
  if (shouldResetTaskPriority(next, options.preservePriority)) taskPriorityFilter.value = 'all'
  if (taskDestination) selectedTaskId.value = automaticTaskSelection()
}
function selectSmartView(view: StudyTaskSmartView) { setDestination(workspaceDestinationFromSmartView(view)) }
function isLearningDestinationActive(view: WorkspaceView) {
  return view.kind === 'learning' && destination.value.kind === 'learning' && view.section === destination.value.section
}
function openTopicEditor(topic?: StudyTopic) { topicEditorOpen.value = true; selectedTopicId.value = topic?.id ?? ''; topicTitle.value = topic?.title ?? ''; topicGoal.value = topic?.goal ?? ''; topicMinutes.value = topic?.weeklyTargetMinutes ?? 120; topicGroupId.value = topic?.groupId ?? '' }
function openGroupEditor(group?: StudyListGroup) { groupEditorOpen.value = true; selectedGroupId.value = group?.id ?? ''; groupTitle.value = group?.title ?? '' }
function openTask(taskId: string) { if (page.value !== 'tasks' && page.value !== 'today') setDestination({ kind: 'inbox' }); selectedOccurrenceId.value = ''; selectedTaskId.value = taskId; showFocus.value = false }
function openGlobalSearch() { globalSearchOpen.value = true }
function handleGlobalSearchShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLocaleLowerCase() !== 'k') return
  event.preventDefault()
  if (document.querySelector('[aria-modal="true"]')) return
  openGlobalSearch()
}
function openSearchTask(taskId: string) {
  const workspace = recurrenceWorkspace.value
  const task = workspace?.tasks.find((item) => item.id === taskId && item.deletedAt === null)
  if (!workspace || !task) { notify('这条任务已不存在，搜索结果已刷新。'); return }
  const activeListIds = workspace.lists.filter((list) => list.archivedAt === null).map((list) => list.id)
  setDestination(destinationForSearchTask(task, activeListIds))
  selectedOccurrenceId.value = ''
  selectedTaskId.value = task.id
  showFocus.value = false
}
function openRhythmOccurrence(occurrenceId: string) {
  const workspace = recurrenceWorkspace.value
  const occurrence = workspace?.occurrences.find((item) => item.id === occurrenceId)
  const series = occurrence ? workspace?.recurrenceSeries.find((item) => item.id === occurrence.seriesId) : undefined
  if (!occurrence || !series) { notify('这次学习已不存在，节律视图已刷新。'); return }
  openSearchTask(series.taskId)
  selectedOccurrenceId.value = occurrence.id
}
function openWeeklyPlanSource(taskId: string, occurrenceId: string | null) {
  if (occurrenceId) openRhythmOccurrence(occurrenceId)
  else openSearchTask(taskId)
}
function openSearchRecord(recordId: string) {
  const record = recurrenceWorkspace.value?.completionRecords.find((item) => item.id === recordId && item.deletedAt === null)
  if (!record) { notify('这条完成记录已不存在，搜索结果已刷新。'); return }
  setDestination({ kind: 'learning', section: 'review' })
  reviewMode.value = 'records'
  recordTarget.value = { id: record.id, requestId: ++recordTargetRequestId }
}
function openPendingReviewLink(linkId: string) {
  setDestination({ kind: 'learning', section: 'review' })
  reviewTargetLinkId.value = linkId
}
function openTagManager(returnToSearch = false) {
  tagManagerError.value = ''
  tagManagerReturnToSearch.value = returnToSearch
  tagManagerOpen.value = true
}
function closeTagManager() {
  const reopenSearch = tagManagerReturnToSearch.value
  tagManagerReturnToSearch.value = false
  tagManagerOpen.value = false
  if (reopenSearch) nextTick(openGlobalSearch)
}
async function executeTagMutation(command: TagCapabilityCommand, successMessage: string, completed: 'created' | 'renamed' | 'archived') {
  if (tagManagerBusy.value) return
  tagManagerBusy.value = true
  tagManagerError.value = ''
  try {
    await runTagCommand({
      snapshotRevision: async () => (await capabilityService.query({ type: 'workspace.snapshot' })).revision,
      execute: (expectedWorkspaceRevision) => capabilityService.execute({
        protocolVersion: CAPABILITY_PROTOCOL_VERSION,
        idempotencyKey: `tag-ui:${crypto.randomUUID()}`,
        source: 'human-ui',
        expectedWorkspaceRevision,
        command,
      }),
      refresh: refreshState,
      notify,
      successAction: calendarUndoAction,
      successMessage,
    })
    if (completed === 'created') tagManager.value?.created()
    if (completed === 'renamed') tagManager.value?.renamed()
  } catch (error) {
    tagManagerError.value = error instanceof Error ? error.message : String(error)
  } finally { tagManagerBusy.value = false }
}
function createTag(title: string) { return executeTagMutation({ type: 'tag.create', title }, '标签已创建。', 'created') }
function renameTag(tagId: string, title: string) { return executeTagMutation({ type: 'tag.rename', tagId, title }, '标签已重命名。', 'renamed') }
function archiveTag(tagId: string) { return executeTagMutation({ type: 'tag.archive', tagId }, '标签已归档；历史关联仍然保留。', 'archived') }
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
  if (!taskViews.value.some((task) => task.id === selectedTaskId.value)) selectedTaskId.value = automaticTaskSelection()
}
function automaticTaskSelection() { return shouldAutoSelectTask(window.innerWidth) ? taskViews.value[0]?.id ?? '' : '' }
function setTaskSearch(value: string) { taskSearch.value = value; alignTaskSelection() }
function setTaskTopicFilter(value: string) {
  const transition = resolveTaskTopicFilterTransition(value)
  setDestination(transition.destination, { topicFilter: transition.topicFilter, preservePriority: transition.preservePriority })
}
function setTaskPriorityFilter(value: StudyTaskPriority | 'all') { taskPriorityFilter.value = value; alignTaskSelection() }
function setTaskSort(value: StudyTaskQuerySort) { taskSort.value = value; alignTaskSelection() }

async function quickAddCreated(entity: EntityRef) {
  try {
    await refreshState(); selectedTaskId.value = entity.id; selectedOccurrenceId.value = ''
    const learning = recurrenceWorkspace.value?.tasks.some(({ id, mode }) => id === entity.id && mode === 'learning')
    notify(learning
      ? `学习任务已加入${activeSmartView.value === 'today' ? '今天' : '收件箱'}；可在编辑任务中补充完成标准。`
      : activeSmartView.value === 'today' ? '已加入今天。' : '已加入收件箱。')
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
    if (taskActionMode.value === 'cancel') setDestination({ kind: 'inbox' })
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

async function reminderCommandForCurrentState(command: ReminderSetValue, baseRules: TaskEditChanges['baseReminderRules']): Promise<ReminderSetValue | null> {
  const workspace = await getWorkspaceStore().load()
  const current = workspace.reminderRules.find(({ id }) => id === command.ruleId)
  const base = baseRules.find(({ id }) => id === command.ruleId)
  const result = resolveReminderEditWrite(current, base, command)
  if (result.decision === 'conflict') throw new Error('提醒规则已在其他位置修改，请重新打开后合并更改。')
  return result.decision === 'write' ? result.command : null
}

async function readCurrentTaskEdit(taskId: string): Promise<{ task: Task; value: TaskEditValue }> {
  const workspace = await getWorkspaceStore().load()
  const task = workspace.tasks.find((item) => item.id === taskId && !item.deletedAt)
  const projected = projectWorkspaceState(workspace).tasks.find((item) => item.id === taskId && !item.deletedAt)
  if (!task || !projected) throw new Error('任务已不存在，编辑内容未保存。')
  return {
    task,
    value: {
      title: task.title,
      notes: task.notes,
      topicId: projected.topicId,
      ...(task.schedule.startAt !== null ? { plannedAt: task.schedule.startAt } : { plannedOn: task.schedule.startOn }),
      ...(task.deadline.dueAt !== null ? { dueAt: task.deadline.dueAt } : { dueOn: task.deadline.dueOn }),
      reminderAt: null,
      priority: task.priority,
      estimateMinutes: task.schedule.estimateMinutes,
      tagIds: [...task.tagIds],
      ...(task.mode === 'learning' ? { acceptanceCriteria: [...(task.learning?.acceptanceCriteria ?? [])] } : {}),
    },
  }
}

async function saveTaskEdit(value: TaskEditValue, changes: TaskEditChanges) {
  const task = selectedTask.value
  if (!task || reminderBusy.value) return
  try {
    if (changes.reminderCommands.length) {
      reminderBusy.value = true
      reminderError.value = ''
    }
    await runTaskEditCommit({ reminders: changes.reminderCommands, recurrence: changes.recurrenceRule }, {
      saveTask: async () => {
        const current = await readCurrentTaskEdit(task.id)
        const decision = resolveTaskEditWrite(current.value, changes.baseTask, value)
        if (decision === 'conflict') throw new Error('任务已在其他位置修改，请重新打开后合并更改。')
        const { reminderAt: _legacyReminderAt, ...taskValue } = value
        if (decision === 'write') await updateStudyTask(task.id, taskValue, { expectedRevision: current.task.revision, now: new Date().toISOString() })
        await refreshState()
      },
      saveReminder: async (draftCommand) => {
        const command = await reminderCommandForCurrentState(draftCommand, changes.baseReminderRules)
        if (command) await saveReminderRuleWithoutBusyGuard(command)
        else await refreshState()
      },
      saveRecurrence: (rule) => requestRecurrenceEdit(rule, changes.baseRecurrenceRule),
    })
    if (recurrenceScopeOpen.value || !taskEditorOpen.value) return
    taskEditorOpen.value = false
    notify('任务内容已更新。')
  } catch (error) {
    if (changes.reminderCommands.length) reminderError.value = error instanceof Error ? error.message : '提醒规则未能保存，请重试。'
    reportStorageError(error)
  } finally { reminderBusy.value = false }
}

function cloneRecurrenceRuleDto(rule: RecurrenceRule): RecurrenceRule {
  const cadence = rule.cadence.kind === 'weekly'
    ? { ...rule.cadence, weekdays: [...rule.cadence.weekdays] }
    : { ...rule.cadence }
  return { cadence, basis: rule.basis, end: { ...rule.end } }
}

async function requestRecurrenceEdit(rule: RecurrenceRule, baseRule: RecurrenceRule | null) {
  const portableRule = cloneRecurrenceRuleDto(rule)
  const workspace = await getWorkspaceStore().load()
  const task = workspace.tasks.find((item) => item.id === selectedTask.value?.id && !item.deletedAt)
  const currentSeries = task?.recurrenceSeriesId
    ? workspace.recurrenceSeries.find((series) => series.id === task.recurrenceSeriesId) ?? null
    : null
  if (!task) throw new Error('重复规则上下文已变化，请重试。')
  const currentRule: RecurrenceRule | null = currentSeries
    ? { cadence: currentSeries.cadence, basis: currentSeries.basis, end: currentSeries.end }
    : null
  const decision = resolveRecurrenceEditWrite(currentRule, baseRule, portableRule)
  if (decision === 'conflict') throw new Error('重复规则已在其他位置修改，请重新打开后合并更改。')
  if (decision === 'noop') {
    await refreshState()
    taskEditorOpen.value = false
    notify(baseRule ? '重复规则已更新。' : '已创建重复规则。')
    return
  }
  if (baseRule === null) {
    const anchorOn = task.schedule.startOn ?? (task.schedule.startAt ? parseZonedDateTime(task.schedule.startAt, timezone).date : today.value)
    recurrenceExecuting.value = true
    try {
      await capabilityService.execute({
        protocolVersion: CAPABILITY_PROTOCOL_VERSION,
        idempotencyKey: `recurrence:${crypto.randomUUID()}`,
        source: 'human-ui',
        expectedWorkspaceRevision: workspace.revision,
        command: {
          type: 'recurrence.create', taskId: task.id, expectedTaskRevision: task.revision,
          cadence: portableRule.cadence, basis: portableRule.basis, anchorOn,
          end: portableRule.end, timezone,
        },
      })
      await refreshState()
      taskEditorOpen.value = false
      notify('已创建重复规则。')
    } finally { recurrenceExecuting.value = false }
    return
  }
  await refreshState()
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
    await refreshState(); recurrenceScopeOpen.value = false; clearRecurrencePreview(); pendingRecurrenceRule = null; taskEditorOpen.value = false
    notify('重复规则已更新。')
  } catch (error) { reportStorageError(error) } finally { recurrenceExecuting.value = false }
}

function clearRecurrencePreview() { recurrencePreviewVersion += 1; recurrencePreview.value = null; recurrencePreviewEnvelope = null }

async function executeOccurrence(id: string, type: 'recurrence.complete' | 'recurrence.skip') {
  const workspace = recurrenceWorkspace.value
  const occurrence = workspace?.occurrences.find((item) => item.id === id)
  const series = occurrence ? workspace?.recurrenceSeries.find((item) => item.id === occurrence.seriesId) : undefined
  const task = series ? workspace?.tasks.find((item) => item.id === series.taskId) : undefined
  if (!workspace || !occurrence) return
  const reviewLink = type === 'recurrence.complete' ? workspace.reviewTaskLinks.find(({ reviewTaskId, occurrenceId, completedAt }) =>
    reviewTaskId === task?.id && occurrenceId === occurrence.id && completedAt === null) : undefined
  if (reviewLink) {
    openPendingReviewLink(reviewLink.id)
    return
  }
  if (type === 'recurrence.complete' && task?.mode === 'learning') {
    completionReminderId.value = ''
    completionTaskId.value = ''
    completionOccurrenceId.value = occurrence.id
    await nextTick()
    completionOpen.value = true
    return
  }
  try {
    const command = type === 'recurrence.complete'
      ? { type, occurrenceId: occurrence.id, expectedOccurrenceRevision: occurrence.revision, reviewedOn: today.value }
      : { type, occurrenceId: occurrence.id, expectedOccurrenceRevision: occurrence.revision }
    await capabilityService.execute({ protocolVersion: CAPABILITY_PROTOCOL_VERSION, idempotencyKey: `recurrence:${crypto.randomUUID()}`, source: 'human-ui', expectedWorkspaceRevision: workspace.revision, command })
    await refreshState(); notify(type === 'recurrence.complete' ? '本次已完成。' : '本次已跳过。')
  } catch (error) { reportStorageError(error) }
}

async function completeOccurrenceEvidence(payload: CompletionPayload) {
  const occurrenceId = completionOccurrenceId.value
  if (!occurrenceId || completionOccurrenceBusy.value) return
  completionOccurrenceBusy.value = true
  try {
    const workspace = await capabilityService.query({ type: 'workspace.snapshot' })
    const occurrence = workspace.occurrences.find(({ id }) => id === occurrenceId)
    const series = occurrence ? workspace.recurrenceSeries.find(({ id }) => id === occurrence.seriesId) : undefined
    const task = series ? workspace.tasks.find(({ id }) => id === series.taskId) : undefined
    if (!occurrence || !task || task.mode !== 'learning') throw new Error('这次学习已变化，填写内容仍保留。')
    await capabilityService.execute({
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      idempotencyKey: `recurrence:${crypto.randomUUID()}`,
      source: 'human-ui',
      expectedWorkspaceRevision: workspace.revision,
      command: {
        type: 'recurrence.complete',
        occurrenceId: occurrence.id,
        expectedOccurrenceRevision: occurrence.revision,
        expectedTaskRevision: task.revision,
        ...payload,
        reviewedOn: today.value,
      },
    })
    if (completionOccurrenceId.value === occurrenceId) {
      completionOpen.value = false
      completionOccurrenceId.value = ''
    }
    try { await refreshState() }
    catch (error) {
      notify(`学习证据已保存，但视图刷新失败：${error instanceof Error ? error.message : String(error)}`, {
        label: '重新加载',
        successMessage: '学习节律已刷新。',
        run: refreshState,
      })
      return
    }
    notify('已记录学习证据并完成本次。')
  } catch (error) {
    notify(error instanceof Error ? error.message : '学习证据未能保存，请重试。')
  } finally { completionOccurrenceBusy.value = false }
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
  await runOverdueBatchMove(taskIds, today.value, {
    snapshot: () => capabilityService.query({ type: 'workspace.snapshot' }),
    preview: (envelope) => capabilityService.preview(envelope),
    execute: (envelope) => capabilityService.execute(envelope),
    refresh: async () => { await refreshState(); selectedTaskId.value = ''; setDestination({ kind: 'today' }) },
    notify,
    successAction: calendarUndoAction,
    createId: () => crypto.randomUUID(),
  })
}

async function toggleTaskCompletion(taskId: string) {
  const task = state.value.tasks.find((item) => item.id === taskId && !item.deletedAt)
  if (!task || task.status === 'cancelled') return
  const workspace = recurrenceWorkspace.value
  const route = workspace ? routeSingleTaskCompletion(workspace, taskId) : 'toggle'
  if (route === 'plan') {
    openTaskAction(taskId, 'plan')
    notify('学习任务需要先安排日期，再填写完成证据。')
    return
  }
  if (route === 'unblock') {
    notify('学习任务需要先解除阻碍，再填写完成证据。')
    await taskPrimary(taskId)
    return
  }
  if (route === 'evidence') {
    completionReminderId.value = ''
    completionOccurrenceId.value = ''
    completionTaskId.value = taskId
    await nextTick()
    completionOpen.value = true
    return
  }
  if (route === 'review') {
    const link = workspace?.reviewTaskLinks.find(({ reviewTaskId, completedAt }) => reviewTaskId === taskId && completedAt === null)
    if (!link) return
    openPendingReviewLink(link.id)
    return
  }
  try {
    const changed = await toggleStudyTaskCompletion(task.id, { expectedRevision: task.revision, eventId: crypto.randomUUID(), now: new Date().toISOString(), reviewedOn: today.value })
    await refreshState()
    notify(changed.status === 'completed' ? '任务已完成。' : '任务已重新打开。')
  } catch (error) { reportStorageError(error) }
}

async function bulkCompleteTasks(taskIds: string[]) {
  const workspace = recurrenceWorkspace.value
  const blockers = workspace ? learningBatchBlockers(workspace, taskIds) : []
  if (blockers.length) {
    notify(`批量完成未执行：${blockers.length} 项学习任务需要逐项填写完成证据。`)
    return
  }
  try {
    for (const taskId of taskIds) {
      const task = (await loadStudyState()).tasks.find((item) => item.id === taskId && !item.deletedAt)
      if (task && task.status !== 'completed' && task.status !== 'cancelled') await toggleStudyTaskCompletion(task.id, { expectedRevision: task.revision, eventId: crypto.randomUUID(), now: new Date().toISOString(), reviewedOn: today.value })
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
  scratchDrafts.set(sessionId, value)
  scratchNotes.set(sessionId, value)
  void saveScratchDrafts()
}

async function saveScratchDrafts() {
  if (scratchSaving) return
  scratchSaving = true
  const failed = new Set<string>()
  try {
    while ([...scratchDrafts.keys()].some((id) => !failed.has(id))) {
      for (const [sessionId, value] of scratchDrafts) {
        if (failed.has(sessionId)) continue
        try {
          await saveStudyScratchpad(sessionId, value, { now: new Date().toISOString() })
          if (scratchDrafts.get(sessionId) === value) scratchDrafts.delete(sessionId)
        } catch (error) { failed.add(sessionId); reportStorageError(error) }
      }
    }
  } finally {
    scratchSaving = false
    if (failed.size) notify('随手记尚未保存，内容仍保留在页面中。', { label: '重试', run: saveScratchDrafts, successMessage: '' })
  }
}

async function completeFocus(payload: CompletionPayload) {
  if (completionReminderId.value) return completeReminderEvidence(payload)
  if (completionOccurrenceId.value) return completeOccurrenceEvidence(payload)
  if (completionTaskId.value) return completeTaskEvidence(payload)
  const session = activeSession.value
  const task = activeTask.value
  if (!session || !task) return
  const now = new Date().toISOString()
  try {
    await completeStudyTask({ taskId: task.id, sessionId: session.id, learned: payload.learned, evidence: payload.evidence, blocker: payload.blocker, nextAction: payload.nextAction, mastery: payload.mastery }, { recordId: crypto.randomUUID(), eventId: crypto.randomUUID(), now })
    await refreshState(); completionOpen.value = false; setDestination({ kind: 'today' }); notify(`已记录这次学习。下一项：${weeklyNext.value}`)
  } catch (error) { reportStorageError(error) }
}

async function completeTaskEvidence(payload: CompletionPayload) {
  const taskId = completionTaskId.value
  if (!taskId || completionOccurrenceBusy.value) return
  const task = recurrenceWorkspace.value?.tasks.find(({ id, deletedAt }) => id === taskId && !deletedAt)
  if (!task || task.mode !== 'learning') return
  completionOccurrenceBusy.value = true
  try {
    const workspace = await capabilityService.query({ type: 'workspace.snapshot' })
    await capabilityService.execute({
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      idempotencyKey: `completion:${crypto.randomUUID()}`,
      source: 'human-ui',
      expectedWorkspaceRevision: workspace.revision,
      command: {
        type: 'task.complete', taskId, ...payload,
        expectedRevision: task.revision, recordId: crypto.randomUUID(), eventId: crypto.randomUUID(),
      },
    })
    if (completionTaskId.value === taskId) {
      completionOpen.value = false
      completionTaskId.value = ''
    }
    try { await refreshState() }
    catch (error) {
      notify(`学习证据已保存，但视图刷新失败：${error instanceof Error ? error.message : String(error)}`, {
        label: '重新加载',
        successMessage: '学习记录已刷新。',
        run: refreshState,
      })
      return
    }
    notify('已记录学习证据并完成任务。')
  } catch (error) { notify(error instanceof Error ? error.message : '学习证据未能保存，请重试。') }
  finally { completionOccurrenceBusy.value = false }
}

async function rateReview(linkId: string, result: ReviewResult) {
  if (reviewBusy.value) return
  reviewBusy.value = true
  try {
    const workspace = await capabilityService.query({ type: 'workspace.snapshot' })
    const receipt = await capabilityService.execute({
      protocolVersion: CAPABILITY_PROTOCOL_VERSION,
      idempotencyKey: `review:${crypto.randomUUID()}`,
      source: 'human-ui', expectedWorkspaceRevision: workspace.revision,
      command: { type: 'review.complete', linkId, result, reviewedOn: today.value },
    })
    if (!await reloadReviews()) return
    const nextLinkId = receipt.data && typeof receipt.data === 'object' && !Array.isArray(receipt.data) ? receipt.data.nextLinkId : undefined
    notify(result === 'clear' ? (nextLinkId ? '已安排下一次回顾。' : nextLinkId === null ? '已完成这一轮复习。' : '复习结果已刷新。') : result === 'fuzzy' ? '明天会再见到这条记录。' : '已标记为需要重新学习。')
  } catch (error) { reviewBusy.value = false; reportStorageError(error) }
}

async function reloadReviews() {
  try {
    await refreshState()
    reviewRevealed.value = false
    reviewBusy.value = false
    reviewRefreshRequired.value = false
    return true
  } catch (error) {
    reviewRefreshRequired.value = true
    notify(`复习结果已保存，但视图刷新失败：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

function openFocusCompletion(reviewLinkId?: string) {
  const reviewLink = reviewLinkId ? recurrenceWorkspace.value?.reviewTaskLinks.find(({ id, completedAt }) => id === reviewLinkId && completedAt === null) : undefined
  if (reviewLink) {
    openPendingReviewLink(reviewLink.id)
    return
  }
  completionReminderId.value = ''
  completionOccurrenceId.value = ''
  completionTaskId.value = ''
  completionOpen.value = true
}

async function createFromNextAction(recordId: string) {
  try {
    const task = await createTaskFromNextAction(recordId, { taskId: crypto.randomUUID(), eventId: crypto.randomUUID(), now: new Date().toISOString(), plannedOn: today.value })
    await refreshState(); setDestination({ kind: 'today' }); selectedTaskId.value = task.id; notify('下一步已加入今天。')
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
  try { await saveStudyTopic({ ...topic, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); await refreshState(); selectedTopicId.value = state.value.topics.find((item) => !item.archivedAt)?.id ?? ''; const transition = resolveArchivedListTransition(destination.value, id, taskTopicFilter.value); if (transition) setDestination(transition.destination, { topicFilter: transition.topicFilter, preservePriority: transition.preservePriority }); notify('清单已归档。') } catch (error) { reportStorageError(error) }
}

function downloadData(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
async function exportJsonData() {
  try { downloadData(await exportStudyState(), 'application/json', `拾学记录-${today.value}.json`); notify('JSON 备份已导出。') } catch (error) { reportStorageError(error) }
}
async function exportMarkdownData() {
  try { downloadData(await exportLearningRecordsMarkdown(), 'text/markdown;charset=utf-8', `拾学学习记录-${today.value}.md`); notify('Markdown 学习记录已导出。') } catch (error) { reportStorageError(error) }
}
async function importData(content: string, complete: (success: boolean) => void) {
  try {
    await importStudyState(content)
    await refreshState()
    selectedTaskId.value = ''
    notify('学习记录已验证并导入。')
    complete(true)
  } catch (error) {
    reportStorageError(error)
    complete(false)
  }
}
async function setReminders(enabled: boolean) {
  if (reminderSettingBusy.value) return
  reminderSettingBusy.value = true
  reminderMessage.value = ''
  try {
    if (enabled && nativeNotificationAvailable.value) notificationPermission.value = await (await notificationAdapter()).ensureNotificationPermission('first-reminder')
    localStorage.setItem('meow-study-reminders', enabled ? 'enabled' : 'disabled')
    remindersEnabled.value = enabled
    reminderMessage.value = !enabled ? '提醒已关闭，已有规则与历史保留。' : notificationPermission.value === 'granted' ? '提醒已开启。' : '应用内提醒已开启；系统通知暂不可用，规则仍保留。'
    if (enabled) await pollReminders()
  } catch { reminderMessage.value = '提醒设置未能保存，请重试。' }
  finally { reminderSettingBusy.value = false }
}
async function testNotification() {
  if (!nativeNotificationAvailable.value || reminderSettingBusy.value) return
  reminderSettingBusy.value = true
  try {
    notificationPermission.value = await (await notificationAdapter()).ensureNotificationPermission('test')
    const sent = notificationPermission.value === 'granted' && await (await notificationAdapter()).sendStudyReminderNotification({ dueTaskCount: 1, dueReviewCount: 0 })
    reminderMessage.value = sent ? '测试通知已提交给系统。' : '系统通知不可用，请检查系统权限后重试。'
  } catch { reminderMessage.value = '测试通知失败，请重试。' }
  finally { reminderSettingBusy.value = false }
}
async function resetDemo(complete: (success: boolean) => void) {
  try {
    await resetStudyState()
    await refreshState()
    selectedTaskId.value = ''
    taskSearch.value = ''
    taskSort.value = 'manual'
    setDestination({ kind: 'inbox' })
    taskPriorityFilter.value = 'all'
    notify('已恢复拾学的演示数据。')
    complete(true)
  } catch (error) { reportStorageError(error); complete(false) }
}
function setThemePreference(patch: Partial<ThemePreference>) {
  try {
    const next = { ...themePreference.value, ...patch }
    saveThemePreference(next)
    themePreference.value = next
    applyThemePreference(next)
  } catch { notify('外观设置未能保存，请重试。') }
}
function setTheme(themeId: string) { setThemePreference({ themeId }) }
function setThemeMode(mode: ThemeMode) { setThemePreference({ mode }) }
function setCustomPrimary(customPrimary: string) { setThemePreference({ themeId: 'custom', customPrimary }) }
function onAppearanceChange(event: MediaQueryListEvent) { systemDark.value = event.matches }
function updatePlanningPreferences(patch: Partial<PlanningPreferences>) {
  try {
    planningPreferences.value = savePlanningPreferences(patch)
    if (patch.reducedGlassOverride) applyReducedGlass(planningPreferences.value.reducedGlassOverride)
  } catch {
    notify('设置未能保存，请重试。')
  }
}
function persistDesktopCalendarMode(mode: CalendarView) {
  if (desktopCalendarMode.value === mode && desktopCalendarModeLoaded) return
  desktopCalendarMode.value = mode
  desktopCalendarModeLoaded = true
  try {
    saveLastDesktopCalendarView(mode)
  } catch {
    notify('日历视图未能保存，本次选择仍可继续使用。')
  }
}
function applyReducedGlass(value: PlanningPreferences['reducedGlassOverride']) {
  if (value === 'on') document.documentElement.dataset.reducedGlass = 'on'
  else delete document.documentElement.dataset.reducedGlass
}
function updateSidebarPreferences(patch: Partial<SidebarPreferences>) {
  try {
    sidebarPreferences.value = saveSidebarPreferences({ ...sidebarPreferences.value, ...patch }, sidebarMenuKeys.value)
    return true
  } catch {
    notify('侧边栏设置未能保存，请重试。')
    return false
  }
}
function resetSidebarOrder() {
  if (updateSidebarPreferences({ order: sidebarMenuKeys.value })) notify('已恢复默认菜单顺序。')
}

function topicTitleFor(topicId: string | null) { return topicId ? topicMap.value.get(topicId)?.title ?? '未知主题' : '未归类' }
function taskStatus(task: StudyTask): TaskViewStatus { return task.status === 'planned' && !task.plannedOn ? 'backlog' : task.status }
function toTaskView(task: StudyTask): TaskViewItem {
  const workspace = recurrenceWorkspace.value
  const workspaceTask = workspace?.tasks.find(({ id }) => id === task.id)
  const planned = workspaceTask?.schedule.startAt ?? workspaceTask?.schedule.startOn ?? task.plannedOn
  const deadline = workspaceTask?.deadline.dueAt ?? workspaceTask?.deadline.dueOn ?? task.dueOn
  const tagTitles = new Map(workspace?.tags.filter(({ archivedAt }) => archivedAt === null).map(({ id, title }) => [id, title]) ?? [])
  return { id: task.id, title: task.title, notes: task.notes, topic: topicTitleFor(task.topicId), topicId: task.topicId, tags: workspaceTask?.tagIds.map((id) => tagTitles.get(id)).filter((title): title is string => Boolean(title)) ?? [], status: taskStatus(task), plannedOn: task.plannedOn, dueOn: task.dueOn, reminderAt: task.reminderAt, priority: task.priority, plannedLabel: planned ? formatPlanDate(planned) : '', dueLabel: deadline ? formatPlanDate(deadline) : '', reminderLabel: formatReminder(task.reminderAt), estimateMinutes: task.estimateMinutes, acceptanceCriteria: task.acceptanceCriteria, checklist: task.checklist.map((item) => ({ id: item.id, text: item.text, checked: item.checked })), blockedReason: task.blockedReason ?? '', reasons: [] }
}
function toEventView(event: TaskEvent): TaskEventViewItem {
  const labels: Record<TaskEvent['type'], string> = { captured: '加入收件箱', migrated: '从旧版记录迁移', planned: '安排任务', started: '开始学习', paused: '暂停学习', resumed: '继续学习', blocked: '标记受阻', completed: '完成学习', reopened: '重开任务', cancelled: '取消任务', rescheduled: '调整计划日期', deleted: '移入回收状态' }
  const tones: Record<TaskEvent['type'], TaskEventViewItem['tone']> = { captured: 'accent', migrated: 'muted', planned: 'accent', started: 'accent', paused: 'muted', resumed: 'accent', blocked: 'warning', completed: 'success', reopened: 'accent', cancelled: 'danger', rescheduled: 'muted', deleted: 'danger' }
  return { id: event.id, time: formatEventTime(event.occurredAt), title: labels[event.type], detail: event.reason || (event.type === 'planned' || event.type === 'rescheduled' ? `计划日期：${formatPlanDate(selectedTask.value?.plannedOn ?? null)}` : statusDetail(event)), tone: tones[event.type] }
}
function statusDetail(event: TaskEvent) { return event.toStatus ? `状态变为${({ inbox: '收件箱', planned: '已计划', in_progress: '进行中', blocked: '已阻塞', completed: '已完成', cancelled: '已取消' } as const)[event.toStatus]}` : '保留此次变化' }
function recordMinutes(record: CompletionRecord) { return Math.max(1, Math.round(state.value.sessions.filter((session) => record.sessionIds.includes(session.id)).reduce((sum, session) => sum + session.elapsedSeconds, 0) / 60)) }
function formatRhythmCadence(cadence: RecurrenceCadence, basis: RecurrenceSeries['basis']) {
  const weekday = ['日', '一', '二', '三', '四', '五', '六']
  const label = cadence.kind === 'daily'
    ? cadence.interval === 1 ? '每天' : `每 ${cadence.interval} 天`
    : cadence.kind === 'weekly'
      ? cadence.interval === 1
        ? `每周${cadence.weekdays.map((day) => weekday[day]).join('、')}`
        : `每 ${cadence.interval} 周的${cadence.weekdays.map((day) => `周${weekday[day]}`).join('、')}`
      : cadence.kind === 'monthly'
        ? `${cadence.interval === 1 ? '每月' : `每 ${cadence.interval} 个月`} ${cadence.dayOfMonth} 日`
        : `${cadence.interval === 1 ? '每年' : `每 ${cadence.interval} 年`} ${cadence.month} 月 ${cadence.dayOfMonth} 日`
  return basis === 'after_completion' ? `完成后${label}` : label
}
function formatRhythmWeek(start: string, endExclusive: string) {
  const end = new Date(`${endExclusive}T12:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() - 1)
  return `${formatRhythmDay(start)}至 ${end.getUTCMonth() + 1} 月 ${end.getUTCDate()} 日`
}
function formatRhythmDay(value: string) {
  const [, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? []
  return month && day ? `${Number(month)} 月 ${Number(day)} 日` : value
}
function formatPlanDate(value: string | null) {
  if (!value) return '待安排'
  const precise = value.length !== 10
  const date = new Date(precise ? value : `${value}T00:00:00`)
  const dateKey = date.toLocaleDateString('sv-SE')
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const day = dateKey === today.value ? '今天' : dateKey === tomorrow.toLocaleDateString('sv-SE') ? '明天' : formatShortDate(value)
  return precise ? `${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : day
}
function formatShortDate(value: string | null | undefined) { if (!value) return '今天'; const date = new Date(value.length === 10 ? `${value}T00:00:00` : value); return `${date.getMonth() + 1} 月 ${date.getDate()} 日` }
function formatAge(value: string) { const diff = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86_400_000)); return diff === 0 ? '今天' : `${diff} 天前` }
function formatEventTime(value: string) { const date = new Date(value); return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function formatReminder(value: string | null) { if (!value) return ''; const date = new Date(value); const day = date.toLocaleDateString('sv-SE') === today.value ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`; return `${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function notify(message: string, action?: { label: string; run: () => Promise<void>; successMessage?: string }) { toast.value = message; toastAction.value = action ?? null; toastVersion.value += 1 }
function dismissToast() { toast.value = ''; toastAction.value = null }
async function runToastAction() {
  const action = toastAction.value
  if (!action) return
  dismissToast()
  try { await action.run(); if (action.successMessage !== '') notify(action.successMessage ?? '已撤销。') } catch (error) { reportStorageError(error) }
}
function reportStorageError(error: unknown) { storageError.value = error instanceof Error ? error.message : String(error); notify('这次更改还没写入本地，内容仍保留在页面中。') }
</script>

<template>
  <div class="shell">
    <OverlayHost />
    <AppSidebar v-if="!showFocus" :active="destination" :counts="smartViewCounts" :groups="activeListGroups" :lists="listNavItems" :display-mode="sidebarPreferences.displayMode" :order="sidebarPreferences.order" @search="openGlobalSearch" @navigate="setDestination" @update:display-mode="updateSidebarPreferences({ displayMode: $event })" @reorder="updateSidebarPreferences({ order: $event })" @create-list="openTopicEditor()" @create-group="openGroupEditor()" @edit-group="openGroupEditor(activeListGroups.find((group) => group.id === $event))" />
    <div class="workspace">
      <header v-if="!showFocus" class="mobile-header"><div class="mobile-brand"><img src="/shixue-mark.svg" alt="" /><strong>拾学</strong></div><div class="mobile-actions"><button type="button" title="全局搜索" aria-label="全局搜索" aria-keyshortcuts="Control+K Meta+K" @click="openGlobalSearch"><Search :size="21" /></button><button type="button" title="设置" aria-label="设置" :aria-current="destination.kind === 'settings' ? 'page' : undefined" @click="setDestination({ kind: 'settings' })"><Settings :size="22" /></button></div></header>
      <main v-page-motion="`${JSON.stringify(destination)}:${showFocus}`" :class="{ 'focus-main': showFocus, 'tasks-main': (page === 'tasks' || page === 'today') && !showFocus, 'calendar-main': page === 'calendar' && !showFocus }">
        <div v-if="loading" class="loading">正在打开你的学习记录…</div>
        <FocusView v-else-if="showFocus && activeSession && activeTask" :topic-title="topicTitleFor(activeTask.topicId)" :task-title="activeTask.title" :criteria="activeTask.acceptanceCriteria" :time-label="timeLabel" :running="activeSession.state === 'running'" :scratchpad="activeSession.scratchpad" :review-link-id="activeReviewLinkId || undefined" @back="showFocus = false" @toggle="toggleFocus" @finish="openFocusCompletion" @update:scratchpad="updateScratchpad" />
        <template v-else-if="page === 'tasks' || page === 'today'">
          <div v-if="destination.kind === 'lists'" class="lists-more">
            <Popover v-model:open="listsMoreOpen" kind="menu" align="end" mobile-sheet mobile-sheet-label="清单更多导航">
              <template #trigger="{ triggerProps }"><Button v-bind="triggerProps">更多清单</Button></template>
              <nav class="lists-more-menu" aria-label="清单更多导航" role="menu">
                <Button v-for="item in mobileMoreWorkspaceNavigation" :key="item.preferenceKey" role="menuitem" @click="setDestination(item.view)">{{ item.label }}</Button>
              </nav>
            </Popover>
          </div>
          <div class="tasks-layout">
          <div class="tasks-scroll"><TasksView ref="tasksView" :tasks="taskViews" :occurrences="occurrenceViews" :topics="state.topics.filter((topic) => !topic.archivedAt)" :title="smartViewTitle" :subtitle="smartViewSubtitle" :selected-id="selectedTaskId" :smart-view="activeSmartView" :search="taskSearch" :topic-filter="taskTopicFilter" :priority-filter="taskPriorityFilter" :sort="taskSort" :quick-add-destination-list-id="quickAddDestinationListId" :quick-add-default-start-on="activeSmartView === 'today' ? today : undefined" :quick-add-default-estimate-minutes="planningPreferences.defaultEstimateMinutes" :quick-add-remove-recognized-text="planningPreferences.quickAddRemoveRecognizedText" :quick-add-catalog-revision="recurrenceWorkspace?.revision" @smart-view-change="selectSmartView" @search-change="setTaskSearch" @topic-filter-change="setTaskTopicFilter" @priority-filter-change="setTaskPriorityFilter" @sort-change="setTaskSort" @created="quickAddCreated" @open="openTask" @toggle-complete="toggleTaskCompletion" @edit="openTaskEditor" @delete="deleteTask" @defer="openTaskAction($event, 'defer')" @cancel="openTaskAction($event, 'cancel')" @bulk-delete="bulkDeleteTasks" @bulk-complete="bulkCompleteTasks" @bulk-move-to-today="bulkMoveTasksToToday" @overdue-move-to-today="bulkMoveTasksToToday" @occurrence-open="openOccurrence" @occurrence-complete="executeOccurrence($event, 'recurrence.complete')" @occurrence-skip="executeOccurrence($event, 'recurrence.skip')" @occurrence-reschedule="openOccurrenceReschedule" /></div>
          <TaskDetailDrawer :task="selectedTaskView" :events="selectedTaskEvents" :due-label="selectedTaskView?.dueLabel" :occurrence-id="selectedOccurrence?.id" :occurrence-status="selectedOccurrence?.status" :occurrence-schedule-label="selectedOccurrence ? formatPlanDate(selectedOccurrence.override?.scheduledOn ?? selectedOccurrence.override?.scheduledAt ?? selectedOccurrence.scheduledOn ?? selectedOccurrence.scheduledAt) : ''" :deadline-label="selectedTaskView?.dueLabel" :mobile="compact" @close="selectedTaskId = ''; selectedOccurrenceId = ''" @edit="openTaskEditor" @delete="deleteTask" @toggle-complete="toggleTaskCompletion" @primary="taskPrimary" @defer="openTaskAction($event, 'defer')" @block="openTaskAction($event, 'block')" @cancel="openTaskAction($event, 'cancel')" @toggle-checklist="toggleTaskChecklist" @add-checklist="addTaskChecklist" @occurrence-complete="executeOccurrence($event, 'recurrence.complete')" @occurrence-skip="executeOccurrence($event, 'recurrence.skip')" @occurrence-reschedule="openOccurrenceReschedule" />
          </div>
        </template>
        <SettingsView v-else-if="page === 'settings'" :workspace="recurrenceWorkspace" :dark="appearanceDark" :theme-id="themePreference.themeId" :theme-mode="themePreference.mode" :custom-primary="themePreference.customPrimary" :reminders-available="nativeNotificationAvailable" :reminder-busy="reminderSettingBusy" :reminder-message="reminderMessage" :reminder-count="reminderCards.length" @open-reminders="openReminderCenter" :lifecycle-available="lifecycleAvailable" :close-behavior="planningPreferences.closeBehavior" :autostart-available="autostartAvailable" :autostart-enabled="autostartEnabled" :autostart-busy="autostartBusy" :device-message="deviceMessage" :reminders-enabled="remindersEnabled" :quick-add-remove-recognized-text="planningPreferences.quickAddRemoveRecognizedText" :default-estimate-minutes="planningPreferences.defaultEstimateMinutes" :reduced-glass-override="planningPreferences.reducedGlassOverride" :sidebar-display-mode="sidebarPreferences.displayMode" :sidebar-order-customized="sidebarOrderCustomized" :cloud-available="cloudAvailable" :cloud-status="cloudStatus" :cloud-email="cloudEmail" :cloud-message="cloudMessage" @export-json="exportJsonData" @export-markdown="exportMarkdownData" @import="importData" @reset-demo="resetDemo" @reset-sidebar-order="resetSidebarOrder" @set-theme="setTheme" @set-theme-mode="setThemeMode" @set-custom-primary="setCustomPrimary" @set-reminders="setReminders" @test-notification="testNotification" @set-close-behavior="setCloseBehavior" @set-launch-at-login="setLaunchAtLogin" @set-quick-add-remove-recognized-text="updatePlanningPreferences({ quickAddRemoveRecognizedText: $event })" @set-default-estimate-minutes="updatePlanningPreferences({ defaultEstimateMinutes: $event })" @set-reduced-glass="updatePlanningPreferences({ reducedGlassOverride: $event })" @set-sidebar-display-mode="updateSidebarPreferences({ displayMode: $event })" @cloud-sign-in="signInStudyCloud" @cloud-sign-out="signOutStudyCloud" @cloud-sync="syncStudyCloud" />
        <div v-else-if="destination.kind === 'learning'" class="route-workspace">
          <nav class="learning-navigation" aria-label="学习导航"><Button v-for="item in learningWorkspaceNavigation" :key="item.preferenceKey" :aria-pressed="isLearningDestinationActive(item.view)" @click="setDestination(item.view)">{{ item.label }}</Button></nav>
          <TopicsView v-if="destination.section === 'topics'" :topics="topicViews" :groups="activeListGroups" :selected-id="selectedTopicId" @select="selectedTopicId = $event" @create="openTopicEditor()" @create-group="openGroupEditor()" @edit-group="openGroupEditor(activeListGroups.find((group) => group.id === $event))" @edit="openTopicEditor(state.topics.find((topic) => topic.id === $event))" @archive="archiveTopic" @start="taskPrimary(liveTasks.find((task) => task.topicId === $event && (task.status === 'in_progress' || task.status === 'planned'))?.id ?? '')" />
          <LearningRhythmView v-else-if="destination.section === 'rhythm'" :items="learningRhythmItems" :totals="learningRhythmSelection.totals" @open-occurrence="openRhythmOccurrence" @open-task="openSearchTask" @edit-task="openTaskEditor" />
          <ReviewView v-else-if="destination.section === 'review'" :item="reviewItems[0]" :remaining="reviewItems.length" :revealed="reviewRevealed" :busy="reviewBusy" :refresh-required="reviewRefreshRequired" :weekly-summary="weeklyLearningSummary" :records="recordViews" :topics="state.topics" :initial-mode="reviewMode" :record-target="recordTarget" @reveal="reviewRevealed = true" @reload="reloadReviews" @rate="rateReview" @create-task="createFromNextAction" @open-task="openSearchTask" @open-record="openSearchRecord" @open-plan-source="openWeeklyPlanSource" />
        </div>
        <CalendarWorkspace v-if="!loading && page === 'calendar'" :workspace="recurrenceWorkspace" :week-starts-on="planningPreferences.weekStartsOn" :default-estimate-minutes="planningPreferences.defaultEstimateMinutes" :initial-mode="desktopCalendarMode" :now="new Date(clock).toISOString()" :target-offset="calendarTargetOffset" :execute-command="executeCalendarCommand" @desktop-mode-selected="persistDesktopCalendarMode" />
      </main>
      <BottomTabs v-if="!showFocus" :active="destination" @navigate="setDestination" />
    </div>

    <CompletionSheet :open="completionOpen" :context-id="completionReminderId || completionOccurrenceId || completionTaskId || activeSession?.id || activeTask?.id || ''" :busy="Boolean(completionReminderId) ? reminderBusy : completionOccurrenceBusy" :task-title="reminderCompletionTask?.title ?? completionOccurrenceTask?.title ?? completionTask?.title ?? activeTask?.title ?? ''" :scratchpad="completionReminderId || completionOccurrenceId || completionTaskId ? '' : activeSession?.scratchpad ?? ''" @close="completionOpen = false; completionReminderId = ''; completionOccurrenceId = ''; completionTaskId = ''" @save="completeFocus" />
    <TaskActionSheet :open="taskActionOpen" :mode="taskActionMode" :task-title="actionTask?.title ?? ''" :topics="state.topics" :default-topic-id="actionTask?.topicId" :default-planned-on="actionTask?.plannedOn" :default-due-on="actionTask?.dueOn" :default-minutes="actionTask?.estimateMinutes" :default-criteria="actionTask?.acceptanceCriteria" @close="taskActionOpen = false" @submit="submitTaskAction" />
    <TaskEditSheet :open="taskEditorOpen" :task="selectedTaskEditModel" :topics="state.topics" :tags="recurrenceWorkspace?.tags ?? []" :recurrence-rule="selectedRecurrenceRule" :learning="selectedWorkspaceTask?.mode === 'learning'" :planned-at="selectedWorkspaceTask?.schedule.startAt" :due-at="selectedWorkspaceTask?.deadline.dueAt" :reminder-rules="recurrenceWorkspace?.reminderRules ?? []" :notification-available="nativeNotificationAvailable" :reminder-permission="editorReminderPermission" :reminder-busy="reminderBusy" :reminder-error="reminderError" @manage-tags="openTagManager()" @close="taskEditorOpen = false; reminderError = ''" @save="saveTaskEdit" />
    <GlobalSearchDialog v-model:open="globalSearchOpen" :workspace="recurrenceWorkspace" :timezone="timezone" @close="globalSearchOpen = false" @manage-tags="openTagManager(true)" @open-task="openSearchTask" @open-record="openSearchRecord" />
    <TagManagerSheet ref="tagManager" :open="tagManagerOpen" :tags="recurrenceWorkspace?.tags ?? []" :busy="tagManagerBusy" :error="tagManagerError" @close="closeTagManager" @create="createTag" @rename="renameTag" @archive="archiveTag" />
    <RecurrenceScopeDialog :open="recurrenceScopeOpen" :preview="recurrencePreview" :previewing="recurrencePreviewing" :executing="recurrenceExecuting" @close="recurrenceScopeOpen = false; clearRecurrencePreview()" @edit-occurrence="editSingleOccurrence" @preview="previewRecurrenceScope" @execute="executeRecurrenceScope" />
    <OccurrenceRescheduleSheet :open="occurrenceRescheduleOpen" :title="selectedTask?.title ?? ''" :model-value="occurrenceRescheduleValue" :timed="occurrenceRescheduleTimed" @close="occurrenceRescheduleOpen = false" @submit="rescheduleOccurrence" />
    <Sheet :open="topicEditorOpen" :label="state.topics.some((topic) => topic.id === selectedTopicId) ? '编辑清单' : '新建清单'" size="lg" @close="topicEditorOpen = false"><form class="editor-sheet" @submit.prevent="saveTopic"><h2>{{ state.topics.some((topic) => topic.id === selectedTopicId) ? '编辑清单' : '新建清单' }}</h2><label><span>名称</span><input v-model="topicTitle" autofocus required placeholder="清单名称" /></label><label><span>分组</span><Listbox v-model="topicGroupId" :options="topicGroupOptions" label="分组" /></label><label><span>目标</span><textarea v-model="topicGoal" placeholder="学习目标" /></label><label><span>每周分钟</span><div class="duration-input"><input v-model.number="topicMinutes" type="number" min="30" max="1200" /><span>分钟</span></div></label><footer><button type="button" class="cancel" @click="topicEditorOpen = false">取消</button><button type="submit" class="save">保存</button></footer></form></Sheet>
    <Sheet :open="groupEditorOpen" :label="selectedGroupId ? '编辑分组' : '新建分组'" size="sm" @close="groupEditorOpen = false"><form class="editor-sheet compact-editor" @submit.prevent="saveGroup"><h2>{{ selectedGroupId ? '编辑分组' : '新建分组' }}</h2><label><span>名称</span><input v-model="groupTitle" autofocus required placeholder="分组名称" /></label><footer><button v-if="selectedGroupId" type="button" class="cancel danger" @click="archiveGroup">归档</button><span class="footer-spacer"></span><button type="button" class="cancel" @click="groupEditorOpen = false">取消</button><button type="submit" class="save">保存</button></footer></form></Sheet>
    <Dialog v-model:open="reminderCenterOpen" title="任务提醒" :description="nativeDeliveryAvailable ? '系统通知仅显示标题，操作在这里完成。' : '仅应用内提醒；未启用系统通知。'">
      <p v-if="!reminderCards.length">暂时没有待处理提醒。</p>
      <p v-if="reminderMessage" role="status">{{ reminderMessage }}</p>
      <ReminderCard v-for="item in reminderCards" :key="item.delivery.id" :delivery="item.delivery" :task-title="item.task.title" :learning="item.task.mode === 'learning'" :notification-available="nativeDeliveryAvailable" :busy="reminderBusy" :error="reminderError" @action="handleReminderAction" />
    </Dialog>
    <Dialog :open="closeRequestOpen" title="关闭拾学" description="隐藏到托盘可继续提醒；退出后不会发送提醒。" @update:open="!$event && chooseWindowClose(null)">
      <template #footer>
        <Button @click="chooseWindowClose(null)">取消</Button>
        <Button @click="chooseWindowClose('tray')">隐藏到托盘</Button>
        <Button variant="danger" @click="chooseWindowClose('quit')">退出拾学</Button>
      </template>
    </Dialog>
    <ToastRegion :key="toastVersion" :message="toast" :action-label="toastAction?.label" :duration="toastAction ? 6000 : 3200" :raised="compact && Boolean(selectedTaskId)" @action="runToastAction" @dismiss="dismissToast" />
    <div v-if="storageError" class="error-banner" role="alert"><span>{{ errorBannerMessage }}</span><button @click="storageError = ''">知道了</button></div>
  </div>
</template>

<style scoped>
.calendar-main { overflow: hidden; }
.route-workspace { min-height: 100%; display: flex; flex-direction: column; }
.route-workspace > :last-child { min-height: 0; flex: 1; }
.learning-navigation { display: flex; gap: 8px; padding: 16px 24px 0; }
.learning-navigation > * { min-height: 44px; }
.lists-more { display: none; }
.lists-more-menu { min-width: 180px; display: grid; gap: 6px; padding: 8px; }
.shell { width: 100%; height: 100vh; height: 100dvh; display: flex; overflow: hidden; background: var(--bg); }.workspace { min-width: 0; flex: 1; height: 100%; overflow: hidden; } main { width: 100%; height: 100%; overflow-y: auto; overscroll-behavior-y: contain; scroll-behavior: smooth; scrollbar-gutter: stable; }.tasks-main { overflow: hidden; }.today-layout { min-height: 100%; display: flex; justify-content: center; }.today-layout > :first-child { flex: 1 1 auto; }.tasks-layout { height: 100%; display: flex; }.tasks-scroll { min-width: 0; flex: 1; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; }.focus-main { background: var(--bg); }.mobile-header { display: none; }.loading { min-height: 100%; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 13px; }
.editor-sheet { width: 100%; }.editor-sheet.compact-editor { width: min(100%, 420px); }.editor-sheet > p { margin: 0 0 5px; color: var(--accent); font-size: 11px; font-weight: 600; }.editor-sheet h2 { margin: 0 0 22px; font-size: 23px; font-weight: 650; letter-spacing: -.025em; }.editor-sheet label { display: block; margin-top: 16px; }.editor-sheet label > span { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; }.editor-sheet input, .editor-sheet textarea { width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); outline: 0; background: var(--control-fill); color: var(--text); font-size: 13px; transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease); }.editor-sheet input:focus, .editor-sheet textarea:focus { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }.editor-sheet textarea { min-height: 88px; resize: vertical; }.duration-input { display: flex; align-items: center; gap: 9px; }.duration-input input { width: 110px; }.duration-input span { color: var(--muted); font-size: 12px; }.editor-sheet footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--hairline); }.editor-sheet footer button { min-height: 46px; padding: 0 18px; border-radius: var(--radius-lg); font-size: 13px; font-weight: 600; }.footer-spacer { flex: 1; }.cancel { border: 1px solid var(--hairline); background: var(--control-fill); color: var(--text); }.save { border: 0; background: var(--accent); color: var(--accent-text); box-shadow: 0 5px 14px color-mix(in srgb, var(--accent) 20%, transparent); }
.error-banner { position: fixed; z-index: var(--z-toast); left: 232px; right: 16px; top: 14px; min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 10px 8px 14px; border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border)); border-radius: var(--radius-lg); background: var(--material-regular); color: var(--danger); font-size: 11px; box-shadow: var(--shadow-md);  }.error-banner button { min-height: 30px; border: 0; background: transparent; color: var(--danger); font-weight: 600; }
@media (max-width: 819px) {
  .learning-navigation { padding: 10px 16px 0; }
  .lists-more { position: fixed; z-index: var(--z-sticky); top: calc(72px + env(safe-area-inset-top, 0px)); right: 16px; display: block; }
  .shell { flex-direction: column; }.workspace { width: 100%; }.mobile-header { height: calc(64px + env(safe-area-inset-top, 0px)); display: flex; align-items: center; justify-content: space-between; padding: calc(8px + env(safe-area-inset-top, 0px)) 16px 8px; border-bottom: 1px solid var(--hairline); background: var(--material-thin);  }.mobile-header > div { display: flex; align-items: center; gap: 8px; }.mobile-header img { width: 34px; height: 34px; }.mobile-header strong { font-size: 18px; font-weight: 650; letter-spacing: .04em; }.mobile-header button { width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--text); }.mobile-header button:active { background: var(--control-fill); }.mobile-actions { gap: 2px !important; } main { height: calc(100% - 64px - env(safe-area-inset-top, 0px)); scrollbar-gutter: auto; } main.focus-main { height: 100%; }.tasks-layout { display: block; }.error-banner { left: 12px; right: 12px; top: calc(70px + env(safe-area-inset-top, 0px)); }
}
</style>
