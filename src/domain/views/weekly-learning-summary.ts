import { calendarRange } from '../calendar/range.ts'
import { parseZonedDateTime } from '../recurrence/timezone.ts'
import type { CompletionRecord, ReviewTaskLink, WorkspaceStateV3 } from '../workspace/types.ts'

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

export interface WeeklyLearningTopicSummary {
  topicId: string | null
  topicTitle: string
  evidenceCompletions: WeeklyLearningMetric
  evidenceMinutes: WeeklyLearningMetric
  completedReviews: WeeklyLearningMetric
  completedReviewFacts: WeeklyLearningReviewFact[]
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
}

export function selectWeeklyLearningSummary(
  state: WorkspaceStateV3,
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
    const topic = requireTopic(topics, record, topicTitles)
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

  const completedLinks = state.reviewTaskLinks
    .filter((link) => link.completedAt !== null && inRange(link.completedAt, instant, query.timezone, range.start, range.end))
    .sort((left, right) => compare(left.completedAt!, right.completedAt!) || compare(left.id, right.id))
  for (const link of completedLinks) {
    const record = liveRecords.get(link.completionRecordId)
    if (!record) continue
    if (!link.completedAt || !link.completion) {
      throw new Error(`Completed review ${link.id} is missing its completion fact.`)
    }
    const topic = requireTopic(topics, record, topicTitles)
    topic.completedReviewCount += 1
    topic.reviewRecordIds.add(record.id)
    topic.reviewFacts.push(reviewFact({ ...link, completedAt: link.completedAt, completion: link.completion }))
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
  record: CompletionRecord,
  titles: ReadonlyMap<string, string>,
): MutableTopicSummary {
  const knownTopicId = record.topicId && titles.has(record.topicId) ? record.topicId : null
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
  }
}

function claimLiveSessions(
  records: readonly CompletionRecord[],
  sessions: ReadonlyMap<string, WorkspaceStateV3['studySessions'][number]>,
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

function compareReviewFacts(left: WeeklyLearningReviewFact, right: WeeklyLearningReviewFact): number {
  return compare(left.completedAt, right.completedAt) || compare(left.id, right.id)
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
