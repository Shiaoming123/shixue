import { parseWorkspaceStateOrMigrate } from '../../domain/workspace/migrate.ts'
import { parseWorkspaceState, parseWorkspaceStateV4 } from '../../domain/workspace/parse.ts'
import type { WorkspaceStateV3, WorkspaceStateV4 } from '../../domain/workspace/types.ts'

export const WORKSPACE_EXPORT_FORMAT = 'meow-study/workspace-export' as const
export const WORKSPACE_EXPORT_VERSION = 4 as const
const LEGACY_STUDY_EXPORT_FORMAT = 'meow-study/study-export'

export interface WorkspaceExportV3 {
  format: typeof WORKSPACE_EXPORT_FORMAT
  version: 3
  exportedAt: string
  state: WorkspaceStateV3
}

export interface WorkspaceExportV4 extends Omit<WorkspaceExportV3, 'version' | 'state'> {
  version: typeof WORKSPACE_EXPORT_VERSION
  state: WorkspaceStateV4
}

export function createWorkspaceExport(
  state: WorkspaceStateV4,
  exportedAt = new Date().toISOString(),
): WorkspaceExportV4 {
  requireExportedAt(exportedAt)
  return {
    format: WORKSPACE_EXPORT_FORMAT,
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt,
    state: parseWorkspaceStateV4(state),
  }
}

export function parseWorkspaceExport(value: unknown): WorkspaceExportV4 {
  const parsed = parseValue(value)
  if (!isRecord(parsed)) throw new Error('Workspace import must be a JSON object.')
  const exportedAt = requireExportedAt(parsed.exportedAt)

  if (parsed.format === WORKSPACE_EXPORT_FORMAT) {
    if (parsed.version !== 3 && parsed.version !== WORKSPACE_EXPORT_VERSION) {
      throw new Error(`Unsupported Workspace import version: ${String(parsed.version)}.`)
    }
    const stateVersion = isRecord(parsed.state) ? parsed.state.version : undefined
    if (stateVersion !== parsed.version) {
      throw new Error(`Workspace import envelope version ${parsed.version} does not match state version ${String(stateVersion)}.`)
    }
    return createWorkspaceExport(parseWorkspaceStateOrMigrate(parsed.state, exportedAt), exportedAt)
  }
  if (parsed.format === LEGACY_STUDY_EXPORT_FORMAT) {
    if (parsed.version !== 1 && parsed.version !== 2) {
      throw new Error(`Unsupported Study import version: ${String(parsed.version)}.`)
    }
    const stateVersion = isRecord(parsed.state) ? parsed.state.version : undefined
    if (stateVersion !== parsed.version) {
      throw new Error(
        `Study import envelope version ${parsed.version} does not match state version ${String(stateVersion)}.`,
      )
    }
    return createWorkspaceExport(
      parseWorkspaceStateOrMigrate(parsed.state, exportedAt),
      exportedAt,
    )
  }
  throw new Error(`Unsupported Workspace import format: ${String(parsed.format)}.`)
}

/** Lossy downgrade: omits all calendar facts and command receipts; leaves the input unchanged. */
export function createTaskOnlyWorkspaceExportV3(state: WorkspaceStateV4, exportedAt = new Date().toISOString()): WorkspaceExportV3 {
  requireExportedAt(exportedAt)
  const validated = parseWorkspaceStateV4(state)
  const { calendarSources: _sources, calendarEvents: _events, calendarEventLinks: _links, eventOutcomes: _outcomes, ...taskState } = validated
  const reminderRules = validated.reminderRules.flatMap(({ target, ...rule }) => target.kind === 'task' ? [{ ...rule, taskId: target.taskId, occurrenceId: target.occurrenceId }] : [])
  const ruleIds = new Set(reminderRules.map((rule) => rule.id))
  return {
    format: WORKSPACE_EXPORT_FORMAT, version: 3, exportedAt,
    state: parseWorkspaceState({ ...taskState, version: 3, reminderRules,
      reminderDeliveries: validated.reminderDeliveries.filter((delivery) => ruleIds.has(delivery.reminderRuleId)),
      commandReceipts: [],
    }),
  }
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
