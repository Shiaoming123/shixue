import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteDB, openDB } from 'idb'
import {
  addTaskChecklistItem,
  bulkCancelStudyTasks,
  bulkDeleteStudyTasks,
  bulkRescheduleStudyTasks,
  captureStudyTask,
  completeStudyTask,
  deleteStudyTask,
  loadStudyState,
  planStudyTask,
  pauseStudySession,
  rescheduleStudyTask,
  resumeStudySession,
  archiveStudyListGroup,
  saveStudyListGroup,
  saveStudyScratchpad,
  saveStudySession,
  reorderStudyTasks,
  setTaskChecklistItem,
  startStudyTask,
  switchStudyTask,
  transitionStudyTask,
  toggleStudyTaskCompletion,
  updateStudyTask,
} from '../src/lib/study.ts'
import { createInMemoryStudyStore, createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createIndexedDbStudyStore, V1_STUDY_STATE_BACKUP_KEY } from '../src/storage/study/indexeddb.ts'
import { registerWorkspaceStore } from '../src/storage/workspace/registry.ts'
import {
  BACKUP_V1_STUDY_STATE_SQL,
  createTauriSqliteStudyStore,
  REPLACE_V1_AFTER_BACKUP_SQL,
} from '../src/storage/study/tauri-sqlite.ts'
import type { StudyState, StudyStateV1, StudyStore } from '../src/storage/study/types.ts'
import { createIndexedDbTodoStore } from '../src/storage/todos/indexeddb.ts'

function emptyState(): StudyState {
  return {
    version: 2,
    topics: [{
      id: 'topic-1',
      title: 'LangGraph',
      goal: 'Build a resumable workflow',
      successCriteria: ['restart resumes'],
      weeklyTargetMinutes: 120,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      archivedAt: null,
    }],
    tasks: [],
    sessions: [],
    taskEvents: [],
    completionRecords: [],
    updatedAt: '2026-09-04T00:00:00.000Z',
  }
}

function legacyState(): StudyStateV1 {
  return {
    version: 1,
    topics: [{
      id: 'topic-1', title: 'LangGraph', goal: 'Build a resumable workflow',
      successCriteria: ['restart resumes'], weeklyTargetMinutes: 120,
      steps: [{
        id: 'step-1', title: 'Persist state', acceptanceCriteria: ['restart resumes'],
        estimateMinutes: 45, scheduledOn: '2026-09-04',
      }],
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
      archivedAt: null,
    }],
    sessions: [],
    updatedAt: '2026-09-04T00:00:00.000Z',
  }
}

async function useEmptyStore() {
  registerWorkspaceStore(createInMemoryWorkspaceStore(emptyState()))
}

test('task commands complete the inbox-to-evidence learning loop atomically', async () => {
  await useEmptyStore()
  await captureStudyTask(
    { title: 'Read checkpointing guide' },
    { taskId: 'task-1', eventId: 'event-1', now: '2026-09-04T08:00:00.000Z' },
  )
  await planStudyTask(
    'task-1',
    {
      topicId: 'topic-1',
      plannedOn: '2026-09-05',
      dueOn: '2026-09-07',
      estimateMinutes: 45,
      acceptanceCriteria: ['restart resumes'],
    },
    { eventId: 'event-2', now: '2026-09-04T08:05:00.000Z' },
  )
  await startStudyTask('task-1', {
    sessionId: 'session-1',
    eventId: 'event-3',
    now: '2026-09-05T08:00:00.000Z',
  })
  await completeStudyTask(
    {
      taskId: 'task-1',
      sessionId: 'session-1',
      learned: 'Checkpoint and thread id are separate.',
      evidence: 'Six tests passed.',
      blocker: '',
      nextAction: 'Add rejection E2E.',
      mastery: 3,
    },
    {
      recordId: 'record-1',
      eventId: 'event-4',
      now: '2026-09-05T08:45:00.000Z',
    },
  )

  const state = await loadStudyState()
  assert.equal(state.tasks[0].status, 'completed')
  assert.equal(state.tasks[0].revision, 4)
  assert.equal(state.sessions[0].state, 'finished')
  assert.equal(state.sessions[0].elapsedSeconds, 2700)
  assert.equal(state.completionRecords[0].nextReviewOn, '2026-09-06')
  assert.deepEqual(
    state.taskEvents.map(({ type }) => type),
    ['captured', 'planned', 'started', 'completed'],
  )
})

test('checklist commands persist stable items without noisy TaskEvents', async () => {
  await useEmptyStore()
  await captureStudyTask(
    { title: 'Build demo' },
    { taskId: 'task-1', eventId: 'event-1', now: '2026-09-04T08:00:00.000Z' },
  )
  await addTaskChecklistItem(
    'task-1',
    'Run restart test',
    { itemId: 'check-1', now: '2026-09-04T08:01:00.000Z' },
  )
  await setTaskChecklistItem(
    'task-1',
    'check-1',
    true,
    '2026-09-04T08:02:00.000Z',
  )

  const state = await loadStudyState()
  assert.deepEqual(state.tasks[0].checklist, [{
    id: 'check-1',
    text: 'Run restart test',
    checked: true,
    checkedAt: '2026-09-04T08:02:00.000Z',
    position: 0,
  }])
  assert.deepEqual(state.taskEvents.map(({ type }) => type), ['captured'])
})

test('updating task metadata preserves lifecycle status and revision CAS', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Draft' }, { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' })
  await planStudyTask('task-1', {}, { eventId: 'plan', now: '2026-09-04T08:01:00.000Z' })
  await transitionStudyTask('task-1', 'blocked', { reason: 'Missing fixture', eventId: 'block', now: '2026-09-04T08:02:00.000Z' })

  const updated = await updateStudyTask('task-1', {
    title: 'Build restart fixture',
    notes: 'Keep the failure reproducible.',
    dueOn: '2026-09-08',
    acceptanceCriteria: ['Restart resumes from the same checkpoint.'],
  }, { expectedRevision: 3, now: '2026-09-04T08:03:00.000Z' })

  assert.equal(updated.status, 'blocked')
  assert.equal(updated.blockedReason, 'Missing fixture')
  assert.equal(updated.revision, 4)
  assert.deepEqual((await loadStudyState()).taskEvents.map(({ type }) => type), ['captured', 'planned', 'blocked'])
  await assert.rejects(
    updateStudyTask('task-1', { notes: 'stale' }, { expectedRevision: 3, now: '2026-09-04T08:04:00.000Z' }),
    /revision conflict/i,
  )
})

test('task creation and planning persist todo metadata atomically', async () => {
  await useEmptyStore()
  const captured = await captureStudyTask({
    title: 'Prepare demo',
    topicId: 'topic-1',
    plannedOn: '2026-09-05',
    dueOn: '2026-09-06',
    reminderAt: '2026-09-05T01:30:00.000Z',
    priority: 'high',
  }, { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' })

  assert.deepEqual(
    {
      topicId: captured.topicId,
      plannedOn: captured.plannedOn,
      dueOn: captured.dueOn,
      reminderAt: captured.reminderAt,
      priority: captured.priority,
    },
    {
      topicId: 'topic-1',
      plannedOn: '2026-09-05',
      dueOn: '2026-09-06',
      reminderAt: '2026-09-05T01:30:00.000Z',
      priority: 'high',
    },
  )

  const planned = await planStudyTask('task-1', {
    reminderAt: null,
    priority: 'low',
  }, { eventId: 'plan', now: '2026-09-04T08:01:00.000Z' })
  assert.equal(planned.reminderAt, null)
  assert.equal(planned.priority, 'low')
})

test('capture preserves a date-only schedule after its deadline', async () => {
  const store = createInMemoryWorkspaceStore(emptyState())
  registerWorkspaceStore(store)

  const captured = await captureStudyTask({
    title: 'Captured conflict',
    plannedOn: '2026-09-07',
    dueOn: '2026-09-06',
  }, { taskId: 'captured-conflict', eventId: 'capture-conflict', now: '2026-09-04T08:00:00.000Z' })

  assert.equal(captured.plannedOn, '2026-09-07')
  assert.equal(captured.dueOn, '2026-09-06')
  const persisted = (await store.load()).tasks.find(({ id }) => id === 'captured-conflict')
  assert.equal(persisted?.schedule.startOn, '2026-09-07')
  assert.equal(persisted?.deadline.dueOn, '2026-09-06')
})

test('metadata update preserves a precise schedule after its deadline', async () => {
  const store = createInMemoryWorkspaceStore(emptyState())
  registerWorkspaceStore(store)
  await captureStudyTask({
    title: 'Updated conflict',
    dueOn: '2026-09-06',
  }, { taskId: 'updated-conflict', eventId: 'capture-before-update', now: '2026-09-04T08:00:00.000Z' })

  await updateStudyTask('updated-conflict', {
    plannedAt: '2026-09-07T06:00:00.000Z',
  }, { now: '2026-09-04T08:01:00.000Z' })

  const persisted = (await store.load()).tasks.find(({ id }) => id === 'updated-conflict')
  assert.equal(persisted?.schedule.startAt, '2026-09-07T06:00:00.000Z')
  assert.equal(persisted?.schedule.startOn, null)
  assert.equal(persisted?.deadline.dueOn, '2026-09-06')
})

test('planning preserves a precise start after its deadline for an explicit conflict', async () => {
  const store = createInMemoryWorkspaceStore(emptyState())
  registerWorkspaceStore(store)
  await captureStudyTask({
    title: 'Timed plan',
    dueOn: '2026-09-06',
  }, { taskId: 'timed-plan', eventId: 'capture-timed', now: '2026-09-04T08:00:00.000Z' })

  await planStudyTask('timed-plan', {
    plannedAt: '2026-09-07T06:00:00.000Z',
  }, { eventId: 'late-timed', now: '2026-09-04T08:01:00.000Z' })
  const persisted = (await store.load()).tasks.find(({ id }) => id === 'timed-plan')
  assert.equal(persisted?.schedule.startAt, '2026-09-07T06:00:00.000Z')
  assert.equal(persisted?.schedule.startOn, null)
})

test('quick completion toggles without evidence and finishes the task session', async () => {
  await useEmptyStore()
  await captureStudyTask(
    { title: 'Quick task', plannedOn: '2026-09-05' },
    { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' },
  )
  await planStudyTask('task-1', {}, { eventId: 'plan', now: '2026-09-04T08:01:00.000Z' })
  await startStudyTask('task-1', { sessionId: 'session-1', eventId: 'start', now: '2026-09-04T08:02:00.000Z' })

  const completed = await toggleStudyTaskCompletion('task-1', {
    eventId: 'quick-complete',
    now: '2026-09-04T08:12:00.000Z',
  })
  assert.equal(completed.status, 'completed')

  let state = await loadStudyState()
  assert.equal(state.sessions[0].state, 'finished')
  assert.equal(state.sessions[0].elapsedSeconds, 600)
  assert.equal(state.completionRecords.length, 0)
  assert.equal(state.taskEvents.at(-1)?.completionRecordId, null)

  const reopened = await toggleStudyTaskCompletion('task-1', {
    eventId: 'quick-reopen',
    now: '2026-09-04T08:13:00.000Z',
  })
  assert.equal(reopened.status, 'planned')
  state = await loadStudyState()
  assert.deepEqual(state.taskEvents.slice(-2).map(({ type }) => type), ['completed', 'reopened'])
})

test('quick completion supports inbox tasks, reopens them to inbox, and rejects cancellation', async () => {
  await useEmptyStore()
  await captureStudyTask(
    { title: 'Inbox task' },
    { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' },
  )
  assert.equal((await toggleStudyTaskCompletion('task-1', {
    eventId: 'complete', now: '2026-09-04T08:01:00.000Z',
  })).status, 'completed')
  assert.equal((await toggleStudyTaskCompletion('task-1', {
    eventId: 'reopen', now: '2026-09-04T08:02:00.000Z',
  })).status, 'inbox')
  await transitionStudyTask('task-1', 'cancelled', {
    eventId: 'cancel', now: '2026-09-04T08:03:00.000Z',
  })
  await assert.rejects(toggleStudyTaskCompletion('task-1'), /cancelled/i)
})

test('soft-delete preserves history and evidence while safely finishing an active session', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Evidence task' }, { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' })
  await planStudyTask('task-1', {}, { eventId: 'plan', now: '2026-09-04T08:01:00.000Z' })
  await completeStudyTask(
    { taskId: 'task-1', learned: 'Checkpoint identity matters.', evidence: 'Restart test passed.', nextAction: 'Repeat under interruption.' },
    { recordId: 'record-1', eventId: 'complete', now: '2026-09-04T08:02:00.000Z' },
  )
  await planStudyTask('task-1', {}, { eventId: 'reopen', now: '2026-09-04T08:03:00.000Z' })
  await startStudyTask('task-1', { sessionId: 'session-1', eventId: 'start', now: '2026-09-04T08:04:00.000Z' })

  await deleteStudyTask('task-1', { expectedRevision: 5, eventId: 'delete', now: '2026-09-04T08:14:00.000Z' })

  const state = await loadStudyState()
  assert.equal(state.tasks[0].deletedAt, '2026-09-04T08:14:00.000Z')
  assert.equal(state.tasks[0].revision, 6)
  assert.equal(state.sessions[0].state, 'finished')
  assert.equal(state.sessions[0].elapsedSeconds, 600)
  assert.equal(state.completionRecords[0].evidence, 'Restart test passed.')
  assert.deepEqual(state.taskEvents.map(({ type }) => type), ['captured', 'planned', 'completed', 'reopened', 'started', 'deleted'])
  assert.deepEqual(state.taskEvents.map(({ sequence }) => sequence), [1, 2, 3, 4, 5, 6])
  await assert.rejects(deleteStudyTask('task-1'), /TASK_ALREADY_DELETED/)
})

test('bulk cancellation validates every target before committing any change', async () => {
  await useEmptyStore()
  for (const id of ['task-1', 'task-2']) {
    await captureStudyTask({ title: id }, { taskId: id, eventId: `capture-${id}`, now: '2026-09-04T08:00:00.000Z' })
    await planStudyTask(id, {}, { eventId: `plan-${id}`, now: '2026-09-04T08:01:00.000Z' })
  }
  const before = await loadStudyState()

  await assert.rejects(
    bulkCancelStudyTasks([
      { taskId: 'task-1', expectedRevision: 2, eventId: 'cancel-1' },
      { taskId: 'task-2', expectedRevision: 99, eventId: 'cancel-2' },
    ], { reason: 'Priority changed', now: '2026-09-04T08:02:00.000Z' }),
    /revision conflict/i,
  )
  assert.deepEqual(await loadStudyState(), before)

  const cancelled = await bulkCancelStudyTasks([
    { taskId: 'task-1', expectedRevision: 2, eventId: 'cancel-1' },
    { taskId: 'task-2', expectedRevision: 2, eventId: 'cancel-2' },
  ], { reason: 'Priority changed', now: '2026-09-04T08:02:00.000Z' })
  assert.deepEqual(cancelled.map(({ status }) => status), ['cancelled', 'cancelled'])
  assert.deepEqual((await loadStudyState()).taskEvents.slice(-2).map(({ type }) => type), ['cancelled', 'cancelled'])
})

test('bulk reschedule is atomic, finishes an active session, and keeps event sequence continuous', async () => {
  await useEmptyStore()
  for (const id of ['task-1', 'task-2']) {
    await captureStudyTask({ title: id }, { taskId: id, eventId: `capture-${id}`, now: '2026-09-04T08:00:00.000Z' })
    await planStudyTask(id, {}, { eventId: `plan-${id}`, now: '2026-09-04T08:01:00.000Z' })
  }
  await startStudyTask('task-1', { sessionId: 'session-1', eventId: 'start-1', now: '2026-09-04T08:02:00.000Z' })

  const tasks = await bulkRescheduleStudyTasks([
    { taskId: 'task-1', expectedRevision: 3, eventId: 'reschedule-1' },
    { taskId: 'task-2', expectedRevision: 2, eventId: 'reschedule-2' },
  ], '2026-09-10', { reason: 'Batch planning', now: '2026-09-04T08:12:00.000Z' })

  const state = await loadStudyState()
  assert.deepEqual(tasks.map(({ status, plannedOn }) => [status, plannedOn]), [
    ['planned', '2026-09-10'],
    ['planned', '2026-09-10'],
  ])
  assert.equal(state.sessions[0].state, 'finished')
  assert.equal(state.sessions[0].elapsedSeconds, 600)
  assert.deepEqual(state.taskEvents.slice(-2).map(({ type }) => type), ['rescheduled', 'rescheduled'])
  assert.deepEqual(state.taskEvents.map(({ sequence }) => sequence), [1, 2, 3, 4, 5, 6, 7])
})

test('bulk reschedule promotes inbox tasks into the planned workflow', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Inbox task' }, { taskId: 'inbox-1', eventId: 'capture-inbox-1', now: '2026-09-04T08:00:00.000Z' })

  const [task] = await bulkRescheduleStudyTasks([
    { taskId: 'inbox-1', expectedRevision: 1, eventId: 'schedule-inbox-1' },
  ], '2026-09-04', { reason: 'Move to today', now: '2026-09-04T08:01:00.000Z' })

  assert.equal(task.status, 'planned')
  assert.equal(task.plannedOn, '2026-09-04')
  assert.equal((await loadStudyState()).taskEvents.at(-1)?.type, 'rescheduled')
})

test('list groups persist independently and archive without orphaning lists', async () => {
  await useEmptyStore()
  await saveStudyListGroup({ id: 'group-work', title: '工作', position: 0, createdAt: '2026-09-04T08:00:00.000Z', updatedAt: '2026-09-04T08:00:00.000Z', archivedAt: null })
  const grouped = await loadStudyState()
  assert.equal(grouped.listGroups?.[0]?.title, '工作')

  await archiveStudyListGroup('group-work', '2026-09-04T08:01:00.000Z')
  const archived = await loadStudyState()
  assert.equal(archived.listGroups?.[0]?.archivedAt, '2026-09-04T08:01:00.000Z')
})

test('bulk soft-delete rejects duplicate targets without partially deleting tasks', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'First' }, { taskId: 'task-1', eventId: 'capture-1', now: '2026-09-04T08:00:00.000Z' })
  await captureStudyTask({ title: 'Second' }, { taskId: 'task-2', eventId: 'capture-2', now: '2026-09-04T08:00:00.000Z' })
  const before = await loadStudyState()

  await assert.rejects(
    bulkDeleteStudyTasks([
      { taskId: 'task-1', expectedRevision: 1, eventId: 'delete-1' },
      { taskId: 'task-1', expectedRevision: 1, eventId: 'delete-2' },
    ], { now: '2026-09-04T08:01:00.000Z' }),
    /duplicate/i,
  )
  assert.deepEqual(await loadStudyState(), before)

  const deleted = await bulkDeleteStudyTasks([
    { taskId: 'task-1', expectedRevision: 1, eventId: 'delete-1' },
    { taskId: 'task-2', expectedRevision: 1, eventId: 'delete-2' },
  ], { now: '2026-09-04T08:01:00.000Z' })
  assert.deepEqual(deleted.map(({ deletedAt }) => deletedAt), [
    '2026-09-04T08:01:00.000Z',
    '2026-09-04T08:01:00.000Z',
  ])
  assert.deepEqual((await loadStudyState()).taskEvents.map(({ sequence }) => sequence), [1, 2, 3, 4])
})

test('starting a second task fails without partial state or event writes', async () => {
  await useEmptyStore()
  for (const id of ['task-1', 'task-2']) {
    await captureStudyTask(
      { title: id },
      { taskId: id, eventId: `capture-${id}`, now: '2026-09-04T08:00:00.000Z' },
    )
    await planStudyTask(
      id,
      { topicId: 'topic-1' },
      { eventId: `plan-${id}`, now: '2026-09-04T08:01:00.000Z' },
    )
  }
  await startStudyTask('task-1', {
    sessionId: 'session-1',
    eventId: 'start-1',
    now: '2026-09-04T08:02:00.000Z',
  })
  const before = await loadStudyState()

  await assert.rejects(
    startStudyTask('task-2', {
      sessionId: 'session-2',
      eventId: 'start-2',
      now: '2026-09-04T08:03:00.000Z',
    }),
    /already active/i,
  )
  assert.deepEqual(await loadStudyState(), before)
})

test('session persistence can update scratchpad but cannot overwrite lifecycle state', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Practice' }, { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' })
  await planStudyTask('task-1', {}, { eventId: 'plan', now: '2026-09-04T08:01:00.000Z' })
  const { session } = await startStudyTask('task-1', { sessionId: 'session-1', eventId: 'start', now: '2026-09-04T08:02:00.000Z' })
  const changedLifecycle = { ...session, state: 'paused' as const, activeSince: null, scratchpad: 'note', updatedAt: '2026-09-04T08:03:00.000Z' }
  await assert.rejects(saveStudySession(changedLifecycle), /lifecycle/i)

  await saveStudyScratchpad('session-1', 'durable note', {
    now: '2026-09-04T08:04:00.000Z', expectedRevision: 3,
  })
  const state = await loadStudyState()
  assert.equal(state.sessions[0].scratchpad, 'durable note')
  assert.equal(state.sessions[0].state, 'running')
  assert.equal(state.tasks[0].revision, 4)
})

test('snapshot CAS lets only one concurrent command commit from the same revision', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Race' }, { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' })
  const results = await Promise.allSettled([
    planStudyTask('task-1', { plannedOn: '2026-09-05' }, { expectedRevision: 1, eventId: 'plan-a', now: '2026-09-04T08:00:00.000Z' }),
    planStudyTask('task-1', { plannedOn: '2026-09-06' }, { expectedRevision: 1, eventId: 'plan-b', now: '2026-09-04T08:00:00.000Z' }),
  ])
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1)
  assert.match(String(results.find(({ status }) => status === 'rejected') && (results.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason), /snapshot conflict/i)
  const state = await loadStudyState()
  assert.equal(state.tasks[0].revision, 2)
  assert.equal(state.taskEvents.length, 2)
})

test('task transition matrix rejects shortcuts and stale revisions without writes', async () => {
  await useEmptyStore()
  await captureStudyTask(
    { title: 'Inbox task' },
    { taskId: 'task-1', eventId: 'event-1', now: '2026-09-04T08:00:00.000Z' },
  )
  const before = await loadStudyState()
  await assert.rejects(
    transitionStudyTask('task-1', 'blocked', { reason: 'No guide', now: '2026-09-04T08:01:00.000Z' }),
    /cannot transition/i,
  )
  await assert.rejects(
    planStudyTask('task-1', {}, { expectedRevision: 99, now: '2026-09-04T08:01:00.000Z' }),
    /revision conflict/i,
  )
  assert.deepEqual(await loadStudyState(), before)
})

test('pause and resume retain elapsed time and distinguish timeline events', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Practice' }, { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' })
  await planStudyTask('task-1', {}, { eventId: 'plan', now: '2026-09-04T08:01:00.000Z' })
  await startStudyTask('task-1', { sessionId: 'session-1', eventId: 'start', now: '2026-09-04T08:02:00.000Z' })
  await pauseStudySession('session-1', { eventId: 'pause', now: '2026-09-04T08:12:00.000Z' })
  await resumeStudySession('session-1', { eventId: 'resume', now: '2026-09-04T08:20:00.000Z' })

  const state = await loadStudyState()
  assert.equal(state.sessions[0].elapsedSeconds, 600)
  assert.equal(state.sessions[0].state, 'running')
  assert.equal(state.tasks[0].revision, 5)
  assert.deepEqual(state.taskEvents.map(({ type }) => type), ['captured', 'planned', 'started', 'paused', 'resumed'])
})

test('reschedule finishes the active session and returns the task to plan atomically', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Practice' }, { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' })
  await planStudyTask('task-1', {}, { eventId: 'plan', now: '2026-09-04T08:01:00.000Z' })
  await startStudyTask('task-1', { sessionId: 'session-1', eventId: 'start', now: '2026-09-04T08:02:00.000Z' })
  await rescheduleStudyTask('task-1', '2026-09-06', { eventId: 'reschedule', reason: 'Need prerequisites', now: '2026-09-04T08:12:00.000Z' })

  const state = await loadStudyState()
  assert.equal(state.tasks[0].status, 'planned')
  assert.equal(state.tasks[0].plannedOn, '2026-09-06')
  assert.equal(state.sessions[0].state, 'finished')
  assert.equal(state.sessions[0].elapsedSeconds, 600)
  assert.equal(state.taskEvents.at(-1)?.type, 'rescheduled')
})

test('blocking or cancelling an active task atomically finishes its focus session', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Blocked practice' }, { taskId: 'task-1', eventId: 'capture-1', now: '2026-09-04T08:00:00.000Z' })
  await planStudyTask('task-1', {}, { eventId: 'plan-1', now: '2026-09-04T08:01:00.000Z' })
  await startStudyTask('task-1', { sessionId: 'session-1', eventId: 'start-1', now: '2026-09-04T08:02:00.000Z' })
  await transitionStudyTask('task-1', 'blocked', { eventId: 'block-1', reason: 'Waiting for a prerequisite', now: '2026-09-04T08:12:00.000Z' })

  let state = await loadStudyState()
  assert.equal(state.tasks[0].status, 'blocked')
  assert.equal(state.sessions[0].state, 'finished')
  assert.equal(state.sessions[0].elapsedSeconds, 600)

  await transitionStudyTask('task-1', 'planned', { eventId: 'unblock-1', now: '2026-09-04T08:13:00.000Z' })
  await startStudyTask('task-1', { sessionId: 'session-2', eventId: 'start-2', now: '2026-09-04T08:14:00.000Z' })
  await pauseStudySession('session-2', { eventId: 'pause-2', now: '2026-09-04T08:19:00.000Z' })
  await transitionStudyTask('task-1', 'cancelled', { eventId: 'cancel-1', reason: 'Priority changed', now: '2026-09-04T08:20:00.000Z' })

  state = await loadStudyState()
  assert.equal(state.tasks[0].status, 'cancelled')
  assert.equal(state.sessions[1].state, 'finished')
  assert.equal(state.sessions[1].elapsedSeconds, 300)
  assert.deepEqual(state.taskEvents.slice(-2).map(({ type }) => type), ['paused', 'cancelled'])
})

test('switch atomically closes the old session and starts the target task', async () => {
  await useEmptyStore()
  for (const id of ['task-1', 'task-2']) {
    await captureStudyTask({ title: id }, { taskId: id, eventId: `capture-${id}`, now: '2026-09-04T08:00:00.000Z' })
    await planStudyTask(id, {}, { eventId: `plan-${id}`, now: '2026-09-04T08:01:00.000Z' })
  }
  await startStudyTask('task-1', { sessionId: 'session-1', eventId: 'start-1', now: '2026-09-04T08:02:00.000Z' })
  await switchStudyTask('task-2', {
    sessionId: 'session-2', pausedEventId: 'pause-1', eventId: 'start-2',
    reason: 'Higher priority', now: '2026-09-04T08:12:00.000Z',
  })

  const state = await loadStudyState()
  assert.deepEqual(state.tasks.map(({ status }) => status), ['planned', 'in_progress'])
  assert.deepEqual(state.sessions.map(({ state }) => state), ['finished', 'running'])
  assert.deepEqual(state.taskEvents.slice(-2).map(({ type }) => type), ['paused', 'started'])
  assert.deepEqual(state.taskEvents.map(({ sequence }) => sequence), [1, 2, 3, 4, 5, 6, 7])
})

test('reordering a visible task queue persists order without adding noisy events', async () => {
  await useEmptyStore()
  for (const id of ['task-1', 'task-2', 'task-3']) {
    await captureStudyTask({ title: id }, { taskId: id, eventId: `capture-${id}`, now: '2026-09-04T08:00:00.000Z' })
    await planStudyTask(id, { plannedOn: '2026-09-04' }, { eventId: `plan-${id}`, now: '2026-09-04T08:01:00.000Z' })
  }
  const eventCount = (await loadStudyState()).taskEvents.length

  await reorderStudyTasks(['task-3', 'task-1', 'task-2'], { now: '2026-09-04T08:02:00.000Z' })

  const state = await loadStudyState()
  assert.deepEqual(state.tasks.map(({ id }) => id), ['task-3', 'task-1', 'task-2'])
  assert.equal(state.taskEvents.length, eventCount)
  assert.deepEqual(state.tasks.map(({ revision }) => revision), [3, 3, 3])
})

test('planned task may be completed directly with evidence, but inbox and blocked tasks may not', async () => {
  await useEmptyStore()
  await captureStudyTask({ title: 'Evidence task' }, { taskId: 'task-1', eventId: 'capture', now: '2026-09-04T08:00:00.000Z' })
  await assert.rejects(
    completeStudyTask({ taskId: 'task-1', learned: 'x', evidence: 'y', nextAction: 'z' }, { now: '2026-09-04T08:01:00.000Z' }),
    /planned or in-progress/i,
  )
  await planStudyTask('task-1', {}, { eventId: 'plan', now: '2026-09-04T08:02:00.000Z' })
  await completeStudyTask(
    { taskId: 'task-1', learned: 'x', evidence: 'y', nextAction: 'z' },
    { recordId: 'record-1', eventId: 'complete', now: '2026-09-04T08:03:00.000Z' },
  )
  assert.equal((await loadStudyState()).tasks[0].status, 'completed')
})

async function verifiesStudyStore(store: StudyStore) {
  const state = emptyState()
  await store.save(state)
  const loaded = await store.load()
  loaded.topics[0].title = 'caller mutation'
  assert.equal((await store.load()).topics[0].title, 'LangGraph')
}

test('memory adapter preserves a cloned v2 snapshot', async () => {
  await verifiesStudyStore(createInMemoryStudyStore(emptyState()))
})

test('IndexedDB preserves v2 state after reopening', async () => {
  const databaseName = `meow-study-v2-${Date.now()}`
  await deleteDB(databaseName)
  await verifiesStudyStore(createIndexedDbStudyStore({ databaseName, seed: emptyState() }))
  assert.equal((await createIndexedDbStudyStore({ databaseName, seed: emptyState() }).load()).version, 2)
})

test('IndexedDB compares expectedUpdatedAt inside its write transaction', async () => {
  const databaseName = `meow-study-cas-${Date.now()}`
  await deleteDB(databaseName)
  const store = createIndexedDbStudyStore({ databaseName, seed: emptyState() })
  const first = emptyState()
  first.updatedAt = '2026-09-04T00:01:00.000Z'
  const second = emptyState()
  second.updatedAt = '2026-09-04T00:02:00.000Z'
  const results = await Promise.allSettled([
    store.save(first, '2026-09-04T00:00:00.000Z'),
    store.save(second, '2026-09-04T00:00:00.000Z'),
  ])
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1)
})

test('IndexedDB v1 database upgrade still preserves Todo records', async () => {
  const databaseName = `meow-study-todo-${Date.now()}`
  await deleteDB(databaseName)
  const versionOne = await openDB(databaseName, 1, {
    upgrade(database) {
      database.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    },
  })
  await versionOne.add('todos', {
    title: 'keep Todo',
    done: 0,
    created_at: '2026-09-03T00:00:00.000Z',
  })
  versionOne.close()
  await createIndexedDbStudyStore({ databaseName, seed: emptyState() }).load()
  assert.deepEqual(
    (await createIndexedDbTodoStore({ databaseName }).list()).map(({ title }) => title),
    ['keep Todo'],
  )
})

test('IndexedDB backs up a v1 snapshot before replacing current with v2', async () => {
  const databaseName = `meow-study-state-migration-${Date.now()}`
  await deleteDB(databaseName)
  const database = await openDB(databaseName, 2, {
    upgrade(db) {
      const todos = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      todos.createIndex('by-created-at', 'created_at')
      db.createObjectStore('studyState', { keyPath: 'key' })
    },
  })
  await database.put('studyState', { key: 'current', state: legacyState() })
  database.close()

  const loaded = await createIndexedDbStudyStore({ databaseName, seed: emptyState() }).load()
  assert.equal(loaded.version, 2)
  const verification = await openDB(databaseName, 2)
  assert.equal((await verification.get('studyState', 'current')).state.version, 2)
  assert.deepEqual((await verification.get('studyState', V1_STUDY_STATE_BACKUP_KEY)).state, legacyState())
  verification.close()
})

test('Tauri SQLite adapter round-trips a v2 snapshot row', async () => {
  let payload: string | undefined
  const store = createTauriSqliteStudyStore(async () => ({
    async select<T>(): Promise<T> {
      return (payload ? [{ version: 2, payload }] : []) as T
    },
    async execute(_sql: string, bindValues?: unknown[]) {
      payload = String(bindValues?.[1])
      return { rowsAffected: 1 }
    },
  }), emptyState())
  await store.save(emptyState())
  assert.equal((await store.load()).version, 2)
})

test('Tauri SQLite migrates v1 only after the backup protocol succeeds', async () => {
  const calls: Array<{ sql: string; binds?: unknown[] }> = []
  const store = createTauriSqliteStudyStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 1, payload: JSON.stringify(legacyState()) }] as T
    },
    async execute(sql: string, binds?: unknown[]) {
      calls.push({ sql, binds })
      return { rowsAffected: 1 }
    },
  }), emptyState(), () => '2026-09-05T00:00:00.000Z')

  assert.equal((await store.load()).version, 2)
  assert.equal(calls[0].sql, BACKUP_V1_STUDY_STATE_SQL)
  assert.equal(calls[0].binds?.[1], 1)
  assert.equal(calls[0].binds?.[2], '2026-09-05T00:00:00.000Z')
  assert.match(String(calls[0].binds?.[0]), /^study-state-v1:/)
  assert.equal(calls[1].sql, REPLACE_V1_AFTER_BACKUP_SQL)
  assert.deepEqual(calls[1].binds?.slice(0, 2), [calls[0].binds?.[0], 2])
})

test('Tauri SQLite uses a fresh backup key for each v1 migration attempt', async () => {
  const backupKeys: string[] = []
  const store = createTauriSqliteStudyStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 1, payload: JSON.stringify(legacyState()) }] as T
    },
    async execute(sql: string, binds?: unknown[]) {
      if (sql === BACKUP_V1_STUDY_STATE_SQL) backupKeys.push(String(binds?.[0]))
      return { rowsAffected: 1 }
    },
  }), emptyState(), () => '2026-09-05T00:00:00.000Z')

  await store.load()
  await store.load()
  assert.equal(new Set(backupKeys).size, 2)
})

test('Tauri SQLite never attempts replacement when the fresh backup insert fails', async () => {
  let executions = 0
  const store = createTauriSqliteStudyStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 1, payload: JSON.stringify(legacyState()) }] as T
    },
    async execute() {
      executions += 1
      return { rowsAffected: 0 }
    },
  }), emptyState(), () => '2026-09-05T00:00:00.000Z')

  await assert.rejects(store.load(), /backup insert/i)
  assert.equal(executions, 1)
})

test('Tauri SQLite CAS checks rowsAffected for conditional saves', async () => {
  let saveSql = ''
  let saveBinds: unknown[] | undefined
  const store = createTauriSqliteStudyStore(async () => ({
    async select<T>(): Promise<T> { return [] as T },
    async execute(sql: string, binds?: unknown[]) {
      saveSql = sql
      saveBinds = binds
      return { rowsAffected: 0 }
    },
  }), emptyState())
  const next = emptyState()
  next.updatedAt = '2026-09-04T00:01:00.000Z'

  await assert.rejects(store.save(next, '2026-09-04T00:00:00.000Z'), /snapshot conflict/i)
  assert.match(saveSql, /study_state\.updated_at = \$4/)
  assert.deepEqual(saveBinds?.slice(3), ['2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z'])
})

test('Tauri SQLite refuses a v1 replacement when backup proof is missing', async () => {
  let executions = 0
  const store = createTauriSqliteStudyStore(async () => ({
    async select<T>(): Promise<T> {
      return [{ version: 1, payload: JSON.stringify(legacyState()) }] as T
    },
    async execute() {
      executions += 1
      return { rowsAffected: executions === 1 ? 1 : 0 }
    },
  }), emptyState(), () => '2026-09-05T00:00:00.000Z')

  await assert.rejects(store.load(), /backup is missing/i)
})
