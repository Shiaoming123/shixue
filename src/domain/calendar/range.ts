export type CalendarView = 'day' | 'week' | 'month' | 'agenda'

export interface CalendarRange {
  /** Inclusive local calendar date. */
  start: string
  /** Exclusive local calendar date. */
  end: string
}

export function calendarRange(view: CalendarView, anchor: string, weekStartsOn: number): CalendarRange {
  assertDate(anchor)
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new Error(`Invalid week start: ${weekStartsOn}`)
  }

  if (view === 'day') return { start: anchor, end: addDays(anchor, 1) }
  if (view === 'week') {
    const start = startOfWeek(anchor, weekStartsOn)
    return { start, end: addDays(start, 7) }
  }
  if (view === 'agenda') return { start: anchor, end: addDays(anchor, 30) }

  const first = `${anchor.slice(0, 8)}01`
  const start = startOfWeek(first, weekStartsOn)
  return { start, end: addDays(start, 42) }
}

function startOfWeek(date: string, weekStartsOn: number): string {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return addDays(date, (weekday - weekStartsOn + 7) % 7 * -1)
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function assertDate(value: string): void {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date: ${value}`)
  }
}
