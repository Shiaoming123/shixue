import { isCalendarEventOccurrenceStart } from '../calendar/event-occurrences.ts'
import type { CalendarEvent, CalendarEventTime, CalendarSource } from '../calendar/types.ts'
import type { WorkspaceStateV4 } from '../workspace/types.ts'
import { DomainCommandError, type CapabilityCommandContext, type CommandApplication, type EntityRef } from './types.ts'

type SourceFields = Pick<CalendarSource, 'title' | 'color' | 'group' | 'timezone' | 'selected' | 'hidden'>
type EventFields = Pick<CalendarEvent, 'title' | 'notes' | 'location' | 'meetingUrl' | 'organizer' | 'attendees' | 'availability' | 'status' | 'time'> & {
  recurrence: Omit<NonNullable<CalendarEvent['recurrence']>, 'exceptions'> | null
}
export type EventCapabilityCommand =
  | { type: 'calendar_source.create'; sourceId?: string; source: SourceFields }
  | { type: 'calendar_source.update'; sourceId: string; expectedRevision: number; patch: Partial<SourceFields> }
  | { type: 'calendar_source.archive'; sourceId: string; expectedRevision: number }
  | { type: 'event.create'; eventId?: string; sourceId: string; event: EventFields }
  | { type: 'event.update'; eventId: string; expectedRevision: number; scope: 'single' | 'series'; patch: Partial<EventFields> }
  | { type: 'event.exception.set'; eventId: string; expectedRevision: number; originalStart: string; time: CalendarEventTime | null }
  | { type: 'event.exception.reset'; eventId: string; expectedRevision: number; originalStart: string }
  | { type: 'event.delete'; eventId: string; expectedRevision: number; scope: 'single' | 'series' }

export type EventCompensation =
  | { type: 'calendar_source.restore'; source: CalendarSource }
  | { type: 'calendar_source.remove_created'; sourceId: string }
  | { type: 'event.restore'; event: CalendarEvent }
  | { type: 'event.remove_created'; eventId: string }

const SOURCE_FIELDS = ['title', 'color', 'group', 'timezone', 'selected', 'hidden']
const EVENT_FIELDS = ['title', 'notes', 'location', 'meetingUrl', 'organizer', 'attendees', 'availability', 'status', 'time', 'recurrence']

export function applyEventCommand(state: WorkspaceStateV4, command: EventCapabilityCommand, context: CapabilityCommandContext): CommandApplication {
  if (command.type === 'calendar_source.create') {
    assertFields(command.source, SOURCE_FIELDS)
    const source: CalendarSource = { ...structuredClone(command.source), id: command.sourceId ?? context.id('calendar_source'), revision: 1, provider: 'local', permission: 'write', createdAt: context.now, updatedAt: context.now, archivedAt: null }
    state.calendarSources.push(source)
    return result(sourceRef(source), 'create', { type: 'calendar_source.remove_created', sourceId: source.id })
  }
  if (command.type === 'calendar_source.update' || command.type === 'calendar_source.archive') {
    const source = requireWritableSource(state, command.sourceId)
    assertRevision(source, command.expectedRevision)
    const before = structuredClone(source)
    if (command.type === 'calendar_source.update') {
      assertFields(command.patch, SOURCE_FIELDS)
      Object.assign(source, structuredClone(command.patch))
    } else source.archivedAt = context.now
    source.revision++
    source.updatedAt = context.now
    return result(sourceRef(source), 'update', { type: 'calendar_source.restore', source: before })
  }
  if (command.type === 'event.create') {
    requireWritableSource(state, command.sourceId)
    assertFields(command.event, EVENT_FIELDS)
    const event: CalendarEvent = { ...structuredClone(command.event), recurrence: recurrence(command.event.recurrence), id: command.eventId ?? context.id('calendar_event'), sourceId: command.sourceId, revision: 1, createdAt: context.now, updatedAt: context.now, deletedAt: null }
    state.calendarEvents.push(event)
    return result(eventRef(event), 'create', { type: 'event.remove_created', eventId: event.id })
  }
  const event = requireEvent(state, command.eventId)
  requireWritableSource(state, event.sourceId)
  if (event.deletedAt) invalid('Deleted event cannot be changed.')
  assertRevision(event, command.expectedRevision)
  if (command.type === 'event.exception.set' || command.type === 'event.exception.reset') {
    if (!event.recurrence || !isCalendarEventOccurrenceStart(event, command.originalStart)) invalid('Original start must belong to a recurring event.')
    const originalStart = event.time.kind === 'fixed' ? new Date(command.originalStart).toISOString() : command.originalStart
    const before = structuredClone(event)
    if (command.type === 'event.exception.set' && command.time !== null && command.time.kind !== event.time.kind) invalid('Event exception must preserve its time kind.')
    event.recurrence.exceptions = event.recurrence.exceptions.filter((entry) => entry.originalStart !== originalStart)
    if (command.type === 'event.exception.set') event.recurrence.exceptions.push({ originalStart, time: structuredClone(command.time) })
    event.revision++
    event.updatedAt = context.now
    return result(eventRef(event), 'update', { type: 'event.restore', event: before })
  }
  if (!['single', 'series'].includes(command.scope)) invalid('Event scope must be single or series.')
  if ((event.recurrence || (command.type === 'event.update' && command.patch.recurrence)) && command.scope !== 'series') invalid('A recurring event requires series scope and preview confirmation.')
  const before = structuredClone(event)
  if (command.type === 'event.update') {
    assertFields(command.patch, EVENT_FIELDS)
    if (event.recurrence?.exceptions.length && ('time' in command.patch || 'recurrence' in command.patch)) invalid('Changing a series with exceptions requires an explicit exception migration.')
    Object.assign(event, structuredClone(command.patch), 'recurrence' in command.patch ? { recurrence: recurrence(command.patch.recurrence!) } : {})
  } else event.deletedAt = context.now
  event.revision++
  event.updatedAt = context.now
  return result(eventRef(event), command.type === 'event.delete' ? 'delete' : 'update', { type: 'event.restore', event: before })
}

export function applyEventUndo(state: WorkspaceStateV4, compensation: EventCompensation, context: CapabilityCommandContext): EntityRef {
  if (compensation.type === 'calendar_source.restore' || compensation.type === 'calendar_source.remove_created') {
    const id = compensation.type === 'calendar_source.restore' ? compensation.source.id : compensation.sourceId
    const source = requireWritableSource(state, id, true)
    if (compensation.type === 'calendar_source.restore') Object.assign(source, structuredClone(compensation.source), { revision: source.revision + 1, updatedAt: context.now })
    else { source.archivedAt = context.now; source.revision++; source.updatedAt = context.now }
    return sourceRef(source)
  }
  const event = requireEvent(state, compensation.type === 'event.restore' ? compensation.event.id : compensation.eventId)
  requireWritableSource(state, event.sourceId)
  if (compensation.type === 'event.restore') {
    if (event.sourceId !== compensation.event.sourceId) invalid('Event undo cannot change source.')
    Object.assign(event, structuredClone(compensation.event), { revision: event.revision + 1, updatedAt: context.now })
  } else { event.deletedAt = context.now; event.revision++; event.updatedAt = context.now }
  return eventRef(event)
}

function requireWritableSource(state: WorkspaceStateV4, id: string, allowArchived = false): CalendarSource {
  const source = state.calendarSources.find((item) => item.id === id)
  if (!source || source.provider !== 'local' || source.permission !== 'write' || (!allowArchived && source.archivedAt)) invalid('Calendar source must be an active writable local source.')
  return source
}
function requireEvent(state: WorkspaceStateV4, id: string): CalendarEvent {
  const event = state.calendarEvents.find((item) => item.id === id)
  if (!event) invalid('Calendar event does not exist.')
  return event
}
function assertRevision(entity: { revision: number }, expected: number) {
  if (!Number.isInteger(expected) || entity.revision !== expected) throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Calendar entity revision conflict.')
}
function assertFields(value: object, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid('Unsupported calendar mutation field.')
}
function recurrence(value: EventFields['recurrence']): CalendarEvent['recurrence'] {
  if (value === null) return null
  assertFields(value, ['cadence', 'end'])
  return { ...structuredClone(value), exceptions: [] }
}
function eventRef(event: CalendarEvent): EntityRef { return { type: 'calendar_event', id: event.id, revision: event.revision } }
function sourceRef(source: CalendarSource): EntityRef { return { type: 'calendar_source', id: source.id, revision: source.revision } }
function result(entity: EntityRef, operation: 'create' | 'update' | 'delete', compensation: EventCompensation): CommandApplication {
  return { affected: [entity], changes: [{ entity, operation, fields: [entity.type] }], events: [], compensation, data: { id: entity.id } }
}
function invalid(message: string): never { throw new DomainCommandError('VALIDATION_ERROR', message) }
