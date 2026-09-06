import assert from 'node:assert/strict'
import test from 'node:test'
import { layoutTimedItems } from '../src/domain/calendar/layout.ts'
import type { CalendarItem } from '../src/domain/calendar/project.ts'

test('overlapping blocks receive stable columns', () => {
  assert.deepEqual(layoutTimedItems(overlapFixture()).map(({ key, column, columnCount }) => [key, column, columnCount]), [
    ['first', 0, 2],
    ['second', 1, 2],
  ])
})

test('adjacent blocks share a column and independent groups retain their own width', () => {
  const items = [
    timed('first', '2026-09-04T09:00:00Z', '2026-09-04T10:00:00Z'),
    timed('second', '2026-09-04T10:00:00Z', '2026-09-04T11:00:00Z'),
    timed('third', '2026-09-04T12:00:00Z', '2026-09-04T13:00:00Z'),
  ]
  const before = structuredClone(items)

  assert.deepEqual(layoutTimedItems(items).map(({ key, column, columnCount }) => [key, column, columnCount]), [
    ['first', 0, 1], ['second', 0, 1], ['third', 0, 1],
  ])
  assert.deepEqual(items, before)
})

test('sorts equal starts by longer duration then stable key before laying out', () => {
  const items = [
    timed('z-short', '2026-09-04T09:00:00Z', '2026-09-04T09:30:00Z'),
    timed('a-long', '2026-09-04T09:00:00Z', '2026-09-04T10:00:00Z'),
    { key: 'all-day', taskId: 'task:all', occurrenceId: null, kind: 'all-day', start: '2026-09-04', end: null } satisfies CalendarItem,
  ]

  assert.deepEqual(layoutTimedItems(items).map(({ key, column, columnCount }) => [key, column, columnCount]), [
    ['a-long', 0, 2], ['z-short', 1, 2],
  ])
})

function overlapFixture(): CalendarItem[] {
  return [
    timed('first', '2026-09-04T09:00:00Z', '2026-09-04T10:00:00Z'),
    timed('second', '2026-09-04T09:30:00Z', '2026-09-04T10:30:00Z'),
  ]
}

function timed(key: string, start: string, end: string): CalendarItem {
  return { key, taskId: `task:${key}`, occurrenceId: null, kind: 'timed', start, end }
}
