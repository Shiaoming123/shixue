import { calendarRange } from '../calendar/range.ts'
import { parseZonedDateTime } from '../recurrence/timezone.ts'
import type {
  RecurrenceCadence,
  RecurrenceSeries,
  TaskOccurrence,
  WorkspaceStateV4,
} from '../workspace/types.ts'

export interface LearningRhythmQuery {
  asOf: string
  weekStartsOn: 0 | 1
}

export interface LearningRhythmItem {
  seriesId: string
  taskId: string
  listId: string
  cadence: RecurrenceCadence
  basis: RecurrenceSeries['basis']
  timezone: string
  rangeStart: string
  rangeEnd: string
  plannedCount: number
  completedWithEvidenceCount: number
  completedMissingEvidenceCount: number
  skippedCount: number
  cancelledCount: number
  streakCount: number
  nextOccurrenceId: string | null
  nextScheduled: string | null
  nextState: 'overdue' | 'today' | 'upcoming' | 'none'
  recentRecordId: string | null
  recentLearned: string
}

export interface LearningRhythmSelection {
  items: LearningRhythmItem[]
  totals: {
    planned: number
    completedWithEvidence: number
    completedMissingEvidence: number
    skipped: number
    cancelled: number
  }
}

interface DatedOccurrence {
  occurrence: TaskOccurrence
  date: string
  scheduled: string
}

export function selectLearningRhythms(
  state: WorkspaceStateV4,
  query: LearningRhythmQuery,
): LearningRhythmSelection {
  const asOf = new Date(query.asOf)
  if (Number.isNaN(asOf.getTime())) throw new Error(`Invalid datetime: ${query.asOf}`)
  if (query.weekStartsOn !== 0 && query.weekStartsOn !== 1) {
    throw new Error(`Invalid week start: ${query.weekStartsOn}`)
  }

  const liveRecords = new Map(state.completionRecords
    .filter(({ deletedAt }) => deletedAt === null)
    .map((record) => [record.id, record]))
  const recordIdByOccurrence = new Map<string, string>()
  const occurrenceIdByRecord = new Map<string, string>()
  for (const event of [...state.taskEvents].sort((left, right) => left.sequence - right.sequence || compare(left.id, right.id))) {
    if (event.type !== 'completed' || !event.occurrenceId || !event.completionRecordId) continue
    const record = liveRecords.get(event.completionRecordId)
    if (!record) continue
    const mappedRecordId = recordIdByOccurrence.get(event.occurrenceId)
    const mappedOccurrenceId = occurrenceIdByRecord.get(record.id)
    if (mappedRecordId && mappedRecordId !== record.id) {
      throw new Error(`Ambiguous completion evidence for occurrence: ${event.occurrenceId}`)
    }
    if (mappedOccurrenceId && mappedOccurrenceId !== event.occurrenceId) {
      throw new Error(`Completion evidence is linked to multiple occurrences: ${record.id}`)
    }
    recordIdByOccurrence.set(event.occurrenceId, record.id)
    occurrenceIdByRecord.set(record.id, event.occurrenceId)
  }

  const seriesById = new Map(state.recurrenceSeries.map((series) => [series.id, series]))
  const items = state.tasks.flatMap((task): LearningRhythmItem[] => {
    const series = task.recurrenceSeriesId ? seriesById.get(task.recurrenceSeriesId) : undefined
    if (!series || task.mode !== 'learning' || task.deletedAt !== null || task.status === 'cancelled' || task.status === 'completed') return []

    const today = parseZonedDateTime(query.asOf, series.timezone).date
    const range = calendarRange('week', today, query.weekStartsOn)
    const taskSeries = new Map(state.recurrenceSeries
      .filter((candidate) => candidate.taskId === task.id)
      .map((candidate) => [candidate.id, candidate]))
    const occurrences = state.occurrences.flatMap((occurrence): DatedOccurrence[] => {
      const owner = taskSeries.get(occurrence.seriesId)
      if (!owner) return []
      const schedule = occurrenceSchedule(occurrence)
      const date = occurrenceDate(schedule, owner.timezone, occurrence.id)
      const structuralSplitCancellation = owner.id !== series.id
        && occurrence.status === 'cancelled'
        && owner.end.kind === 'on'
        && date > owner.end.date
      return structuralSplitCancellation ? [] : [{ occurrence, date, scheduled: schedule.scheduledOn ?? schedule.scheduledAt! }]
    })
      .sort(compareOccurrence)
    const thisWeek = occurrences.filter(({ date }) => date >= range.start && date < range.end)
    const completedWithEvidence = thisWeek.filter(({ occurrence }) => (
      occurrence.status === 'completed' && recordIdByOccurrence.has(occurrence.id)
    ))
    const completedMissingEvidence = thisWeek.filter(({ occurrence }) => (
      occurrence.status === 'completed' && !recordIdByOccurrence.has(occurrence.id)
    ))
    const next = occurrences.find(({ occurrence }) => occurrence.seriesId === series.id && occurrence.status === 'pending') ?? null
    const evidenceRecords = occurrences.flatMap(({ occurrence }) => {
      const recordId = recordIdByOccurrence.get(occurrence.id)
      const record = recordId ? liveRecords.get(recordId) : undefined
      return record ? [record] : []
    }).sort((left, right) => compare(right.completedAt, left.completedAt) || compare(left.id, right.id))

    return [{
      seriesId: series.id,
      taskId: task.id,
      listId: task.listId,
      cadence: cloneCadence(series.cadence),
      basis: series.basis,
      timezone: series.timezone,
      rangeStart: range.start,
      rangeEnd: range.end,
      plannedCount: thisWeek.length,
      completedWithEvidenceCount: completedWithEvidence.length,
      completedMissingEvidenceCount: completedMissingEvidence.length,
      skippedCount: thisWeek.filter(({ occurrence }) => occurrence.status === 'skipped').length,
      cancelledCount: thisWeek.filter(({ occurrence }) => occurrence.status === 'cancelled').length,
      streakCount: evidenceStreak(occurrences, today, recordIdByOccurrence),
      nextOccurrenceId: next?.occurrence.id ?? null,
      nextScheduled: next?.scheduled ?? null,
      nextState: nextState(next?.date ?? null, today),
      recentRecordId: evidenceRecords[0]?.id ?? null,
      recentLearned: evidenceRecords[0]?.learned ?? '',
    }]
  }).sort((left, right) => (
    nextStateOrder(left.nextState) - nextStateOrder(right.nextState)
    || compare(left.nextScheduled ?? '9999-12-31', right.nextScheduled ?? '9999-12-31')
    || compare(left.taskId, right.taskId)
    || compare(left.seriesId, right.seriesId)
  ))

  return {
    items,
    totals: {
      planned: sum(items, 'plannedCount'),
      completedWithEvidence: sum(items, 'completedWithEvidenceCount'),
      completedMissingEvidence: sum(items, 'completedMissingEvidenceCount'),
      skipped: sum(items, 'skippedCount'),
      cancelled: sum(items, 'cancelledCount'),
    },
  }
}

function occurrenceSchedule(occurrence: TaskOccurrence): Pick<TaskOccurrence, 'scheduledAt' | 'scheduledOn'> {
  const hasScheduleOverride = occurrence.override !== null
    && (occurrence.override.scheduledOn !== null || occurrence.override.scheduledAt !== null)
  return hasScheduleOverride
    ? { scheduledAt: occurrence.override!.scheduledAt, scheduledOn: occurrence.override!.scheduledOn }
    : { scheduledAt: occurrence.scheduledAt, scheduledOn: occurrence.scheduledOn }
}

function occurrenceDate(
  schedule: Pick<TaskOccurrence, 'scheduledAt' | 'scheduledOn'>,
  timezone: string,
  occurrenceId: string,
): string {
  const scheduledOn = schedule.scheduledOn
  if (scheduledOn) return scheduledOn
  const scheduledAt = schedule.scheduledAt
  if (!scheduledAt) throw new Error(`Occurrence has no schedule: ${occurrenceId}`)
  return parseZonedDateTime(scheduledAt, timezone).date
}

function evidenceStreak(
  occurrences: readonly DatedOccurrence[],
  today: string,
  recordIdByOccurrence: ReadonlyMap<string, string>,
): number {
  const eligible = occurrences.filter(({ occurrence, date }) => (
    date < today || (date === today && occurrence.status !== 'pending')
  ))
  let streak = 0
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const occurrence = eligible[index]!.occurrence
    if (occurrence.status !== 'completed' || !recordIdByOccurrence.has(occurrence.id)) break
    streak += 1
  }
  return streak
}

function compareOccurrence(left: DatedOccurrence, right: DatedOccurrence): number {
  return compare(left.date, right.date)
    || left.occurrence.ordinal - right.occurrence.ordinal
    || compare(left.occurrence.id, right.occurrence.id)
}

function nextState(date: string | null, today: string): LearningRhythmItem['nextState'] {
  if (date === null) return 'none'
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  return 'upcoming'
}

function nextStateOrder(state: LearningRhythmItem['nextState']): number {
  return ({ overdue: 0, today: 1, upcoming: 2, none: 3 })[state]
}

function cloneCadence(cadence: RecurrenceCadence): RecurrenceCadence {
  return cadence.kind === 'weekly' ? { ...cadence, weekdays: [...cadence.weekdays] } : { ...cadence }
}

function sum(items: readonly LearningRhythmItem[], key: 'plannedCount' | 'completedWithEvidenceCount' | 'completedMissingEvidenceCount' | 'skippedCount' | 'cancelledCount'): number {
  return items.reduce((total, item) => total + item[key], 0)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
