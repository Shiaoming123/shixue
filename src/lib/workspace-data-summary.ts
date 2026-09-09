import type { WorkspaceStateV4 } from '../domain/workspace/types.ts'
import { parseWorkspaceExport } from '../storage/workspace/data-port.ts'

export function summarizeWorkspace(state: WorkspaceStateV4): string {
  return `${state.tasks.length} 项任务 · ${state.lists.length} 个清单 · ${state.completionRecords.length} 条完成证据 · ${state.calendarSources.length} 个日历 · ${state.calendarEvents.length} 项日程`
}

export function prepareWorkspaceImport(content: string) {
  const exported = parseWorkspaceExport(content)
  return {
    content,
    summary: summarizeWorkspace(exported.state),
    exportedAt: exported.exportedAt,
  }
}
