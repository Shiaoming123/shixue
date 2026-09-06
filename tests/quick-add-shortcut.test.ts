import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  isQuickAddEditableTarget,
  type EditableTargetLike,
} from '../src/lib/quick-add-shortcut-state.ts'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('desktop registers quick capture in the native lifecycle and routes it through the shared tray bridge', () => {
  const lib = source('src-tauri/src/lib.rs')
  const shortcut = source('src-tauri/src/shortcut.rs')
  const frontend = source('src/modules/shortcut/index.ts')
  const tray = source('src-tauri/src/tray.rs')

  assert.match(lib, /mod shortcut;/)
  assert.match(lib, /builder = builder\.plugin\(shortcut::plugin\(\)\)/)
  assert.match(lib, /fn set_quick_add_shortcut[\s\S]*shortcut::set_registered\(&app, enabled\)/)
  assert.doesNotMatch(lib, /shortcut::register\(app\.handle\(\)\)/)
  assert.match(shortcut, /Builder::new\(\)[\s\S]*\.with_handler\([\s\S]*\.build\(\)/)
  assert.match(shortcut, /pub fn set_registered[\s\S]*global_shortcut\.register\(shortcut\)[\s\S]*global_shortcut\.unregister\(shortcut\)/)
  assert.doesNotMatch(shortcut, /\.with_shortcut\(/)
  assert.match(shortcut, /state == ShortcutState::Pressed/)
  assert.match(shortcut, /tray::show_quick_add\(app\)/)
  assert.match(tray, /pub const QUICK_ADD_EVENT: &str = "shixue:quick-add"/)
  assert.match(frontend, /invoke\('set_quick_add_shortcut', \{ enabled \}\)/)
  assert.doesNotMatch(frontend, /@tauri-apps\/plugin-global-shortcut|\bregister\(|\bunregister\(/)
})

test('global quick add closes blocking layers, navigates to Inbox, and focuses the exposed composer', () => {
  const app = source('src/App.vue')
  assert.match(app, /window\.addEventListener\('shixue:quick-add', handleQuickAdd\)/)
  assert.match(app, /window\.removeEventListener\('shixue:quick-add', handleQuickAdd\)/)
  assert.match(app, /<TasksView\b[\s\S]*ref="tasksView"/)
  assert.match(app, /function handleQuickAdd\(\)[\s\S]*taskEditorOpen\.value = false[\s\S]*selectSmartView\('inbox'\)[\s\S]*tasksView\.value\?\.activateQuickAdd\(\)/)
  assert.doesNotMatch(app, /settingsOpen/)
  assert.doesNotMatch(app, /handleQuickAdd[\s\S]{0,700}querySelector/)
})

function editableTarget(options: {
  matches?: boolean
  isContentEditable?: boolean
  hostValue?: string | null
} = {}): EditableTargetLike {
  return {
    matches: () => options.matches ?? false,
    isContentEditable: options.isContentEditable ?? false,
    closest: () => options.hostValue === undefined ? null : ({
      getAttribute: () => options.hostValue ?? null,
    }),
  }
}

test('local shortcut recognizes native inputs and every supported contenteditable host shape', () => {
  assert.equal(isQuickAddEditableTarget(editableTarget({ matches: true })), true)
  assert.equal(isQuickAddEditableTarget(editableTarget({ isContentEditable: true })), true)
  assert.equal(isQuickAddEditableTarget(editableTarget({ hostValue: '' })), true)
  assert.equal(isQuickAddEditableTarget(editableTarget({ hostValue: 'true' })), true)
  assert.equal(isQuickAddEditableTarget(editableTarget({ hostValue: 'plaintext-only' })), true)
  assert.equal(isQuickAddEditableTarget(editableTarget({ hostValue: 'false' })), false)
  assert.equal(isQuickAddEditableTarget(editableTarget()), false)
})

test('local N focuses the current view composer without hijacking editable targets', () => {
  const tasks = source('src/components/study/TasksView.vue')
  assert.match(tasks, /target instanceof HTMLElement && isQuickAddEditableTarget\(target\)/)
  assert.match(tasks, /event\.key\.toLowerCase\(\) === 'n'[\s\S]*quickAddComposer\.value\?\.focus\(\)/)
  assert.match(tasks, /function activateQuickAdd\(\)[\s\S]*confirmDeleteIds\.value = \[\][\s\S]*quickAddComposer\.value\?\.focus\(\)/)
  assert.match(tasks, /defineExpose\(\{ activateQuickAdd \}\)/)
  assert.doesNotMatch(tasks, /\[contenteditable="true"\]/)
})
