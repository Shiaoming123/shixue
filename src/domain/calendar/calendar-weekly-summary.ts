import { parseZonedDateTime } from '../recurrence/timezone.ts'
import type { WorkspaceStateV4 } from '../workspace/types.ts'
import { calendarRange } from './range.ts'
import { calendarTaskPlans, schedulingRangeBounds } from './scheduling.ts'
import type { ScheduleReason } from './scheduling.ts'

export interface CalendarWeeklySummaryQuery {
  asOf: string
  timezone: string
  weekStartsOn: 0 | 1
  unscheduledReasons?: Array<{ taskId: string; reason: ScheduleReason }>
}

/** Current plans and recorded outcomes; estimates never count as focus or completion. */
export function selectCalendarWeeklySummary(state: WorkspaceStateV4, query: CalendarWeeklySummaryQuery) {
  const asOf = Date.parse(query.asOf)
  if (!Number.isFinite(asOf) || !/(Z|[+-]\d{2}:\d{2})$/.test(query.asOf)) throw new Error('Invalid summary instant')
  const range = calendarRange('week', parseZonedDateTime(query.asOf, query.timezone).date, query.weekStartsOn)
  const bounds = schedulingRangeBounds(range, query.timezone)
  const through = Math.min(bounds.end, asOf)
  const overlapSeconds = (start: number, end: number) => Math.max(0, Math.min(end, through) - Math.max(start, bounds.start)) / 1000
  const plans = calendarTaskPlans(state).filter((plan) => {
    if (plan.startAt && plan.estimateMinutes !== null) return Date.parse(plan.startAt) < bounds.end && Date.parse(plan.startAt) + plan.estimateMinutes * 60_000 > bounds.start
    const date = plan.startAt ? parseZonedDateTime(plan.startAt, query.timezone).date : plan.startOn
    return date !== null && date >= range.start && date < range.end
  })
  let plannedMinutes = 0
  for (const plan of plans) {
    if (plan.estimateMinutes === null) continue
    plannedMinutes += plan.startAt ? Math.max(0, Math.min(bounds.end, Date.parse(plan.startAt) + plan.estimateMinutes * 60_000) - Math.max(bounds.start, Date.parse(plan.startAt))) / 60_000 : plan.estimateMinutes
  }
  const recorded = state.taskEvents.filter((event) => Date.parse(event.occurredAt) <= asOf)
  const completedPlans = plans.filter((plan) => {
    const last = recorded.filter((event) => event.taskId === plan.task.id && (event.occurrenceId ?? null) === plan.occurrenceId && ['completed', 'reopened', 'cancelled'].includes(event.type)).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.sequence - a.sequence)[0]
    return last?.type === 'completed'
  })
  let actualFocusSeconds = 0, unallocatedFocusSeconds = 0
  const unallocatedSessionIds: string[] = []
  for (const session of state.studySessions) {
    if (session.deletedAt) continue
    const start = Date.parse(session.startedAt), updated = Date.parse(session.updatedAt)
    if (start > through || updated < bounds.start) continue
    if (session.elapsedSeconds > 0) {
      if (start >= bounds.start && updated <= through) actualFocusSeconds += session.elapsedSeconds
      else { unallocatedFocusSeconds += session.elapsedSeconds; unallocatedSessionIds.push(session.id) }
    }
    if (session.state === 'running' && session.activeSince) actualFocusSeconds += overlapSeconds(Date.parse(session.activeSince), asOf)
  }
  const movements = recorded.filter((event) => event.type === 'rescheduled' && Date.parse(event.occurredAt) >= bounds.start && Date.parse(event.occurredAt) < bounds.end)
  return {
    range, timezone: query.timezone, asOf: query.asOf,
    plannedMinutes, plannedCount: plans.length, unestimatedCount: plans.filter((plan) => plan.estimateMinutes === null).length,
    completedCount: completedPlans.length, completionRate: plans.length ? completedPlans.length / plans.length : null,
    actualFocusSeconds, unallocatedFocusSeconds, unallocatedSessionIds: unallocatedSessionIds.sort(),
    movementCount: movements.length, movementEventIds: movements.map(({ id }) => id).sort(),
    unscheduledReasons: [...(query.unscheduledReasons ?? [])].sort((a, b) => a.taskId.localeCompare(b.taskId)),
  }
}
