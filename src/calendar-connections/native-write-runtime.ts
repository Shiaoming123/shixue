import { canonicalJson, createTaskCapabilityService } from '../domain/capabilities/service.ts'
import { parseCalendarEventTime } from '../domain/workspace/parse.ts'
import { DomainCommandError } from '../domain/capabilities/types.ts'
import type { RuntimeInfo } from '../lib/platform.ts'
import type { WorkspaceStore } from '../storage/workspace/types.ts'
import { normalizeNativeCalendarBatch, type CalendarConnectionConfig, type CalendarInvoke } from './runtime.ts'
import { array, instant, record, string } from './types.ts'
import type { SendUpdates, WriteFields, WriteIntent, WritePreview, WriteResult } from './write-outbox.ts'

export interface NativeWriteState { operationId: string; state: 'prepared' | 'confirmed' | 'applying' | 'applied' | 'conflict' | 'failed'; outcomeUnknown: boolean; result: WriteResult | null }
function invalid(): never { throw new Error('WRITE_RESPONSE_INVALID') }
function updates(value: unknown): SendUpdates { if (value === 'all' || value === 'externalOnly' || value === 'none') return value; return invalid() }
function safeIntent(input: unknown): WriteIntent {
  const value = record(input)
  const ref = (raw: unknown) => { const item = record(raw); return { eventId: string(item.eventId), etag: string(item.etag) } }
  if (value.kind === 'recurring.single') {
    const rawStart = string(value.originalStart), originalStart = /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : instant(rawStart), parent = ref(value.parent), instance = ref(value.instance)
    if (value.action === 'cancel') return { kind: 'recurring.single', parent, instance, originalStart, action: 'cancel' }
    const time = parseCalendarEventTime(record(value.fields).time); if (time.kind !== 'all-day' && time.kind !== 'fixed') invalid()
    return { kind: 'recurring.single', parent, instance, originalStart, action: 'update', fields: { time } }
  }
  if (value.kind === 'recurring.series') {
    const parent = ref(value.parent)
    if (value.action === 'cancel') return { kind: 'recurring.series', parent, action: 'cancel' }
    const raw = record(value.fields), fields: Omit<WriteFields, 'attendees'> = {}
    if (raw.title !== undefined) fields.title = string(raw.title)
    if (raw.time !== undefined) { const time = parseCalendarEventTime(raw.time); if (time.kind === 'floating') invalid(); fields.time = time }
    const recurrence = value.recurrence === undefined ? undefined : array(value.recurrence).map(string)
    return { kind: 'recurring.series', parent, action: 'update', fields, ...(recurrence ? { recurrence } : {}) }
  }
  if (value.kind === 'create' || value.kind === 'update') {
    const raw = record(value.fields), fields: WriteFields = {}
    if (raw.title !== undefined) fields.title = string(raw.title)
    if (raw.time !== undefined) { fields.time = parseCalendarEventTime(raw.time); if (fields.time.kind === 'floating') invalid() }
    if (raw.attendees !== undefined) fields.attendees = array(raw.attendees).map((entry) => { const attendee = record(entry); if (typeof attendee.optional !== 'boolean') invalid(); return { email: string(attendee.email), optional: attendee.optional } })
    return value.kind === 'create' ? { kind: 'create', fields } : { kind: 'update', eventId: string(value.eventId), etag: string(value.etag), fields }
  }
  if (value.kind === 'cancel' || value.kind === 'delete') return { kind: value.kind, eventId: string(value.eventId), etag: string(value.etag) }
  if (value.kind === 'rsvp' && ['accepted', 'declined', 'tentative'].includes(String(value.response))) return { kind: 'rsvp', eventId: string(value.eventId), etag: string(value.etag), selfEmail: string(value.selfEmail), response: value.response as 'accepted' | 'declined' | 'tentative' }
  return invalid()
}
function safeState(raw: unknown, operationId: string, connectionId: string): NativeWriteState {
  const value = record(raw)
  if (value.operationId !== operationId || !['prepared', 'confirmed', 'applying', 'applied', 'conflict', 'failed'].includes(String(value.state)) || typeof value.outcomeUnknown !== 'boolean') invalid()
  let result: WriteResult | null = null
  if (value.result !== null) {
    const item = record(value.result)
    if (item.operationId !== operationId || item.connectionId !== connectionId) invalid()
    result = { operationId, connectionId, calendarId: string(item.calendarId), eventId: string(item.eventId), etag: item.etag === null ? null : string(item.etag) }
  }
  if (value.state === 'applied' ? !result || value.outcomeUnknown : result !== null) invalid()
  return { operationId, state: value.state as NativeWriteState['state'], outcomeUnknown: value.outcomeUnknown, result }
}
const publicErrors = new Set(['WRITE_LOCAL_BASELINE_STALE', 'WRITE_CONFIRM_CANCELLED', 'WRITE_CONFIRM_REQUIRED', 'WRITE_AUTHORITY_MISMATCH', 'WRITE_GRANT_CHANGED', 'WRITE_REAUTHORIZE', 'WRITE_UNAVAILABLE', 'WRITE_INVALID', 'WRITE_UNSUPPORTED', 'WRITE_AUTHORITY_UNAVAILABLE'])
const stale = (error: unknown) => error instanceof Error && error.message === 'WRITE_LOCAL_BASELINE_STALE'

/** Backend seam only. Local native endpoints must exist and authenticate their ledger before this can succeed. */
export function createNativeCalendarWriteRuntime(options: { enabled?: boolean; runtime: RuntimeInfo; config: CalendarConnectionConfig; invoke?: CalendarInvoke }) {
  const config = { clientId: options.config.clientId, connectionId: options.config.connectionId }
  const call = async (operation: string, args: Record<string, unknown>) => {
    if (!options.enabled || options.runtime.platform !== 'desktop') throw new Error('WRITE_UNAVAILABLE')
    try {
      const invoke = options.invoke ?? (await import('@tauri-apps/api/core')).invoke
      return await invoke(`plugin:calendar-connections|${operation}`, { config, ...args })
    } catch (error) { throw new Error(typeof error === 'string' && publicErrors.has(error) ? error : 'WRITE_LOCAL_NATIVE_UNAVAILABLE') }
  }
  const stateCall = async (operation: string, operationId: string) => safeState(await call(operation, { operationId: string(operationId) }), operationId, config.connectionId)
  return {
    async prepare(calendarId: string, intent: WriteIntent, sendUpdates: SendUpdates) {
      const requested = safeIntent(intent), policy = updates(sendUpdates)
      const raw = record(await call('write_prepare', { calendarId: string(calendarId), intent: requested, sendUpdates: policy }))
      const value = record(raw.preview), operationId = string(raw.operationId), hash = string(raw.hash)
      if (!/^sha256:[a-f0-9]{64}$/.test(hash) || value.hash !== hash || value.operationId !== operationId || value.connectionId !== config.connectionId || value.calendarId !== calendarId || updates(value.sendUpdates) !== policy || !Number.isSafeInteger(raw.expiresAt) || Number(raw.expiresAt) <= Date.now()) invalid()
      const responseIntent = safeIntent(value.intent), eventId = string(value.eventId)
      const requestedEventId = requested.kind === 'recurring.single' ? requested.instance.eventId : requested.kind === 'recurring.series' ? requested.parent.eventId : 'eventId' in requested ? requested.eventId : null
      if (canonicalJson(responseIntent) !== canonicalJson(requested) || (requested.kind === 'create' ? !/^[a-v0-9]{5,1024}$/.test(eventId) : eventId !== requestedEventId)) invalid()
      const preview: WritePreview = { operationId, connectionId: config.connectionId, calendarId, eventId, sendUpdates: policy, intent: responseIntent, hash }
      return { operationId, preview, hash, expiresAt: Number(raw.expiresAt) }
    },
    async confirm(operationId: string, hash: string) {
      const result = record(await call('write_confirm', { operationId: string(operationId), hash: string(hash) }))
      if (result.confirmed !== true) invalid()
      return { confirmed: true as const }
    },
    run: (operationId: string) => stateCall('write_run', operationId),
    reconcile: (operationId: string) => stateCall('write_reconcile', operationId),
    lookup: (operationId: string) => stateCall('write_lookup', operationId),
    async disable() { const result = record(await call('write_disable', {})); if (result.enabled !== false) invalid(); return { enabled: false as const } },
    /** Never accepts mirror results or intents; a missing/pruned receipt requires native fresh-read recovery. */
    async applyLocal(operationId: string, store: WorkspaceStore) {
      string(operationId)
      for (let attempt = 0; attempt < 3; attempt++) {
        // Native reuses the binding only while its Workspace proof remains valid.
        let staged: Record<string, unknown>
        try { staged = record(await call('write_stage_local', { operationId })) }
        catch (error) { if (attempt < 2 && stale(error)) continue; throw error }
        if (staged.operationId !== operationId || staged.connectionId !== config.connectionId) throw new Error('WRITE_LOCAL_IDENTITY')
        const batchId = string(staged.batchId), calendarId = string(staged.calendarId)
        const now = new Date().toISOString()
        const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:${crypto.randomUUID()}`, {
          loadExternalBatch: async (requestedId, state) => {
            const raw = record(await call('write_read_local', { operationId, batchId: requestedId }))
            if (raw.operationId !== operationId || raw.batchId !== batchId || requestedId !== batchId) throw new Error('WRITE_LOCAL_IDENTITY')
            const expectedWorkspaceHash = string(raw.expectedWorkspaceHash)
            if (!/^sha256:[a-f0-9]{64}$/.test(expectedWorkspaceHash)) throw new Error('WRITE_LOCAL_IDENTITY')
            const observedAt = instant(raw.observedAt)
            return { ...normalizeNativeCalendarBatch(raw, config.connectionId, calendarId, observedAt, state.calendarEvents), operationId, expectedWorkspaceHash }
          },
        })
        let receiptId: string
        try {
          const result = await service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: batchId, expectedWorkspaceRevision: (await store.load()).revision, command: { type: 'calendar_external.apply', batchId } })
          const data = record(result.data)
          if (data.operationId !== operationId || data.batchId !== batchId) throw new Error('WRITE_LOCAL_IDENTITY')
          receiptId = result.receiptId
        } catch (error) {
          if (attempt < 2 && (stale(error) || error instanceof DomainCommandError && ['WORKSPACE_REVISION_CONFLICT', 'WORKSPACE_SAVE_CONFLICT'].includes(error.code))) continue
          throw error
        }
        try {
          const ack = record(await call('write_ack_local', { operationId, batchId, workspaceReceiptId: receiptId }))
          if (ack.applied !== true || ack.operationId !== operationId || ack.batchId !== batchId) throw new Error('WRITE_LOCAL_IDENTITY')
          return { operationId, batchId, applied: true as const }
        } catch (error) { if (attempt < 2 && stale(error)) continue; throw new Error('WRITE_LOCAL_APPLIED_ACK_PENDING') }
      }
      throw new Error('WRITE_LOCAL_CONFLICT')
    },
  }
}
