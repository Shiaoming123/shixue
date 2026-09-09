import type { WorkspaceStateV4 } from '../../domain/workspace/types.ts'

export interface WorkspaceStore {
  load(): Promise<WorkspaceStateV4>
  save(state: WorkspaceStateV4, expectedUpdatedAt?: string): Promise<void>
}
