import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('shared Popover owns named dialog semantics for desktop popovers and mobile Sheets', () => {
  const popover = source('src/components/ui/Popover.vue')

  assert.match(popover, /mobileSheetLabel\?: string/)
  assert.match(popover, /dialogPanelActive = computed\(\(\) => mobileSheetActive\.value \|\| \(!props\.inline && props\.kind === 'popover'\)\)/)
  assert.match(popover, /'aria-haspopup': props\.kind === 'menu' \? 'menu' as const : props\.kind === 'popover' \? 'dialog' as const : undefined/)
  assert.match(popover, /:role="dialogPanelActive \? 'dialog' : undefined"/)
  assert.match(popover, /:aria-modal="dialogPanelActive \? \(mobileSheetActive \? 'true' : 'false'\) : undefined"/)
  assert.match(popover, /:aria-label="dialogPanelActive \? mobileSheetLabel : undefined"/)
})

test('popover content does not duplicate the shared panel dialog', () => {
  const dateTimePicker = source('src/components/ui/DateTimePicker.vue')
  const quickAdd = source('src/components/study/QuickAddComposer.vue')

  assert.doesNotMatch(dateTimePicker, /class="date-panel"[^>]*(?:role|aria-modal|aria-label)=/s)
  assert.doesNotMatch(quickAdd, /class="candidate-editor"[^>]*(?:role|aria-modal|aria-labelledby)=/s)
})

test('every mobile Sheet caller supplies a concrete accessible name', () => {
  const callers = [
    ['src/components/calendar/CalendarToolbar.vue', /mobile-sheet mobile-sheet-label="选择日历日期"/],
    ['src/components/calendar/UnscheduledTray.vue', /mobile-sheet :mobile-sheet-label="`安排 \$\{task\.title\}`"/],
    ['src/components/calendar/CalendarItem.vue', /mobile-sheet :mobile-sheet-label="`安排 \$\{title\}`"/],
    ['src/components/calendar/MonthGrid.vue', /mobile-sheet :mobile-sheet-label="`\$\{dayLabel\(day\)\}当日安排`"/],
    ['src/components/ui/DateTimePicker.vue', /mobile-sheet :mobile-sheet-label="label"/],
    ['src/components/study/QuickAddComposer.vue', /mobile-sheet\s+:mobile-sheet-label="`编辑\$\{candidateLabel\(candidate\)\}`"/],
    ['src/components/study/TasksView.vue', /mobile-sheet mobile-sheet-label="切换智能清单"/],
  ] as const

  for (const [path, namedSheet] of callers) {
    const component = source(path)
    assert.match(component, namedSheet, path)
    const mobileSheets = component.match(/<Popover\b[^>]*\bmobile-sheet(?:\s|>)[^>]*>/gs) ?? []
    assert.ok(mobileSheets.length > 0, `${path} must retain its mobile Sheet`)
    assert.ok(mobileSheets.every((tag) => tag.includes('mobile-sheet-label=')), `${path} has an unnamed mobile Sheet`)
  }
})

test('calendar smoke locks the themed native-control denylist and both calendar Sheet names', () => {
  const smoke = source('scripts/smoke-calendar.mjs')

  for (const selector of ['select', 'input[type="date"]', 'input[type="time"]', 'input[type="checkbox"]', 'input[type="radio"]']) {
    assert.ok(smoke.includes(selector), `${selector} must remain in the visible native-control denylist`)
  }
  assert.match(smoke, /选择日历日期/)
  assert.match(smoke, /安排 \$\{seededTitles\.visualUnscheduled\}/)
  assert.match(smoke, /aria-modal/)
})
