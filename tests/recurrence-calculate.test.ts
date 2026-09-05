import test from 'node:test'
import assert from 'node:assert/strict'
import { nextAfterCompletion, nextFixedOccurrence } from '../src/domain/recurrence/calculate.ts'
import type { RecurrenceSeries } from '../src/domain/workspace/types.ts'

function series(overrides: Partial<RecurrenceSeries>): RecurrenceSeries {
  return {
    id: 'series-1',
    taskId: 'task-1',
    revision: 1,
    cadence: { kind: 'daily', interval: 1 },
    basis: 'fixed_schedule',
    anchorAt: '2026-09-04T09:00:00-04:00',
    end: { kind: 'never' },
    timezone: 'America/New_York',
    createdThrough: null,
    createdCount: 0,
    ...overrides,
  }
}

test('weekly recurrence returns the next Friday in the configured timezone', () => {
  const value = nextFixedOccurrence(
    series({
      cadence: { kind: 'weekly', interval: 1, weekdays: [5] },
      anchorAt: '2026-09-04T09:00:00-04:00',
      timezone: 'America/New_York',
    }),
    '2026-09-04T08:00:00-04:00',
  )
  assert.equal(value, '2026-09-04T13:00:00.000Z')
})

test('monthly recurrence clamps to the last day of short months', () => {
  const value = nextFixedOccurrence(
    series({
      cadence: { kind: 'monthly', interval: 1, dayOfMonth: 31 },
      anchorAt: '2026-01-31T09:00:00-05:00',
      timezone: 'America/New_York',
    }),
    '2026-01-31T08:00:00-05:00',
  )
  assert.equal(value, '2026-01-31T14:00:00.000Z')
  assert.equal(nextFixedOccurrence(series({
    cadence: { kind: 'monthly', interval: 1, dayOfMonth: 31 },
    anchorAt: '2026-01-31T09:00:00-05:00', timezone: 'America/New_York',
  }), '2026-01-31T14:01:00.000Z'), '2026-02-28T14:00:00.000Z')
})

test('DST-safe arithmetic keeps the local wall clock time across the spring transition', () => {
  const value = nextFixedOccurrence(
    series({
      cadence: { kind: 'daily', interval: 1 },
      anchorAt: '2026-03-07T09:00:00-05:00',
      timezone: 'America/New_York',
    }),
    '2026-03-07T08:00:00-05:00',
  )
  assert.equal(value, '2026-03-07T14:00:00.000Z')
  assert.equal(nextFixedOccurrence(series({
    cadence: { kind: 'daily', interval: 1 }, anchorAt: '2026-03-08T09:00:00-04:00', timezone: 'America/New_York',
  }), '2026-03-08T13:01:00.000Z'), '2026-03-09T13:00:00.000Z')
})

test('after-completion recurrence stays strictly after the completion timestamp', () => {
  const value = nextAfterCompletion(
    series({
      cadence: { kind: 'daily', interval: 1 },
      anchorAt: '2026-09-04T09:00:00-04:00',
      timezone: 'America/New_York',
    }),
    '2026-09-04T09:00:00-04:00',
  )
  assert.equal(value, '2026-09-05T13:00:00.000Z')
})

test('end-after-count stops once the configured number of occurrences is exhausted', () => {
  const value = nextFixedOccurrence(
    series({
      cadence: { kind: 'daily', interval: 1 },
      end: { kind: 'after', count: 1 },
    }),
    '2026-09-05T00:00:00-04:00',
  )
  assert.equal(value, null)
})

test('end-on stops on the configured calendar date', () => {
  assert.equal(nextFixedOccurrence(series({ end: { kind: 'on', date: '2026-09-05' } }), '2026-09-05T14:00:00.000Z'), null)
})
