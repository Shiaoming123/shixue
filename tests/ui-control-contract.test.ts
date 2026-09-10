import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const rootSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('shared Sheet owns business modal lifecycle and app-level editors use it', () => {
  const sheet = rootSource('src/components/ui/Sheet.vue')
  assert.match(sheet, /useModalOverlay/)
  assert.match(sheet, /<Teleport\b[^>]*\bdefer\b[^>]*\bto="#ui-overlay-host"/)
  assert.match(sheet, /:role="renderedPlacement === 'inline' \? undefined : 'dialog'"/)
  assert.match(sheet, /:aria-modal="renderedPlacement === 'inline' \? undefined : 'true'"/)
  assert.match(sheet, /@media \(min-width: 820px\) and \(max-width: 1279px\)[\s\S]*\.sheet-panel--right \{ position: fixed; \}/)

  const app = rootSource('src/App.vue')
  assert.match(app, /import Sheet from '.\/components\/ui\/Sheet\.vue'/)
  assert.equal((app.match(/<Sheet\b/g) ?? []).length, 2, 'list and group editors share the modal primitive')
  assert.doesNotMatch(app, /editor-backdrop|@click\.self/)
})

test('business sheets and responsive task detail no longer own parallel overlay code', () => {
  for (const name of ['CompletionSheet.vue', 'TaskActionSheet.vue', 'TaskEditSheet.vue', 'TaskDetailDrawer.vue']) {
    const source = rootSource(`src/components/study/${name}`)
    assert.match(source, /<Sheet\b/)
    assert.doesNotMatch(source, /useModalOverlay|<Teleport\b|class="backdrop"|@click\.self/)
  }
  const detail = rootSource('src/components/study/TaskDetailDrawer.vue')
  assert.match(detail, /resolveTaskDetailPlacement/)
  assert.match(detail, /:placement="detailPlacement"/)
  assert.match(detail, /width:\s*100%/)
  assert.doesNotMatch(detail, /width:\s*420px|min-width:\s*420px/)

  const responsive = rootSource('src/components/ui/Sheet.vue')
  assert.match(responsive, /\.sheet-panel--responsive::before/)
  assert.match(responsive, /\.sheet-overlay-enter-from \.sheet-panel--responsive[\s\S]*translateY/)
})

test('dialog delegates modal keyboard and focus behavior to the shared overlay lifecycle', () => {
  const dialog = rootSource('src/components/ui/Dialog.vue')
  assert.match(dialog, /useModalOverlay/)
  assert.match(dialog, /size\?: 'sm' \| 'md' \| 'lg' \| 'xl'/)
  assert.match(dialog, /\.dialog-panel--xl \{ width: min\(100%, 920px\); \}/)
  assert.match(dialog, /\.dialog-panel--lg,\s*\n\s*\.dialog-panel--xl \{/)
  assert.doesNotMatch(dialog, /function onKeydown|focusableSelector|@keydown=/)
})

test('quick add uses edge-to-edge sheets through 369px and inset sheets from 370px', () => {
  const popover = rootSource('src/components/ui/Popover.vue')
  const smoke = rootSource('scripts/smoke-web-persistence.mjs')
  assert.match(popover, /@media \(max-width: 369px\)/)
  assert.match(popover, /right:\s*0;[\s\S]*left:\s*0 !important;/)
  assert.match(popover, /right:\s*12px;[\s\S]*left:\s*12px !important;/)
  assert.match(smoke, /const sheetPanel = scheduleSheet\b/)
  assert.doesNotMatch(smoke, /const sheetPanel = scheduleSheet\.locator\('\.\.'\)/)
})

test('the unused private-breakpoint context rail is removed', () => {
  assert.equal(existsSync(new URL('../src/components/study/ContextRail.vue', import.meta.url)), false)
})

test('the desktop app root cannot become a second scroll container', () => {
  const global = rootSource('src/assets/themes/global.css')
  assert.match(global, /html,\s*\nbody,\s*\n#app\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/)
  assert.match(global, /#app\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;/)
})

test('Sheet keeps its rendered placement while closing so Teleport cannot cross layout roots', () => {
  const sheet = rootSource('src/components/ui/Sheet.vue')
  assert.match(sheet, /const renderedPlacement = ref\(props\.placement\)/)
  assert.match(sheet, /if \(open\) renderedPlacement\.value = placement/)
  assert.match(sheet, /<Teleport\b[^>]*:disabled="renderedPlacement === 'inline'"/)
  assert.match(sheet, /<Transition\b[^>]*:css="renderedPlacement !== 'inline'"/)

  const app = rootSource('src/App.vue')
  assert.doesNotMatch(app, /v-page-motion|const vPageMotion/)
})

test('functional chrome shares adaptive glass materials with opaque accessibility fallbacks', () => {
  const global = rootSource('src/assets/themes/global.css')
  assert.match(global, /--material-thin:\s*color-mix\([^;]+transparent\)/)
  assert.match(global, /--material-regular:\s*color-mix\([^;]+transparent\)/)
  assert.match(global, /--glass-filter:\s*blur\(/)
  assert.match(global, /--glass-filter-strong:\s*blur\(/)
  assert.match(global, /prefers-reduced-transparency:[\s\S]*--material-thin:\s*var\(--surface\)[\s\S]*--glass-filter:\s*none/)
  assert.match(global, /data-reduced-glass='on'[\s\S]*--material-regular:\s*var\(--surface\)[\s\S]*--glass-filter-strong:\s*none/)

  for (const path of [
    'src/components/study/AppSidebar.vue',
    'src/components/study/BottomTabs.vue',
    'src/components/ui/Sheet.vue',
    'src/components/ui/Dialog.vue',
    'src/components/ui/Popover.vue',
  ]) {
    const source = rootSource(path)
    assert.match(source, /backdrop-filter:\s*var\(--glass-filter(?:-strong)?\)/, `${path} consumes a shared glass filter`)
  }

  const tasks = rootSource('src/components/study/TasksView.vue')
  assert.doesNotMatch(tasks.match(/\.task-row\s*\{[^}]+\}/)?.[0] ?? '', /backdrop-filter/, 'content rows stay flat')
})

test('text entry controls share one compact rest and focus treatment', () => {
  const global = rootSource('src/assets/themes/global.css')
  assert.match(global, /--field-min-height:\s*38px/)
  assert.match(global, /--field-fill:\s*color-mix\(/)
  assert.match(global, /--field-focus-fill:\s*var\(--surface\)/)
  assert.match(global, /--field-focus-ring:\s*0 0 0 1px/)
  assert.match(global, /data-input='coarse'[\s\S]*--field-min-height:\s*44px/)

  for (const path of [
    'src/components/ui/Input.vue',
    'src/components/ui/Listbox.vue',
    'src/components/ui/DateTimePicker.vue',
    'src/components/ui/TimePicker.vue',
    'src/components/study/QuickAddComposer.vue',
    'src/components/study/GlobalSearchDialog.vue',
  ]) {
    const source = rootSource(path)
    assert.match(source, /var\(--field-fill\)/, `${path} uses the shared resting fill`)
    assert.match(source, /var\(--field-focus-ring\)/, `${path} uses the shared focused outline`)
  }

  const composer = rootSource('src/components/study/QuickAddComposer.vue')
  assert.match(composer, /min-height:\s*var\(--field-min-height\)/)
  assert.doesNotMatch(composer.match(/\.quick-add-composer\s*\{[^}]+\}/)?.[0] ?? '', /var\(--shadow-sm\)/)
})
