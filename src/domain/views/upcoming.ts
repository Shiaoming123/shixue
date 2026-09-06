import { addCalendarDays } from '../../storage/study/types.ts'
import { projectTaskItems, type TaskProjection } from '../../lib/study-task-query.ts'
import type { WorkspaceStateV3 } from '../workspace/types.ts'
import { canonicalReasons, compareProjection } from './today.ts'

export interface DayGroup { date: string; items: TaskProjection[] }

export function selectUpcoming(
  state: WorkspaceStateV3,
  start: string,
  days: number,
  timezone: string,
): DayGroup[] {
  if (!Number.isInteger(days) || days <= 0) throw new Error('Upcoming projection days must be a positive integer.')
  const endExclusive = addCalendarDays(start, days)
  const endInclusive = addCalendarDays(endExclusive, -1)
  const taskOrder = new Map(state.tasks.map((task, index) => [task.id, index]))
  const byKey = new Map<string, { date: string; item: TaskProjection }>()

  for (const projection of projectTaskItems(state, { from: start, to: endInclusive }, timezone)) {
    if (projection.task.deletedAt !== null || projection.task.status === 'completed' || projection.task.status === 'cancelled') continue
    if (projection.occurrence && projection.occurrence.status !== 'pending') continue
    const date = earliestDateInRange(projection, start, endExclusive)
    if (!date) continue
    const existing = byKey.get(projection.key)
    if (!existing) byKey.set(projection.key, { date, item: { ...projection, reasons: canonicalReasons(projection.reasons) } })
    else {
      existing.date = existing.date < date ? existing.date : date
      existing.item.reasons = canonicalReasons([...existing.item.reasons, ...projection.reasons])
    }
  }

  const groups = new Map<string, TaskProjection[]>()
  for (const { date, item } of byKey.values()) {
    const items = groups.get(date) ?? []
    items.push(item)
    groups.set(date, items)
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, items]) => ({
    date,
    items: items.sort((left, right) => compareProjection(left, right, taskOrder)),
  }))
}

function earliestDateInRange(item: TaskProjection, start: string, endExclusive: string): string | null {
  const candidates: string[] = []
  if ((item.reasons.includes('planned') || item.reasons.includes('recurring')) && item.scheduledOn) candidates.push(item.scheduledOn)
  if (item.reasons.includes('due') && item.dueOn) candidates.push(item.dueOn)
  const inRange = candidates.filter((date) => date >= start && date < endExclusive).sort()
  return inRange[0] ?? null
}
