import { DomainCommandError, type CommandResult, type UndoToken } from '../domain/capabilities/types.ts'

export interface CalendarNoticeAction { label: string; run(): Promise<void>; successMessage?: string }
export interface CalendarCommandHandler {
  preflight(): Promise<number>
  execute(expectedWorkspaceRevision: number): Promise<CommandResult>
  refresh(): Promise<void>
  notify(message: string, action?: CalendarNoticeAction): void
  successAction(result: CommandResult): CalendarNoticeAction | undefined
  successMessage?: string
}

interface CalendarOperationCopy {
  preflightFailure: string
  executeFailure: string
  refreshFailure: string
  success: string
}

export interface CalendarUndoActionOptions {
  token: UndoToken
  preflight(): Promise<number>
  execute(expectedWorkspaceRevision: number, token: UndoToken): Promise<CommandResult>
  refresh(): Promise<void>
  notify(message: string, action?: CalendarNoticeAction): void
}

const commandCopy: CalendarOperationCopy = {
  preflightFailure: '无法读取最新日历，未执行调整',
  executeFailure: '日历调整未保存',
  refreshFailure: '日历安排已保存，但视图刷新失败',
  success: '日历安排已更新。',
}

const undoCopy: CalendarOperationCopy = {
  preflightFailure: '无法读取最新日历，未执行撤销',
  executeFailure: '日历撤销未保存',
  refreshFailure: '日历撤销已保存，但视图刷新失败',
  success: '已撤销。',
}

export async function runCalendarCommand(handler: CalendarCommandHandler): Promise<CommandResult> {
  return runCalendarOperation(handler, commandCopy)
}

export async function runCalendarUndo(handler: CalendarCommandHandler): Promise<CommandResult> {
  return runCalendarOperation(handler, undoCopy)
}

export function createCalendarUndoAction(options: CalendarUndoActionOptions): CalendarNoticeAction {
  return {
    label: '撤销',
    successMessage: '',
    run: async () => {
      try {
        await runCalendarUndo({
          preflight: options.preflight,
          execute: (revision) => options.execute(revision, options.token),
          refresh: options.refresh,
          notify: options.notify,
          successAction: () => undefined,
        })
      } catch { /* The phase handler already reported the precise undo failure. */ }
    },
  }
}

async function runCalendarOperation(handler: CalendarCommandHandler, copy: CalendarOperationCopy): Promise<CommandResult> {
  let expectedWorkspaceRevision: number
  try {
    expectedWorkspaceRevision = await handler.preflight()
  } catch (error) {
    handler.notify(`${copy.preflightFailure}：${calendarCommandErrorDetail(error)}`)
    throw error
  }

  let result: CommandResult
  try {
    result = await handler.execute(expectedWorkspaceRevision)
  } catch (error) {
    try { await handler.refresh() } catch { /* The execution failure remains primary. */ }
    handler.notify(`${copy.executeFailure}：${calendarCommandErrorDetail(error)}`)
    throw error
  }

  try {
    await handler.refresh()
  } catch (error) {
    notifyRefreshFailure(handler, result, error, copy)
    return result
  }
  notifySuccess(handler, result, copy)
  return result
}

function notifySuccess(handler: CalendarCommandHandler, result: CommandResult, copy: CalendarOperationCopy) {
  handler.notify(handler.successMessage ?? copy.success, handler.successAction(result))
}

function notifyRefreshFailure(handler: CalendarCommandHandler, result: CommandResult, error: unknown, copy: CalendarOperationCopy) {
  handler.notify(`${copy.refreshFailure}：${calendarCommandErrorDetail(error)}`, {
    label: '重新加载', successMessage: '',
    run: async () => {
      try { await handler.refresh(); notifySuccess(handler, result, copy) }
      catch (retryError) { notifyRefreshFailure(handler, result, retryError, copy) }
    },
  })
}

export function calendarCommandErrorDetail(error: unknown) {
  return error instanceof DomainCommandError
    ? `${error.code}：${error.message.replace(/^\[[^\]]+\]\s*/u, '')}`
    : error instanceof Error ? error.message : String(error)
}
