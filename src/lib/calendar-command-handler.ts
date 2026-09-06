import { DomainCommandError, type CommandResult } from '../domain/capabilities/types.ts'

export interface CalendarNoticeAction { label: string; run(): Promise<void>; successMessage?: string }
export interface CalendarCommandHandler {
  preflight(): Promise<number>
  execute(expectedWorkspaceRevision: number): Promise<CommandResult>
  refresh(): Promise<void>
  notify(message: string, action?: CalendarNoticeAction): void
  successAction(result: CommandResult): CalendarNoticeAction | undefined
}

export async function runCalendarCommand(handler: CalendarCommandHandler): Promise<CommandResult> {
  let expectedWorkspaceRevision: number
  try {
    expectedWorkspaceRevision = await handler.preflight()
  } catch (error) {
    handler.notify(`无法读取最新日历，未执行调整：${calendarCommandErrorDetail(error)}`)
    throw error
  }

  let result: CommandResult
  try {
    result = await handler.execute(expectedWorkspaceRevision)
  } catch (error) {
    try { await handler.refresh() } catch { /* The execution failure remains primary. */ }
    handler.notify(`日历调整未保存：${calendarCommandErrorDetail(error)}`)
    throw error
  }

  try {
    await handler.refresh()
  } catch (error) {
    notifyRefreshFailure(handler, result, error)
    return result
  }
  notifySuccess(handler, result)
  return result
}

function notifySuccess(handler: CalendarCommandHandler, result: CommandResult) {
  handler.notify('日历安排已更新。', handler.successAction(result))
}

function notifyRefreshFailure(handler: CalendarCommandHandler, result: CommandResult, error: unknown) {
  handler.notify(`日历安排已保存，但视图刷新失败：${calendarCommandErrorDetail(error)}`, {
    label: '重新加载', successMessage: '',
    run: async () => {
      try { await handler.refresh(); notifySuccess(handler, result) }
      catch (retryError) { notifyRefreshFailure(handler, result, retryError) }
    },
  })
}

export function calendarCommandErrorDetail(error: unknown) {
  return error instanceof DomainCommandError
    ? `${error.code}：${error.message.replace(/^\[[^\]]+\]\s*/u, '')}`
    : error instanceof Error ? error.message : String(error)
}
