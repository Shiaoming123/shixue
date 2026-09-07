import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = () => readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const studySource = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')

test('task header renders one page title without a duplicate title selector', () => {
  const tasks = studySource('TasksView.vue')
  assert.equal(tasks.match(/<h1\b/g)?.length, 1)
  assert.doesNotMatch(tasks, /mobile-smart-view/)
  assert.match(tasks, /aria-label="切换智能清单"/)
})

test('settings is a first-class page instead of a modal sheet', () => {
  const app = appSource()
  const sidebar = studySource('AppSidebar.vue')
  const settings = studySource('SettingsView.vue')

  const navigation = readFileSync(new URL('../src/lib/sidebar-navigation.ts', import.meta.url), 'utf8')
  assert.match(navigation, /StudyPage = [^\n]*'settings'/)
  assert.match(sidebar, /active: ShellDestination/)
  assert.match(sidebar, /navigate: \[destination: ShellDestination\]/)
  assert.match(app, /<SettingsView\b/)
  assert.match(app, /page === 'settings'/)
  assert.doesNotMatch(app, /SettingsSheet|settingsOpen/)
  assert.match(settings, /<h1[^>]*>设置<\/h1>/)
  assert.doesNotMatch(settings, /role="dialog"|aria-modal|class="backdrop"/)
})

test('sidebar supports persisted icon mode, drag ordering, and keyboard fallback', () => {
  const sidebar = studySource('AppSidebar.vue')
  assert.match(sidebar, /displayMode/)
  assert.match(sidebar, /draggable="true"/)
  assert.match(sidebar, /@dragstart/)
  assert.match(sidebar, /@drop/)
  assert.match(sidebar, /Alt\+ArrowUp Alt\+ArrowDown/)
  assert.match(sidebar, /prefers-reduced-motion/)
  assert.match(sidebar, /aria-live="polite"/)
  assert.match(sidebar, /min-width: 820px[\s\S]*max-width: 1279px[\s\S]*\.mode-toggle \{ display: none; \}/)
})

test('settings exposes only connected appearance, navigation, quick add, data, reminder, and cloud controls', () => {
  const settings = studySource('SettingsView.vue')
  for (const section of ['外观与显示', '侧边栏', '快速新增', '本地数据']) {
    assert.match(settings, new RegExp(section))
  }
  assert.match(settings, /reducedGlassOverride/)
  assert.match(settings, /sidebarDisplayMode/)
  assert.match(settings, /resetSidebarOrder/)
  assert.match(settings, /remindersAvailable/)
  assert.match(settings, /cloudAvailable/)
  assert.match(settings, /aria-pressed/)
  assert.match(settings, /tabindex="-1"/)
  assert.match(settings, /当前窗口使用图标侧栏；展开偏好会在宽屏生效。/)
  assert.doesNotMatch(settings, /<select\b/)
})
