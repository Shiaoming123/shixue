import type { LegacyReminderRule, ReminderDelivery, ReminderRule, Task, TaskOccurrence, WorkspaceStateV4 } from '../workspace/types.ts'
import type { CalendarEvent, CalendarEventTime } from '../calendar/types.ts'
import { expandCalendarEventOccurrences, resolveCalendarEventOccurrence } from '../calendar/event-occurrences.ts'
import { addCalendarDays, OCCURRENCE_HORIZON_DAYS } from '../recurrence/calculate.ts'
import { parseZonedDateTime, zonedDateTimeToInstant } from '../recurrence/timezone.ts'
import { reminderTarget } from './target.ts'

export function deliveryKey(ruleId: string, occurrenceId: string | null, scheduledFor: string, originalStart?: string | null): string {
  return JSON.stringify([ruleId, occurrenceId ?? originalStart ?? null, new Date(scheduledFor).toISOString()])
}

export function resolveReminderInstant(rule: ReminderRule | LegacyReminderRule, task: Task, occurrence: TaskOccurrence | null): string | null {
  const target = reminderTarget(rule)
  if (target.kind !== 'task' || !rule.enabled || task.deletedAt || task.status === 'completed' || task.status === 'cancelled') return null
  if (occurrence && occurrence.status !== 'pending') return null
  if (target.occurrenceId !== null && target.occurrenceId !== occurrence?.id) return null
  const trigger = rule.trigger
  const anchor = trigger.kind === 'absolute' ? trigger.at
    : trigger.kind === 'before_due' ? (occurrence ? null : task.deadline.dueAt)
      : occurrence ? (occurrence.override?.scheduledOn ? null : occurrence.override?.scheduledAt ?? occurrence.scheduledAt) : task.schedule.startAt
  if (!anchor) return null
  const offset = trigger.kind === 'before_start' || trigger.kind === 'before_due' ? trigger.minutes * 60_000 : 0
  return new Date(Date.parse(anchor) - offset).toISOString()
}

function eventReminderInstant(rule: ReminderRule, event: CalendarEvent, time: CalendarEventTime, timezone: string): string | null {
  if (!rule.enabled || event.deletedAt !== null || event.status === 'cancelled' || rule.trigger.kind === 'before_due') return null
  if (rule.trigger.kind === 'absolute') return new Date(rule.trigger.at).toISOString()
  const anchor = time.kind === 'fixed' ? new Date(time.startAt)
    : time.kind === 'all-day' ? zonedDateTimeToInstant(time.startOn, '00:00', timezone)
      : zonedDateTimeToInstant(time.startLocal.slice(0, 10), time.startLocal.slice(11), timezone)
  return new Date(anchor.getTime() - (rule.trigger.kind === 'before_start' ? rule.trigger.minutes * 60_000 : 0)).toISOString()
}

export function resolveReminderDeliveryInstant(state: WorkspaceStateV4, rule: ReminderRule, delivery: Pick<ReminderDelivery, 'occurrenceId' | 'originalStart'>): string | null {
  const target = reminderTarget(rule)
  if (target.kind === 'task') {
    const task = state.tasks.find(({ id }) => id === target.taskId)
    const occurrence = delivery.occurrenceId ? state.occurrences.find(({ id }) => id === delivery.occurrenceId) : null
    return task && (delivery.occurrenceId === null || occurrence) ? resolveReminderInstant(rule, task, occurrence ?? null) : null
  }
  const event = state.calendarEvents.find(({ id }) => id === target.eventId)
  const source = event && state.calendarSources.find(({ id }) => id === event.sourceId)
  if (!event || !source || source.archivedAt !== null || delivery.occurrenceId !== null) return null
  if (target.originalStart !== null && target.originalStart !== delivery.originalStart) return null
  if (delivery.originalStart) {
    const occurrence = resolveCalendarEventOccurrence(event, delivery.originalStart)
    return occurrence ? eventReminderInstant(rule, event, occurrence.time, source.timezone) : null
  }
  if (event.recurrence && rule.trigger.kind !== 'absolute') return null
  return eventReminderInstant(rule, event, event.time, source.timezone)
}

export function reconcileReminderDeliveries(state: WorkspaceStateV4, createPending = true, now = state.updatedAt): void {
  const desired = new Map<string, { ruleId: string; occurrenceId: string | null; originalStart?: string | null; at: string }>()
  const add = (rule: ReminderRule, occurrenceId: string | null, originalStart?: string | null) => {
    const at = resolveReminderDeliveryInstant(state, rule, { occurrenceId, originalStart })
    if (at) desired.set(deliveryKey(rule.id, occurrenceId, at, originalStart), { ruleId: rule.id, occurrenceId, ...(originalStart === undefined ? {} : { originalStart }), at })
  }
  for (const rule of state.reminderRules) {
    const target = reminderTarget(rule)
    if (target.kind === 'task') {
      const task = state.tasks.find(({ id }) => id === target.taskId)
      if (!task) continue
      const occurrences = target.occurrenceId !== null ? state.occurrences.filter(({ id }) => id === target.occurrenceId)
        : task.recurrenceSeriesId && rule.trigger.kind !== 'absolute' ? state.occurrences.filter(({ seriesId }) => seriesId === task.recurrenceSeriesId) : [null]
      for (const occurrence of occurrences) add(rule, occurrence?.id ?? null)
    } else {
      const event = state.calendarEvents.find(({ id }) => id === target.eventId)
      const source = event && state.calendarSources.find(({ id }) => id === event.sourceId)
      if (!event || !source) continue
      if (target.originalStart !== null || !event.recurrence || rule.trigger.kind === 'absolute') add(rule, null, target.originalStart)
      else {
        const today = parseZonedDateTime(now, source.timezone).date
        const leadDays = rule.trigger.kind === 'before_start' ? Math.ceil(rule.trigger.minutes / 1440) : 0
        // ponytail: reuse the 90-day task horizon; persisted deliveries are revalidated below regardless of age.
        const range = { start: addCalendarDays(today, -OCCURRENCE_HORIZON_DAYS), end: addCalendarDays(today, OCCURRENCE_HORIZON_DAYS + leadDays + 1) }
        for (const occurrence of expandCalendarEventOccurrences(event, range, source.timezone)) add(rule, null, occurrence.originalStart)
      }
    }
  }
  for (const delivery of state.reminderDeliveries) {
    const rule = state.reminderRules.find(({ id }) => id === delivery.reminderRuleId)
    if (rule && reminderTarget(rule).kind === 'event') add(rule, null, delivery.originalStart ?? null)
  }
  for (const delivery of state.reminderDeliveries) {
    const key = deliveryKey(delivery.reminderRuleId, delivery.occurrenceId, delivery.scheduledFor, delivery.originalStart)
    if (!desired.has(key) && (delivery.status === 'pending' || delivery.status === 'snoozed')) {
      delivery.status = 'cancelled'
      delivery.revision = (delivery.revision ?? 1) + 1
    } else if (desired.has(key) && delivery.status === 'cancelled') {
      delivery.status = delivery.snoozedUntil ? 'snoozed' : 'pending'
      delivery.revision = (delivery.revision ?? 1) + 1
    }
    desired.delete(key)
  }
  if (createPending) for (const [key, entry] of desired) state.reminderDeliveries.push({
    id: `delivery:${key}`, reminderRuleId: entry.ruleId, occurrenceId: entry.occurrenceId,
    ...(entry.originalStart === undefined ? {} : { originalStart: entry.originalStart }),
    scheduledFor: entry.at, status: 'pending', snoozedUntil: null, action: null,
  })
}
