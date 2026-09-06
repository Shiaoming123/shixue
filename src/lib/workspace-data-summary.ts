import type { WorkspaceStateV3 } from '../domain/workspace/types.ts'
import { parseWorkspaceExport } from '../storage/workspace/data-port.ts'

export function summarizeWorkspace(state: WorkspaceStateV3): string {
  return `${state.tasks.length} 项任务 · ${state.lists.length} 个清单 · ${state.completionRecords.length} 条完成证据`
}

export function prepareWorkspaceImport(content: string) {
  const exported = parseWorkspaceExport(content)
  return {
    content,
    summary: summarizeWorkspace(exported.state),
    exportedAt: exported.exportedAt,
  }
}
