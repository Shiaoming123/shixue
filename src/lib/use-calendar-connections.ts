import { reactive } from 'vue'
import { createCalendarConnectionRuntime, type CalendarConnectionConfig, type CalendarConnectionStatus, type CalendarInvoke } from '../calendar-connections/runtime.ts'
import type { BusyResult, CalendarDescriptor } from '../calendar-connections/types.ts'
import type { RuntimeInfo } from './platform.ts'
import type { WorkspaceStore } from '../storage/workspace/types.ts'
import type { CalendarRange } from '../domain/calendar/range.ts'
import { schedulingRangeBounds } from '../domain/calendar/scheduling.ts'
import { parseZonedDateTime } from '../domain/recurrence/timezone.ts'
import { addCalendarDays } from '../domain/recurrence/calculate.ts'

export function useCalendarConnections(options: { enabled: boolean; runtime: RuntimeInfo; config: CalendarConnectionConfig; invoke?: CalendarInvoke; store: WorkspaceStore; refreshWorkspace(): Promise<void> }) {
  const runtime = createCalendarConnectionRuntime(options)
  const state = reactive({ busy: false, status: 'unavailable' as CalendarConnectionStatus['state'], calendars: [] as CalendarDescriptor[], busyResults: [] as BusyResult[], error: '', message: '' })
  const errors: Record<string, string> = {
    REAUTHORIZE: '授权已失效，请重新连接。', SCOPE_REQUIRED: '此操作需要相应的日历读取权限，请重新选择连接范围。',
    AUTHORIZATION_DENIED: '已取消授权。', AUTHORIZATION_CANCELLED: '连接已取消。', AUTHORIZATION_TIMEOUT: '授权超时，请重新连接。',
    DISCONNECTED_REVOCATION_UNCONFIRMED: '本机已断开，远端授权撤销尚未确认。',
    SYNC_APPLIED_ACK_PENDING: '日程已保存，同步回执尚未确认。再次同步会恢复同一批次。',
    'Calendar provider: unsupported-recurrence': '此日历包含尚不支持的重复规则，本次未标记同步完成；仍可独立查询忙闲。',
  }
  async function run(action: () => Promise<void>) {
    if (state.busy) return
    state.busy = true; state.error = ''; state.message = ''
    try { await action() }
    catch (error) { state.error = errors[error instanceof Error ? error.message : ''] ?? '连接操作未完成。已保存的日程仍可离线查看，请检查网络或重新连接。' }
    finally { state.busy = false }
  }
  async function load() {
    state.status = (await runtime.status()).state
    state.calendars = ['ready', 'session-only'].includes(state.status) ? await runtime.listCalendars() : []
  }
  async function fetchBusy(calendarIds: string[], range: CalendarRange, timezone: string) {
    const bounds = schedulingRangeBounds(range, timezone)
    state.busyResults = state.busyResults.filter((item) => !calendarIds.includes(item.calendarId))
    const results = await runtime.queryFreeBusy(calendarIds, new Date(bounds.start).toISOString(), new Date(bounds.end).toISOString(), new Date().toISOString())
    state.busyResults = [...state.busyResults, ...results]
    state.message = results.some((item) => item.error) ? '部分忙闲结果未知，不能据此判断空闲。' : '已获取所选日期的忙闲，结果有效期5分钟。'
  }
  return {
    state,
    inspect: () => run(load),
    connect: (mode: 'details' | 'freebusy') => run(async () => { state.status = (await runtime.connect(mode)).state; await load() }),
    disconnect: (revoke: boolean) => run(async () => {
      try { state.status = (await runtime.disconnect(revoke)).state; state.message = '已断开，保留已缓存的日程。' }
      finally { state.status = (await runtime.status()).state; state.calendars = []; state.busyResults = [] }
    }),
    synchronize: (calendarId: string) => run(async () => {
      try { await runtime.syncCalendar(calendarId, options.store); state.message = '日历已同步。' }
      finally { await options.refreshWorkspace() }
    }),
    queryBusy: (calendarId: string) => run(async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const start = parseZonedDateTime(new Date().toISOString(), timezone).date
      await fetchBusy([calendarId], { start, end: addCalendarDays(start, 7) }, timezone)
    }),
    queryRangeBusy: (range: CalendarRange, timezone: string) => run(async () => {
      await load()
      const sources = (await options.store.load()).calendarSources.filter((source) => !source.archivedAt && source.provider === 'google')
      const ids = state.calendars.filter((calendar) => sources.some((source) => source.id === calendar.id)).map((calendar) => calendar.remoteId)
      if (!ids.length) throw new Error('DISCONNECTED')
      await fetchBusy(ids, range, timezone)
    }),
  }
}

export type CalendarConnectionsController = ReturnType<typeof useCalendarConnections>
