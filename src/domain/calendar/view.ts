import type { CalendarItem } from './project.ts'
import type { CalendarView } from './range.ts'

export interface CalendarDayGroup {
  date: string
  items: CalendarItem[]
}

export interface AgendaWindow {
  start: number
  end: number
  before: number
  after: number
}

export interface AgendaScrollAnchor {
  key: string
  offset: number
}

export function resolveCalendarMode(requested: CalendarView, width: number): CalendarView {
  return width <= 819 && requested === 'week' ? 'day' : requested
}

export function monthOverflow(items: readonly CalendarItem[]): { visible: CalendarItem[]; hiddenCount: number } {
  return { visible: items.slice(0, 3), hiddenCount: Math.max(0, items.length - 3) }
}

export function compareCalendarItems(left: CalendarItem, right: CalendarItem): number {
  const byKind = itemOrder(left) - itemOrder(right)
  if (byKind !== 0) return byKind
  const byMinute = (left.displayMinute ?? -1) - (right.displayMinute ?? -1)
  return byMinute || left.key.localeCompare(right.key)
}

export function groupCalendarItems(items: readonly CalendarItem[]): CalendarDayGroup[] {
  const byDate = new Map<string, CalendarItem[]>()
  for (const item of items) {
    const group = byDate.get(item.displayDate) ?? []
    group.push(item)
    byDate.set(item.displayDate, group)
  }
  return [...byDate]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entries]) => ({ date, items: entries.slice().sort(compareCalendarItems) }))
}

export function shouldVirtualizeAgenda(itemRowCount: number): boolean {
  return itemRowCount > 500
}

export function agendaWindow(
  rowKeys: readonly string[],
  measuredHeights: ReadonlyMap<string, number>,
  scrollTop: number,
  viewportHeight: number,
  focusedKey = '',
): AgendaWindow | null {
  if (viewportHeight <= 0 || rowKeys.some((key) => (measuredHeights.get(key) ?? 0) <= 0)) return null

  const offsets = [0]
  for (const key of rowKeys) offsets.push(offsets[offsets.length - 1]! + measuredHeights.get(key)!)
  const overscan = viewportHeight * 2
  const from = Math.max(0, scrollTop - overscan)
  const to = scrollTop + viewportHeight + overscan
  let start = rowKeys.findIndex((_, index) => offsets[index + 1]! >= from)
  if (start < 0) start = rowKeys.length
  let end = rowKeys.findIndex((_, index) => offsets[index]! > to)
  if (end < 0) end = rowKeys.length
  const focusedIndex = focusedKey ? rowKeys.indexOf(focusedKey) : -1
  if (focusedIndex >= 0) {
    start = Math.min(start, focusedIndex)
    end = Math.max(end, focusedIndex + 1)
  }
  return {
    start,
    end,
    before: offsets[start]!,
    after: offsets[rowKeys.length]! - offsets[end]!,
  }
}

export function agendaScrollAnchor(
  rowKeys: readonly string[],
  measuredHeights: ReadonlyMap<string, number>,
  scrollTop: number,
): AgendaScrollAnchor | null {
  let top = 0
  for (const key of rowKeys) {
    const height = measuredHeights.get(key) ?? 0
    if (height <= 0) return null
    if (top + height > scrollTop) return { key, offset: scrollTop - top }
    top += height
  }
  return rowKeys.length ? { key: rowKeys[rowKeys.length - 1]!, offset: 0 } : null
}

export function agendaScrollTop(
  rowKeys: readonly string[],
  measuredHeights: ReadonlyMap<string, number>,
  anchor: AgendaScrollAnchor,
): number | null {
  let top = 0
  for (const key of rowKeys) {
    if (key === anchor.key) return top + anchor.offset
    const height = measuredHeights.get(key) ?? 0
    if (height <= 0) return null
    top += height
  }
  return null
}

function itemOrder(item: CalendarItem): number {
  if (item.kind === 'all-day') return 0
  if (item.kind === 'deadline-marker' && item.displayMinute === null) return 1
  if (item.kind === 'timed') return 2
  return 3
}
