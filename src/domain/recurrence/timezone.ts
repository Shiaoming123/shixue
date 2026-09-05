export function assertIanaTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(0))
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`)
  }
}

export function parseZonedDateTime(value: string, timezone: string): { date: string; time: string } {
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid datetime: ${value}`)
  return formatInTimeZone(instant, timezone)
}

export function formatInTimeZone(instant: Date, timezone: string): { date: string; time: string } {
  assertIanaTimezone(timezone)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

/**
 * Resolves a local wall clock deterministically. Ambiguous times use the first
 * matching instant; nonexistent DST-gap times shift forward by the gap.
 */
export function zonedDateTimeToInstant(date: string, time: string, timezone: string): Date {
  assertIanaTimezone(timezone)
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute))
  let shiftedForward: Date | null = null
  let shiftedForwardMinutes = Number.POSITIVE_INFINITY
  for (let i = 0; i < 8; i += 1) {
    const parts = formatInTimeZone(utc, timezone)
    if (parts.date === date && parts.time === time) return utc
    const localMinutes = toMinuteNumber(parts.date, parts.time)
    const targetMinutes = toMinuteNumber(date, time)
    if (parts.date === date && localMinutes > targetMinutes && localMinutes < shiftedForwardMinutes) {
      shiftedForward = utc
      shiftedForwardMinutes = localMinutes
    }
    utc = new Date(utc.getTime() + (targetMinutes - localMinutes) * 60_000)
  }
  if (shiftedForward) return shiftedForward
  throw new Error(`Unable to resolve ${date}T${time} in ${timezone}`)
}

function toMinuteNumber(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return (((year * 12 + month) * 31 + day) * 24 * 60) + hour * 60 + minute
}
