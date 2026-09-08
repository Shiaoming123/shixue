import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreDeletedInlineTaskFocus, shouldAutoSelectTask } from '../src/lib/task-detail-layout.ts'

test('only the split detail layout automatically selects the first task', () => {
  for (const width of [700, 810, 819, 820, 1279]) {
    assert.equal(shouldAutoSelectTask(width), false, `${width}px uses an overlay detail`)
  }
  for (const width of [1280, 1440]) {
    assert.equal(shouldAutoSelectTask(width), true, `${width}px uses the split detail`)
  }
})

test('deleted split detail restores focus after its inline trigger is removed', () => {
  let focused = 0
  const fallback = () => ({ isConnected: true, focus: () => { focused += 1 } }) as HTMLElement

  assert.equal(restoreDeletedInlineTaskFocus(1279, fallback), false)
  assert.equal(focused, 0, 'overlay detail owns its focus restoration')
  assert.equal(restoreDeletedInlineTaskFocus(1280, fallback), true)
  assert.equal(focused, 1, 'split detail focuses the surviving task fallback')
})
