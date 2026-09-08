import assert from 'node:assert/strict'
import test from 'node:test'

const routing = await import('../src/lib/task-completion-routing.ts').catch(() => null)

const tasks = [
  { id: 'general', title: 'General', mode: 'general', status: 'planned' },
  { id: 'learning', title: 'Learning', mode: 'learning', status: 'planned' },
  { id: 'review', title: 'Review', mode: 'learning', status: 'planned' },
  { id: 'finished-learning', title: 'Finished learning', mode: 'learning', status: 'completed' },
  { id: 'cancelled-learning', title: 'Cancelled learning', mode: 'learning', status: 'cancelled' },
  { id: 'inbox-learning', title: 'Inbox learning', mode: 'learning', status: 'inbox' },
  { id: 'blocked-learning', title: 'Blocked learning', mode: 'learning', status: 'blocked' },
] as const
const reviewTaskLinks = [{ reviewTaskId: 'review' }] as const
const snapshot = { tasks, reviewTaskLinks }

test('ordinary unfinished learning tasks open evidence while linked reviews enter recall and completed tasks keep their command route', () => {
  assert.ok(routing, 'task completion routing must be implemented')
  assert.equal(routing.routeSingleTaskCompletion(snapshot, 'general'), 'toggle')
  assert.equal(routing.routeSingleTaskCompletion(snapshot, 'learning'), 'evidence')
  assert.equal(routing.routeSingleTaskCompletion(snapshot, 'review'), 'review')
  assert.equal(routing.routeSingleTaskCompletion(snapshot, 'finished-learning'), 'toggle')
  assert.equal(routing.routeSingleTaskCompletion(snapshot, 'inbox-learning'), 'plan')
  assert.equal(routing.routeSingleTaskCompletion(snapshot, 'blocked-learning'), 'unblock')
})

test('a mixed batch reports every learning task before general completion can begin', () => {
  assert.ok(routing, 'task completion routing must be implemented')
  assert.deepEqual(routing.learningBatchBlockers(snapshot, ['general', 'learning', 'review']), [
    { id: 'learning', title: 'Learning' },
    { id: 'review', title: 'Review' },
  ])
  assert.deepEqual(routing.learningBatchBlockers(snapshot, ['general']), [])
  assert.deepEqual(routing.learningBatchBlockers(snapshot, ['general', 'finished-learning', 'cancelled-learning']), [])
})
