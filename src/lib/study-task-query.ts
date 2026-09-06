import { addCalendarDays } from '../storage/study/types.ts'
import type { StudyTask, StudyTaskStatus, StudyTopic } from '../storage/study/types.ts'
import type { Task, TaskOccurrence, WorkspaceStateV3 } from '../domain/workspace/types.ts'
import { createTimeZoneFormatter, zonedDateTimeToInstant } from '../domain/recurrence/timezone.ts'

export type StudyTaskSort = 'manual' | 'updatedAt' | 'dueOn' | 'title'
export type StudyTaskQuerySort = StudyTaskSort | 'priority'
export type StudyTaskSmartView = 'inbox' | 'today' | 'next7' | 'all' | 'completed'

export interface StudyTaskFilter {
  statuses?: readonly StudyTaskStatus[]
  topicId?: string | null
}

export interface StudyTaskQuery extends StudyTaskFilter {
  search?: string
  sort?: StudyTaskQuerySort
  smartView?: StudyTaskSmartView
  today?: string
}

export interface TaskProjectionRange {
  /** Inclusive local calendar date. */
  from: string
  /** Inclusive local calendar date. */
  to: string
}

export type TaskProjectionReason = 'overdue' | 'planned' | 'due' | 'recurring'

export interface TaskProjection {
  key: `task:${string}` | `occurrence:${string}`
  taskId: string
  occurrenceId: string | null
  task: Task
  occurrence: TaskOccurrence | null
  scheduledAt: string | null
  scheduledOn: string | null
  dueAt: string | null
  dueOn: string | null
  reasons: TaskProjectionReason[]
}

export function projectTaskItems(
  state: WorkspaceStateV3,
  range: TaskProjectionRange,
  timezone: string,
): TaskProjection[] {
  if (range.from > range.to) throw new Error('Task projection range must start on or before it ends.')
  const dates = createProjectionDateContext(range, timezone)

  const seriesById = new Map(state.recurrenceSeries.map((series) => [series.id, series]))
  const occurrencesByTask = new Map<string, TaskOccurrence[]>()
  for (const occurrence of state.occurrences) {
    const taskId = seriesById.get(occurrence.seriesId)?.taskId
    if (!taskId) continue
    const items = occurrencesByTask.get(taskId) ?? []
    items.push(occurrence)
    occurrencesByTask.set(taskId, items)
  }

  const projections: TaskProjection[] = []
  for (const task of state.tasks) {
    if (task.deletedAt !== null || task.status === 'cancelled') continue
    const occurrences = occurrencesByTask.get(task.id) ?? []
    if (task.recurrenceSeriesId !== null || occurrences.length) {
      const taskProjections: TaskProjection[] = []
      const deadlineOn = task.deadline.dueOn ?? dates.datePart(task.deadline.dueAt)
      const deadlineOccurrence = canonicalDeadlineOccurrence(occurrences, deadlineOn, dates.datePart)
      for (const occurrence of occurrences) {
        const projection = projectOccurrence(task, occurrence, range, dates, occurrence.id === deadlineOccurrence?.id)
        if (projection) taskProjections.push(projection)
      }
      if (!deadlineOccurrence) {
        const deadlineProjection = projectRecurringDeadline(task, range, dates.datePart)
        if (deadlineProjection) taskProjections.push(deadlineProjection)
      }
      projections.push(...taskProjections)
      continue
    }
    const projection = projectSingleTask(task, range, dates.datePart)
    if (projection) projections.push(projection)
  }
  return projections
}

export function searchStudyTasks(
  tasks: readonly StudyTask[],
  topics: readonly StudyTopic[],
  search: string,
): StudyTask[] {
  const query = normalize(search)
  const topicTitles = new Map(topics.map(({ id, title }) => [id, title]))
  return visibleTasks(tasks).filter((task) => {
    if (!query) return true
    const values = [
      task.title,
      task.notes,
      task.topicId ? topicTitles.get(task.topicId) ?? '' : '',
      ...task.acceptanceCriteria,
      ...task.checklist.map(({ text }) => text),
      task.blockedReason ?? '',
    ]
    return values.some((value) => normalize(value).includes(query))
  })
}

export function filterStudyTasks(
  tasks: readonly StudyTask[],
  filter: StudyTaskFilter,
): StudyTask[] {
  return visibleTasks(tasks).filter((task) =>
    (!filter.statuses || filter.statuses.includes(task.status)) &&
    (filter.topicId === undefined || task.topicId === filter.topicId))
}

export function filterStudyTasksByTopic(
  tasks: readonly StudyTask[],
  topicId: string | null,
): StudyTask[] {
  return filterStudyTasks(tasks, { topicId })
}

export function sortStudyTasks(
  tasks: readonly StudyTask[],
  sort: StudyTaskQuerySort,
): StudyTask[] {
  const visible = visibleTasks(tasks).map((task, index) => ({ task, index }))
  visible.sort((left, right) => compareTasks(left.task, right.task, sort) || left.index - right.index)
  return visible.map(({ task }) => task)
}

export function queryStudyTasks(
  tasks: readonly StudyTask[],
  topics: readonly StudyTopic[],
  query: StudyTaskQuery = {},
): StudyTask[] {
  if (query.smartView && !query.today) {
    throw new Error('Study task smart view requires an injected today date.')
  }
  const selected = query.smartView
    ? selectStudyTaskSmartView(tasks, query.smartView, query.today!)
    : tasks
  const filtered = filterStudyTasks(selected, query)
  const searched = searchStudyTasks(filtered, topics, query.search ?? '')
  return sortStudyTasks(searched, query.sort ?? 'manual')
}

export function selectStudyTaskSmartView(
  tasks: readonly StudyTask[],
  view: StudyTaskSmartView,
  today: string,
): StudyTask[] {
  const visible = tasks.filter(({ deletedAt, status }) => !deletedAt && status !== 'cancelled')
  if (view === 'inbox') return visible.filter(({ status }) => status === 'inbox')
  if (view === 'completed') return visible.filter(({ status }) => status === 'completed')
  const actionable = visible.filter(({ status }) => status !== 'completed')
  if (view === 'all') return actionable
  if (view === 'today') {
    return actionable.filter((task) =>
      (task.plannedOn !== null && task.plannedOn <= today) ||
      (task.dueOn !== null && task.dueOn <= today),
    )
  }
  const end = addCalendarDays(today, 6)
  return actionable.filter((task) =>
    isInDateWindow(task.plannedOn, today, end) || isInDateWindow(task.dueOn, today, end),
  )
}

function compareTasks(left: StudyTask, right: StudyTask, sort: StudyTaskQuerySort): number {
  if (sort === 'updatedAt') return compareText(right.updatedAt, left.updatedAt)
  if (sort === 'dueOn') {
    if (left.dueOn === null) return right.dueOn === null ? 0 : 1
    if (right.dueOn === null) return -1
    return compareText(left.dueOn, right.dueOn)
  }
  if (sort === 'priority') {
    const order = { high: 0, medium: 1, low: 2, none: 3 } as const
    return order[left.priority] - order[right.priority]
  }
  if (sort === 'title') return compareText(normalize(left.title), normalize(right.title))
  return 0
}

type LocalDateResolver = (value: string | null) => string | null

interface ProjectionDateContext {
  datePart: LocalDateResolver
  rangeStartMs: number
  rangeEndExclusiveMs: number
}

function projectSingleTask(task: Task, range: TaskProjectionRange, datePart: LocalDateResolver): TaskProjection | null {
  const scheduledAt = task.schedule.startAt
  const scheduledOn = task.schedule.startOn ?? datePart(scheduledAt)
  const dueAt = task.deadline.dueAt
  const dueOn = task.deadline.dueOn ?? datePart(dueAt)
  const reasons = projectionReasons(task.status, scheduledOn, dueOn, range)
  if (!reasons.length) return null
  return {
    key: `task:${task.id}`,
    taskId: task.id,
    occurrenceId: null,
    task,
    occurrence: null,
    scheduledAt,
    scheduledOn,
    dueAt,
    dueOn,
    reasons,
  }
}

function projectOccurrence(
  task: Task,
  occurrence: TaskOccurrence,
  range: TaskProjectionRange,
  dates: ProjectionDateContext,
  attachDeadline = false,
): TaskProjection | null {
  if (occurrence.status === 'cancelled') return null
  const schedule = resolvedOccurrenceSchedule(occurrence)
  const scheduledAt = schedule.scheduledAt
  const explicitOccurrenceOn = schedule.scheduledOn
  const active = occurrence.status === 'pending'
  let occurrenceOn = explicitOccurrenceOn
  let inWindow = occurrenceOn !== null && inRange(occurrenceOn, range)
  let occurrenceOverdue = active && occurrenceOn !== null && occurrenceOn < range.from
  if (occurrenceOn === null && scheduledAt !== null) {
    const scheduledMs = Date.parse(scheduledAt)
    if (Number.isNaN(scheduledMs)) throw new Error(`Invalid datetime: ${scheduledAt}`)
    inWindow = scheduledMs >= dates.rangeStartMs && scheduledMs < dates.rangeEndExclusiveMs
    occurrenceOverdue = active && scheduledMs < dates.rangeStartMs
    if (inWindow || occurrenceOverdue) occurrenceOn = dates.datePart(scheduledAt)
  }
  if (!inWindow && !occurrenceOverdue) return null

  const taskPlannedOn = task.schedule.startOn ?? dates.datePart(task.schedule.startAt)
  const dueAt = attachDeadline ? task.deadline.dueAt : null
  const dueOn = attachDeadline ? task.deadline.dueOn ?? dates.datePart(dueAt) : null
  const deadlineInWindow = active && dueOn !== null && inRange(dueOn, range)
  const deadlineOverdue = active && dueOn !== null && dueOn < range.from

  const reasons: TaskProjectionReason[] = []
  if (occurrenceOverdue || deadlineOverdue) reasons.push('overdue')
  if (inWindow && taskPlannedOn !== null && inRange(taskPlannedOn, range)) reasons.push('planned')
  if (deadlineInWindow) reasons.push('due')
  if (inWindow || occurrenceOverdue) reasons.push('recurring')

  return {
    key: `occurrence:${occurrence.id}`,
    taskId: task.id,
    occurrenceId: occurrence.id,
    task,
    occurrence,
    scheduledAt,
    scheduledOn: occurrenceOn,
    dueAt,
    dueOn,
    reasons,
  }
}

function resolvedOccurrenceOn(occurrence: TaskOccurrence, datePart: LocalDateResolver): string {
  const schedule = resolvedOccurrenceSchedule(occurrence)
  return schedule.scheduledOn ?? datePart(schedule.scheduledAt) ?? '9999-12-31'
}

function resolvedOccurrenceSchedule(occurrence: TaskOccurrence): Pick<TaskOccurrence, 'scheduledAt' | 'scheduledOn'> {
  const override = occurrence.override
  return override && (override.scheduledAt !== null || override.scheduledOn !== null) ? override : occurrence
}

function canonicalDeadlineOccurrence(
  occurrences: readonly TaskOccurrence[],
  deadlineOn: string | null,
  datePart: LocalDateResolver,
): TaskOccurrence | null {
  if (!deadlineOn) return null
  return occurrences
    .filter((occurrence) => occurrence.status === 'pending' && resolvedOccurrenceOn(occurrence, datePart) === deadlineOn)
    .sort((left, right) => left.ordinal - right.ordinal || compareText(left.id, right.id))[0] ?? null
}

function projectRecurringDeadline(task: Task, range: TaskProjectionRange, datePart: LocalDateResolver): TaskProjection | null {
  if (task.status === 'completed' || task.status === 'cancelled') return null
  const dueAt = task.deadline.dueAt
  const dueOn = task.deadline.dueOn ?? datePart(dueAt)
  if (!dueOn) return null
  const reasons: TaskProjectionReason[] = []
  if (dueOn < range.from) reasons.push('overdue')
  else if (inRange(dueOn, range)) reasons.push('due')
  if (!reasons.length) return null
  return {
    key: `task:${task.id}`,
    taskId: task.id,
    occurrenceId: null,
    task,
    occurrence: null,
    scheduledAt: null,
    scheduledOn: null,
    dueAt,
    dueOn,
    reasons,
  }
}

function projectionReasons(
  status: Task['status'],
  scheduledOn: string | null,
  dueOn: string | null,
  range: TaskProjectionRange,
): TaskProjectionReason[] {
  const reasons: TaskProjectionReason[] = []
  const active = status !== 'completed' && status !== 'cancelled'
  if (active && ((scheduledOn !== null && scheduledOn < range.from) || (dueOn !== null && dueOn < range.from))) reasons.push('overdue')
  if (scheduledOn && inRange(scheduledOn, range)) reasons.push('planned')
  if (dueOn && inRange(dueOn, range)) reasons.push('due')
  return reasons
}

function createLocalDateResolver(timezone: string): LocalDateResolver {
  const format = createTimeZoneFormatter(timezone)
  const cache = new Map<string, string>()
  return (value) => {
    if (!value) return null
    const cached = cache.get(value)
    if (cached) return cached
    const instant = new Date(value)
    if (Number.isNaN(instant.getTime())) throw new Error(`Invalid datetime: ${value}`)
    const date = format(instant).date
    cache.set(value, date)
    return date
  }
}

function createProjectionDateContext(range: TaskProjectionRange, timezone: string): ProjectionDateContext {
  return {
    datePart: createLocalDateResolver(timezone),
    rangeStartMs: zonedDateTimeToInstant(range.from, '00:00', timezone).getTime(),
    rangeEndExclusiveMs: zonedDateTimeToInstant(addCalendarDays(range.to, 1), '00:00', timezone).getTime(),
  }
}

function inRange(value: string, range: TaskProjectionRange): boolean {
  return value >= range.from && value <= range.to
}

function isInDateWindow(value: string | null, from: string, to: string): boolean {
  return value !== null && value >= from && value <= to
}

function visibleTasks(tasks: readonly StudyTask[]): StudyTask[] {
  return tasks.filter(({ deletedAt }) => !deletedAt)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
