import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('shared PageHeader owns every core page title', () => {
  const pageHeaderUrl = new URL('../src/components/ui/PageHeader.vue', import.meta.url)
  assert.equal(existsSync(pageHeaderUrl), true, 'PageHeader must be a shared UI primitive')

  for (const path of [
    'src/components/study/TasksView.vue',
    'src/components/study/TodayView.vue',
    'src/components/calendar/CalendarToolbar.vue',
    'src/components/study/TopicsView.vue',
    'src/components/study/LearningRhythmView.vue',
    'src/components/study/ReviewView.vue',
    'src/components/study/SettingsView.vue',
  ]) {
    const page = source(path)
    assert.match(page, /import PageHeader from ['"]\.\.\/ui\/PageHeader\.vue['"]/, `${path} imports PageHeader`)
    assert.equal((page.match(/<PageHeader\b/g) ?? []).length, 1, `${path} renders one PageHeader`)
    assert.doesNotMatch(page, /<h1\b|\.page-header\b|\.page-title[^,{]*h1\b|(?:^|\})\s*h1\s*\{/m, `${path} does not own page-title markup or styles`)
  }
})

test('Button and IconButton expose roles, states, and shared hit-area behavior', () => {
  const button = source('src/components/ui/Button.vue')
  for (const role of ['prominent', 'standard', 'quiet', 'destructive']) {
    assert.match(button, new RegExp(`['"]${role}['"]`), `Button supports the ${role} role`)
  }
  assert.match(button, /loading\?: boolean/)
  assert.match(button, /icon\?: boolean/)
  assert.match(button, /:aria-busy="loading \? 'true' : undefined"/)
  assert.match(button, /:disabled="disabled \|\| loading"/)
  assert.match(button, /\.btn:active:not\(:disabled\)/)
  assert.match(button, /\.btn:focus-visible/)
  assert.match(button, /\.btn:disabled/)
  assert.match(button, /var\(--icon-hit\)/)
  assert.match(button, /<span class="btn__content"><slot \/><\/span>/)
  assert.doesNotMatch(button, /\.btn--loading \.btn__content\s*\{[^}]*visibility:\s*hidden;/)

  const iconButtonUrl = new URL('../src/components/ui/IconButton.vue', import.meta.url)
  assert.equal(existsSync(iconButtonUrl), true, 'IconButton must be a shared UI primitive')
  const iconButton = readFileSync(iconButtonUrl, 'utf8')
  assert.match(iconButton, /import Button from ['"]\.\/Button\.vue['"]/)
  assert.match(iconButton, /(?:ariaLabel|label)\??:\s*string/)
  assert.match(iconButton, /<Button\b[^>]*\bicon\b[^>]*:aria-label="(?:ariaLabel|label)"/)
  assert.match(iconButton, /!value\.trim\(\)/, 'IconButton rejects a blank accessible name')
  assert.match(iconButton, /throw new TypeError\(['"]IconButton requires an accessible name['"]\)/)
})

test('platform tokens keep iOS targets at 44px and content surfaces opaque', () => {
  const css = source('src/assets/themes/global.css')
  assert.match(css, /:root\s*\{[\s\S]*?--screen-inline:\s*32px;/, '1280px and wider use 32px page padding')
  assert.match(css, /@media \(max-width:\s*1279px\)\s*\{\s*:root\s*\{\s*--screen-inline:\s*28px;/)
  assert.match(css, /:root\[data-ui-platform=['"]ios['"]\][\s\S]*--control-hit:\s*44px;[\s\S]*--icon-hit:\s*44px;/)

  const content = [
    'src/components/study/TasksView.vue',
    'src/components/study/TodayView.vue',
    'src/components/calendar/CalendarWorkspace.vue',
    'src/components/study/TopicsView.vue',
    'src/components/study/LearningRhythmView.vue',
    'src/components/study/ReviewView.vue',
    'src/components/study/SettingsView.vue',
  ].map(source).join('\n')
  assert.doesNotMatch(content, /backdrop-filter|var\(--material-(?:thin|regular|clear)\)/)
})

test('navigation and overlay chrome use semantic material with an opaque fallback', () => {
  for (const path of [
    'src/components/study/AppSidebar.vue',
    'src/components/study/BottomTabs.vue',
    'src/components/calendar/CalendarToolbar.vue',
    'src/components/ui/Sheet.vue',
    'src/components/ui/Popover.vue',
  ]) {
    const chrome = source(path)
    assert.match(chrome, /background:\s*var\(--material-(?:thin|regular)\)/, `${path} uses functional-layer material`)
  }

  const css = source('src/assets/themes/global.css')
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\) \{\s*:root \{[^}]*--material-thin:\s*var\(--surface\);[^}]*--material-regular:\s*var\(--surface\);[^}]*\}/)

  for (const path of ['src/components/ui/Dialog.vue', 'src/components/ui/Sheet.vue', 'src/components/ui/Popover.vue']) {
    assert.match(source(path), /box-shadow:\s*var\(--shadow-(?:md|lg)\)/, `${path} has one semantic floating shadow`)
  }
})

test('App business overlays reuse the shared host and primitives', () => {
  const app = source('src/App.vue')
  assert.equal((app.match(/<OverlayHost\s*\/>/g) ?? []).length, 1)
  assert.match(app, /<Sheet\b/)
  assert.match(app, /<Dialog\b/)

  for (const path of [
    'src/components/study/CompletionSheet.vue',
    'src/components/study/TaskActionSheet.vue',
    'src/components/study/TaskEditSheet.vue',
    'src/components/study/TagManagerSheet.vue',
    'src/components/study/GlobalSearchDialog.vue',
    'src/components/study/RecurrenceScopeDialog.vue',
    'src/components/study/OccurrenceRescheduleSheet.vue',
    'src/components/calendar/CalendarSchedulePanel.vue',
    'src/components/calendar/CalendarEventEditor.vue',
  ]) {
    const businessOverlay = source(path)
    assert.match(businessOverlay, /<(?:Sheet|Dialog|Popover)\b/, `${path} reuses a shared overlay primitive`)
    assert.doesNotMatch(businessOverlay, /<Teleport\b|class="[^"]*(?:backdrop|overlay)[^"]*"/, `${path} does not own overlay infrastructure`)
  }
})
