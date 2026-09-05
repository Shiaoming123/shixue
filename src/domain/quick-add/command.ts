import type { TaskCreateCommand } from '../capabilities/types.ts'
import type { RecurrenceCadence, TaskPriority } from '../workspace/types.ts'
import { parseZonedDateTime } from '../recurrence/timezone.ts'
import type { QuickAddCandidate } from './types.ts'

export interface BuildQuickAddCommandInput {
  input: string
  candidates: readonly QuickAddCandidate[]
  destinationListId: string
  defaultStartOn?: string
  fallbackRecurrenceAnchorOn?: string
  timezone: string
  defaultEstimateMinutes?: number | null
  removeRecognizedText?: boolean
  taskId?: string
  eventId?: string
  seriesId?: string
}

export function buildQuickAddCommand(options: BuildQuickAddCommandInput): TaskCreateCommand {
  const candidates = [...options.candidates]
  if (candidates.some(({ status }) => status === 'ambiguous')) {
    throw new Error('AMBIGUOUS_QUICK_ADD_CANDIDATE')
  }
  for (const kind of ['schedule', 'deadline', 'priority', 'recurrence', 'list'] as const) {
    if (candidates.filter((candidate) => candidate.kind === kind).length > 1) {
      throw new Error(`AMBIGUOUS_QUICK_ADD_CANDIDATE:${kind}`)
    }
  }

  const title = options.removeRecognizedText
    ? removeCandidateRanges(options.input, candidates)
    : options.input.trim()
  if (!title) throw new Error('QUICK_ADD_TITLE_REQUIRED')

  const schedule = candidates.find(({ kind }) => kind === 'schedule')?.value ?? options.defaultStartOn
  const deadline = candidates.find(({ kind }) => kind === 'deadline')?.value
  const priority = candidates.find(({ kind }) => kind === 'priority')?.value
  const recurrence = candidates.find(({ kind }) => kind === 'recurrence')?.value
  const listId = candidates.find(({ kind }) => kind === 'list')?.value ?? options.destinationListId
  const tagIds = [...new Set(candidates.filter(({ kind }) => kind === 'tag').map(({ value }) => value))]

  return {
    type: 'task.create',
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.eventId ? { eventId: options.eventId } : {}),
    listId,
    title,
    ...(tagIds.length ? { tagIds } : {}),
    ...(priority ? { priority: parsePriority(priority) } : {}),
    ...(options.defaultEstimateMinutes === null || options.defaultEstimateMinutes === undefined
      ? {}
      : { estimateMinutes: options.defaultEstimateMinutes }),
    ...dateFields(schedule, 'startAt', 'startOn'),
    ...dateFields(deadline, 'dueAt', 'dueOn'),
    ...(recurrence ? {
      recurrence: recurrenceFields(
        recurrence,
        schedule ?? options.fallbackRecurrenceAnchorOn,
        options.timezone,
        options.seriesId,
      ),
    } : {}),
  }
}

function removeCandidateRanges(input: string, candidates: readonly QuickAddCandidate[]): string {
  const ranges = candidates
    .map(({ source }) => source)
    .sort((left, right) => right.start - left.start)
  let title = input
  for (const range of ranges) title = `${title.slice(0, range.start)} ${title.slice(range.end)}`
  return title.replace(/\s+/gu, ' ').trim()
}

function parsePriority(value: string): TaskPriority {
  if (value === 'high' || value === 'medium' || value === 'low' || value === 'none') return value
  throw new Error(`INVALID_QUICK_ADD_PRIORITY:${value}`)
}

function dateFields<At extends 'startAt' | 'dueAt', On extends 'startOn' | 'dueOn'>(
  value: string | undefined,
  at: At,
  on: On,
): Partial<Record<At | On, string>> {
  if (!value) return {}
  if (isDateOnly(value)) return { [on]: value } as Partial<Record<At | On, string>>
  if (!isOffsetDateTime(value)) throw new Error(`INVALID_QUICK_ADD_DATE:${value}`)
  return { [at]: value } as Partial<Record<At | On, string>>
}

function recurrenceFields(
  recurrence: string,
  anchor: string | undefined,
  timezone: string,
  seriesId: string | undefined,
): NonNullable<TaskCreateCommand['recurrence']> {
  if (!anchor) throw new Error('QUICK_ADD_RECURRENCE_ANCHOR_REQUIRED')
  if (!isDateOnly(anchor) && !isOffsetDateTime(anchor)) throw new Error(`INVALID_QUICK_ADD_DATE:${anchor}`)
  const date = isDateOnly(anchor) ? anchor : parseZonedDateTime(anchor, timezone).date
  const fields = {
    ...(seriesId ? { seriesId } : {}),
    cadence: cadenceFor(recurrence, date),
    basis: 'fixed_schedule' as const,
    ...(isDateOnly(anchor) ? { anchorOn: anchor } : { anchorAt: anchor }),
    end: { kind: 'never' as const },
    timezone,
  }
  return fields
}

function cadenceFor(value: string, anchorDate: string): RecurrenceCadence {
  const [year, month, day] = anchorDate.split('-').map(Number)
  if (value === 'daily') return { kind: 'daily', interval: 1 }
  if (value === 'weekdays') return { kind: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }
  if (value === 'weekly') {
    return { kind: 'weekly', interval: 1, weekdays: [new Date(Date.UTC(year, month - 1, day)).getUTCDay()] }
  }
  if (value === 'monthly') return { kind: 'monthly', interval: 1, dayOfMonth: day }
  if (value === 'yearly') return { kind: 'yearly', interval: 1, month, dayOfMonth: day }
  throw new Error(`INVALID_QUICK_ADD_RECURRENCE:${value}`)
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value)
}

function isOffsetDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
}
