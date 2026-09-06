import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'
import { buildQuickAddCommand } from '../src/domain/quick-add/command.ts'
import {
  loadPlanningPreferences,
  loadLastDesktopCalendarView,
  saveLastDesktopCalendarView,
  savePlanningPreferences,
  type PlanningPreferences,
} from '../src/lib/planning-preferences.ts'

const appSource = () => readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const studySource = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')
const ref = <T>(value: T) => ({ value })

function componentHandlers(file: string, names: string[], ports: Record<string, unknown>): Record<string, (...args: any[]) => any> {
  const { descriptor } = parse(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'))
  const source = ts.createSourceFile(file, descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true)
  const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  assert.equal(functions.length, names.length)
  const code = ts.transpileModule(functions.map((node) => node.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(ports), `${code}; return { ${names.join(',')} };`)(...Object.values(ports))
}

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

function withStorage(run: (storage: MemoryStorage) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    run(storage)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

const defaults: PlanningPreferences = {
  weekStartsOn: 1,
  defaultCalendarView: 'week',
  defaultEstimateMinutes: null,
  quickAddRemoveRecognizedText: false,
  closeBehavior: 'ask',
  launchAtLogin: false,
  defaultSnoozeMinutes: 10,
  reducedGlassOverride: 'system',
}

test('planning preferences load a complete validated default outside the workspace snapshot', () => {
  withStorage((storage) => {
    assert.deepEqual(loadPlanningPreferences(), defaults)
    const saved = savePlanningPreferences({ quickAddRemoveRecognizedText: true, defaultEstimateMinutes: 45 })
    assert.deepEqual(saved, { ...defaults, quickAddRemoveRecognizedText: true, defaultEstimateMinutes: 45 })
    assert.deepEqual(loadPlanningPreferences(), saved)
    assert.equal([...storage.values.keys()].some((key) => /workspace|snapshot/i.test(key)), false)
  })
})

test('last desktop calendar view is a separate validated device record', () => {
  withStorage((storage) => {
    assert.equal(loadLastDesktopCalendarView(), null)
    assert.equal(saveLastDesktopCalendarView('month'), 'month')
    assert.equal(loadLastDesktopCalendarView(), 'month')
    assert.equal(storage.values.has('shixue:calendar-last-desktop-view:v1'), true)
    assert.equal(storage.values.has('shixue:planning-preferences:v1'), false)

    storage.setItem('shixue:calendar-last-desktop-view:v1', '{bad json')
    assert.equal(loadLastDesktopCalendarView(), null)
    storage.setItem('shixue:calendar-last-desktop-view:v1', JSON.stringify({ version: 1, mode: 'board' }))
    assert.equal(loadLastDesktopCalendarView(), null)
  })
})

test('last desktop calendar view surfaces write failures', () => {
  withStorage((storage) => {
    storage.setItem = () => { throw new Error('disk full') }
    assert.throws(() => saveLastDesktopCalendarView('agenda'), /disk full/)
  })
})

test('App persists one changed desktop selection and keeps the in-memory mode when storage fails', () => {
  const desktopCalendarMode = ref<'day' | 'week' | 'month' | 'agenda'>('week')
  let desktopCalendarModeLoaded = true
  const writes: string[] = []
  const notices: string[] = []
  const api = componentHandlers('App.vue', ['persistDesktopCalendarMode'], {
    desktopCalendarMode,
    desktopCalendarModeLoaded,
    saveLastDesktopCalendarView: (mode: string) => writes.push(mode),
    notify: (message: string) => notices.push(message),
  })

  api.persistDesktopCalendarMode('week')
  api.persistDesktopCalendarMode('month')
  api.persistDesktopCalendarMode('month')
  assert.deepEqual(writes, ['month'])
  assert.equal(desktopCalendarMode.value, 'month')

  const failed = componentHandlers('App.vue', ['persistDesktopCalendarMode'], {
    desktopCalendarMode,
    desktopCalendarModeLoaded,
    saveLastDesktopCalendarView: () => { throw new Error('disk full') },
    notify: (message: string) => notices.push(message),
  })
  failed.persistDesktopCalendarMode('agenda')
  assert.equal(desktopCalendarMode.value, 'agenda')
  assert.match(notices.at(-1) ?? '', /未能保存/)
})

test('calendar workspace emits only a changed desktop toolbar selection', () => {
  const viewportWidth = ref(1200)
  const compact = { get value() { return viewportWidth.value <= 819 } }
  const requestedMode = ref<'day' | 'week' | 'month' | 'agenda'>('week')
  const lastDesktopMode = ref<'day' | 'week' | 'month' | 'agenda'>('week')
  const statusMessage = ref('')
  const emitted: string[] = []
  const api = componentHandlers('components/calendar/CalendarWorkspace.vue', ['onCompactChange', 'setMode'], {
    viewportWidth,
    compact,
    requestedMode,
    lastDesktopMode,
    statusMessage,
    emit: (_event: string, mode: string) => emitted.push(mode),
  })

  api.setMode('week')
  api.setMode('month')
  assert.deepEqual(emitted, ['month'])
  api.onCompactChange({ matches: true })
  api.setMode('agenda')
  assert.equal(requestedMode.value, 'agenda')
  assert.deepEqual(emitted, ['month'])
  api.onCompactChange({ matches: false })
  assert.equal(requestedMode.value, 'month')
  assert.deepEqual(emitted, ['month'])
})

test('damaged or untrusted preference storage fails safe to validated defaults', () => {
  withStorage((storage) => {
    storage.setItem('shixue:planning-preferences:v1', '{bad json')
    assert.deepEqual(loadPlanningPreferences(), defaults)

    storage.setItem('shixue:planning-preferences:v1', JSON.stringify({ ...defaults, defaultEstimateMinutes: -1 }))
    assert.deepEqual(loadPlanningPreferences(), defaults)

    const before = storage.getItem('shixue:planning-preferences:v1')
    assert.throws(
      () => savePlanningPreferences({ defaultCalendarView: 'board' } as unknown as Partial<PlanningPreferences>),
      /Invalid planning preferences patch/,
    )
    assert.equal(storage.getItem('shixue:planning-preferences:v1'), before)
  })
})

test('the default estimate is applied by the same quick-add capability command path', () => {
  const command = buildQuickAddCommand({
    input: '复习线代',
    candidates: [],
    destinationListId: 'list:system:learning',
    timezone: 'Asia/Shanghai',
    defaultEstimateMinutes: 45,
  })
  assert.equal(command.estimateMinutes, 45)
})

test('App explicitly wires planning preferences through themed settings into Quick Add', () => {
  const app = appSource()
  assert.match(app, /loadPlanningPreferences\(\)/)
  assert.match(app, /savePlanningPreferences\(/)
  assert.match(app, /:quick-add-remove-recognized-text="planningPreferences\.quickAddRemoveRecognizedText"/)
  assert.match(app, /:quick-add-default-estimate-minutes="planningPreferences\.defaultEstimateMinutes"/)

  const settings = studySource('SettingsView.vue')
  assert.match(settings, /<Switch\b[\s\S]*quickAddRemoveRecognizedText/)
  assert.match(settings, /<Listbox\b[\s\S]*defaultEstimateMinutes/)
  assert.doesNotMatch(settings, /<select\b/)

  const tasks = studySource('TasksView.vue')
  const composer = studySource('QuickAddComposer.vue')
  assert.match(tasks, /:default-estimate-minutes="quickAddDefaultEstimateMinutes"/)
  assert.match(composer, /defaultEstimateMinutes/)
})
