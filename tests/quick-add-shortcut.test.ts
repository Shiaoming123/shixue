import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createShortcutModule } from '../src/modules/shortcut/index.ts'
import type { ModuleContext } from '../src/modules/types.ts'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('desktop setup de-duplicates registration and focuses the main window before quick-add dispatch', async () => {
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
    dispatchEvent: (event) => { actions.push(event.type) },
  }))

  await Promise.all([
    module.setup?.({} as ModuleContext),
    module.setup?.({} as ModuleContext),
  ])
  await handler?.({ state: 'Released' })
  assert.deepEqual(actions, [])
  await handler?.({ state: 'Pressed' })

  assert.deepEqual(registered, ['Ctrl+Alt+A'])
  assert.deepEqual(actions, ['show', 'unminimize', 'focus', 'shixue:quick-add'])
})

test('teardown unregisters once and permits a clean later setup', async () => {
  const registered: string[] = []
  const unregistered: string[] = []
  const module = createShortcutModule(async () => ({
    register: async (shortcut) => { registered.push(shortcut) },
    unregister: async (shortcut) => { unregistered.push(shortcut) },
    getMainWindow: () => ({ show: async () => {}, unminimize: async () => {}, setFocus: async () => {} }),
    dispatchEvent: () => {},
  }))

  await module.setup?.({} as ModuleContext)
  await Promise.all([
    module.teardown?.({} as ModuleContext),
    module.teardown?.({} as ModuleContext),
  ])
  await module.setup?.({} as ModuleContext)

  assert.deepEqual(registered, ['Ctrl+Alt+A', 'Ctrl+Alt+A'])
  assert.deepEqual(unregistered, ['Ctrl+Alt+A'])
})

test('global quick add closes blocking layers, navigates to Inbox, and focuses the exposed composer', () => {
  const app = source('src/App.vue')
  assert.match(app, /window\.addEventListener\('shixue:quick-add', handleQuickAdd\)/)
  assert.match(app, /window\.removeEventListener\('shixue:quick-add', handleQuickAdd\)/)
  assert.match(app, /<TasksView\b[\s\S]*ref="tasksView"/)
  assert.match(app, /function handleQuickAdd\(\)[\s\S]*settingsOpen\.value = false[\s\S]*taskEditorOpen\.value = false[\s\S]*selectSmartView\('inbox'\)[\s\S]*tasksView\.value\?\.focusQuickAdd\(\)/)
  assert.doesNotMatch(app, /handleQuickAdd[\s\S]{0,700}querySelector/)
})

test('local N focuses the current view composer without hijacking editable targets', () => {
  const tasks = source('src/components/study/TasksView.vue')
  assert.match(tasks, /target\.matches\('input, textarea, select, \[contenteditable="true"\]'\)/)
  assert.match(tasks, /event\.key\.toLowerCase\(\) === 'n'[\s\S]*quickAddComposer\.value\?\.focus\(\)/)
  assert.match(tasks, /function focusQuickAdd\(\)[\s\S]*quickAddComposer\.value\?\.focus\(\)/)
  assert.match(tasks, /defineExpose\(\{ focusQuickAdd \}\)/)
})
