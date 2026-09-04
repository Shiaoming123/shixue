import assert from 'node:assert/strict'
import test from 'node:test'
import { createShortcutModule } from '../src/modules/shortcut/index.ts'
import type { ModuleContext } from '../src/modules/types.ts'

test('desktop setup registers quick capture once and activation focuses the main window before dispatch', async () => {
  const registered: string[] = []
  const actions: string[] = []
  let handler: ((event: { state: string }) => void | Promise<void>) | undefined

  const module = createShortcutModule(async () => ({
    register: async (shortcut, nextHandler) => {
      registered.push(shortcut)
      handler = nextHandler
    },
    unregister: async () => {},
    getMainWindow: () => ({
      show: async () => { actions.push('show') },
      unminimize: async () => { actions.push('unminimize') },
      setFocus: async () => { actions.push('focus') },
    }),
    dispatchEvent: (event) => {
      assert.equal(event instanceof CustomEvent, true)
      actions.push(event.type)
    },
  }))

  await Promise.all([
    module.setup?.({} as ModuleContext),
    module.setup?.({} as ModuleContext),
  ])
  await handler?.({ state: 'Released' })
  assert.deepEqual(actions, [])
  await handler?.({ state: 'Pressed' })

  assert.deepEqual(registered, ['Ctrl+Alt+A'])
  assert.deepEqual(actions, [
    'show',
    'unminimize',
    'focus',
    'shixue:quick-capture',
  ])
})

test('teardown unregisters quick capture and allows a later setup to register it again', async () => {
  const registered: string[] = []
  const unregistered: string[] = []
  const module = createShortcutModule(async () => ({
    register: async (shortcut) => { registered.push(shortcut) },
    unregister: async (shortcut) => { unregistered.push(shortcut) },
    getMainWindow: () => ({
      show: async () => {},
      unminimize: async () => {},
      setFocus: async () => {},
    }),
    dispatchEvent: () => {},
  }))

  await module.setup?.({} as ModuleContext)
  await module.teardown?.({} as ModuleContext)
  await module.setup?.({} as ModuleContext)

  assert.deepEqual(registered, ['Ctrl+Alt+A', 'Ctrl+Alt+A'])
  assert.deepEqual(unregistered, ['Ctrl+Alt+A'])
})
