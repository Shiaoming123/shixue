import type { CalendarItem } from './project.ts'

export interface LaidOutCalendarItem extends CalendarItem {
  column: number
  columnCount: number
}

export function layoutTimedItems(items: readonly CalendarItem[]): LaidOutCalendarItem[] {
  const timed = items
    .filter((item): item is CalendarItem & { kind: 'timed'; end: string } => item.kind === 'timed' && item.end !== null)
    .slice()
    .sort(compareTimedItems)
  const result: LaidOutCalendarItem[] = []
  let active: LaidOutCalendarItem[] = []
  let group: LaidOutCalendarItem[] = []

  for (const item of timed) {
    active = active.filter((entry) => entry.displayDate === item.displayDate && (entry.displayMinute ?? 0) + duration(entry) > (item.displayMinute ?? 0))
    if (active.length === 0 && group.length) {
      appendGroup(result, group)
      group = []
    }
    const used = new Set(active.map((entry) => entry.column))
    let column = 0
    while (used.has(column)) column += 1
    const entry = { ...item, column, columnCount: 1 }
    active.push(entry)
    group.push(entry)
  }
  if (group.length) appendGroup(result, group)
  return result
}

function appendGroup(result: LaidOutCalendarItem[], group: LaidOutCalendarItem[]): void {
  const columnCount = Math.max(...group.map((item) => item.column)) + 1
  for (const item of group) result.push({ ...item, columnCount })
}

function compareTimedItems(left: CalendarItem, right: CalendarItem): number {
  const byDate = left.displayDate.localeCompare(right.displayDate)
  if (byDate !== 0) return byDate
  const byStart = (left.displayMinute ?? 0) - (right.displayMinute ?? 0)
  if (byStart !== 0) return byStart
  const byDuration = duration(right) - duration(left)
  return byDuration || left.key.localeCompare(right.key)
}

function duration(item: CalendarItem): number {
  return item.end === null ? 0 : Math.max(0, Math.round((Date.parse(item.end) - Date.parse(item.start)) / 60_000))
}
