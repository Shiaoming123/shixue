import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { projectTaskItems } from '../src/lib/study-task-query.ts'
import { createStudyTaskQueryScaleFixture } from '../scripts/benchmark-fixtures/study-task-query-scale.ts'

test('empty Today projection stays linear at 10,000 tasks, 1,000 series and 50,000 precise occurrences', () => {
  const state = createStudyTaskQueryScaleFixture()
  assert.equal(state.tasks.length, 10_000)
  assert.equal(state.recurrenceSeries.length, 1_000)
  assert.equal(state.occurrences.length, 50_000)
  assert.equal(new Set(state.occurrences.map(({ scheduledAt }) => scheduledAt)).size, 50_000)
  assert.equal(
    Date.parse(state.occurrences[1]!.scheduledAt!) - Date.parse(state.occurrences[0]!.scheduledAt!),
    24 * 60 * 60 * 1_000,
  )
  const startedAt = performance.now()

  const result = projectTaskItems(state, { from: '2026-09-05', to: '2026-09-05' }, 'Asia/Shanghai')
  const elapsedMs = performance.now() - startedAt

  assert.deepEqual(result, [])
  // This generous CI guard catches the formatter/comparator explosion without
  // pretending heterogeneous runners can enforce the locked local benchmark.
  assert.ok(elapsedMs < 1_500, `empty Today projection took ${elapsedMs.toFixed(1)}ms`)
})
