import assert from 'node:assert/strict'
import test from 'node:test'
import { parseQuickAdd } from '../src/domain/quick-add/parse.ts'
import type { QuickAddContext } from '../src/domain/quick-add/types.ts'

function context(
  now: string,
  timezone = 'Asia/Shanghai',
  overrides: Partial<QuickAddContext> = {},
): QuickAddContext {
  return {
    now,
    timezone,
    lists: [{ id: 'list-inbox', title: '收件箱' }, { id: 'list-work', title: 'Work' }],
    tags: [{ id: 'tag-math', title: '数学' }, { id: 'tag-study', title: 'study' }],
    ...overrides,
  }
}

test('parses without mutating the submitted title', () => {
  const input = '周五下午3点 复习线代 #数学 p1'
  const result = parseQuickAdd(input, context('2026-09-04T09:00:00+08:00'))

  assert.equal(result.originalTitle, input)
  assert.deepEqual(result.candidates.map((candidate) => candidate.kind), ['schedule', 'tag', 'priority'])
  assert.equal(result.candidates.find((candidate) => candidate.kind === 'schedule')?.value, '2026-09-04T15:00:00+08:00')
  assert.equal(result.candidates.find((candidate) => candidate.kind === 'tag')?.value, 'tag-math')
  assert.equal(result.candidates.find((candidate) => candidate.kind === 'priority')?.value, 'high')
  for (const candidate of result.candidates) {
    assert.equal(input.slice(candidate.source.start, candidate.source.end), candidate.source.text)
  }
})

test('parses equivalent Chinese and English structured tokens', () => {
  const cases = [
    {
      input: '明天上午9点 阅读 @收件箱 #数学 p2 每天',
      expected: [
        ['schedule', '2026-09-05T09:00:00+08:00'],
        ['list', 'list-inbox'],
        ['tag', 'tag-math'],
        ['priority', 'medium'],
        ['recurrence', 'daily'],
      ],
    },
    {
      input: 'tomorrow 9:30am Read @Work #study p3 weekly',
      expected: [
        ['schedule', '2026-09-05T09:30:00+08:00'],
        ['list', 'list-work'],
        ['tag', 'tag-study'],
        ['priority', 'low'],
        ['recurrence', 'weekly'],
      ],
    },
  ] as const

  for (const item of cases) {
    const actual = parseQuickAdd(item.input, context('2026-09-04T09:00:00+08:00'))
    assert.deepEqual(actual.candidates.map(({ kind, value }) => [kind, value]), item.expected)
    assert.ok(actual.candidates.every((candidate) => candidate.status === 'resolved'))
  }
})

test('maps bilingual priority and recurrence tokens to domain values', () => {
  const cases = [
    ['p1', 'priority', 'high'], ['p2', 'priority', 'medium'],
    ['p3', 'priority', 'low'], ['p4', 'priority', 'none'],
    ['优先级1', 'priority', 'high'], ['优先级4', 'priority', 'none'],
    ['每天', 'recurrence', 'daily'], ['工作日', 'recurrence', 'weekdays'],
    ['每周', 'recurrence', 'weekly'], ['每月', 'recurrence', 'monthly'],
    ['每年', 'recurrence', 'yearly'], ['daily', 'recurrence', 'daily'],
    ['weekdays', 'recurrence', 'weekdays'], ['weekly', 'recurrence', 'weekly'],
    ['monthly', 'recurrence', 'monthly'], ['yearly', 'recurrence', 'yearly'],
  ] as const

  for (const [input, kind, value] of cases) {
    const result = parseQuickAdd(input, context('2026-09-04T09:00:00+08:00'))
    assert.deepEqual(result.candidates.map((candidate) => [candidate.kind, candidate.value]), [[kind, value]])
  }
})

test('only resolves exact list and tag tokens and retains unknown tokens in the original title', () => {
  const exact = parseQuickAdd('@收件箱 #数学', context('2026-09-04T09:00:00+08:00'))
  assert.deepEqual(exact.candidates.map(({ kind, value }) => [kind, value]), [
    ['list', 'list-inbox'],
    ['tag', 'tag-math'],
  ])

  const unknownInput = '@不存在 #unknown #明天 @today 保留这些词'
  const unknown = parseQuickAdd(unknownInput, context('2026-09-04T09:00:00+08:00'))
  assert.equal(unknown.originalTitle, unknownInput)
  assert.deepEqual(unknown.candidates, [])
})

test('treats a qualified Chinese weekday as one date token', () => {
  const result = parseQuickAdd('下周五下午3点', context('2026-09-04T09:00:00+08:00'))

  assert.deepEqual(result.candidates.map(({ kind, value, source }) => ({ kind, value, text: source.text })), [{
    kind: 'schedule',
    value: '2026-09-11T15:00:00+08:00',
    text: '下周五下午3点',
  }])
})

test('marks duplicate exact entity titles as ambiguous instead of choosing an id', () => {
  const result = parseQuickAdd('@收件箱 #数学', context('2026-09-04T09:00:00+08:00', 'Asia/Shanghai', {
    lists: [{ id: 'list-a', title: '收件箱' }, { id: 'list-b', title: '收件箱' }],
    tags: [{ id: 'tag-a', title: '数学' }, { id: 'tag-b', title: '数学' }],
  }))

  assert.deepEqual(result.candidates.map(({ kind, value, status }) => ({ kind, value, status })), [
    { kind: 'list', value: '收件箱', status: 'ambiguous' },
    { kind: 'tag', value: '数学', status: 'ambiguous' },
  ])
})

test('keeps date-only schedules as calendar dates rather than midnight timestamps', () => {
  const result = parseQuickAdd('明天整理笔记', context('2026-09-04T23:30:00+08:00'))
  assert.deepEqual(result.candidates.map(({ kind, value }) => [kind, value]), [['schedule', '2026-09-05']])
})

test('parses independent deadline dates and times without also producing a schedule', () => {
  const cases = [
    ['截止明天18点 交报告', '2026-09-05T18:00:00+08:00'],
    ['due tomorrow 5pm submit report', '2026-09-05T17:00:00+08:00'],
    ['截止后天 交材料', '2026-09-06'],
  ] as const

  for (const [input, value] of cases) {
    const result = parseQuickAdd(input, context('2026-09-04T09:00:00+08:00'))
    assert.deepEqual(result.candidates.map(({ kind, value: actual }) => [kind, actual]), [['deadline', value]])
  }
})

test('uses non-overlapping source ranges when deadline text contains a date and time', () => {
  const input = 'p1 截止明天下午3点 #数学'
  const result = parseQuickAdd(input, context('2026-09-04T09:00:00+08:00'))

  assert.deepEqual(result.candidates.map((candidate) => candidate.kind), ['priority', 'deadline', 'tag'])
  for (let index = 1; index < result.candidates.length; index += 1) {
    assert.ok(result.candidates[index - 1].source.end <= result.candidates[index].source.start)
  }
})

test('weekday without this or next includes today only while its time is still future', () => {
  const futureToday = parseQuickAdd('Friday 3pm', context('2026-09-04T09:00:00+08:00'))
  const passedToday = parseQuickAdd('Friday 3pm', context('2026-09-04T16:00:00+08:00'))
  const nextFriday = parseQuickAdd('next Friday 3pm', context('2026-09-04T09:00:00+08:00'))

  assert.equal(futureToday.candidates[0]?.value, '2026-09-04T15:00:00+08:00')
  assert.equal(passedToday.candidates[0]?.value, '2026-09-11T15:00:00+08:00')
  assert.equal(nextFriday.candidates[0]?.value, '2026-09-11T15:00:00+08:00')
})

test('marks conflicting same-kind date candidates ambiguous rather than selecting one', () => {
  const result = parseQuickAdd('周一上午9点 周二下午3点 复习', context('2026-09-04T09:00:00+08:00'))
  const schedules = result.candidates.filter((candidate) => candidate.kind === 'schedule')

  assert.equal(schedules.length, 2)
  assert.deepEqual(schedules.map((candidate) => candidate.status), ['ambiguous', 'ambiguous'])
  assert.deepEqual(schedules.map((candidate) => candidate.value), [
    '2026-09-07T09:00:00+08:00',
    '2026-09-08T15:00:00+08:00',
  ])
})

test('resolves DST gap and fold wall times through the shared timezone policy', () => {
  const spring = parseQuickAdd(
    'tomorrow 2:30am',
    context('2026-03-07T12:00:00-08:00', 'America/Los_Angeles'),
  )
  const fall = parseQuickAdd(
    'tomorrow 1:30am',
    context('2026-10-31T12:00:00-07:00', 'America/Los_Angeles'),
  )

  assert.equal(spring.candidates[0]?.value, '2026-03-08T03:30:00-07:00')
  assert.equal(fall.candidates[0]?.value, '2026-11-01T01:30:00-07:00')
})

test('rejects an invalid explicit clock or IANA timezone', () => {
  assert.throws(
    () => parseQuickAdd('today', context('not-a-date')),
    /Invalid datetime/,
  )
  assert.throws(
    () => parseQuickAdd('today', context('2026-09-04T09:00:00+08:00', 'Mars/Olympus_Mons')),
    /Invalid IANA timezone/,
  )
})
