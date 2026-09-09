import { calendarRange } from '../calendar/range.ts'
import { parseZonedDateTime } from '../recurrence/timezone.ts'
import { SYSTEM_LEARNING_LIST_ID } from '../workspace/migrate.ts'
import type { CompletionRecord, ReviewTaskLink, Task, TaskEvent, TaskOccurrence, WorkspaceStateV4 } from '../workspace/types.ts'

export interface WeeklyLearningSummaryQuery {
  asOf: string
  timezone: string
  weekStartsOn: 0 | 1
}

export interface WeeklyLearningMetric {
  value: number
  recordIds: string[]
}

export interface WeeklyLearningReviewFact {
  id: string
  recordId: string
  completedAt: string
  reviewedOn: string
  result: 'clear' | 'fuzzy' | 'relearn'
}

export type WeeklyLearningDueReviewState = 'scheduled' | 'due' | 'overdue' | 'completed'

export interface WeeklyLearningDueReviewFact {
  id: string
  recordId: string
  reviewTaskId: string
  occurrenceId: string | null
  reviewStage: 0 | 1 | 2 | 3
  dueOn: string
  sourceTitle: string
  state: WeeklyLearningDueReviewState
  completedAt: string | null
  reviewedOn: string | null
  result: 'clear' | 'fuzzy' | 'relearn' | null
}

export interface WeeklyLearningReviewCoverageMetric {
  value: number
  recordIds: string[]
  facts: WeeklyLearningDueReviewFact[]
}

export interface WeeklyLearningReviewCoverage {
  due: WeeklyLearningReviewCoverageMetric
  completed: WeeklyLearningReviewCoverageMetric
  scheduledCount: number
  dueTodayCount: number
  overdueCount: number
}

export type WeeklyLearningPlanStatus = 'pending' | 'completed' | 'cancelled' | 'skipped'

export interface WeeklyLearningPlanFact {
  id: string
  taskId: string
  occurrenceId: string | null
  title: string
  scheduledAt: string | null
  scheduledOn: string | null
  scheduledDate: string
  scheduledTime: string | null
  estimateMinutes: number | null
  status: WeeklyLearningPlanStatus
  outcomeEventId: string | null
  completionRecordId: string | null
}

export interface WeeklyLearningPlanMetric {
  value: number
  facts: WeeklyLearningPlanFact[]
}

export interface WeeklyLearningCurrentPlans {
  planned: WeeklyLearningPlanMetric
  completed: WeeklyLearningPlanMetric
  cancelled: WeeklyLearningPlanMetric
  skipped: WeeklyLearningPlanMetric
  estimatedMinutes: WeeklyLearningPlanMetric
  unestimatedCount: number
  evidenceCoverage: {
    eligible: WeeklyLearningPlanMetric
    covered: WeeklyLearningPlanMetric
    missing: WeeklyLearningPlanMetric
  }
}

export interface WeeklyLearningTopicSummary {
  topicId: string | null
  topicTitle: string
  evidenceCompletions: WeeklyLearningMetric
  evidenceMinutes: WeeklyLearningMetric
  completedReviews: WeeklyLearningMetric
  completedReviewFacts: WeeklyLearningReviewFact[]
  reviewCoverage: WeeklyLearningReviewCoverage
  currentPlans: WeeklyLearningCurrentPlans
}

export interface WeeklyLearningSummary {
  rangeStart: string
  rangeEnd: string
  totals: {
    evidenceCompletions: WeeklyLearningMetric
    evidenceMinutes: WeeklyLearningMetric
    completedReviews: WeeklyLearningMetric
  }
  topics: WeeklyLearningTopicSummary[]
}

interface MutableTopicSummary {
  topicId: string | null
  topicTitle: string
  completionRecordIds: Set<string>
  minuteRecordIds: Set<string>
  evidenceSeconds: number
  reviewRecordIds: Set<string>
  completedReviewCount: number
  reviewFacts: WeeklyLearningReviewFact[]
  dueReviewFacts: WeeklyLearningDueReviewFact[]
  planFacts: WeeklyLearningPlanFact[]
}

interface PlanOutcome {
  status: WeeklyLearningPlanStatus
  eventId: string | null
  completionRecordId: string | null
}

export function selectWeeklyLearningSummary(
  state: WorkspaceStateV4,
  query: WeeklyLearningSummaryQuery,
): WeeklyLearningSummary {
  const instant = new Date(query.asOf)
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid datetime: ${query.asOf}`)
  if (query.weekStartsOn !== 0 && query.weekStartsOn !== 1) throw new Error(`Invalid week start: ${query.weekStartsOn}`)

  const today = parseZonedDateTime(query.asOf, query.timezone).date
  const range = calendarRange('week', today, query.weekStartsOn)
  const topicTitles = new Map(state.lists.map(({ id, title }) => [id, title]))
  const sessions = new Map(state.studySessions
    .filter(({ deletedAt }) => deletedAt === null)
    .map((session) => [session.id, session]))
  const liveRecordList = state.completionRecords
    .filter(({ deletedAt }) => deletedAt === null)
    .sort(compareRecords)
  const liveRecords = new Map(liveRecordList.map((record) => [record.id, record]))
  const sessionOwners = claimLiveSessions(liveRecordList, sessions)
  const weeklyRecords = [...liveRecords.values()]
    .filter((record) => inRange(record.completedAt, instant, query.timezone, range.start, range.end))
    .sort(compareRecords)
  const topics = new Map<string, MutableTopicSummary>()

  for (const record of weeklyRecords) {
    const topic = requireTopic(topics, record.topicId, topicTitles)
    topic.completionRecordIds.add(record.id)
    let recordSeconds = 0
    for (const sessionId of new Set(record.sessionIds)) {
      const session = sessions.get(sessionId)
      if (!session || sessionOwners.get(sessionId) !== record.id || session.taskId !== record.taskId) continue
      recordSeconds += Math.max(0, session.elapsedSeconds)
    }
    if (recordSeconds > 0) topic.minuteRecordIds.add(record.id)
    topic.evidenceSeconds += recordSeconds
  }

  const reviewLinks = [...state.reviewTaskLinks].sort(compareReviewLinks)
  for (const link of reviewLinks) {
    const record = liveRecords.get(link.completionRecordId)
    if (!record
      || Date.parse(record.createdAt) > instant.getTime()
      || Date.parse(record.completedAt) > instant.getTime()
      || Date.parse(link.createdAt) > instant.getTime()) continue
    if (link.completedAt !== null && !link.completion) throw new Error(`Completed review ${link.id} is missing its completion fact.`)
    if (link.completedAt === null && link.completion !== null) throw new Error(`Review ${link.id} has a result without a completion time.`)
    if (link.dueOn >= range.start && link.dueOn < range.end) {
      requireTopic(topics, record.topicId, topicTitles).dueReviewFacts.push(dueReviewFact(link, record, instant, today))
    }
    if (link.completedAt !== null && inRange(link.completedAt, instant, query.timezone, range.start, range.end)) {
      if (!link.completion) throw new Error(`Completed review ${link.id} is missing its completion fact.`)
      const topic = requireTopic(topics, record.topicId, topicTitles)
      topic.completedReviewCount += 1
      topic.reviewRecordIds.add(record.id)
      topic.reviewFacts.push(reviewFact({ ...link, completedAt: link.completedAt, completion: link.completion }))
    }
  }

  for (const { topicId, fact } of selectCurrentPlanFacts(state, instant, query.timezone, range.start, range.end)) {
    requireTopic(topics, topicId, topicTitles).planFacts.push(fact)
  }

  const orderedTopics = [...topics.values()]
    .sort((left, right) => compare(left.topicTitle, right.topicTitle) || compare(left.topicId ?? '', right.topicId ?? ''))
  const minuteAllocations = allocateMinutes(orderedTopics)
  const rows = orderedTopics.map((topic, index) => toTopicSummary(topic, minuteAllocations[index]!))

  return {
    rangeStart: range.start,
    rangeEnd: range.end,
    totals: {
      evidenceCompletions: metric(
        rows.reduce((sum, row) => sum + row.evidenceCompletions.value, 0),
        rows.flatMap((row) => row.evidenceCompletions.recordIds),
      ),
      evidenceMinutes: metric(
        Math.round(orderedTopics.reduce((sum, topic) => sum + topic.evidenceSeconds, 0) / 60),
        rows.flatMap((row) => row.evidenceMinutes.recordIds),
      ),
      completedReviews: metric(
        rows.reduce((sum, row) => sum + row.completedReviews.value, 0),
        rows.flatMap((row) => row.completedReviews.recordIds),
      ),
    },
    topics: rows,
  }
}

function requireTopic(
  topics: Map<string, MutableTopicSummary>,
  topicId: string | null,
  titles: ReadonlyMap<string, string>,
): MutableTopicSummary {
  const knownTopicId = topicId && topicId !== SYSTEM_LEARNING_LIST_ID && titles.has(topicId) ? topicId : null
  const key = knownTopicId ?? ''
  let topic = topics.get(key)
  if (!topic) {
    topic = {
      topicId: knownTopicId,
      topicTitle: knownTopicId ? titles.get(knownTopicId)! : '未归类',
      completionRecordIds: new Set(),
      minuteRecordIds: new Set(),
      evidenceSeconds: 0,
      reviewRecordIds: new Set(),
      completedReviewCount: 0,
      reviewFacts: [],
      dueReviewFacts: [],
      planFacts: [],
    }
    topics.set(key, topic)
  }
  return topic
}

function toTopicSummary(topic: MutableTopicSummary, evidenceMinutes: number): WeeklyLearningTopicSummary {
  return {
    topicId: topic.topicId,
    topicTitle: topic.topicTitle,
    evidenceCompletions: metric(topic.completionRecordIds.size, [...topic.completionRecordIds]),
    evidenceMinutes: metric(evidenceMinutes, [...topic.minuteRecordIds]),
    completedReviews: metric(topic.completedReviewCount, [...topic.reviewRecordIds]),
    completedReviewFacts: [...topic.reviewFacts].sort(compareReviewFacts),
    reviewCoverage: reviewCoverage(topic.dueReviewFacts),
    currentPlans: currentPlans(topic.planFacts),
  }
}

function selectCurrentPlanFacts(
  state: WorkspaceStateV4,
  asOf: Date,
  timezone: string,
  rangeStart: string,
  rangeEnd: string,
): Array<{ topicId: string | null; fact: WeeklyLearningPlanFact }> {
  const reviewTaskIds = new Set(state.reviewTaskLinks.map(({ reviewTaskId }) => reviewTaskId))
  const records = new Map(state.completionRecords.map((record) => [record.id, record]))
  const seriesById = new Map(state.recurrenceSeries.map((series) => [series.id, series]))
  const seriesByTask = new Map<string, WorkspaceStateV4['recurrenceSeries']>()
  for (const series of state.recurrenceSeries) {
    const taskSeries = seriesByTask.get(series.taskId) ?? []
    taskSeries.push(series)
    seriesByTask.set(series.taskId, taskSeries)
  }
  const eventsByTask = new Map<string, TaskEvent[]>()
  for (const event of [...state.taskEvents].sort(compareEvents)) {
    const events = eventsByTask.get(event.taskId) ?? []
    events.push(event)
    eventsByTask.set(event.taskId, events)
  }

  return state.tasks.flatMap((task): Array<{ topicId: string | null; fact: WeeklyLearningPlanFact }> => {
    if (task.mode !== 'learning' || task.deletedAt !== null || reviewTaskIds.has(task.id)) return []
    const taskSeries = seriesByTask.get(task.id) ?? []
    if (!taskSeries.length) {
      const schedule = { scheduledAt: task.schedule.startAt, scheduledOn: task.schedule.startOn }
      const scheduled = scheduleDisplay(schedule, timezone, task.id)
      if (!scheduled || scheduled.date < rangeStart || scheduled.date >= rangeEnd) return []
      const outcome = taskOutcome(eventsByTask.get(task.id) ?? [], asOf, records)
      return [{
        topicId: task.listId,
        fact: planFact(task, null, schedule, scheduled, task.schedule.estimateMinutes, outcome),
      }]
    }

    return state.occurrences.flatMap((occurrence): Array<{ topicId: string | null; fact: WeeklyLearningPlanFact }> => {
      const series = seriesById.get(occurrence.seriesId)
      if (!series || series.taskId !== task.id) return []
      if (occurrence.status === 'cancelled') return []
      const schedule = occurrenceSchedule(occurrence)
      const scheduled = scheduleDisplay(schedule, timezone, occurrence.id)
      if (!scheduled || scheduled.date < rangeStart || scheduled.date >= rangeEnd) return []
      const outcome = occurrenceOutcome(
        occurrence,
        eventsByTask.get(task.id) ?? [],
        asOf,
        records,
      )
      const estimateMinutes = occurrence.override === null
        ? task.schedule.estimateMinutes
        : occurrence.override.estimateMinutes
      return [{
        topicId: task.listId,
        fact: planFact(task, occurrence, schedule, scheduled, estimateMinutes, outcome),
      }]
    })
  }).sort((left, right) => comparePlanFacts(left.fact, right.fact))
}

function planFact(
  task: Task,
  occurrence: TaskOccurrence | null,
  schedule: { scheduledAt: string | null; scheduledOn: string | null },
  scheduled: { date: string; time: string | null },
  estimateMinutes: number | null,
  outcome: PlanOutcome,
): WeeklyLearningPlanFact {
  return {
    id: occurrence ? `occurrence:${occurrence.id}` : `task:${task.id}`,
    taskId: task.id,
    occurrenceId: occurrence?.id ?? null,
    title: task.title,
    ...schedule,
    scheduledDate: scheduled.date,
    scheduledTime: scheduled.time,
    estimateMinutes,
    status: outcome.status,
    outcomeEventId: outcome.eventId,
    completionRecordId: outcome.completionRecordId,
  }
}

function taskOutcome(
  events: readonly TaskEvent[],
  asOf: Date,
  records: ReadonlyMap<string, CompletionRecord>,
): PlanOutcome {
  const eligible = events.filter((event) => !event.occurrenceId && Date.parse(event.occurredAt) <= asOf.getTime())
  const last = eligible[eligible.length - 1]
  if (!last || (last.type !== 'completed' && last.type !== 'cancelled')) return pendingOutcome()
  const semanticTime = last.type === 'completed' && last.completionRecordId
    ? records.get(last.completionRecordId)?.completedAt ?? last.occurredAt
    : last.occurredAt
  return Date.parse(semanticTime) <= asOf.getTime()
    ? {
        status: last.type,
        eventId: last.id,
        completionRecordId: last.type === 'completed' ? resolveCompletionRecordId(last, records) : null,
      }
    : pendingOutcome()
}

function occurrenceOutcome(
  occurrence: TaskOccurrence,
  events: readonly TaskEvent[],
  asOf: Date,
  records: ReadonlyMap<string, CompletionRecord>,
): PlanOutcome {
  if (occurrence.status === 'pending' || occurrence.status === 'cancelled') return pendingOutcome()
  const terminal = events.filter((event) => event.occurrenceId === occurrence.id && (event.type === 'completed' || event.type === 'cancelled'))
  const event = terminal[terminal.length - 1]
  if (!event || Date.parse(event.occurredAt) > asOf.getTime()) return pendingOutcome()
  const expectedType = occurrence.status === 'completed' ? 'completed' : 'cancelled'
  if (event.type !== expectedType) {
    throw new Error(`Occurrence ${occurrence.id} status does not match its latest terminal outcome event.`)
  }
  const semanticTime = event.type === 'completed' && event.completionRecordId
    ? records.get(event.completionRecordId)?.completedAt ?? event.occurredAt
    : event.occurredAt
  if (Date.parse(semanticTime) > asOf.getTime()) return pendingOutcome()
  if (event.type === 'completed') {
    return { status: 'completed', eventId: event.id, completionRecordId: resolveCompletionRecordId(event, records) }
  }
  return { status: 'skipped', eventId: event.id, completionRecordId: null }
}

function pendingOutcome(): PlanOutcome {
  return { status: 'pending', eventId: null, completionRecordId: null }
}

function resolveCompletionRecordId(event: TaskEvent, records: ReadonlyMap<string, CompletionRecord>): string | null {
  if (!event.completionRecordId) return null
  const record = records.get(event.completionRecordId)
  if (!record) throw new Error(`Outcome event ${event.id} references missing completion record ${event.completionRecordId}.`)
  if (record.taskId !== event.taskId) throw new Error(`Outcome event ${event.id} references a completion record for another task.`)
  return record.deletedAt === null ? record.id : null
}

function occurrenceSchedule(occurrence: TaskOccurrence): { scheduledAt: string | null; scheduledOn: string | null } {
  const hasScheduleOverride = occurrence.override !== null
    && (occurrence.override.scheduledAt !== null || occurrence.override.scheduledOn !== null)
  return hasScheduleOverride
    ? { scheduledAt: occurrence.override!.scheduledAt, scheduledOn: occurrence.override!.scheduledOn }
    : { scheduledAt: occurrence.scheduledAt, scheduledOn: occurrence.scheduledOn }
}

function scheduleDisplay(
  schedule: { scheduledAt: string | null; scheduledOn: string | null },
  timezone: string,
  id: string,
): { date: string; time: string | null } | null {
  if (schedule.scheduledOn) return { date: schedule.scheduledOn, time: null }
  if (!schedule.scheduledAt) return null
  try {
    const { date, time } = parseZonedDateTime(schedule.scheduledAt, timezone)
    return { date, time }
  } catch (error) {
    throw new Error(`Invalid schedule for ${id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function currentPlans(facts: readonly WeeklyLearningPlanFact[]): WeeklyLearningCurrentPlans {
  const ordered = [...facts].sort(comparePlanFacts)
  const planned = planMetric(ordered.length, ordered)
  const completed = ordered.filter(({ status }) => status === 'completed')
  const cancelled = ordered.filter(({ status }) => status === 'cancelled')
  const skipped = ordered.filter(({ status }) => status === 'skipped')
  const estimated = ordered.filter((fact) => fact.estimateMinutes !== null)
  const covered = completed.filter(({ completionRecordId }) => completionRecordId !== null)
  const missing = completed.filter(({ completionRecordId }) => completionRecordId === null)
  const recordOwners = new Map<string, string>()
  for (const fact of covered) {
    const owner = recordOwners.get(fact.completionRecordId!)
    if (owner && owner !== fact.id) {
      throw new Error(`Completion record ${fact.completionRecordId} is claimed by weekly plans ${owner} and ${fact.id}.`)
    }
    recordOwners.set(fact.completionRecordId!, fact.id)
  }
  return {
    planned,
    completed: planMetric(completed.length, completed),
    cancelled: planMetric(cancelled.length, cancelled),
    skipped: planMetric(skipped.length, skipped),
    estimatedMinutes: planMetric(estimated.reduce((sum, fact) => sum + fact.estimateMinutes!, 0), estimated),
    unestimatedCount: ordered.length - estimated.length,
    evidenceCoverage: {
      eligible: planMetric(completed.length, completed),
      covered: planMetric(covered.length, covered),
      missing: planMetric(missing.length, missing),
    },
  }
}

function planMetric(value: number, facts: readonly WeeklyLearningPlanFact[]): WeeklyLearningPlanMetric {
  return { value, facts: facts.map((fact) => ({ ...fact })) }
}

function claimLiveSessions(
  records: readonly CompletionRecord[],
  sessions: ReadonlyMap<string, WorkspaceStateV4['studySessions'][number]>,
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const record of records) {
    for (const sessionId of new Set(record.sessionIds)) {
      if (!sessions.has(sessionId)) continue
      const owner = owners.get(sessionId)
      if (owner && owner !== record.id) {
        throw new Error(`Live study session ${sessionId} is claimed by completion records ${owner} and ${record.id}.`)
      }
      owners.set(sessionId, record.id)
    }
  }
  return owners
}

function allocateMinutes(topics: readonly MutableTopicSummary[]): number[] {
  const allocations = topics.map((topic) => Math.floor(topic.evidenceSeconds / 60))
  const target = Math.round(topics.reduce((sum, topic) => sum + topic.evidenceSeconds, 0) / 60)
  let remaining = target - allocations.reduce((sum, value) => sum + value, 0)
  const order = topics.map((topic, index) => ({
    index,
    remainder: topic.evidenceSeconds % 60,
    title: topic.topicTitle,
    id: topic.topicId ?? '',
  })).sort((left, right) =>
    right.remainder - left.remainder || compare(left.title, right.title) || compare(left.id, right.id))
  for (const entry of order) {
    if (remaining <= 0) break
    allocations[entry.index]! += 1
    remaining -= 1
  }
  return allocations
}

function reviewFact(link: ReviewTaskLink & { completedAt: string; completion: NonNullable<ReviewTaskLink['completion']> }): WeeklyLearningReviewFact {
  return {
    id: link.id,
    recordId: link.completionRecordId,
    completedAt: link.completedAt,
    reviewedOn: link.completion.reviewedOn,
    result: link.completion.result,
  }
}

function dueReviewFact(
  link: ReviewTaskLink,
  record: CompletionRecord,
  asOf: Date,
  today: string,
): WeeklyLearningDueReviewFact {
  const completed = link.completedAt !== null && Date.parse(link.completedAt) <= asOf.getTime()
  if (completed && !link.completion) throw new Error(`Completed review ${link.id} is missing its completion fact.`)
  const state: WeeklyLearningDueReviewState = completed
    ? 'completed'
    : link.dueOn < today
      ? 'overdue'
      : link.dueOn === today
        ? 'due'
        : 'scheduled'
  return {
    id: link.id,
    recordId: record.id,
    reviewTaskId: link.reviewTaskId,
    occurrenceId: link.occurrenceId,
    reviewStage: link.reviewStage,
    dueOn: link.dueOn,
    sourceTitle: record.taskTitleSnapshot,
    state,
    completedAt: completed ? link.completedAt : null,
    reviewedOn: completed ? link.completion!.reviewedOn : null,
    result: completed ? link.completion!.result : null,
  }
}

function reviewCoverage(facts: readonly WeeklyLearningDueReviewFact[]): WeeklyLearningReviewCoverage {
  const ordered = [...facts].sort(compareDueReviewFacts)
  const completed = ordered.filter(({ state }) => state === 'completed')
  return {
    due: reviewCoverageMetric(ordered.length, ordered),
    completed: reviewCoverageMetric(completed.length, completed),
    scheduledCount: ordered.filter(({ state }) => state === 'scheduled').length,
    dueTodayCount: ordered.filter(({ state }) => state === 'due').length,
    overdueCount: ordered.filter(({ state }) => state === 'overdue').length,
  }
}

function reviewCoverageMetric(
  value: number,
  facts: readonly WeeklyLearningDueReviewFact[],
): WeeklyLearningReviewCoverageMetric {
  return {
    value,
    recordIds: [...new Set(facts.map(({ recordId }) => recordId))].sort(compare),
    facts: facts.map((fact) => ({ ...fact })),
  }
}

function compareReviewFacts(left: WeeklyLearningReviewFact, right: WeeklyLearningReviewFact): number {
  return compare(left.completedAt, right.completedAt) || compare(left.id, right.id)
}

function compareReviewLinks(left: ReviewTaskLink, right: ReviewTaskLink): number {
  return compare(left.dueOn, right.dueOn) || left.reviewStage - right.reviewStage || compare(left.id, right.id)
}

function compareDueReviewFacts(left: WeeklyLearningDueReviewFact, right: WeeklyLearningDueReviewFact): number {
  return compare(left.dueOn, right.dueOn) || left.reviewStage - right.reviewStage || compare(left.id, right.id)
}

function comparePlanFacts(left: WeeklyLearningPlanFact, right: WeeklyLearningPlanFact): number {
  return compare(left.scheduledDate, right.scheduledDate)
    || compare(left.scheduledAt ?? left.scheduledOn ?? '', right.scheduledAt ?? right.scheduledOn ?? '')
    || compare(left.taskId, right.taskId)
    || compare(left.occurrenceId ?? '', right.occurrenceId ?? '')
}

function compareEvents(left: TaskEvent, right: TaskEvent): number {
  return left.sequence - right.sequence
    || compare(left.occurredAt, right.occurredAt)
    || compare(left.id, right.id)
}

function metric(value: number, recordIds: string[]): WeeklyLearningMetric {
  return { value, recordIds: [...new Set(recordIds)].sort(compare) }
}

function inRange(value: string, asOf: Date, timezone: string, start: string, end: string): boolean {
  if (Date.parse(value) > asOf.getTime()) return false
  const date = parseZonedDateTime(value, timezone).date
  return date >= start && date < end
}

function compareRecords(left: CompletionRecord, right: CompletionRecord): number {
  return compare(left.completedAt, right.completedAt) || compare(left.id, right.id)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
