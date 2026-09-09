export interface CalendarSlot { date: string; minute: number; duration: number }
export interface CalendarCreateSlot extends CalendarSlot { kind: 'task' | 'event' }

export function calendarSlot(date: string, start: number, end = start): CalendarSlot {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Invalid calendar slot minute')
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar slot date')
  const snap = (minute: number) => Math.max(0, Math.min(1440, Math.round(minute / 15) * 15))
  const minute = Math.min(1425, Math.min(snap(start), snap(end)))
  const finish = Math.min(1440, Math.max(minute + (Math.abs(end - start) < 4 ? 30 : 15), snap(start), snap(end)))
  return { date, minute, duration: finish - minute }
}
