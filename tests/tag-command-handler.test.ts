import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommandResult } from '../src/domain/capabilities/types.ts'
import { runTagCommand, type TagCommandHandler } from '../src/lib/tag-command-handler.ts'

const result: CommandResult = { receiptId: 'receipt:tag', workspaceRevision: 2, affected: [], events: [], undoToken: { id: 'undo:tag' } as CommandResult['undoToken'], data: null }

function fixture(overrides: Partial<TagCommandHandler> = {}) {
  const calls: string[] = []
  const notices: Array<{ message: string; action?: { label: string; run(): Promise<void> } }> = []
  const handler: TagCommandHandler = {
    snapshotRevision: async () => { calls.push('snapshot'); return 1 },
    execute: async (revision) => { calls.push(`execute:${revision}`); return result },
    refresh: async () => { calls.push('refresh') },
    notify: (message, action) => notices.push({ message, action }),
    successAction: () => ({ label: '撤销', run: async () => { calls.push('undo') } }),
    successMessage: '标签已创建。',
    ...overrides,
  }
  return { calls, notices, handler }
}

test('tag mutation reads the current revision, commits, refreshes, then exposes undo', async () => {
  const { calls, notices, handler } = fixture()
  assert.equal(await runTagCommand(handler), result)
  assert.deepEqual(calls, ['snapshot', 'execute:1', 'refresh'])
  assert.equal(notices[0]?.message, '标签已创建。')
  assert.equal(notices[0]?.action?.label, '撤销')
})

test('tag mutation cannot execute when the current revision is unavailable', async () => {
  const failure = new Error('offline')
  const { calls, notices, handler } = fixture({ snapshotRevision: async () => { calls.push('snapshot'); throw failure } })
  await assert.rejects(runTagCommand(handler), failure)
  assert.deepEqual(calls, ['snapshot'])
  assert.equal(notices[0]?.message, '无法读取最新标签，未执行更改：offline')
})

test('tag command failure reloads persisted state and retains a precise failure', async () => {
  const failure = new Error('CAS conflict')
  const { calls, notices, handler } = fixture({ execute: async () => { calls.push('execute'); throw failure } })
  await assert.rejects(runTagCommand(handler), failure)
  assert.deepEqual(calls, ['snapshot', 'execute', 'refresh'])
  assert.equal(notices[0]?.message, '标签更改未保存：CAS conflict')
})

test('saved tag command with a failed refresh offers a reload without replaying the write', async () => {
  let fail = true
  const { calls, notices, handler } = fixture({ refresh: async () => { calls.push('refresh'); if (fail) { fail = false; throw new Error('load failed') } } })
  assert.equal(await runTagCommand(handler), result)
  assert.deepEqual(calls, ['snapshot', 'execute:1', 'refresh'])
  assert.equal(notices[0]?.message, '标签已保存，但界面刷新失败：load failed')
  assert.equal(notices[0]?.action?.label, '重新加载')
  await notices[0]!.action!.run()
  assert.deepEqual(calls, ['snapshot', 'execute:1', 'refresh', 'refresh'])
  assert.equal(notices[1]?.message, '标签已创建。')
})
