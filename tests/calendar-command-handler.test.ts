import assert from 'node:assert/strict'
import test from 'node:test'
import { createCalendarUndoAction, runCalendarCommand, type CalendarCommandHandler } from '../src/lib/calendar-command-handler.ts'
import type { CommandResult } from '../src/domain/capabilities/types.ts'

const result: CommandResult = { receiptId: 'receipt:1', workspaceRevision: 2, affected: [], events: [], undoToken: { id: 'undo:1' } as CommandResult['undoToken'], data: null }

function fixture(overrides: Partial<CalendarCommandHandler> = {}) {
  const calls: string[] = []
  const notices: Array<{ message: string; action?: { label: string; run(): Promise<void> } }> = []
  const handler: CalendarCommandHandler = {
    preflight: async () => { calls.push('preflight'); return 1 },
    execute: async (revision) => { calls.push(`execute:${revision}`); return result },
    refresh: async () => { calls.push('refresh') },
    notify: (message, action) => { notices.push({ message, action }) },
    successAction: (saved) => saved.undoToken ? { label: '撤销', run: async () => { calls.push(`undo:${saved.undoToken?.id}`) } } : undefined,
    ...overrides,
  }
  return { calls, notices, handler }
}

test('preflight failure reports precisely and never executes or refreshes', async () => {
  const failure = new Error('snapshot unavailable')
  const { calls, notices, handler } = fixture({ preflight: async () => { calls.push('preflight'); throw failure } })
  await assert.rejects(runCalendarCommand(handler), failure)
  assert.deepEqual(calls, ['preflight'])
  assert.equal(notices[0]?.message, '无法读取最新日历，未执行调整：snapshot unavailable')
})

test('execution failure refreshes the persisted source then reports not saved', async () => {
  const failure = new Error('CAS conflict')
  const { calls, notices, handler } = fixture({ execute: async () => { calls.push('execute'); throw failure } })
  await assert.rejects(runCalendarCommand(handler), failure)
  assert.deepEqual(calls, ['preflight', 'execute', 'refresh'])
  assert.equal(notices[0]?.message, '日历调整未保存：CAS conflict')
})

test('successful execute plus refresh failure preserves the result and retry only refreshes', async () => {
  let firstRefresh = true
  const { calls, notices, handler } = fixture({
    refresh: async () => { calls.push('refresh'); if (firstRefresh) { firstRefresh = false; throw new Error('load failed') } },
  })
  assert.equal(await runCalendarCommand(handler), result)
  assert.deepEqual(calls, ['preflight', 'execute:1', 'refresh'])
  assert.equal(notices[0]?.message, '日历安排已保存，但视图刷新失败：load failed')
  assert.equal(notices[0]?.action?.label, '重新加载')
  await notices[0]!.action!.run()
  assert.deepEqual(calls, ['preflight', 'execute:1', 'refresh', 'refresh'])
  assert.equal(notices[1]?.message, '日历安排已更新。')
  assert.equal(notices[1]?.action?.label, '撤销')
})

test('normal success refreshes before exposing the undo-bearing result', async () => {
  const { calls, notices, handler } = fixture()
  assert.equal(await runCalendarCommand(handler), result)
  assert.deepEqual(calls, ['preflight', 'execute:1', 'refresh'])
  assert.equal(notices[0]?.message, '日历安排已更新。')
  assert.equal(notices[0]?.action?.label, '撤销')
})

test('App undo seam preserves a saved undo across refresh failure and retries only refresh', async () => {
  const calls: string[] = []
  const notices: Array<{ message: string; action?: { label: string; run(): Promise<void> } }> = []
  let firstRefresh = true
  const action = createCalendarUndoAction({
    token: result.undoToken!,
    preflight: async () => { calls.push('preflight'); return 2 },
    execute: async (revision, token) => { calls.push(`execute:${revision}:${token.id}`); return { ...result, undoToken: null } },
    refresh: async () => { calls.push('refresh'); if (firstRefresh) { firstRefresh = false; throw new Error('view load failed') } },
    notify: (message, noticeAction) => notices.push({ message, action: noticeAction }),
  })

  await action.run()
  assert.deepEqual(calls, ['preflight', 'execute:2:undo:1', 'refresh'])
  assert.equal(notices[0]?.message, '日历撤销已保存，但视图刷新失败：view load failed')
  assert.equal(notices[0]?.action?.label, '重新加载')
  await notices[0]!.action!.run()
  assert.deepEqual(calls, ['preflight', 'execute:2:undo:1', 'refresh', 'refresh'])
  assert.equal(notices[1]?.message, '已撤销。')
})

test('App undo seam classifies preflight and execute failures without retrying undo', async (context) => {
  await context.test('preflight', async () => {
    const calls: string[] = []
    const notices: string[] = []
    const action = createCalendarUndoAction({
      token: result.undoToken!,
      preflight: async () => { calls.push('preflight'); throw new Error('snapshot unavailable') },
      execute: async () => { calls.push('execute'); return result },
      refresh: async () => { calls.push('refresh') },
      notify: (message) => notices.push(message),
    })
    await action.run()
    assert.deepEqual(calls, ['preflight'])
    assert.deepEqual(notices, ['无法读取最新日历，未执行撤销：snapshot unavailable'])
  })

  await context.test('execute', async () => {
    const calls: string[] = []
    const notices: string[] = []
    const action = createCalendarUndoAction({
      token: result.undoToken!,
      preflight: async () => { calls.push('preflight'); return 2 },
      execute: async () => { calls.push('execute'); throw new Error('undo CAS conflict') },
      refresh: async () => { calls.push('refresh') },
      notify: (message) => notices.push(message),
    })
    await action.run()
    assert.deepEqual(calls, ['preflight', 'execute', 'refresh'])
    assert.deepEqual(notices, ['日历撤销未保存：undo CAS conflict'])
  })
})
