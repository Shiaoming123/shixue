import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldAutoSelectTask } from '../src/lib/task-detail-layout.ts'

test('only the split detail layout automatically selects the first task', () => {
  for (const width of [700, 810, 819, 820, 1279]) {
    assert.equal(shouldAutoSelectTask(width), false, `${width}px uses an overlay detail`)
  }
  for (const width of [1280, 1440]) {
    assert.equal(shouldAutoSelectTask(width), true, `${width}px uses the split detail`)
  }
})
