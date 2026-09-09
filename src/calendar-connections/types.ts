import type { CalendarEvent } from '../domain/calendar/types.ts'
export type CalendarProvider = 'google' | 'feishu'
export type ReadAccess = 'details' | 'freebusy' | 'none'
export interface CalendarDescriptor { id: string; remoteId: string; title: string; timezone: string; color: string; access: ReadAccess; timezoneSource?: 'provider' | 'fallback'; eventsSupported?: boolean }
export interface ProviderEvent { remoteId: string; event: CalendarEvent; sourceUrl: string | null }
export interface CalendarDelta { upserts: ProviderEvent[]; deletedRemoteIds: string[]; access: ReadAccess }
/** Device/backend protocol only: cursors MUST NOT be bridged through production WebView IPC. */
export interface ProviderReadRequest { operation: `${CalendarProvider}.${'calendars' | 'events' | 'freebusy'}`; connectionId: string; calendarId?: string; calendarIds?: string[]; pageToken?: string; pageSize?: number; busyTarget?: FeishuBusyTarget; syncToken?: string; anchorTime?: string; startAt?: string; endAt?: string }
export interface ProviderReadResponse { status: number; body: unknown; retryAfterSeconds?: number }
export type ProviderReadTransport = (request: ProviderReadRequest) => Promise<ProviderReadResponse>
export interface PullRequest { connectionId: string; calendarId: string; timezone: string; now: string; cursor: string | null; anchorTime?: string }
export interface PullResult { delta: CalendarDelta; nextCursor: string | null; full: boolean }
export interface BusyResult { calendarId: string; sourceId?: string; startAt: string; endAt: string; fetchedAt: string; expiresAt: string; intervals: { startAt: string; endAt: string }[]; error: string | null }
export interface CalendarProviderPort<TTarget = string, TResult = BusyResult> { listCalendars(connectionId: string): Promise<CalendarDescriptor[]>; pullChanges(request: PullRequest): Promise<PullResult>; queryFreeBusy(connectionId: string, calendarIds: TTarget[], startAt: string, endAt: string, now: string): Promise<TResult[]> }
export type CalendarProviderErrorCode = 'retryable' | 'cursor-expired' | 'permission' | 'invalid-response' | 'invalid-request' | 'unsupported-operation' | 'unsupported-recurrence' | 'incomplete'
export class CalendarProviderError extends Error {
  readonly code: CalendarProviderErrorCode
  readonly retryAfterSeconds?: number
  constructor(code: CalendarProviderErrorCode, retryAfterSeconds?: number) { super(`Calendar provider: ${code}`); this.code = code; this.retryAfterSeconds = retryAfterSeconds }
}
export function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CalendarProviderError('invalid-response'); return value as Record<string, unknown> }
export function string(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 100_000) throw new CalendarProviderError('invalid-response'); return value }
export function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new CalendarProviderError('invalid-response'); return value }
export function stableId(provider: CalendarProvider, connection: string, calendar: string, remote?: string): string { return `calendar-provider:${encodeURIComponent(JSON.stringify([provider, connection, calendar, ...(remote === undefined ? [] : [remote])]))}` }
export function access(role: unknown): ReadAccess { return ['owner', 'writer', 'reader'].includes(String(role)) ? 'details' : ['freeBusyReader', 'free_busy_reader'].includes(String(role)) ? 'freebusy' : 'none' }
export function checkHttp(response: ProviderReadResponse): void {
  if (response.status === 410) throw new CalendarProviderError('cursor-expired')
  if (response.status === 429 || response.status >= 500) throw new CalendarProviderError('retryable', response.retryAfterSeconds)
  if (response.status === 401 || response.status === 403) throw new CalendarProviderError('permission')
  if (response.status < 200 || response.status >= 300) throw new CalendarProviderError('invalid-request')
}
export function instant(value: unknown): string { const text = string(value); if (!/(Z|[+-]\d\d:\d\d)$/.test(text) || !Number.isFinite(Date.parse(text))) throw new CalendarProviderError('invalid-response'); return new Date(text).toISOString() }
export function safeSourceUrl(value: unknown, provider: CalendarProvider): string | null { try { const url = new URL(string(value)); const allowed = provider === 'google' ? ['calendar.google.com', 'www.google.com'] : ['calendar.feishu.cn']; return url.protocol === 'https:' && !url.username && !url.password && allowed.includes(url.hostname) && (url.hostname !== 'www.google.com' || /^\/calendar(?:\/|$)/.test(url.pathname)) ? url.href : null } catch { return null } }

export function safeNormalize<T>(operation: () => T): T { try { return operation() } catch (error) { if (error instanceof CalendarProviderError) throw error; throw new CalendarProviderError('invalid-response') } }

export type FeishuBusyTarget = { kind: 'user'; userId: string; userIdType: 'open_id' | 'union_id' | 'user_id' } | { kind: 'room'; roomId: string }
export type FeishuBusyResult = Omit<BusyResult, 'calendarId'> & { target: FeishuBusyTarget }
