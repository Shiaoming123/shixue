import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('desktop windows use one themed chrome with safe native controls', () => {
  const config = JSON.parse(source('src-tauri/tauri.conf.json'))
  assert.equal(config.app.windows[0].decorations, false)
  assert.match(source('src/lib/settings-window.ts'), /decorations:\s*false/)
  const titlebar = source('src/components/study/DesktopTitlebar.vue')
  for (const action of ['minimize', 'toggleMaximize', 'close']) assert.match(titlebar, new RegExp(`current\\.${action}\\(`))
  assert.match(titlebar, /data-tauri-drag-region/)
  const capability = source('src-tauri/capabilities/default.json')
  for (const permission of ['allow-close', 'allow-minimize', 'allow-toggle-maximize', 'allow-start-dragging']) assert.match(capability, new RegExp(permission))
})

test('desktop reload and context menus are scoped to Tauri while inputs keep edit commands', () => {
  const app = source('src/App.vue')
  assert.match(app, /desktopRuntime.*addEventListener\('contextmenu'/s)
  assert.match(app, /event\.key === 'F5'.*event\.preventDefault\(\)/s)
  assert.match(app, /document\.execCommand\(command\)/)
  assert.match(app, /navigator\.clipboard\.readText\(\)/)
  const menu = source('src/components/study/DesktopContextMenu.vue')
  assert.match(menu, /role="menu"/)
  assert.match(menu, /role="menuitem"/)
})

test('desktop workspace exposes persistent accessible resizers and a single inspector shell', () => {
  const app = source('src/App.vue')
  assert.match(app, /:width="sidebarPreferences\.width"/)
  assert.match(app, /:width="sidebarPreferences\.inspectorWidth"/)
  assert.match(app, /<TaskDetailDrawer\b[^>]*:editing="taskEditorOpen"[^>]*>[\s\S]*<TaskEditSheet embedded/)
  assert.equal((app.match(/<TaskDetailDrawer\b/g) ?? []).length, 1)
  const sidebar = source('src/components/study/AppSidebar.vue')
  const sheet = source('src/components/ui/Sheet.vue')
  for (const component of [sidebar, sheet]) {
    assert.match(component, /role="separator"/)
    assert.match(component, /ArrowLeft/)
    assert.match(component, /ArrowRight/)
  }
})

test('settings owns one scroll container and appearance includes global font scaling', () => {
  const settings = source('src/components/study/SettingsView.vue')
  assert.doesNotMatch(settings, /href="#settings-/)
  assert.match(settings, /settings-content[^}]*height:\s*100%[^}]*overflow-y:\s*auto/s)
  assert.match(settings, /type="range"[^>]*aria-label="全局字体大小"/)
  const theme = source('src/assets/themes/apply.ts')
  assert.match(theme, /fontScale:\s*number/)
  assert.match(theme, /--font-scale/)
  assert.match(source('src/assets/themes/global.css'), /--text-base:\s*calc\(13px \* var\(--font-scale\)\)/)
})
