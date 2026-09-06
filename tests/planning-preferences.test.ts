import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildQuickAddCommand } from '../src/domain/quick-add/command.ts'
import {
  loadPlanningPreferences,
  savePlanningPreferences,
  type PlanningPreferences,
} from '../src/lib/planning-preferences.ts'

const appSource = () => readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const studySource = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')

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
