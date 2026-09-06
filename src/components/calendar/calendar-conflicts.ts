import type { CalendarCapabilityCommand } from '../../domain/capabilities/calendar-commands.ts'
import type { LaidOutCalendarItem } from '../../domain/calendar/layout.ts'
import type { WorkspaceStateV3 } from '../../domain/workspace/types.ts'
import { durationMinutes } from './use-calendar-drag.ts'

export function calendarDeadlineConflict(workspace: WorkspaceStateV3 | null, command: CalendarCapabilityCommand): string | null {
  if (command.type !== 'calendar.move') return null
  const task = workspace?.tasks.find(({ id }) => id === command.taskId)
  const target = command.startAt ?? command.startOn
  const deadline = task?.deadline.dueAt ?? task?.deadline.dueOn
  if (!target || !deadline) return null
  const after = target.includes('T') && deadline.includes('T')
    ? Date.parse(target) > Date.parse(deadline)
    : dateValue(target) > dateValue(deadline)
  return after ? '安排时间晚于截止时间，请确认仍然安排。' : null
}

export function calendarOverlapMessage(
  items: readonly LaidOutCalendarItem[], itemKey: string, day: string, start: number, duration: number,
): string | null {
  const end = start + duration
  const count = items.filter((item) => item.key !== itemKey && item.displayDate === day)
    .filter((item) => (item.displayMinute ?? 0) < end && (item.displayMinute ?? 0) + durationMinutes(item) > start).length
  return count ? `与 ${count} 个任务重叠` : null
}

function dateValue(value: string) { return value.includes('T') ? value.slice(0, 10) : value }
