import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const rootSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('shared Sheet owns business modal lifecycle and app-level editors use it', () => {
  const sheet = rootSource('src/components/ui/Sheet.vue')
  assert.match(sheet, /useModalOverlay/)
  assert.match(sheet, /<Teleport\b[^>]*\bdefer\b[^>]*\bto="#ui-overlay-host"/)
  assert.match(sheet, /:role="placement === 'inline' \? undefined : 'dialog'"/)
  assert.match(sheet, /:aria-modal="placement === 'inline' \? undefined : 'true'"/)
  assert.match(sheet, /@media \(min-width: 820px\) and \(max-width: 1279px\)[\s\S]*\.sheet-panel--right \{ position: fixed; width: 360px; \}/)

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
  assert.match(detail, /:placement="covering \? 'right' : 'inline'"/)
  assert.match(detail, /width:\s*100%/)
  assert.doesNotMatch(detail, /width:\s*420px|min-width:\s*420px/)
})

test('dialog delegates modal keyboard and focus behavior to the shared overlay lifecycle', () => {
  const dialog = rootSource('src/components/ui/Dialog.vue')
  assert.match(dialog, /useModalOverlay/)
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
