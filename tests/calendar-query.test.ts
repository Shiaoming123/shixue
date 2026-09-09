import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { queryCalendar } from '../src/domain/calendar/query.ts'
import { parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'
import { calendarMenuMoveCommand } from '../src/components/calendar/use-calendar-drag.ts'

test('task display and moving use the selected timezone regardless of stored timestamp offset', () => {
  const state = parseWorkspaceExport(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')).state
  const task = state.tasks.find(({ id }) => id === 'timed')!
  task.deadline = { dueAt: '2026-09-08T17:00:00Z', dueOn: null }
  const range = { start: '2026-09-09', end: '2026-09-10' }
  for (const startAt of ['2026-09-09T04:00:00Z', '2026-09-09T12:00:00+08:00']) {
    task.schedule.startAt = startAt
    const items = queryCalendar(state, range, {}, 'Asia/Shanghai').items
    const item = items.find(({ key }) => key === 'task:timed')!
    assert.equal(item.displayMinute, 720)
    assert.equal(items.find(({ key }) => key === 'deadline:timed')!.displayMinute, 60)
    const command = calendarMenuMoveCommand(item, '2026-09-09', 780, 60, { kind: 'timezone', timezone: 'Asia/Shanghai' })
    assert.equal(command.type, 'calendar.move')
    assert.ok('startAt' in command)
    assert.equal(Date.parse(command.startAt!), Date.parse('2026-09-09T05:00:00Z'))
  }
  const recurring = queryCalendar(state, { start: '2026-09-09', end: '2026-09-11' }, {}, 'America/New_York').items.find(({ occurrenceId, kind }) => occurrenceId !== null && kind === 'timed')!
  const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(recurring.start)))
  assert.equal(Math.floor(recurring.displayMinute! / 60), localHour)
})

test('calendar facets share workspace search and project completion per occurrence without writing facts', () => {
  const state = parseWorkspaceExport(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')).state
  const timed = state.tasks.find(({ id }) => id === 'timed')!
  state.tags.push({ id: 'tag:one', title: '学习', position: 0, createdAt: state.updatedAt, updatedAt: state.updatedAt, archivedAt: null })
  timed.tagIds = ['tag:one']
  timed.notes = 'ＡＢＣ notes'
  state.occurrences[0]!.status = 'completed'
  state.occurrences[1]!.status = 'pending'
  const before = structuredClone(state)
  const range = { start: '2026-09-09', end: '2026-09-11' }
  const result = queryCalendar(state, range, { text: 'abc', priority: 'high', tagId: 'tag:one' })
  assert.deepEqual(result.items.map(({ key }) => key), ['task:timed'])
  assert.deepEqual(result.items[0]!.presentation, { priority: 'high', status: 'planned', tags: ['学习'] })
  assert.deepEqual(result.tasks.map(({ id }) => id), ['timed'])
  assert.equal(queryCalendar(state, range, { text: '学习', priority: 'low' }).items.length, 0)
  assert.deepEqual(queryCalendar(state, range, { status: 'completed' }).items.map(({ key }) => key), ['occurrence:synthetic-occurrence-1'])
  assert.ok(queryCalendar(state, range, { status: 'active' }).items.some(({ key }) => key === 'occurrence:synthetic-occurrence-2'))
  assert.ok(!queryCalendar(state, range, { status: 'active' }).items.some(({ key }) => key === 'occurrence:synthetic-occurrence-1'))
  const empty = queryCalendar(state, range, { text: 'no matching task' })
  assert.deepEqual([empty.items, empty.tasks], [[], []])
  assert.deepEqual(empty.allItems, queryCalendar(state, range).allItems, 'Hidden tasks must remain available to overlap warnings')
  assert.deepEqual(state, before)
})
