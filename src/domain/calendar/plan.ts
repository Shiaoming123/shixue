import type { Task } from '../workspace/types.ts'
import type { CalendarRange } from './range.ts'

export interface CalendarPlanGroup {
  id: 'overdue' | 'deadline' | 'undated' | 'all-day' | 'duration'
  title: string
  tasks: Task[]
}

export function groupCalendarPlanningTasks(
  tasks: readonly Task[],
  unscheduledTasks: readonly Task[],
  range: CalendarRange,
  now: string,
): CalendarPlanGroup[] {
  const groups: CalendarPlanGroup[] = [
    { id: 'overdue', title: '已逾期', tasks: [] },
    { id: 'deadline', title: '仅截止日期', tasks: [] },
    { id: 'undated', title: '无日期', tasks: [] },
    { id: 'all-day', title: '全天待细排', tasks: [] },
    { id: 'duration', title: '待补时长', tasks: [] },
  ]
  const today = new Date(now).toLocaleDateString('sv-SE')
  for (const task of unscheduledTasks) {
    const { dueOn, dueAt } = task.deadline
    const overdue = dueOn !== null ? dueOn < today : dueAt !== null && Date.parse(dueAt) < Date.parse(now)
    groups[overdue ? 0 : dueOn !== null || dueAt !== null ? 1 : 2]!.tasks.push(task)
  }
  for (const task of tasks) {
    if (task.deletedAt !== null || task.status === 'completed' || task.status === 'cancelled' || task.recurrenceSeriesId !== null) continue
    const date = task.schedule.startOn ?? task.schedule.startAt?.slice(0, 10)
    if (!date || date < range.start || date >= range.end) continue
    if (task.schedule.startOn !== null) groups[3]!.tasks.push(task)
    else if (task.schedule.estimateMinutes === null) groups[4]!.tasks.push(task)
  }
  return groups.filter(({ tasks }) => tasks.length > 0)
}
