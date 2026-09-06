import type { Task, TaskOccurrence, WorkspaceStateV3 } from '../../src/domain/workspace/types.ts'

export function createStudyTaskQueryScaleFixture(): WorkspaceStateV3 {
  const tasks: Task[] = []
  const recurrenceSeries: WorkspaceStateV3['recurrenceSeries'] = []
  const occurrences: TaskOccurrence[] = []

  for (let seriesIndex = 0; seriesIndex < 1_000; seriesIndex += 1) {
    const taskId = `task:scale:${seriesIndex}`
    const seriesId = `series:scale:${seriesIndex}`
    const preciseDates = Array.from({ length: 50 }, (_, occurrenceIndex) =>
      new Date(Date.UTC(2027, 0, occurrenceIndex + 1, 0, seriesIndex)).toISOString())
    tasks.push({
      id: taskId, revision: 1, mode: 'general', listId: 'list:scale', sectionId: null, tagIds: [],
      title: `Scale task ${seriesIndex}`, notes: '', status: 'planned',
      schedule: { startAt: null, startOn: null, estimateMinutes: 30 },
      deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [], learning: null,
      recurrenceSeriesId: seriesId, createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null,
    })
    recurrenceSeries.push({
      id: seriesId, taskId, revision: 1, cadence: { kind: 'daily', interval: 1 },
      basis: 'fixed_schedule', anchorAt: preciseDates[0]!, anchorOn: null,
      end: { kind: 'never' }, timezone: 'Asia/Shanghai',
      createdThrough: preciseDates.at(-1)!, createdCount: 50,
    })
    for (let ordinal = 1; ordinal <= 50; ordinal += 1) {
      occurrences.push({
        id: `occurrence:${seriesIndex}:${ordinal}`, seriesId, ordinal,
        scheduledAt: preciseDates[ordinal - 1]!, scheduledOn: null, status: 'pending',
        override: null, completedAt: null, revision: 1,
      })
    }
  }

  for (let taskIndex = 1_000; taskIndex < 10_000; taskIndex += 1) {
    tasks.push({
      id: `task:scale:${taskIndex}`, revision: 1, mode: 'general', listId: 'list:scale', sectionId: null, tagIds: [],
      title: `Scale task ${taskIndex}`, notes: '', status: 'inbox',
      schedule: { startAt: null, startOn: null, estimateMinutes: null },
      deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [], learning: null,
      recurrenceSeriesId: null, createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null,
    })
  }

  return {
    version: 3, revision: 1, listGroups: [], lists: [], sections: [], tags: [],
    tasks, recurrenceSeries, occurrences, reminderRules: [], reminderDeliveries: [],
    studySessions: [], taskEvents: [], completionRecords: [], reviewTaskLinks: [],
    commandReceipts: [], updatedAt: '2026-09-05T00:00:00.000Z',
  }
}
