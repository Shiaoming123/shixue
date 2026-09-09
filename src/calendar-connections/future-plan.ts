import { normalizeGoogleBatch } from './google-recurrence.ts'
import { normalizeGoogleEvent } from './google.ts'
import { expandCalendarEventOccurrences } from '../domain/calendar/event-occurrences.ts'
import { addCalendarDays } from '../domain/recurrence/calculate.ts'
import { record, string } from './types.ts'
import { recurrenceRules, writePreviewHash, type RecurringRef, type WritePreview } from './write-outbox.ts'

export interface FutureSnapshot {
  parent: Record<string, unknown>; pivot: Record<string, unknown>; exceptions: Record<string, unknown>[]
  /** Authoritative full remote exception enumeration and local attachment scan; never supplied by the intent. */
  complete: boolean; attachedFacts: string[]; workspaceHash: string
}
export interface FutureStep { eventId: string; etag: string | null; body: Record<string, unknown> }
export interface FuturePlan {
  version: 1; workspaceHash: string; originalParent: Record<string, unknown>; pivot: RecurringRef
  originalStart: string; exceptions: Record<string, unknown>[]; markerHash: string
  parent: FutureStep; successor: FutureStep; compensation: FutureStep
}
export interface FutureStepState { state: 'pending' | 'applying' | 'unknown' | 'proved' | 'rejected' | 'conflict'; outcomeUnknown?: boolean; etag?: string; proof?: Record<string, unknown> }
export type FutureStepResponse = { kind: 'proved'; proof: Record<string, unknown> } | { kind: 'unknown' | 'rejected' | 'conflict' }
export interface FutureState { parent: FutureStepState; successor: FutureStepState; compensation: FutureStepState }
function unsupported(): never { throw new Error('WRITE_UNSUPPORTED') }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Fake-only prepare contract. Exceptions and attached facts require migration and are rejected. */
export async function prepareFuturePlan(base: Omit<WritePreview, 'hash'>, snapshot: FutureSnapshot): Promise<FuturePlan> {
  try {
    const intent = base.intent
    if (intent.kind !== 'recurring.future' || intent.plan || !snapshot.complete || snapshot.attachedFacts.length || snapshot.exceptions.length) unsupported()
    const parent = record(snapshot.parent), pivot = record(snapshot.pivot)
    if (Object.keys(intent).some((key) => !['kind', 'parent', 'originalStart', 'fields'].includes(key)) || Object.keys(intent.fields).some((key) => key !== 'title')) unsupported()
    const title = string(intent.fields.title)
    // Reject provider facts we cannot copy losslessly into a new series.
    if (Object.keys(parent).some((key) => !['id', 'etag', 'summary', 'start', 'end', 'recurrence', 'extendedProperties', 'eventType', 'status', 'created', 'updated', 'kind', 'htmlLink', 'iCalUID', 'sequence'].includes(key)) || parent.eventType !== undefined && parent.eventType !== 'default' || parent.status === 'cancelled') unsupported()
    if (parent.id !== intent.parent.eventId || parent.etag !== intent.parent.etag || /[\r\n]/.test(string(parent.etag)) || pivot.recurringEventId !== parent.id || pivot.id === parent.id || pivot.status === 'cancelled') unsupported()
    if (Object.keys(pivot).some((key) => !['id', 'etag', 'summary', 'start', 'end', 'recurringEventId', 'originalStartTime', 'status', 'created', 'updated', 'kind', 'htmlLink', 'iCalUID', 'sequence'].includes(key)) || pivot.summary !== undefined && pivot.summary !== parent.summary || /[\r\n]/.test(string(pivot.etag))) unsupported()
    for (const value of [parent.start, parent.end]) if (Object.keys(record(value)).some((key) => !['date', 'dateTime', 'timeZone'].includes(key))) unsupported()
    const original = record(pivot.originalStartTime), start = string(original.date ?? original.dateTime)
    if (start !== intent.originalStart) unsupported()
    const rules = recurrenceRules(parent.recurrence)
    const request = { connectionId: base.connectionId, calendarId: base.calendarId, timezone: 'UTC', now: '2026-01-01T00:00:00.000Z', cursor: null }
    const event = normalizeGoogleBatch([parent], request, [], 'full').upserts[0]!.event
    const { recurringEventId: _parent, originalStartTime: _original, ...plainPivot } = pivot
    if (normalizeGoogleEvent(plainPivot, request).event.status !== event.status) unsupported()
    const anchor = event.time.kind === 'all-day' ? event.time.startOn : event.time.kind === 'fixed' ? event.time.startAt.slice(0, 10) : unsupported()
    const occurrences = expandCalendarEventOccurrences(event, { start: addCalendarDays(anchor, -1), end: addCalendarDays(start.slice(0, 10), 2) }, 'UTC')
    const index = occurrences.findIndex((item) => item.originalStart === start)
    if (index < 1) unsupported()
    const occurrence = occurrences[index]!, time = occurrence.time
    const times = time.kind === 'all-day' ? { start: { date: time.startOn }, end: { date: time.endOnExclusive } } : time.kind === 'fixed' ? { start: { dateTime: time.startAt, timeZone: time.timezone }, end: { dateTime: time.endAt, timeZone: time.timezone } } : unsupported()
    if (!same(pivot.start, times.start) || !same(pivot.end, times.end)) unsupported()
    const parts = rules[0]!.slice(6).split(';'), cadence = parts.filter((part) => !part.startsWith('COUNT=') && !part.startsWith('UNTIL='))
    const count = parts.find((part) => part.startsWith('COUNT='))
    const successorRules = count ? [`RRULE:${[...cadence, `COUNT=${Number(count.slice(6)) - index}`].join(';')}`] : rules
    const parentRules = [`RRULE:${[...cadence, `COUNT=${index}`].join(';')}`]
    // markerHash binds the pre-marker root; the final preview hash also binds every frozen body.
    const markerHash = await writePreviewHash({ ...base, intent, eventId: string(parent.id) })
    const properties = record(parent.extendedProperties ?? {}), privateProperties = record(properties.private ?? {})
    const marker = { extendedProperties: { private: { ...privateProperties, meowOperationId: base.operationId, meowOperationHash: markerHash } } }
    const successorId = `m${base.operationId.replace(/-/g, '')}`
    if ([parent.id, pivot.id].includes(successorId)) unsupported()
    return { version: 1, workspaceHash: string(snapshot.workspaceHash), originalParent: structuredClone(parent), pivot: { eventId: string(pivot.id), etag: string(pivot.etag) }, originalStart: start, exceptions: [], markerHash,
      parent: { eventId: string(parent.id), etag: string(parent.etag), body: { recurrence: parentRules, ...marker } },
      successor: { eventId: successorId, etag: null, body: { id: successorId, summary: title, ...(parent.status === undefined ? {} : { status: parent.status }), ...times, recurrence: successorRules, ...marker } },
      compensation: { eventId: string(parent.id), etag: null, body: { recurrence: rules, ...marker } },
    }
  } catch { return unsupported() }
}
