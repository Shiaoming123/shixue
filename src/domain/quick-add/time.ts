export function normalizeQuickAddTime(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const match = /^(\d{1,2}):?(\d{0,2})$/u.exec(trimmed)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2] || 0)
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
