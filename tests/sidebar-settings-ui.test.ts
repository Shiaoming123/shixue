import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = () => readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const studySource = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')

test('task header renders one page title without a duplicate title selector', () => {
  const tasks = studySource('TasksView.vue')
  assert.equal(tasks.match(/<h1\b/g)?.length, 1)
  assert.doesNotMatch(tasks, /mobile-smart-view/)
  assert.match(tasks, /<IconButton[^>]*label="切换智能清单"/)
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
})

test('sidebar keeps a separate visible collapse control at every desktop width', () => {
  const sidebar = studySource('AppSidebar.vue')
  assert.match(sidebar, /<\/div>\s*<button class="mode-toggle"/)
  assert.match(sidebar, /class="mode-label"/)
  assert.match(sidebar, /\.mode-toggle \{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/)
  assert.doesNotMatch(sidebar, /\.sidebar\.icons \.mode-toggle \{[^}]*opacity:\s*0/)
  assert.doesNotMatch(sidebar, /\.brand:hover \.brand-mark/)
  assert.doesNotMatch(sidebar, /@media \(min-width: 820px\)[\s\S]*?\.mode-toggle \{\s*display:\s*none;/)
  assert.doesNotMatch(sidebar, /@media \(min-width: 820px\)[\s\S]*?\.sidebar \{[^}]*\b(?:width|min-width):\s*72px/)
})

test('sidebar logo and controls share one icon axis while long labels stay clipped', () => {
  const sidebar = studySource('AppSidebar.vue')
  assert.match(sidebar, /--sidebar-icon-size:\s*18px/)
  assert.match(sidebar, /--sidebar-row-padding:\s*10px/)
  assert.match(sidebar, /\.brand \{[^}]*grid-template-columns:\s*var\(--sidebar-icon-size\) minmax\(0,\s*1fr\)/)
  for (const selector of ['brand', 'mode-toggle', 'search-command', 'nav-item']) {
    assert.match(sidebar, new RegExp(`\\.${selector} \\{[^}]*padding: 0 var\\(--sidebar-row-padding\\)`))
  }
  assert.match(sidebar, /\.sidebar\.icons \.nav-section h2 \{[^}]*max-width:\s*0;[^}]*margin:\s*0/)
  assert.match(sidebar, /\.nav-label \{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/)
  assert.match(sidebar, /\.group-heading > span \{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/)
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
  assert.doesNotMatch(settings, /当前窗口使用图标侧栏；展开偏好会在宽屏生效。/)
  assert.doesNotMatch(settings, /\.sidebar-mode-control \.segmented \{ display:\s*none;/)
  assert.doesNotMatch(settings, /<select\b/)
})

test('settings separates the lossless JSON backup from the readable Markdown export', () => {
  const app = appSource()
  const settings = studySource('SettingsView.vue')

  assert.match(settings, /exportJson: \[\]/)
  assert.match(settings, /exportMarkdown: \[\]/)
  assert.match(settings, /导出 JSON 备份/)
  assert.match(settings, /可重新导入拾学/)
  assert.match(settings, /导出 Markdown 阅读版/)
  assert.match(settings, /无需拾学也能阅读/)
  assert.match(app, /@export-json="exportJsonData"/)
  assert.match(app, /@export-markdown="exportMarkdownData"/)
})
