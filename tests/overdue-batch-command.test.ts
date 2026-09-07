import assert from 'node:assert/strict'
import test from 'node:test'
import { runOverdueBatchMove, type OverdueBatchRuntime } from '../src/lib/overdue-batch-command.ts'
import type { CommandPreview, CommandResult } from '../src/domain/capabilities/types.ts'
import type { Task, WorkspaceStateV3 } from '../src/domain/workspace/types.ts'

const result: CommandResult = {
  receiptId: 'receipt:overdue', workspaceRevision: 2, affected: [], events: [],
  undoToken: { id: 'undo:overdue' } as CommandResult['undoToken'], data: null,
}
const acceptedPreview: CommandPreview = {
  accepted: true,
  descriptor: { type: 'task.batch_reschedule', risk: 'medium', scope: 'batch', reversibility: 'reversible', requiresPreview: true },
  affected: [], changes: [], validationErrors: [], confirmation: 'review', previewReceiptId: 'preview:overdue',
}

test('saved overdue batch keeps undo when refresh fails and retry only refreshes', async () => {
  const calls: string[] = []
  const notices: Array<{ message: string; action?: { label: string; run(): Promise<void> } }> = []
  let firstRefresh = true
  const runtime = fixtureRuntime(calls, notices, {
    preview: async (envelope) => {
      calls.push(`preview:${envelope.command.taskIds.join(',')}`)
      assert.deepEqual(envelope.command.taskIds, ['ordinary'])
      return acceptedPreview
    },
    execute: async () => { calls.push('execute'); return result },
    refresh: async () => {
      calls.push('refresh')
      if (firstRefresh) { firstRefresh = false; throw new Error('load failed') }
    },
  })

  assert.equal(await runOverdueBatchMove(['ordinary', 'recurring'], '2026-09-05', runtime), result)
  assert.deepEqual(calls, ['snapshot', 'preview:ordinary', 'execute', 'refresh'])
  assert.match(notices[0]!.message, /已保存，但视图刷新失败.*load failed/)
  assert.equal(notices[0]!.action?.label, '重新加载')

  await notices[0]!.action!.run()
  assert.deepEqual(calls, ['snapshot', 'preview:ordinary', 'execute', 'refresh', 'refresh'])
  assert.equal(notices[1]!.message, '已把 1 项移到今天。')
  assert.equal(notices[1]!.action?.label, '撤销')
})

test('overdue batch CAS failure refreshes the latest source and never offers undo', async () => {
  const calls: string[] = []
  const notices: Array<{ message: string; action?: { label: string; run(): Promise<void> } }> = []
  const runtime = fixtureRuntime(calls, notices, {
    execute: async () => { calls.push('execute'); throw new Error('CAS conflict') },
  })

  assert.equal(await runOverdueBatchMove(['ordinary'], '2026-09-05', runtime), null)
  assert.deepEqual(calls, ['snapshot', 'preview', 'execute', 'refresh'])
  assert.match(notices[0]!.message, /未保存.*CAS conflict/)
  assert.equal(notices[0]!.action, undefined)
})

function fixtureRuntime(
  calls: string[],
  notices: Array<{ message: string; action?: { label: string; run(): Promise<void> } }>,
  overrides: Partial<OverdueBatchRuntime> = {},
): OverdueBatchRuntime {
  return {
    snapshot: async () => { calls.push('snapshot'); return workspace() },
    preview: async () => { calls.push('preview'); return acceptedPreview },
    execute: async () => { calls.push('execute'); return result },
    refresh: async () => { calls.push('refresh') },
    notify: (message, action) => notices.push({ message, action }),
    successAction: () => ({ label: '撤销', run: async () => { calls.push('undo') } }),
    createId: () => 'id:fixed',
    ...overrides,
  }
}

function workspace(): WorkspaceStateV3 {
  return {
    version: 3, revision: 1, listGroups: [], lists: [], sections: [], tags: [],
    tasks: [task('ordinary', null), task('recurring', 'series:1')], recurrenceSeries: [], occurrences: [],
    reminderRules: [], reminderDeliveries: [], studySessions: [], taskEvents: [], completionRecords: [], reviewTaskLinks: [], commandReceipts: [],
    updatedAt: '2026-09-05T00:00:00.000Z',
  }
}

function task(id: string, recurrenceSeriesId: string | null): Task {
  return {
    id, revision: 1, mode: 'general', listId: 'list:system:learning', sectionId: null, tagIds: [], title: id, notes: '', status: 'planned',
    schedule: { startAt: null, startOn: '2026-09-04', estimateMinutes: null }, deadline: { dueAt: null, dueOn: null }, priority: 'none',
    checklist: [], learning: null, recurrenceSeriesId, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null,
  }
}
