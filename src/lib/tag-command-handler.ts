import type { CommandResult } from '../domain/capabilities/types.ts'
import { calendarCommandErrorDetail, type CalendarNoticeAction } from './calendar-command-handler.ts'

export interface TagCommandHandler {
  snapshotRevision(): Promise<number>
  execute(expectedWorkspaceRevision: number): Promise<CommandResult>
  refresh(): Promise<void>
  notify(message: string, action?: CalendarNoticeAction): void
  successAction(result: CommandResult): CalendarNoticeAction | undefined
  successMessage: string
}

export async function runTagCommand(handler: TagCommandHandler): Promise<CommandResult> {
  let revision: number
  try {
    revision = await handler.snapshotRevision()
  } catch (error) {
    handler.notify(`无法读取最新标签，未执行更改：${calendarCommandErrorDetail(error)}`)
    throw error
  }

  let result: CommandResult
  try {
    result = await handler.execute(revision)
  } catch (error) {
    try { await handler.refresh() } catch { /* The command failure remains primary. */ }
    handler.notify(`标签更改未保存：${calendarCommandErrorDetail(error)}`)
    throw error
  }

  try {
    await handler.refresh()
  } catch (error) {
    handler.notify(`标签已保存，但界面刷新失败：${calendarCommandErrorDetail(error)}`, {
      label: '重新加载', successMessage: '',
      run: async () => { await handler.refresh(); handler.notify(handler.successMessage, handler.successAction(result)) },
    })
    return result
  }
  handler.notify(handler.successMessage, handler.successAction(result))
  return result
}
