import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')
const appSource = () => readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('recurrence editor keeps cadence and basis choices in themed controls', () => {
  const editor = source('RecurrenceEditor.vue')
  for (const label of ['每天', '工作日', '每周', '每月', '每年', '自定义']) assert.match(editor, new RegExp(label))
  assert.match(editor, /fixed_schedule/)
  assert.match(editor, /after_completion/)
  assert.match(editor, /presetFor\(rule\)/)
  assert.match(editor, /<Listbox\b/)
  assert.doesNotMatch(editor, /<select\b/i)
  assert.doesNotMatch(editor, /<input\b/)
  assert.match(editor, /dayOfMonth\.value = rule\.cadence\.dayOfMonth/)
  assert.match(editor, /month\.value = rule\.cadence\.month/)
})

test('scope dialog presents all edit ranges and requires a preview before execute', () => {
  const dialog = source('RecurrenceScopeDialog.vue')
  for (const label of ['本次', '本次及以后', '整个系列']) assert.match(dialog, new RegExp(label))
  assert.match(dialog, /仅改本次计划/)
  assert.match(dialog, /editOccurrence/)
  assert.match(dialog, /ref<RecurrenceRuleScope>\('future'\)/)
  assert.match(dialog, /preview\.accepted/)
  assert.match(dialog, /affected\.length/)
  assert.match(dialog, /previewExamples/)
  assert.match(dialog, /affectedOverflow/)
  assert.match(dialog, /selectedScope\.value = scope/)
})

test('occurrence row emits occurrence intents without task date fields', () => {
  const row = source('OccurrenceRow.vue')
  for (const intent of ['complete', 'skip', 'reschedule']) assert.match(row, new RegExp(`emit\\('${intent}'`))
  assert.doesNotMatch(row, /plannedOn|dueOn/)
})

test('reachable task UI uses capability preview and execute without writing snapshots', () => {
  const app = appSource()
  assert.match(app, /<RecurrenceScopeDialog/)
  assert.match(app, /capabilityService\.preview\(envelope\)/)
  assert.match(app, /capabilityService\.execute\(/)
  assert.match(app, /clearRecurrencePreview\(\)/)
  assert.doesNotMatch(app, /getWorkspaceStore\(\)\.save\(/)
})

test('reachable UI creates a first series, follows the active split series, and executes occurrence reschedule', () => {
  const app = appSource()
  assert.match(app, /task\.recurrenceSeriesId/)
  assert.match(app, /type: 'recurrence\.create'/)
  assert.match(app, /<OccurrenceRescheduleSheet/)
  assert.match(app, /scope: 'occurrence'/)
  assert.match(app, /scheduledAt|scheduledOn/)
  assert.doesNotMatch(app, /@occurrence-reschedule="notify\(/)
})

test('single-occurrence rule scope opens the occurrence plan editor without previewing series fields', () => {
  const app = appSource()
  assert.match(app, /@edit-occurrence="editSingleOccurrence"/)
  assert.match(app, /function editSingleOccurrence\(\)/)
  assert.match(app, /openOccurrenceReschedule\(occurrence\.id\)/)
  assert.match(app, /previewRecurrenceScope\(scope: RecurrenceRuleScope\)/)
  assert.match(app, /executeRecurrenceScope\(scope: RecurrenceRuleScope\)/)
})
