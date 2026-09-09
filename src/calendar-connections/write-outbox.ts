import type { CalendarEventTime } from '../domain/calendar/types.ts'
import { parseCalendarEventTime } from '../domain/workspace/parse.ts'
import { record, string } from './types.ts'

export type SendUpdates = 'all' | 'externalOnly' | 'none'
export interface WriteFields { title?: string; time?: CalendarEventTime; attendees?: Array<{ email: string; optional: boolean }> }
export interface RecurringRef { eventId: string; etag: string }
export type WriteIntent =
  | { kind: 'create'; fields: WriteFields }
  | { kind: 'update'; eventId: string; etag: string; fields: WriteFields }
  | { kind: 'cancel' | 'delete'; eventId: string; etag: string }
  | { kind: 'rsvp'; eventId: string; etag: string; selfEmail: string; response: 'accepted' | 'declined' | 'tentative' }
  | { kind: 'recurring.single'; parent: RecurringRef; originalStart: string; instance: RecurringRef; action: 'update'; fields: Pick<WriteFields, 'time'> }
  | { kind: 'recurring.single'; parent: RecurringRef; originalStart: string; instance: RecurringRef; action: 'cancel' }
  | { kind: 'recurring.series'; parent: RecurringRef; action: 'update'; fields: Omit<WriteFields, 'attendees'>; recurrence?: string[] }
  | { kind: 'recurring.series'; parent: RecurringRef; action: 'cancel' }
  | { kind: 'recurring.future' }
export interface WritePreview { operationId: string; connectionId: string; calendarId: string; eventId: string; lockKeys: string[]; sendUpdates: SendUpdates; intent: WriteIntent; hash: string }
export interface WriteOperation { preview: WritePreview; version: number; state: 'pending' | 'applying' | 'applied' | 'conflict' | 'failed'; outcomeUnknown: boolean; attempts: number; leaseId: string | null; leaseUntil: number; error: string | null; result: WriteResult | null; localApplied: boolean }
export interface WriteResult { connectionId: string; calendarId: string; eventId: string; etag: string | null; operationId: string }
export interface WriteOutboxStore {
  insert(operation: WriteOperation): Promise<boolean>
  get(id: string): Promise<WriteOperation | null>
  list(): Promise<WriteOperation[]>
  /** Atomic CAS; set applying/outcomeUnknown, increment version/attempts, assign lease. Reject active leases and any OTHER applying or outcomeUnknown operation for the same connection/calendar/event, even after its lease expires. */
  claim(id: string, version: number, leaseId: string, now: number, leaseUntil: number, lockKeys: string[]): Promise<WriteOperation | null>
  /** Atomic compare-and-swap; next.version must equal expectedVersion + 1. */
  cas(id: string, expectedVersion: number, next: WriteOperation): Promise<boolean>
}
export interface WriteSession { connected: boolean; generation: number; canWrite: boolean }
export interface RemoteWriteIdentity { connectionId: string; calendarId: string; eventId: string; etag: string | null; canWrite: boolean; selfEmail: string | null }
export type WriteResponse = { kind: 'applied'; result: WriteResult } | { kind: 'conflict' } | { kind: 'rejected'; code: 'permission' | 'quota' | 'invalid' } | { kind: 'unknown' }
export interface CalendarWriter {
  mode: 'fake' | 'native'
  session(connectionId: string): WriteSession
  inspect(preview: WritePreview): Promise<RemoteWriteIdentity>
  /** Implementations must send the immutable event ID, sendUpdates and If-Match from preview. */
  execute(preview: WritePreview): Promise<WriteResponse>
  /** Read-only proof of this exact operation; matching content alone is not proof of authorship. */
  reconcile(preview: WritePreview): Promise<WriteResponse>
}
function fail(code: string): never { throw new Error(code) }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(record(value)[key])}`).join(',')}}`; return JSON.stringify(value) }
export async function writePreviewHash(value: Omit<WritePreview, 'hash'>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
function keys(value: object, allowed: string[]) { if (Object.keys(value).some((key) => !allowed.includes(key))) fail('WRITE_INVALID') }
function fields(raw: WriteFields, create: boolean): WriteFields {
  keys(record(raw), ['title', 'time', 'attendees']); const result: WriteFields = {}
  if (raw.title !== undefined) result.title = string(raw.title)
  if (raw.time !== undefined) { result.time = parseCalendarEventTime(raw.time); if (result.time.kind === 'floating') fail('WRITE_UNSUPPORTED') }
  if (raw.attendees !== undefined) {
    if (!Array.isArray(raw.attendees) || raw.attendees.length > 200) fail('WRITE_INVALID')
    result.attendees = raw.attendees.map((item) => { keys(record(item), ['email', 'optional']); const email = string(item.email); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof item.optional !== 'boolean') fail('WRITE_INVALID'); return { email, optional: item.optional } }).sort((a, b) => a.email.localeCompare(b.email))
    if (new Set(result.attendees.map((item) => item.email.toLowerCase())).size !== result.attendees.length) fail('WRITE_INVALID')
  }
  if ((create && (!result.title || !result.time)) || Object.keys(result).length === 0) fail('WRITE_INVALID')
  return result
}

/** Credential-independent core. Native execution is deliberately unavailable until separately implemented. */
export class CalendarWriteOutbox {
  enabled = false
  private readonly previews = new Map<string, WritePreview>()
  private readonly store: WriteOutboxStore
  private readonly writer: CalendarWriter
  private readonly applyLocal: (operation: WriteOperation) => Promise<void>
  private readonly now: () => number
  /** applyLocal must atomically deduplicate operationId with its Workspace CAS receipt; calls may overlap or repeat after crashes. */
  constructor(store: WriteOutboxStore, writer: CalendarWriter, applyLocal: (operation: WriteOperation) => Promise<void>, now = Date.now) { this.store = store; this.writer = writer; this.applyLocal = applyLocal; this.now = now }
  async prepare(connectionId: string, calendarId: string, intent: WriteIntent, sendUpdates: SendUpdates): Promise<WritePreview> {
    string(connectionId); string(calendarId)
    if (!['all', 'externalOnly', 'none'].includes(sendUpdates)) fail('WRITE_INVALID')
    const operationId = crypto.randomUUID(); let normalized: WriteIntent
    if (intent.kind === 'recurring.future') fail('WRITE_UNSUPPORTED')
    if (intent.kind === 'create') { keys(intent, ['kind', 'fields']); normalized = { kind: 'create', fields: fields(intent.fields, true) } }
    else {
      if (intent.kind === 'recurring.single') {
        keys(intent, intent.action === 'update' ? ['kind', 'parent', 'originalStart', 'instance', 'action', 'fields'] : ['kind', 'parent', 'originalStart', 'instance', 'action'])
        const parent = recurringRef(intent.parent), instance = recurringRef(intent.instance)
        const originalStart = string(intent.originalStart)
        if (!Number.isFinite(Date.parse(originalStart))) fail('WRITE_INVALID')
        if (intent.action === 'update') {
          const update = fields(intent.fields, false)
          if (!update.time || update.title !== undefined || update.attendees !== undefined) fail('WRITE_INVALID')
          normalized = { kind: 'recurring.single', parent, originalStart: new Date(originalStart).toISOString(), instance, action: 'update', fields: { time: update.time } }
        } else if (intent.action === 'cancel') normalized = { kind: 'recurring.single', parent, originalStart: new Date(originalStart).toISOString(), instance, action: 'cancel' }
        else fail('WRITE_INVALID')
      } else if (intent.kind === 'recurring.series') {
        keys(intent, intent.action === 'update' ? ['kind', 'parent', 'action', 'fields', 'recurrence'] : ['kind', 'parent', 'action'])
        const parent = recurringRef(intent.parent)
        if (intent.action === 'update') {
          const update = fields(intent.fields, false)
          if (update.attendees !== undefined || (Object.keys(update).length === 0 && intent.recurrence === undefined)) fail('WRITE_INVALID')
          const recurrence = intent.recurrence === undefined ? undefined : recurrenceRules(intent.recurrence)
          normalized = { kind: 'recurring.series', parent, action: 'update', fields: update, ...(recurrence ? { recurrence } : {}) }
        } else if (intent.action === 'cancel') normalized = { kind: 'recurring.series', parent, action: 'cancel' }
        else fail('WRITE_INVALID')
      } else {
      const eventId = string(intent.eventId); const etag = string(intent.etag)
      if (intent.kind === 'update') { keys(intent, ['kind', 'eventId', 'etag', 'fields']); normalized = { kind: 'update', eventId, etag, fields: fields(intent.fields, false) } }
      else if (intent.kind === 'cancel' || intent.kind === 'delete') { keys(intent, ['kind', 'eventId', 'etag']); normalized = { kind: intent.kind, eventId, etag } }
      else if (intent.kind === 'rsvp') { keys(intent, ['kind', 'eventId', 'etag', 'selfEmail', 'response']); if (!['accepted', 'declined', 'tentative'].includes(intent.response)) fail('WRITE_INVALID'); normalized = { kind: 'rsvp', eventId, etag, selfEmail: string(intent.selfEmail), response: intent.response } }
      else fail('WRITE_UNSUPPORTED')
      }
    }
    const eventId = normalized.kind === 'create' ? `m${operationId.replace(/-/g, '')}` : normalized.kind === 'recurring.single' ? normalized.instance.eventId : normalized.kind === 'recurring.series' ? normalized.parent.eventId : normalized.eventId
    const lockKeys = normalized.kind === 'recurring.single' ? [normalized.parent.eventId, normalized.instance.eventId].sort() : normalized.kind === 'recurring.series' ? [normalized.parent.eventId] : [eventId]
    const value = { operationId, connectionId, calendarId, eventId, lockKeys, sendUpdates, intent: normalized }
    const preview = { ...value, hash: await writePreviewHash(value) }
    this.previews.set(operationId, structuredClone(preview)); return structuredClone(preview)
  }
  async enqueue(operationId: string, hash: string, confirmed: true): Promise<WriteOperation> {
    const preview = this.previews.get(operationId)
    if (!preview || preview.hash !== hash || confirmed !== true) fail('PREVIEW_NOT_CONFIRMED')
    const operation: WriteOperation = { preview: structuredClone(preview), version: 1, state: 'pending', outcomeUnknown: false, attempts: 0, leaseId: null, leaseUntil: 0, error: null, result: null, localApplied: false }
    if (await this.store.insert(operation)) return operation
    const old = await this.required(operationId); if (old.preview.hash !== hash) fail('OPERATION_COLLISION'); return old
  }
  list() { return this.store.list() }
  private async required(id: string) { return await this.store.get(id) ?? fail('OPERATION_NOT_FOUND') }
  private active(preview: WritePreview, generation?: number) {
    const session = this.writer.session(preview.connectionId)
    if (!this.enabled || this.writer.mode !== 'fake') fail('WRITE_UNAVAILABLE')
    if (!session.connected || !session.canWrite || (generation !== undefined && session.generation !== generation)) fail('WRITE_DISCONNECTED')
    return session.generation
  }
  async run(id: string): Promise<WriteOperation> { return this.process(id, false) }
  async reconcile(id: string): Promise<WriteOperation> { return this.process(id, true) }
  private async process(id: string, reconcile: boolean): Promise<WriteOperation> {
    let operation = await this.required(id)
    if (operation.state === 'applied') return this.finishLocal(operation)
    if (operation.state === 'conflict') return operation
    if (!reconcile && (operation.outcomeUnknown || operation.state !== 'pending')) fail('RECONCILE_REQUIRED')
    if (reconcile && !operation.outcomeUnknown && operation.state !== 'applying') fail('RECONCILE_NOT_REQUIRED')
    const epoch = this.active(operation.preview)
    const leaseId = crypto.randomUUID(); const now = this.now()
    operation = await this.store.claim(id, operation.version, leaseId, now, now + 30_000, operation.preview.lockKeys) ?? fail('WRITE_BUSY')
    let response: WriteResponse; let sent = false
    try {
      if (reconcile) { this.active(operation.preview, epoch); response = await this.writer.reconcile(structuredClone(operation.preview)) }
      else {
        this.active(operation.preview, epoch)
        const remote = await this.writer.inspect(structuredClone(operation.preview)); this.active(operation.preview, epoch)
        const preview = operation.preview; const intent = preview.intent
        if (remote.connectionId !== preview.connectionId || remote.calendarId !== preview.calendarId || remote.eventId !== preview.eventId || !remote.canWrite) fail('WRITE_IDENTITY')
        const expectedEtag = intent.kind === 'recurring.single' ? intent.instance.etag : intent.kind === 'recurring.series' ? intent.parent.etag : 'etag' in intent ? intent.etag : null
        if (intent.kind === 'create' ? remote.etag !== null : remote.etag !== expectedEtag) response = { kind: 'conflict' }
        else if (intent.kind === 'rsvp' && remote.selfEmail !== intent.selfEmail) response = { kind: 'rejected', code: 'permission' }
        else { sent = true; response = await this.writer.execute(structuredClone(preview)) }
      }
      this.active(operation.preview, epoch)
    } catch { response = sent || reconcile ? { kind: 'unknown' } : { kind: 'rejected', code: 'permission' } }
    // A failed/conflicting read does not establish whether the original write took effect.
    if (reconcile && response.kind !== 'applied') response = { kind: 'unknown' }
    if (response.kind === 'applied') {
      const result = response.result; const preview = operation.preview
      if (result.operationId !== id || result.connectionId !== preview.connectionId || result.calendarId !== preview.calendarId || result.eventId !== preview.eventId || (preview.intent.kind !== 'delete' && !result.etag)) response = { kind: 'unknown' }
    }
    const next: WriteOperation = { ...operation, version: operation.version + 1, leaseId: null, leaseUntil: 0, state: response.kind === 'applied' ? 'applied' : response.kind === 'conflict' ? 'conflict' : 'failed', outcomeUnknown: response.kind === 'unknown', result: response.kind === 'applied' ? response.result : null, error: response.kind === 'rejected' ? response.code : response.kind === 'unknown' ? 'OUTCOME_UNKNOWN' : null }
    if (!await this.store.cas(id, operation.version, next)) fail('WRITE_LEASE_LOST')
    return next.state === 'applied' ? this.finishLocal(next) : next
  }
  private async finishLocal(operation: WriteOperation): Promise<WriteOperation> {
    if (operation.localApplied) return operation
    try { await this.applyLocal(structuredClone(operation)) } catch { return operation }
    const next = { ...operation, version: operation.version + 1, localApplied: true }
    return await this.store.cas(operation.preview.operationId, operation.version, next) ? next : this.required(operation.preview.operationId)
  }
}
function recurringRef(raw: unknown): RecurringRef { keys(record(raw), ['eventId', 'etag']); const eventId = string(record(raw).eventId), etag = string(record(raw).etag); if (/[\r\n]/.test(etag)) fail('WRITE_INVALID'); return { eventId, etag } }
function recurrenceRules(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== 1 || typeof raw[0] !== 'string' || !raw[0].startsWith('RRULE:')) fail('WRITE_UNSUPPORTED')
  const parts = raw[0].slice(6).split(';').map((part) => part.split('=')); const rule = Object.fromEntries(parts)
  if (parts.some((part) => part.length !== 2) || new Set(parts.map(([key]) => key)).size !== parts.length || Object.keys(rule).some((key) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST'].includes(key)) || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.FREQ) || rule.BYSETPOS !== undefined) fail('WRITE_UNSUPPORTED')
  return [raw[0]]
}
