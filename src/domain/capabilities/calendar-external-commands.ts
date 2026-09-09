import type { CalendarEvent, CalendarSource } from '../calendar/types.ts'
import { validateCalendarEventRecurrence } from '../calendar/event-occurrences.ts'
import type { WorkspaceStateV4 } from '../workspace/types.ts'
import { safeSourceUrl, stableId, type CalendarProvider, type ProviderEvent, type ReadAccess } from '../../calendar-connections/types.ts'
import { DomainCommandError, type CapabilityCommandContext, type CommandApplication, type EntityRef } from './types.ts'

export interface ExternalCalendarBatch {
  batchId: string; provider: CalendarProvider; connectionId: string; calendarId: string; sourceId: string
  mode: 'full' | 'incremental'; access: ReadAccess; title: string; timezone: string
  upserts: ProviderEvent[]; deletedRemoteIds: string[]
  /** Native-owned write completion binding; absent for ordinary read-only sync. */
  operationId?: string
  expectedWorkspaceHash?: string
  writeProjection?: {
    plan: { hash: string; parentEventId: string } & ({ kind: 'recurring.series' } | { kind: 'recurring.single'; instanceEventId: string; originalStart: string })
    expectedWorkspaceHash: string; observedAt: string
  }
}
export type CalendarSourcePreferences = Pick<CalendarSource, 'selected' | 'hidden' | 'color' | 'group'>
export type CalendarExternalCommand =
  | { type: 'calendar_external.apply'; batchId: string }
  | { type: 'calendar_source.preferences'; sourceId: string; expectedRevision: number; patch: Partial<CalendarSourcePreferences> }
export type CalendarPreferencesCompensation = { type: 'calendar_source.preferences.restore'; sourceId: string; preferences: CalendarSourcePreferences }

export function applyExternalCalendarBatch(state: WorkspaceStateV4, batch: ExternalCalendarBatch, context: CapabilityCommandContext): CommandApplication {
  if (batch.writeProjection && (batch.operationId === undefined || batch.writeProjection.expectedWorkspaceHash !== batch.expectedWorkspaceHash || batch.mode !== 'incremental')) invalid('Recurrence projection binding mismatch.')
  if (batch.operationId !== undefined) {
    if (!batch.operationId.trim() || !/^sha256:[a-f0-9]{64}$/.test(batch.expectedWorkspaceHash ?? '')) invalid('Write completion requires a native workspace baseline.')
  } else if (batch.expectedWorkspaceHash !== undefined) invalid('A write completion baseline requires an operation identity.')
  if (!['google', 'feishu'].includes(batch.provider) || !['full', 'incremental'].includes(batch.mode) || !['details', 'freebusy', 'none'].includes(batch.access)) invalid('Invalid external batch metadata.')
  if (batch.sourceId !== stableId(batch.provider, batch.connectionId, batch.calendarId)) invalid('External source identity is not authenticated.')
  if (batch.upserts.length + batch.deletedRemoteIds.length > 50_000 || new TextEncoder().encode(JSON.stringify(batch)).length > 32 * 1024 * 1024) invalid('External batch exceeds limits.')
  let source = state.calendarSources.find(({ id }) => id === batch.sourceId)
  if (source && (source.provider === 'local' || source.provider !== batch.provider)) invalid('External batch cannot replace a local or unrelated source.')
  if (!source) { source = { id: batch.sourceId, revision: 1, provider: batch.provider, title: batch.title, color: '#668575', group: null, permission: 'read', selected: true, hidden: false, timezone: batch.timezone, createdAt: context.now, updatedAt: context.now, archivedAt: null }; state.calendarSources.push(source) }
  else { source.revision++; source.title = batch.title; source.timezone = batch.timezone; source.updatedAt = context.now }
  source.permission = 'read'; source.archivedAt = batch.access === 'none' ? context.now : null
  const incoming = new Set<string>()
  const deleted = new Set(batch.deletedRemoteIds.map((remoteId) => stableId(batch.provider, batch.connectionId, batch.calendarId, remoteId)))
  if (deleted.size !== batch.deletedRemoteIds.length) invalid('Duplicate external tombstone.')
  for (const entry of batch.upserts) {
    const expectedId = stableId(batch.provider, batch.connectionId, batch.calendarId, entry.remoteId)
    if (entry.event.id !== expectedId || entry.event.sourceId !== source.id || incoming.has(expectedId) || deleted.has(expectedId)) invalid('External event identity mismatch or duplicate.')
    incoming.add(expectedId)
    validateCalendarEventRecurrence(entry.event)
    const previous = state.calendarEvents.find(({ id }) => id === expectedId)
    if (previous && previous.sourceId !== source.id) invalid('External batch cannot change an unrelated event.')
    if (batch.access !== 'details') continue
    const event: CalendarEvent = { ...structuredClone(entry.event), sourceUrl: safeSourceUrl(entry.sourceUrl, batch.provider), revision: previous ? previous.revision + 1 : 1, createdAt: previous?.createdAt ?? entry.event.createdAt, deletedAt: null }
    if (previous) state.calendarEvents[state.calendarEvents.indexOf(previous)] = event
    else state.calendarEvents.push(event)
  }
  for (const event of state.calendarEvents) {
    if (event.sourceId !== source.id) continue
    const removed = batch.access !== 'details' || deleted.has(event.id) || (batch.mode === 'full' && !incoming.has(event.id))
    if (!removed) continue
    if (event.deletedAt === null) { event.deletedAt = context.now; event.revision++; event.updatedAt = context.now }
    if (batch.access !== 'details') { event.title = '忙碌'; event.notes = ''; event.location = ''; event.meetingUrl = null; event.sourceUrl = null; event.organizer = null; event.attendees = [] }
  }
  const entity: EntityRef = { type: 'calendar_source', id: source.id, revision: source.revision }
  return { affected: [entity], changes: [{ entity, operation: 'update', fields: ['calendarSources', 'calendarEvents'] }], events: [], compensation: null, data: { batchId: batch.batchId, provider: batch.provider, connectionId: batch.connectionId, calendarId: batch.calendarId, sourceId: batch.sourceId, mode: batch.mode, applied: true, ...(batch.operationId === undefined ? {} : { operationId: batch.operationId, ...(batch.writeProjection ? { writeProjection: structuredClone(batch.writeProjection) } : {}) }) } }
}
export function applyCalendarSourcePreferences(state: WorkspaceStateV4, command: Extract<CalendarExternalCommand, { type: 'calendar_source.preferences' }>, context: CapabilityCommandContext): CommandApplication {
  const source = state.calendarSources.find(({ id }) => id === command.sourceId)
  if (!source) invalid('Calendar source does not exist.')
  if (source.revision !== command.expectedRevision) throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Calendar source revision changed.')
  if (Object.keys(command.patch).some((key) => !['selected', 'hidden', 'color', 'group'].includes(key))) invalid('Only local calendar preferences can change.')
  const preferences = { selected: source.selected, hidden: source.hidden, color: source.color, group: source.group }
  Object.assign(source, structuredClone(command.patch)); source.revision++; source.updatedAt = context.now
  const entity: EntityRef = { type: 'calendar_source', id: source.id, revision: source.revision }
  return { affected: [entity], changes: [{ entity, operation: 'update', fields: Object.keys(command.patch) }], events: [], compensation: { type: 'calendar_source.preferences.restore', sourceId: source.id, preferences }, data: null }
}
export function applyCalendarPreferencesUndo(state: WorkspaceStateV4, compensation: CalendarPreferencesCompensation, context: CapabilityCommandContext): EntityRef {
  const source = state.calendarSources.find(({ id }) => id === compensation.sourceId)
  if (!source) invalid('Calendar source does not exist.')
  Object.assign(source, compensation.preferences); source.revision++; source.updatedAt = context.now
  return { type: 'calendar_source', id: source.id, revision: source.revision }
}
function invalid(message: string): never { throw new DomainCommandError('VALIDATION_ERROR', message) }
