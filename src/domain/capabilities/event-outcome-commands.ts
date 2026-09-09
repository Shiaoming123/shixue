import type { CalendarEvent, CalendarEventLink, EventOutcome } from '../calendar/types.ts'
import { resolveCalendarEventOccurrence } from '../calendar/event-occurrences.ts'
import { zonedDateTimeToInstant } from '../recurrence/timezone.ts'
import type { WorkspaceStateV4 } from '../workspace/types.ts'
import { applyTaskCommand } from './task-commands.ts'
import { DomainCommandError, type CapabilityCommandContext, type CommandApplication, type EntityRef } from './types.ts'

export type EventOutcomeCommand =
  | ({ type: 'event.outcome.create'; eventId: string; originalStart: string | null; expectedEventRevision: number } & (
    | { action: 'followup'; title: string; listId: string; note?: string }
    | { action: 'note'; note: string }
    | { action: 'dismiss' }))
  | { type: 'event.link' | 'event.unlink'; eventId: string; taskId: string }
export type EventOutcomeCompensation =
  | { type: 'event.outcome.remove_created'; outcomeId: string; linkId: string | null; taskId: string | null; taskRevision: number | null }
  | { type: 'event.link.remove_created'; linkId: string }
  | { type: 'event.link.restore'; link: CalendarEventLink }

export function applyEventOutcomeCommand(state: WorkspaceStateV4, command: EventOutcomeCommand, context: CapabilityCommandContext): CommandApplication {
  const event = state.calendarEvents.find(({ id }) => id === command.eventId)
  if (!event) invalid('Event does not exist.')
  if (command.type !== 'event.outcome.create') {
    const task = state.tasks.find(({ id }) => id === command.taskId)
    if (!task) invalid('Linked task does not exist.')
    const link = state.calendarEventLinks.find((link) => link.eventId === event.id && link.taskId === task.id)
    if (command.type === 'event.unlink') {
      if (!link) return result(event.id, null, null)
      state.calendarEventLinks = state.calendarEventLinks.filter(({ id }) => id !== link.id)
      return result(event.id, { type: 'event.link.restore', link: structuredClone(link) }, link)
    }
    if (link) return result(event.id, null, link)
    if (event.deletedAt || task.deletedAt) invalid('Cannot link deleted facts.')
    const created = { id: context.id('event_link'), eventId: event.id, taskId: task.id }
    state.calendarEventLinks.push(created)
    return result(event.id, { type: 'event.link.remove_created', linkId: created.id }, created)
  }
  if (event.revision !== command.expectedEventRevision) throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Event revision changed.')
  if (!['followup', 'note', 'dismiss'].includes(command.action)) invalid('Invalid event outcome action.')
  if (Boolean(event.recurrence) !== (command.originalStart !== null)) invalid('Recurring outcomes require an original occurrence start; standalone outcomes use null.')
  const originalStart = command.originalStart === null ? null : event.time.kind === 'fixed' ? new Date(command.originalStart).toISOString() : command.originalStart
  const existing = state.eventOutcomes.find((outcome) => outcome.eventId === event.id && outcome.occurrenceId === originalStart && outcome.action === command.action)
  if (existing) return result(event.id, null, existing)
  const source = state.calendarSources.find(({ id }) => id === event.sourceId)
  if (!source || source.archivedAt || event.deletedAt || event.status === 'cancelled') invalid('Event is not available for a new outcome.')
  const end = getEventOutcomeEnd(event, originalStart, source.timezone)
  if (end === null) invalid('Event occurrence does not exist or was cancelled.')
  if (Date.parse(context.now) < Date.parse(end)) invalid('Event has not ended.')
  let taskApplication: CommandApplication | null = null
  let taskId: string | null = null
  let linkId: string | null = null
  if (command.action === 'followup') {
    taskId = context.id('task')
    taskApplication = applyTaskCommand(state, { type: 'task.create', taskId, mode: 'general', title: command.title, listId: command.listId, notes: command.note ?? '' }, context)
    linkId = context.id('event_link')
    state.calendarEventLinks.push({ id: linkId, eventId: event.id, taskId })
  }
  const outcome: EventOutcome = { id: context.id('event_outcome'), eventId: event.id, occurrenceId: originalStart, action: command.action, taskId, note: command.action === 'dismiss' ? '' : command.note ?? '', createdAt: context.now }
  state.eventOutcomes.push(outcome)
  const application = result(event.id, { type: 'event.outcome.remove_created', outcomeId: outcome.id, linkId, taskId, taskRevision: taskId ? 1 : null }, outcome)
  if (taskApplication) { application.affected.push(...taskApplication.affected); application.changes.push(...taskApplication.changes); application.events.push(...taskApplication.events) }
  return application
}

export function applyEventOutcomeUndo(state: WorkspaceStateV4, compensation: EventOutcomeCompensation, context: CapabilityCommandContext): CommandApplication {
  if (compensation.type === 'event.link.restore') {
    const link = compensation.link
    if (!state.calendarEventLinks.some((item) => item.eventId === link.eventId && item.taskId === link.taskId)) state.calendarEventLinks.push(structuredClone(link))
    return result(link.eventId, null, link)
  }
  if (compensation.type === 'event.link.remove_created') {
    const link = state.calendarEventLinks.find(({ id }) => id === compensation.linkId)
    state.calendarEventLinks = state.calendarEventLinks.filter(({ id }) => id !== compensation.linkId)
    return result(link?.eventId ?? 'missing', null, null)
  }
  const outcome = state.eventOutcomes.find(({ id }) => id === compensation.outcomeId)
  if (!outcome) invalid('Outcome no longer exists.')
  let taskApplication: CommandApplication | null = null
  if (compensation.taskId) {
    const task = state.tasks.find(({ id }) => id === compensation.taskId)
    if (!task || task.revision !== compensation.taskRevision || task.deletedAt) throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Followup task changed; undo cannot delete it.')
    taskApplication = applyTaskCommand(state, { type: 'task.delete', taskId: task.id, expectedRevision: task.revision }, context)
  }
  state.eventOutcomes = state.eventOutcomes.filter(({ id }) => id !== compensation.outcomeId)
  state.calendarEventLinks = state.calendarEventLinks.filter(({ id }) => id !== compensation.linkId)
  const application = result(outcome.eventId, null, null)
  if (taskApplication) { application.affected.push(...taskApplication.affected); application.changes.push(...taskApplication.changes); application.events.push(...taskApplication.events) }
  return application
}
function result(eventId: string, compensation: EventOutcomeCompensation | null, data: EventOutcome | CalendarEventLink | null): CommandApplication {
  const entity: EntityRef = { type: 'calendar_event', id: eventId }
  return { affected: [entity], changes: [{ entity, operation: 'update', fields: ['eventOutcomes', 'calendarEventLinks'] }], events: [], compensation, data: data === null ? null : JSON.parse(JSON.stringify(data)) }
}
function invalid(message: string): never { throw new DomainCommandError('VALIDATION_ERROR', message) }

/** Shared display anchor; commands independently enforce revision and completion time. */
export function getEventOutcomeEnd(event: CalendarEvent, originalStart: string | null, sourceTimezone: string): string | null {
  if (event.deletedAt || event.status === 'cancelled' || Boolean(event.recurrence) !== (originalStart !== null)) return null
  const occurrence = originalStart === null ? null : resolveCalendarEventOccurrence(event, originalStart)
  if (originalStart !== null && !occurrence) return null
  const time = occurrence?.time ?? event.time
  const end = time.kind === 'fixed' ? new Date(time.endAt) : time.kind === 'all-day'
    ? zonedDateTimeToInstant(time.endOnExclusive, '00:00', sourceTimezone)
    : zonedDateTimeToInstant(time.endLocal.slice(0, 10), time.endLocal.slice(11), sourceTimezone)
  return end.toISOString()
}
