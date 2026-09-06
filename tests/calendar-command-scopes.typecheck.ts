import type { CalendarResizeCommand } from '../src/domain/capabilities/calendar-commands.ts'

const supportedResizeScopes: CalendarResizeCommand['scope'][] = ['single', 'occurrence', undefined]

// @ts-expect-error Calendar resize cannot target a whole or future recurrence range.
const unsupportedResizeSeriesScope: CalendarResizeCommand['scope'] = 'series'

// @ts-expect-error Calendar resize cannot target future occurrences.
const unsupportedResizeFutureScope: CalendarResizeCommand['scope'] = 'future'

void supportedResizeScopes
void unsupportedResizeSeriesScope
void unsupportedResizeFutureScope
