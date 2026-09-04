import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyReviewResult,
  createSeedStudyState,
  migrateStudyStateV1ToV2,
  nextReviewDate,
  parseStudyState,
} from '../src/storage/study/types.ts'

function legacyState() {
  return {
    version: 1,
    updatedAt: '2026-09-04T12:00:00.000Z',
    topics: [
      {
        id: 'topic-1',
        title: 'LangGraph',
        goal: 'Build a resumable workflow',
        successCriteria: ['restart resumes'],
        weeklyTargetMinutes: 120,
        steps: [{ id: 'step-1', title: 'Persist state', acceptanceCriteria: ['restart resumes'], estimateMinutes: 45, scheduledOn: '2026-09-04' }],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-04T12:00:00.000Z',
        archivedAt: null,
      },
    ],
    sessions: [
      {
        id: 'session-1', topicId: 'topic-1', stepId: 'step-1', state: 'completed',
        startedAt: '2026-09-04T10:00:00.000Z', activeSince: null, elapsedSeconds: 2700,
        scratchpad: 'Reuse thread_id.', learned: 'A checkpoint needs its thread id.',
        evidence: 'six tests passed', blocker: '', nextAction: 'Add rejection E2E', mastery: 3,
        completedAt: '2026-09-04T10:45:00.000Z', reviewStage: 0, nextReviewOn: '2026-09-05',
        lastReviewResult: null, lastReviewedAt: null, createdAt: '2026-09-04T10:00:00.000Z',
        updatedAt: '2026-09-04T10:45:00.000Z', deletedAt: null,
      },
    ],
  }
}

test('v1 migration replaces nested StudyStep with Task and CompletionRecord', () => {
  const migrated = migrateStudyStateV1ToV2(legacyState(), '2026-09-05T00:00:00.000Z')

  assert.equal(migrated.version, 2)
  assert.equal('steps' in migrated.topics[0], false)
  assert.deepEqual(migrated.tasks[0], {
    id: 'step-1', revision: 1, topicId: 'topic-1', title: 'Persist state', notes: '', status: 'completed',
    plannedOn: '2026-09-04', dueOn: null, reminderAt: null, priority: 'none', estimateMinutes: 45,
    acceptanceCriteria: ['restart resumes'], checklist: [], blockedReason: null,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', deletedAt: null,
  })
  assert.equal(migrated.sessions[0].taskId, 'step-1')
  assert.equal(migrated.sessions[0].state, 'finished')
  assert.equal('learned' in migrated.sessions[0], false)
  assert.equal(migrated.completionRecords[0].learned, 'A checkpoint needs its thread id.')
  assert.deepEqual(migrated.taskEvents.map(({ type }) => type), ['migrated', 'completed'])
  assert.deepEqual(migrated.taskEvents.map(({ sequence }) => sequence), [1, 2])
  assert.deepEqual(
    migrated.taskEvents.map(({ fromStatus, toStatus }) => [fromStatus, toStatus]),
    [[null, 'planned'], ['planned', 'completed']],
  )
  assert.deepEqual(parseStudyState(migrated), migrated)
})

test('v2 task parsing defaults new todo metadata and validates explicit values', () => {
  const legacyV2 = createSeedStudyState('2026-09-04T00:00:00.000Z') as unknown as {
    tasks: Array<Record<string, unknown>>
  }
  delete legacyV2.tasks[0].priority
  delete legacyV2.tasks[0].reminderAt

  const parsed = parseStudyState(legacyV2)
  assert.equal(parsed.tasks[0].priority, 'none')
  assert.equal(parsed.tasks[0].reminderAt, null)

  const invalidPriority = structuredClone(parsed) as unknown as { tasks: Array<Record<string, unknown>> }
  invalidPriority.tasks[0].priority = 'urgent'
  assert.throws(() => parseStudyState(invalidPriority), /priority/i)

  const invalidReminder = structuredClone(parsed) as unknown as { tasks: Array<Record<string, unknown>> }
  invalidReminder.tasks[0].reminderAt = '2026-09-04'
  assert.throws(() => parseStudyState(invalidReminder), /reminderAt/i)
})

test('review dates follow the deterministic 1/3/7 calendar-day schedule', () => {
  assert.equal(nextReviewDate('2026-01-30', 0), '2026-01-31')
  assert.equal(nextReviewDate('2026-01-30', 1), '2026-02-02')
  assert.equal(nextReviewDate('2026-01-30', 2), '2026-02-06')
  assert.equal(nextReviewDate('2026-01-30', 3), null)

  const record = createSeedStudyState('2026-09-04T00:00:00.000Z').completionRecords[0]
  const fuzzy = applyReviewResult(record, 'fuzzy', '2026-09-05', '2026-09-05T09:00:00.000Z')
  assert.equal(fuzzy.reviewStage, record.reviewStage)
  assert.equal(fuzzy.nextReviewOn, '2026-09-06')
  const relearn = applyReviewResult(record, 'relearn', '2026-09-05', '2026-09-05T09:00:00.000Z')
  assert.equal(relearn.nextReviewOn, null)
  const clear = applyReviewResult(record, 'clear', '2026-10-01', '2026-10-01T09:00:00.000Z')
  assert.equal(clear.nextReviewOn, '2026-10-04')
})

test('v2 validation enforces task revisions, global event sequence, and one active session', () => {
  const state = createSeedStudyState('2026-09-04T00:00:00.000Z')
  const missingRevision = structuredClone(state) as unknown as { tasks: Array<Record<string, unknown>> }
  delete missingRevision.tasks[0].revision
  assert.throws(() => parseStudyState(missingRevision), /revision/)

  const duplicateSequence = structuredClone(state)
  duplicateSequence.taskEvents[1].sequence = duplicateSequence.taskEvents[0].sequence
  assert.throws(() => parseStudyState(duplicateSequence), /sequence/)

  const sequenceGap = structuredClone(state)
  sequenceGap.taskEvents[1].sequence = 1_000
  assert.throws(() => parseStudyState(sequenceGap), /sequence/)

  const reversedEvents = structuredClone(state)
  reversedEvents.taskEvents.reverse()
  assert.throws(() => parseStudyState(reversedEvents), /continuous sequence/)

  const active = structuredClone(state)
  for (const task of active.tasks.slice(3, 5)) {
    task.status = 'in_progress'
    const event = active.taskEvents.find(({ taskId }) => taskId === task.id)
    if (event) event.toStatus = 'in_progress'
  }
  active.sessions.push(
    {
      id: 'active-1', taskId: active.tasks[3].id, state: 'running',
      startedAt: state.updatedAt, activeSince: state.updatedAt, elapsedSeconds: 0,
      scratchpad: '', createdAt: state.updatedAt, updatedAt: state.updatedAt, deletedAt: null,
    },
    {
      id: 'active-2', taskId: active.tasks[4].id, state: 'paused',
      startedAt: state.updatedAt, activeSince: null, elapsedSeconds: 0,
      scratchpad: '', createdAt: state.updatedAt, updatedAt: state.updatedAt, deletedAt: null,
    },
  )
  assert.throws(() => parseStudyState(active), /only one active/i)

  const mismatchedCompletion = structuredClone(state)
  mismatchedCompletion.completionRecords[0].sessionIds = [mismatchedCompletion.sessions[1].id]
  assert.throws(() => parseStudyState(mismatchedCompletion), /belongs to another task/i)

  const blankEvidence = structuredClone(state)
  blankEvidence.completionRecords[0].evidence = '   '
  assert.throws(() => parseStudyState(blankEvidence), /evidence/)
})

test('v2 validation rejects broken per-task event chains and cross-task completion links', () => {
  const state = createSeedStudyState('2026-09-04T00:00:00.000Z')
  const completedEventIndex = state.taskEvents.findIndex(({ type }) => type === 'completed')

  const brokenFrom = structuredClone(state)
  brokenFrom.taskEvents[completedEventIndex].fromStatus = 'inbox'
  assert.throws(() => parseStudyState(brokenFrom), /event chain/i)

  const brokenFinal = structuredClone(state)
  brokenFinal.tasks[0].status = 'planned'
  assert.throws(() => parseStudyState(brokenFinal), /final event status/i)

  const wrongRecord = structuredClone(state)
  wrongRecord.taskEvents[completedEventIndex].completionRecordId = wrongRecord.completionRecords[1].id
  assert.throws(() => parseStudyState(wrongRecord), /completion belongs to another task/i)
})
