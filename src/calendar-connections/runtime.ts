import type { RuntimeInfo } from '../lib/platform.ts'
import { createGoogleCalendarProvider, normalizeGoogleBatch } from './google.ts'
import { record, array, string, stableId, CalendarProviderError } from './types.ts'
import type { CalendarEvent } from '../domain/calendar/types.ts'
import { createTaskCapabilityService } from '../domain/capabilities/service.ts'
import { DomainCommandError } from '../domain/capabilities/types.ts'
import type { ExternalCalendarBatch } from '../domain/capabilities/calendar-external-commands.ts'
import type { WorkspaceStore } from '../storage/workspace/types.ts'

export interface CalendarConnectionConfig { clientId: string | null; connectionId: string }
export interface CalendarConnectionStatus {
  state: 'unavailable' | 'disconnected' | 'ready' | 'session-only'
  grantedScopes: string[]
}
export type CalendarInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>

async function nativeInvoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

function status(value: unknown): CalendarConnectionStatus {
  const data = record(value)
  if (!['unavailable', 'disconnected', 'ready', 'session-only'].includes(String(data.state))) throw new CalendarProviderError('invalid-response')
  return { state: data.state as CalendarConnectionStatus['state'], grantedScopes: array(data.grantedScopes).map(string) }
}

export function normalizeNativeCalendarBatch(value: unknown, connectionId: string, calendarId: string, now: string, parents: readonly CalendarEvent[]): ExternalCalendarBatch {
  const batch = record(value)
  if (batch.provider !== 'google' || batch.connectionId !== connectionId || batch.calendarId !== calendarId || batch.sourceId !== stableId('google', connectionId, calendarId) || !['full', 'incremental'].includes(String(batch.mode)) || !['details', 'freebusy', 'none'].includes(String(batch.access))) throw new CalendarProviderError('invalid-response')
  const timezone = string(batch.timezone)
  const items = array(batch.items)
  if (items.length > 50_000 || new TextEncoder().encode(JSON.stringify(value)).length > 32 * 1024 * 1024) throw new CalendarProviderError('incomplete')
  if (batch.operationId !== undefined && items.some((item) => { const event = record(item); return event.recurrence !== undefined || event.recurringEventId !== undefined })) {
    const plan = record(batch.plan)
    if (!/^sha256:[a-f0-9]{64}$/.test(string(plan.hash)) || !['recurring.single', 'recurring.series'].includes(string(plan.kind)) || string(plan.parentEventId) === '') throw new CalendarProviderError('invalid-response')
    if (plan.kind === 'recurring.single' && (string(plan.instanceEventId) === '' || string(plan.originalStart) === '')) throw new CalendarProviderError('invalid-response')
  }
  const mode = batch.mode as ExternalCalendarBatch['mode']
  const delta = normalizeGoogleBatch(items, { connectionId, calendarId, timezone, now, cursor: null }, parents, mode)
  return { batchId: string(batch.batchId), provider: 'google', connectionId, calendarId, sourceId: string(batch.sourceId), mode, access: batch.access as ExternalCalendarBatch['access'], title: string(batch.title), timezone, ...delta }
}

/** Only public configuration and whitelisted calendar facts cross this boundary. */
export function createCalendarConnectionRuntime(options: {
  enabled: boolean
  runtime: RuntimeInfo
  config: CalendarConnectionConfig
  invoke?: CalendarInvoke
}) {
  const enabled = options.enabled && options.runtime.platform === 'desktop'
  const config = { clientId: options.config.clientId, connectionId: options.config.connectionId }
  const call = async (operation: string, args: Record<string, unknown> = {}) => {
    if (!enabled) throw new Error('CALENDAR_CONNECTIONS_UNAVAILABLE')
    try { return await (options.invoke ?? nativeInvoke)(`plugin:calendar-connections|${operation}`, { config, ...args }) }
    catch (error) {
      // Never forward provider bodies, request URLs, or arbitrary host errors to UI/logs.
      const code = typeof error === 'string' ? error : ''
      const publicErrors = ['UNAVAILABLE_CLIENT_ID', 'CONFIG_INVALID', 'DISCONNECTED', 'REAUTHORIZE', 'SCOPE_REQUIRED', 'AUTHORIZATION_DENIED', 'AUTHORIZATION_CANCELLED', 'AUTHORIZATION_TIMEOUT', 'DISCONNECTED_REVOCATION_UNCONFIRMED', 'CREDENTIAL_STORE_UNAVAILABLE']
      throw new Error(publicErrors.includes(code) ? code : 'CALENDAR_CONNECTION_FAILED')
    }
  }
  const provider = createGoogleCalendarProvider(async (request) => {
    if (request.operation === 'google.calendars') return { status: 200, body: await call('list_calendars') }
    if (request.operation === 'google.freebusy') return { status: 200, body: await call('free_busy', { calendarIds: request.calendarIds, startAt: request.startAt, endAt: request.endAt }) }
    throw new CalendarProviderError('unsupported-operation')
  })
  return {
    async status(): Promise<CalendarConnectionStatus> {
      return enabled ? status(await call('status')) : { state: 'unavailable', grantedScopes: [] }
    },
    async connect(mode: 'details' | 'freebusy') { return status(await call('connect', { mode })) },
    async disconnect(revoke: boolean) { return status(await call('disconnect', { revoke })) },
    listCalendars: () => provider.listCalendars(config.connectionId),
    queryFreeBusy: async (calendarIds: string[], startAt: string, endAt: string, now: string) => (await provider.queryFreeBusy(config.connectionId, calendarIds, startAt, endAt, now)).map((result) => ({ ...result, sourceId: stableId('google', config.connectionId, result.calendarId) })),
    async syncCalendar(calendarId: string, store: WorkspaceStore) {
      const now = new Date().toISOString()
      let batchId = string(record(await call('stage_events', { calendarId })).batchId)
      let reset = false
      const service = createTaskCapabilityService(store, () => now, (kind) => `${kind}:${crypto.randomUUID()}`, {
        loadExternalBatch: async (batchId, state) => normalizeNativeCalendarBatch(await call('read_staged', { calendarId, batchId }), config.connectionId, calendarId, now, state.calendarEvents),
      })
      for (let attempt = 0; attempt < 3; attempt++) {
        let receiptId: string
        try {
          const result = await service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: batchId, expectedWorkspaceRevision: (await store.load()).revision, command: { type: 'calendar_external.apply', batchId } })
          receiptId = result.receiptId
        } catch (error) {
          if (attempt < 2 && error instanceof DomainCommandError && ['WORKSPACE_REVISION_CONFLICT', 'WORKSPACE_SAVE_CONFLICT'].includes(error.code)) continue
          if (!reset && error instanceof CalendarProviderError && error.code === 'cursor-expired') {
            const result = record(await call('reset_sync', { calendarId, batchId }))
            if (result.reset !== true) throw new CalendarProviderError('invalid-response')
            reset = true
            batchId = string(record(await call('stage_events', { calendarId })).batchId)
            continue
          }
          throw error
        }
        try {
          const ack = record(await call('ack_events', { calendarId, batchId, workspaceReceiptId: receiptId }))
          if (ack.applied !== true || ack.batchId !== batchId) throw new CalendarProviderError('invalid-response')
          return { batchId, applied: true as const }
        } catch { throw new Error('SYNC_APPLIED_ACK_PENDING') }
      }
      throw new Error('CALENDAR_CONNECTION_FAILED')
    },
  }
}
