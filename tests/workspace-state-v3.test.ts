import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'

function validWorkspaceState() {
  const at = '2026-09-04T09:00:00+08:00'
  return {
    version: 3,
    revision: 1,
    listGroups: [
      {
        id: 'group-1',
        title: 'Personal',
        position: 0,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      },
    ],
    lists: [
      {
        id: 'list-1',
        groupId: 'group-1',
        title: 'Inbox',
        position: 0,
        goal: '',
        successCriteria: [],
        weeklyTargetMinutes: null,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      },
    ],
    sections: [
      {
        id: 'section-1',
        listId: 'list-1',
        title: 'Next',
        position: 0,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      },
    ],
    tags: [
      {
        id: 'tag-1',
        title: 'home',
        position: 0,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      },
    ],
    tasks: [
      {
        id: 'task-1',
        revision: 1,
        mode: 'general',
        listId: 'list-1',
        sectionId: 'section-1',
        tagIds: ['tag-1'],
        title: 'Pay rent',
        notes: '',
        status: 'planned',
        schedule: { startAt: null, startOn: '2026-09-04', estimateMinutes: 30 },
        deadline: { dueAt: null, dueOn: '2026-09-03' },
        priority: 'medium',
        checklist: [
          { id: 'check-1', text: 'Open banking', checked: false, checkedAt: null, position: 0 },
        ],
        learning: null,
        recurrenceSeriesId: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      },
    ],
    recurrenceSeries: [],
    occurrences: [],
    reminderRules: [],
    reminderDeliveries: [],
    studySessions: [],
    taskEvents: [
      {
        id: 'event-1',
        sequence: 1,
        taskId: 'task-1',
        type: 'planned',
        occurredAt: at,
        fromStatus: null,
        toStatus: 'planned',
        reason: null,
        completionRecordId: null,
      },
    ],
    completionRecords: [],
    reviewTaskLinks: [],
    commandReceipts: [],
    updatedAt: at,
  }
}

test('accepts a complete v3 workspace and preserves a schedule later than its deadline', () => {
  const state = validWorkspaceState()

  assert.deepEqual(parseWorkspaceState(state), state)
})

test('rejects two schedule representations and dangling list ids', () => {
  const state = validWorkspaceState()
  state.tasks[0].schedule = {
    startOn: '2026-09-04',
    startAt: '2026-09-04T09:00:00+08:00',
    estimateMinutes: 30,
  }
  assert.throws(() => parseWorkspaceState(state), /startOn and startAt/)

  state.tasks[0].schedule = { startOn: '2026-09-04', startAt: null, estimateMinutes: 30 }
  state.tasks[0].listId = 'missing'
  assert.throws(() => parseWorkspaceState(state), /unknown listId/)
})

test('rejects invalid versions, revisions, dates, timestamps, enums, and numeric ranges', () => {
  const state = validWorkspaceState()
  state.version = 2
  assert.throws(() => parseWorkspaceState(state), /version 3/)

  const badRevision = validWorkspaceState()
  badRevision.revision = 0
  assert.throws(() => parseWorkspaceState(badRevision), /Workspace state revision/)

  const badDate = validWorkspaceState()
  badDate.tasks[0].schedule.startOn = '2025-02-29'
  assert.throws(() => parseWorkspaceState(badDate), /startOn.*YYYY-MM-DD/)

  const badTimestamp = validWorkspaceState()
  badTimestamp.tasks[0].createdAt = '2026-09-04T09:00:00'
  assert.throws(() => parseWorkspaceState(badTimestamp), /createdAt.*ISO datetime/)

  const badEnum = validWorkspaceState()
  badEnum.tasks[0].status = 'waiting'
  assert.throws(() => parseWorkspaceState(badEnum), /status/)

  const badRange = validWorkspaceState()
  badRange.tasks[0].schedule.estimateMinutes = 0
  assert.throws(() => parseWorkspaceState(badRange), /estimateMinutes/)
})

test('rejects duplicate ids and broken list, section, tag, and event references', () => {
  const duplicate = validWorkspaceState()
  duplicate.lists.push({ ...duplicate.lists[0], id: 'list-1' })
  assert.throws(() => parseWorkspaceState(duplicate), /duplicate list id/)

  const missingSection = validWorkspaceState()
  missingSection.tasks[0].sectionId = 'missing'
  assert.throws(() => parseWorkspaceState(missingSection), /unknown sectionId/)

  const foreignSection = validWorkspaceState()
  foreignSection.sections[0].listId = 'another-list'
  assert.throws(() => parseWorkspaceState(foreignSection), /unknown listId/)

  const missingTag = validWorkspaceState()
  missingTag.tasks[0].tagIds = ['missing']
  assert.throws(() => parseWorkspaceState(missingTag), /unknown tagId/)

  const missingEventTask = validWorkspaceState()
  missingEventTask.taskEvents[0].taskId = 'missing'
  assert.throws(() => parseWorkspaceState(missingEventTask), /unknown taskId/)
})

test('rejects invalid recurrence, reminder, and occurrence links without generating records', () => {
  const state = validWorkspaceState()
  state.recurrenceSeries.push({
    id: 'series-1',
    revision: 1,
    taskId: 'task-1',
    cadence: { kind: 'weekly', interval: 1, weekdays: [1, 3] },
    basis: 'fixed_schedule',
    anchorAt: '2026-09-04T09:00:00+08:00',
    end: { kind: 'after', count: 3 },
    timezone: 'Asia/Shanghai',
    createdThrough: null,
    createdCount: 0,
  })
  state.tasks[0].recurrenceSeriesId = 'series-1'
  state.occurrences.push({
    id: 'occurrence-1',
    seriesId: 'series-1',
    ordinal: 1,
    scheduledAt: '2026-09-04T09:00:00+08:00',
    status: 'pending',
    override: null,
    completedAt: null,
    revision: 1,
  })
  state.reminderRules.push({
    id: 'reminder-1',
    taskId: 'task-1',
    occurrenceId: 'occurrence-1',
    trigger: { kind: 'before_start', minutes: 10 },
    enabled: true,
    revision: 1,
  })
  state.reminderDeliveries.push({
    id: 'delivery-1',
    reminderRuleId: 'reminder-1',
    occurrenceId: 'occurrence-1',
    scheduledFor: '2026-09-04T08:50:00+08:00',
    status: 'pending',
    snoozedUntil: null,
    action: null,
  })

  assert.deepEqual(parseWorkspaceState(state), state)

  state.occurrences[0].seriesId = 'missing'
  assert.throws(() => parseWorkspaceState(state), /unknown seriesId/)
})

test('preserves event-chain and active-session invariants for legacy learning facts', () => {
  const brokenChain = validWorkspaceState()
  brokenChain.taskEvents[0].toStatus = 'inbox'
  assert.throws(() => parseWorkspaceState(brokenChain), /final event status/)

  const activeSession = validWorkspaceState()
  activeSession.studySessions.push({
    id: 'session-1',
    taskId: 'task-1',
    state: 'running',
    startedAt: '2026-09-04T09:00:00+08:00',
    activeSince: '2026-09-04T09:00:00+08:00',
    elapsedSeconds: 0,
    scratchpad: '',
    createdAt: '2026-09-04T09:00:00+08:00',
    updatedAt: '2026-09-04T09:00:00+08:00',
    deletedAt: null,
  })
  assert.throws(() => parseWorkspaceState(activeSession), /in-progress task/)
})
