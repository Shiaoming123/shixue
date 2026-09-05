import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')

test('recurrence editor keeps cadence and basis choices in themed controls', () => {
  const editor = source('RecurrenceEditor.vue')
  for (const label of ['每天', '工作日', '每周', '每月', '每年', '自定义']) assert.match(editor, new RegExp(label))
  assert.match(editor, /fixed_schedule/)
  assert.match(editor, /after_completion/)
  assert.match(editor, /<Listbox\b/)
  assert.doesNotMatch(editor, /<select\b/i)
  assert.doesNotMatch(editor, /<input\b/)
})

test('scope dialog presents all edit ranges and requires a preview before execute', () => {
  const dialog = source('RecurrenceScopeDialog.vue')
  for (const label of ['本次', '本次及以后', '整个系列']) assert.match(dialog, new RegExp(label))
  assert.match(dialog, /preview\.accepted/)
  assert.match(dialog, /affected\.length/)
})

test('occurrence row emits occurrence intents without task date fields', () => {
  const row = source('OccurrenceRow.vue')
  for (const intent of ['complete', 'skip', 'reschedule']) assert.match(row, new RegExp(`emit\\('${intent}'`))
  assert.doesNotMatch(row, /plannedOn|dueOn/)
})
