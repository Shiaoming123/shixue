import assert from 'node:assert/strict'
import test from 'node:test'
import { installWindowLifecycle, requestWindowClose, type WindowLifecycleBindings } from '../src/lib/window-lifecycle.ts'
import { queryAutostartStatus, setAutostartEnabled } from '../src/modules/autostart/index.ts'
import { createTrayModule } from '../src/modules/tray/index.ts'

test('ask never loads a native action and quit uses exit rather than hiding', async () => {
  assert.equal(await requestWindowClose('ask', async () => { throw Error('must not load') }), 'confirmation-required')
  const actions: string[] = []
  const bindings: WindowLifecycleBindings = { hide: async () => { actions.push('hide') }, exit: async () => { actions.push('exit') }, onCloseRequested: async () => () => {} }
  assert.equal(await requestWindowClose('tray', async () => bindings), 'hidden')
  assert.equal(await requestWindowClose('quit', async () => bindings), 'exiting')
  assert.deepEqual(actions, ['hide', 'exit'])
  await assert.rejects(() => requestWindowClose('tray', async () => { throw Error('denied') }), /未能隐藏/)
})

test('close prevention is synchronous, ask is single flight, cancel keeps the window, and failure is visible', async () => {
  let handler!: (event: { preventDefault(): void }) => Promise<void>
  let resolve!: (choice: 'tray' | 'quit' | null) => void
  let asked = 0
  let prevented = 0
  let hidden = 0
  let stopped = 0
  let behavior: 'ask' | 'tray' = 'ask'
  const errors: Error[] = []
  const unlisten = await installWindowLifecycle({
    getBehavior: () => behavior,
    onAsk: () => { asked++; return new Promise((done) => { resolve = done }) },
    onError: (error) => errors.push(error),
  }, async () => ({
    hide: async () => { hidden++; throw Error('hide denied') }, exit: async () => assert.fail('cancel must not exit'),
    onCloseRequested: async (listener) => { handler = listener; return () => { stopped++ } },
  }))
  const event = { preventDefault: () => { prevented++ } }
  const first = handler(event)
  assert.equal(prevented, 1)
  await handler(event)
  assert.equal(asked, 1)
  resolve(null)
  await first
  assert.equal(hidden, 0)
  behavior = 'tray'
  await handler(event)
  assert.equal(errors.length, 1)
  unlisten()
  assert.equal(stopped, 1)
})

test('autostart capability probe is read-only and a write is successful only when native state matches', async () => {
  assert.deepEqual(await queryAutostartStatus(async () => false), { available: true, enabled: false })
  assert.equal((await queryAutostartStatus(async () => { throw Error('missing feature') })).available, false)
  const writes: string[] = []
  const bindings = { enable: async () => { writes.push('enable') }, disable: async () => { writes.push('disable') }, read: async () => false }
  await assert.rejects(() => setAutostartEnabled(true, bindings), /未能保存/)
  assert.equal(await setAutostartEnabled(false, bindings), false)
  assert.deepEqual(writes, ['enable', 'disable'])
})

test('tray quick-add bridges the event once and unsubscribes on teardown', async () => {
  let listener!: () => void
  let dispatched = 0
  let stopped = 0
  let loads = 0
  const module = createTrayModule(async () => {
    loads++
    return { listenQuickAdd: async (handler) => { listener = handler; return () => { stopped++ } }, dispatchQuickAdd: () => { dispatched++ } }
  })
  await module.setup?.({} as never)
  await module.setup?.({} as never)
  listener()
  assert.equal(loads, 1)
  assert.equal(dispatched, 1)
  await module.teardown?.({} as never)
  assert.equal(stopped, 1)
})
