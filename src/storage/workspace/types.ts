import type { WorkspaceStateV3 } from '../../domain/workspace/types.ts'

export interface WorkspaceStore {
  load(): Promise<WorkspaceStateV3>
  save(state: WorkspaceStateV3, expectedUpdatedAt?: string): Promise<void>
}
