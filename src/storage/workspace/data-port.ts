import { parseWorkspaceStateOrMigrate } from '../../domain/workspace/migrate.ts'
import { parseWorkspaceState } from '../../domain/workspace/parse.ts'
import type { WorkspaceStateV3 } from '../../domain/workspace/types.ts'

export const WORKSPACE_EXPORT_FORMAT = 'meow-study/workspace-export' as const
export const WORKSPACE_EXPORT_VERSION = 3 as const
const LEGACY_STUDY_EXPORT_FORMAT = 'meow-study/study-export'

export interface WorkspaceExportV3 {
  format: typeof WORKSPACE_EXPORT_FORMAT
  version: typeof WORKSPACE_EXPORT_VERSION
  exportedAt: string
  state: WorkspaceStateV3
}

export function createWorkspaceExport(
  state: WorkspaceStateV3,
  exportedAt = new Date().toISOString(),
): WorkspaceExportV3 {
  requireExportedAt(exportedAt)
  return {
    format: WORKSPACE_EXPORT_FORMAT,
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt,
    state: parseWorkspaceState(state),
  }
}

export function parseWorkspaceExport(value: unknown): WorkspaceExportV3 {
  const parsed = parseValue(value)
  if (!isRecord(parsed)) throw new Error('Workspace import must be a JSON object.')
  const exportedAt = requireExportedAt(parsed.exportedAt)

  if (parsed.format === WORKSPACE_EXPORT_FORMAT) {
    if (parsed.version !== WORKSPACE_EXPORT_VERSION) {
      throw new Error(`Unsupported Workspace import version: ${String(parsed.version)}.`)
    }
    return createWorkspaceExport(parseWorkspaceState(parsed.state), exportedAt)
  }
  if (parsed.format === LEGACY_STUDY_EXPORT_FORMAT) {
    if (parsed.version !== 1 && parsed.version !== 2) {
      throw new Error(`Unsupported Study import version: ${String(parsed.version)}.`)
    }
    return createWorkspaceExport(
      parseWorkspaceStateOrMigrate(parsed.state, exportedAt),
      exportedAt,
    )
  }
  throw new Error(`Unsupported Workspace import format: ${String(parsed.format)}.`)
}

function requireExportedAt(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new Error('Workspace import requires a valid exportedAt timestamp.')
  }
  return value
}

function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Workspace import must contain valid JSON.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
