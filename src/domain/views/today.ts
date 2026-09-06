import { createTimeZoneFormatter } from '../recurrence/timezone.ts'
import type { WorkspaceStateV3 } from '../workspace/types.ts'
import { projectTaskItems, type TaskProjection, type TaskProjectionReason } from '../../lib/study-task-query.ts'

export const TODAY_GROUP_KINDS = ['overdue', 'planned', 'due', 'recurring'] as const
export type TodayGroupKind = typeof TODAY_GROUP_KINDS[number]
export interface TodayGroup { kind: TodayGroupKind; items: TaskProjection[] }

const reasonOrder = new Map<TaskProjectionReason, number>(TODAY_GROUP_KINDS.map((reason, index) => [reason, index]))
const priorityOrder = { high: 0, medium: 1, low: 2, none: 3 } as const

export function selectToday(state: WorkspaceStateV3, now: string, timezone: string): TodayGroup[] {
  const today = localDate(now, timezone)
  const taskOrder = new Map(state.tasks.map((task, index) => [task.id, index]))
  const merged = mergeProjections(projectTaskItems(state, { from: today, to: today }, timezone))
    .filter((item) => item.task.deletedAt === null && item.task.status !== 'completed' && item.task.status !== 'cancelled')
    .filter((item) => item.occurrence === null || item.occurrence.status === 'pending')
    .sort((left, right) => compareProjection(left, right, taskOrder))

  return TODAY_GROUP_KINDS.map((kind) => ({
    kind,
    items: merged.filter((item) => primaryReason(item.reasons) === kind),
  }))
}

export function canonicalReasons(reasons: readonly TaskProjectionReason[]): TaskProjectionReason[] {
  return [...new Set(reasons)].sort((left, right) => reasonOrder.get(left)! - reasonOrder.get(right)!)
}

export function compareProjection(left: TaskProjection, right: TaskProjection, taskOrder: ReadonlyMap<string, number>): number {
  return compareText(effectivePlanDate(left), effectivePlanDate(right)) ||
    compareText(effectivePlanTime(left), effectivePlanTime(right)) ||
    priorityOrder[left.task.priority] - priorityOrder[right.task.priority] ||
    (taskOrder.get(left.taskId) ?? Number.MAX_SAFE_INTEGER) - (taskOrder.get(right.taskId) ?? Number.MAX_SAFE_INTEGER) ||
    (left.occurrence?.ordinal ?? -1) - (right.occurrence?.ordinal ?? -1) ||
    compareText(left.key, right.key)
}

function mergeProjections(items: readonly TaskProjection[]): TaskProjection[] {
  const byKey = new Map<string, TaskProjection>()
  for (const item of items) {
    const current = byKey.get(item.key)
    if (!current) byKey.set(item.key, { ...item, reasons: canonicalReasons(item.reasons) })
    else current.reasons = canonicalReasons([...current.reasons, ...item.reasons])
  }
  return [...byKey.values()]
}

function primaryReason(reasons: readonly TaskProjectionReason[]): TodayGroupKind {
  return canonicalReasons(reasons)[0] ?? 'recurring'
}

function effectivePlanDate(item: TaskProjection): string {
  return item.scheduledOn ?? item.dueOn ?? '9999-12-31'
}

function effectivePlanTime(item: TaskProjection): string {
  return item.scheduledAt ?? item.dueAt ?? ''
}

function localDate(now: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(now)) return now
  const instant = new Date(now)
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid projection instant: ${now}`)
  return createTimeZoneFormatter(timezone)(instant).date
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
