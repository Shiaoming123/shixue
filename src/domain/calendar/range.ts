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
  const last = addDays(addMonths(first, 1), -1)
  const end = addDays(startOfWeek(last, weekStartsOn), 7)
  return { start, end }
}

function startOfWeek(date: string, weekStartsOn: number): string {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return addDays(date, (weekday - weekStartsOn + 7) % 7 * -1)
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function addMonths(date: string, months: number): string {
  const [year, month] = date.split('-').map(Number)
  const total = year * 12 + month - 1 + months
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String(total % 12 + 1).padStart(2, '0')}-01`
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
    throw new Error(`Invalid calendar date: ${value}`)
  }
}
