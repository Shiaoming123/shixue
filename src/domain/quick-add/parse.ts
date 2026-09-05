import {
  assertIanaTimezone,
  formatInTimeZone,
  parseZonedDateTime,
  zonedDateTimeToInstant,
} from '../recurrence/timezone.ts'
import { findTokenRanges, rangesOverlap } from './tokenize.ts'
import type {
  QuickAddCandidate,
  QuickAddCandidateKind,
  QuickAddCandidateStatus,
  QuickAddContext,
  QuickAddParse,
  QuickAddSourceRange,
} from './types.ts'

type Rule = (state: ParserState) => void

interface ParserState {
  input: string
  context: QuickAddContext
  now: Date
  localNow: { date: string; time: string }
  entityTokens: QuickAddSourceRange[]
  candidates: QuickAddCandidate[]
}

interface ParsedDateToken {
  date: string
  status: QuickAddCandidateStatus
}

const PRIORITIES: ReadonlyMap<string, string> = new Map([
  ['1', 'high'],
  ['2', 'medium'],
  ['3', 'low'],
  ['4', 'none'],
] as const)

const RECURRENCES: ReadonlyMap<string, string> = new Map([
  ['每天', 'daily'],
  ['工作日', 'weekdays'],
  ['每周', 'weekly'],
  ['每月', 'monthly'],
  ['每年', 'yearly'],
  ['daily', 'daily'],
  ['weekdays', 'weekdays'],
  ['weekly', 'weekly'],
  ['monthly', 'monthly'],
  ['yearly', 'yearly'],
] as const)

const WEEKDAYS: ReadonlyMap<string, number> = new Map([
  ['周日', 0], ['周天', 0], ['星期日', 0], ['星期天', 0],
  ['周一', 1], ['星期一', 1], ['周二', 2], ['星期二', 2],
  ['周三', 3], ['星期三', 3], ['周四', 4], ['星期四', 4],
  ['周五', 5], ['星期五', 5], ['周六', 6], ['星期六', 6],
  ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3],
  ['thursday', 4], ['friday', 5], ['saturday', 6],
] as const)

const DATE_TOKEN_PATTERN = /(今天|明天|后天|(?:本|这|下)?(?:周|星期)[一二三四五六日天]|下周)|\b(today|tomorrow|weekday|next\s+week|(?:(?:this|next)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/giu
const ENTITY_PATTERN = /([#@])([^\s#@]+)/gu
const PRIORITY_PATTERN = /(?<![#@])(?:\bp([1-4])\b|优先级\s*([1-4]))/giu
const RECURRENCE_PATTERN = /(?<![#@])(?:每天|工作日|每周|每月|每年|\b(?:daily|weekdays|weekly|monthly|yearly)\b)/giu
const CHINESE_TIME_PATTERN = /^\s*((?:凌晨|早上|上午|中午|下午|晚上)?\s*(?:[01]?\d|2[0-3])(?::[0-5]\d|点(?:[0-5]?\d分?)?))/u
const ENGLISH_TIME_PATTERN = /^\s+((?:at\s+)?(?:(?:1[0-2]|0?\d)(?::[0-5]\d)?\s*(?:am|pm)|(?:[01]?\d|2[0-3]):[0-5]\d))\b/iu

export function parseQuickAdd(input: string, context: QuickAddContext): QuickAddParse {
  assertIanaTimezone(context.timezone)
  const now = new Date(context.now)
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid datetime: ${context.now}`)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/iu.test(context.now)) {
    throw new Error(`Invalid datetime (UTC offset required): ${context.now}`)
  }
  const localNow = parseZonedDateTime(context.now, context.timezone)
  const state: ParserState = {
    input,
    context,
    now,
    localNow,
    entityTokens: findTokenRanges(input, ENTITY_PATTERN),
    candidates: [],
  }

  return resolveTokens(state, [priorityRule, recurrenceRule, entityRule, dateTimeRule, deadlineRule])
}

function resolveTokens(state: ParserState, rules: readonly Rule[]): QuickAddParse {
  for (const rule of rules) rule(state)
  markSingularConflicts(state.candidates)
  state.candidates.sort((left, right) => left.source.start - right.source.start)
  return { originalTitle: state.input, candidates: state.candidates }
}

function priorityRule(state: ParserState): void {
  for (const source of findTokenRanges(state.input, PRIORITY_PATTERN)) {
    if (insideEntityToken(state, source)) continue
    const level = /[1-4]/u.exec(source.text)?.[0]
    if (level) addCandidate(state, 'priority', PRIORITIES.get(level)!, source)
  }
}

function recurrenceRule(state: ParserState): void {
  for (const source of findTokenRanges(state.input, RECURRENCE_PATTERN)) {
    if (insideEntityToken(state, source)) continue
    const value = RECURRENCES.get(source.text.toLocaleLowerCase())
    if (value) addCandidate(state, 'recurrence', value, source)
  }
}

function entityRule(state: ParserState): void {
  for (const source of state.entityTokens) {
    const prefix = source.text[0]
    const title = source.text.slice(1)
    const entities = prefix === '#' ? state.context.tags : state.context.lists
    const matches = entities.filter((entity) => entity.title === title)
    if (matches.length === 1) addCandidate(state, prefix === '#' ? 'tag' : 'list', matches[0].id, source)
    if (matches.length > 1) addCandidate(state, prefix === '#' ? 'tag' : 'list', title, source, 'ambiguous')
  }
}

function dateTimeRule(state: ParserState): void {
  for (const dateSource of findTokenRanges(state.input, DATE_TOKEN_PATTERN)) {
    if (isOccupied(state, dateSource) || insideEntityToken(state, dateSource)) continue
    const timeSource = followingTime(state.input, dateSource.end)
    if (deadlinePrefixStart(state.input, dateSource.start) !== null) continue
    addDateCandidate(state, 'schedule', dateSource, timeSource, dateSource.start)
  }
}

function deadlineRule(state: ParserState): void {
  for (const dateSource of findTokenRanges(state.input, DATE_TOKEN_PATTERN)) {
    if (insideEntityToken(state, dateSource)) continue
    const deadlineStart = deadlinePrefixStart(state.input, dateSource.start)
    if (deadlineStart === null) continue
    addDateCandidate(state, 'deadline', dateSource, followingTime(state.input, dateSource.end), deadlineStart)
  }
}

function addDateCandidate(
  state: ParserState,
  kind: 'schedule' | 'deadline',
  dateSource: QuickAddSourceRange,
  timeSource: QuickAddSourceRange | null,
  sourceStart: number,
): void {
  const parsedDate = resolveDateToken(dateSource.text, state.localNow.date)
  const time = timeSource ? parseTime(timeSource.text) : null
  let date = parsedDate.date
  let instant = time === null ? null : zonedDateTimeToInstant(date, time, state.context.timezone)
  if (instant && isUnqualifiedWeekday(dateSource.text) && instant.getTime() <= state.now.getTime()) {
    date = addDays(date, 7)
    instant = zonedDateTimeToInstant(date, time!, state.context.timezone)
  }
  const source = range(state.input, sourceStart, timeSource?.end ?? dateSource.end)
  const value = instant === null ? date : formatZonedValue(instant, state.context.timezone)
  addCandidate(state, kind, value, source, parsedDate.status)
}

function addCandidate(
  state: ParserState,
  kind: QuickAddCandidateKind,
  value: string,
  source: QuickAddSourceRange,
  status: QuickAddCandidateStatus = 'resolved',
): void {
  if (isOccupied(state, source)) return
  state.candidates.push({ id: `${kind}:${source.start}:${source.end}`, kind, value, source, status })
}

function isOccupied(state: ParserState, source: QuickAddSourceRange): boolean {
  return state.candidates.some((candidate) => rangesOverlap(candidate.source, source))
}

function insideEntityToken(state: ParserState, source: QuickAddSourceRange): boolean {
  return state.entityTokens.some((token) => rangesOverlap(token, source))
}

function followingTime(input: string, start: number): QuickAddSourceRange | null {
  const tail = input.slice(start)
  const matches = [CHINESE_TIME_PATTERN.exec(tail), ENGLISH_TIME_PATTERN.exec(tail)]
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((left, right) => right[0].length - left[0].length)
  const match = matches[0]
  if (!match) return null
  return range(input, start, start + match[0].length)
}

function parseTime(source: string): string {
  const token = source.trim().replace(/^at\s+/iu, '').replace(/\s+/gu, '')
  const chinese = /^(凌晨|早上|上午|中午|下午|晚上)?(\d{1,2})(?::(\d{2})|点(?:(\d{1,2})分?)?)$/u.exec(token)
  if (chinese) {
    const period = chinese[1] ?? ''
    let hour = Number(chinese[2])
    const minute = Number(chinese[3] ?? chinese[4] ?? 0)
    if ((period === '下午' || period === '晚上' || period === '中午') && hour < 12) hour += 12
    if ((period === '凌晨' || period === '上午' || period === '早上') && hour === 12) hour = 0
    return `${pad(hour)}:${pad(minute)}`
  }

  const english = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/iu.exec(token)
  if (!english) throw new Error(`Invalid quick-add time: ${source}`)
  let hour = Number(english[1])
  const minute = Number(english[2] ?? 0)
  const period = english[3]?.toLocaleLowerCase()
  if (period === 'am' && hour === 12) hour = 0
  if (period === 'pm' && hour < 12) hour += 12
  return `${pad(hour)}:${pad(minute)}`
}

function resolveDateToken(source: string, currentDate: string): ParsedDateToken {
  const token = source.trim().toLocaleLowerCase().replace(/\s+/gu, ' ')
  if (token === '今天' || token === 'today') return { date: currentDate, status: 'resolved' }
  if (token === '明天' || token === 'tomorrow') return { date: addDays(currentDate, 1), status: 'resolved' }
  if (token === '后天') return { date: addDays(currentDate, 2), status: 'resolved' }
  if (token === '下周' || token === 'next week') {
    return { date: startOfNextWeek(currentDate), status: 'ambiguous' }
  }
  if (token === 'weekday') return { date: nextWeekday(currentDate), status: 'resolved' }

  const normalized = token
    .replace(/^(?:本|这|下)(?=周|星期)/u, '')
    .replace(/^(?:this|next)\s+/u, '')
  const weekday = WEEKDAYS.get(normalized)
  if (weekday === undefined) throw new Error(`Invalid quick-add date: ${source}`)
  const explicitNext = /^(?:下(?:周|星期)|next\s+)/u.test(token)
  const explicitThis = /^(?:本|这)(?:周|星期)|^this\s+/u.test(token)
  const currentWeekday = weekdayOf(currentDate)
  let days = (weekday - currentWeekday + 7) % 7
  if (explicitNext) days += 7
  if (explicitThis) days = weekday - currentWeekday
  return { date: addDays(currentDate, days), status: 'resolved' }
}

function markSingularConflicts(candidates: QuickAddCandidate[]): void {
  for (const kind of ['schedule', 'deadline', 'priority', 'recurrence'] as const) {
    const matches = candidates.filter((candidate) => candidate.kind === kind)
    if (matches.length > 1) {
      for (const candidate of matches) candidate.status = 'ambiguous'
    }
  }
}

function isUnqualifiedWeekday(source: string): boolean {
  return WEEKDAYS.has(source.trim().toLocaleLowerCase())
}

function deadlinePrefixStart(input: string, dateStart: number): number | null {
  const prefix = input.slice(0, dateStart)
  const match = /(?:截止\s*|\bdue\s+)$/iu.exec(prefix)
  return match?.index ?? null
}

function formatZonedValue(instant: Date, timezone: string): string {
  const local = formatInTimeZone(instant, timezone)
  const [year, month, day] = local.date.split('-').map(Number)
  const [hour, minute] = local.time.split(':').map(Number)
  const offsetMinutes = Math.round((Date.UTC(year, month - 1, day, hour, minute) - instant.getTime()) / 60_000)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  return `${local.date}T${local.time}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

function range(input: string, start: number, end: number): QuickAddSourceRange {
  return { start, end, text: input.slice(start, end) }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function startOfNextWeek(date: string): string {
  const weekday = weekdayOf(date)
  return addDays(date, weekday === 0 ? 1 : 8 - weekday)
}

function nextWeekday(date: string): string {
  let candidate = addDays(date, 1)
  while (weekdayOf(candidate) === 0 || weekdayOf(candidate) === 6) candidate = addDays(candidate, 1)
  return candidate
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
