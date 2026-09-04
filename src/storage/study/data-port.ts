import {
  parseStudyState,
  parseStudyStateOrMigrate,
  type StudyState,
  type StudyStateV1,
} from './types.ts'

export const STUDY_EXPORT_FORMAT = 'meow-study/study-export' as const
export const STUDY_EXPORT_VERSION = 2 as const

export interface StudyExportV1 {
  format: typeof STUDY_EXPORT_FORMAT
  version: 1
  exportedAt: string
  state: StudyStateV1
}

export interface StudyExportV2 {
  format: typeof STUDY_EXPORT_FORMAT
  version: typeof STUDY_EXPORT_VERSION
  exportedAt: string
  state: StudyState
}

export function createStudyExport(
  state: StudyState,
  exportedAt = new Date().toISOString(),
): StudyExportV2 {
  if (!exportedAt) throw new Error('Study export requires exportedAt.')
  return {
    format: STUDY_EXPORT_FORMAT,
    version: STUDY_EXPORT_VERSION,
    exportedAt,
    state: parseStudyState(state),
  }
}

export function parseStudyExport(value: unknown): StudyExportV2 {
  const parsed = parseValue(value)
  if (!isRecord(parsed)) throw new Error('Study import must be a JSON object.')
  if (parsed.format !== STUDY_EXPORT_FORMAT) {
    throw new Error(`Unsupported Study import format: ${String(parsed.format)}.`)
  }
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error(`Unsupported Study import version: ${String(parsed.version)}.`)
  }
  if (typeof parsed.exportedAt !== 'string' || parsed.exportedAt.length === 0) {
    throw new Error('Study import requires exportedAt.')
  }
  return {
    format: STUDY_EXPORT_FORMAT,
    version: STUDY_EXPORT_VERSION,
    exportedAt: parsed.exportedAt,
    state: parsed.version === 1
      ? parseStudyStateOrMigrate(parsed.state, parsed.exportedAt)
      : parseStudyState(parsed.state),
  }
}

function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Study import must contain valid JSON.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
