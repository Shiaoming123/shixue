import assert from 'node:assert/strict'
import test from 'node:test'
import { destinationForSearchTask } from '../src/lib/search-result-navigation.ts'
import type { Task } from '../src/domain/workspace/types.ts'

function task(status: Task['status'], listId = 'list:one'): Task {
  return {
    id: `task:${status}`, title: status, notes: '', listId, sectionId: null, tagIds: [], status,
    priority: 'none', schedule: { startOn: null, startAt: null, estimateMinutes: null },
    deadline: { dueOn: null, dueAt: null }, recurrenceSeriesId: null, checklist: [], learning: null,
    revision: 1, createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', deletedAt: null,
  }
}

test('search result navigation opens each task in a destination that can preserve its exact selection', () => {
  assert.deepEqual(destinationForSearchTask(task('inbox'), ['list:one']), { kind: 'inbox' })
  assert.deepEqual(destinationForSearchTask(task('completed'), ['list:one']), { kind: 'completed' })
  assert.deepEqual(destinationForSearchTask(task('blocked'), ['list:one']), { kind: 'list', listId: 'list:one' })
  assert.deepEqual(destinationForSearchTask(task('cancelled'), ['list:one']), { kind: 'list', listId: 'list:one' })
  assert.deepEqual(destinationForSearchTask(task('planned'), []), { kind: 'lists' }, 'an archived list cannot become an invalid route')
  assert.deepEqual(destinationForSearchTask(task('planned', 'list:system:learning'), ['list:system:learning']), { kind: 'lists' })
})
