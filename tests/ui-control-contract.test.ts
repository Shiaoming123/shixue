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

test('task editor advances compact date, reminder, and recurrence work inside its existing Sheet', () => {
  const sheet = rootSource('src/components/ui/Sheet.vue')
  const editor = rootSource('src/components/study/TaskEditSheet.vue')
  const picker = rootSource('src/components/ui/DateTimePicker.vue')

  assert.match(sheet, /title\?: string/)
  assert.match(sheet, /subtitle\?: string/)
  assert.match(sheet, /backLabel\?: string/)
  assert.match(sheet, /back: \[\]/)
  assert.match(editor, /type EditorPage = 'form' \| 'planned' \| 'due' \| 'reminders' \| 'recurrence'/)
  assert.match(editor, /v-if="task && compact && editorPage !== 'form'"/)
  assert.match(editor, /:inline="true"/)
  assert.match(picker, /inline\?: boolean/)
  assert.doesNotMatch(editor, /<Popover\b|useModalOverlay|<Teleport\b/)
})

test('compact task editor keeps reminder state in the current Sheet and resets child pages', () => {
  const sheet = rootSource('src/components/ui/Sheet.vue')
  const editor = rootSource('src/components/study/TaskEditSheet.vue')
  const reminder = rootSource('src/components/study/ReminderEditor.vue')

  assert.match(reminder, /inlinePicker\?: boolean/)
  assert.match(reminder, /:inline="inlinePicker"/)
  assert.match(editor, /editorPage\.value = 'form'/)
  assert.match(editor, /:inline-picker="true"/)
  assert.match(editor, /:notification-available="notificationAvailable"[\s\S]*:permission="reminderPermission"[\s\S]*:busy="reminderBusy"[\s\S]*:error="reminderError"/)
  assert.match(sheet, /display: flex;\s*flex-direction: column;/)
  assert.match(sheet, /\.sheet-body \{[^}]*overflow-y: auto;/)
  assert.doesNotMatch(sheet, /\.sheet-panel \{[^}]*overflow-y: auto;/)
})

test('task editor uses shared controls for every business action', () => {
  const editor = rootSource('src/components/study/TaskEditSheet.vue')

  assert.match(editor, /import Button from '..\/ui\/Button\.vue'/)
  assert.doesNotMatch(editor, /<button\b/)
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
  assert.match(dialog, /\.dialog-panel--xl \{ width: min\(100%, 900px\); \}/)
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
