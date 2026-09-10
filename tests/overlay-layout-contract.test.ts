import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ui = (name: string) => readFileSync(new URL(`../src/components/ui/${name}`, import.meta.url), 'utf8')

test('dialogs keep header and footer fixed while only body scrolls', () => {
  const source = ui('Dialog.vue')
  assert.match(source, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/)
  assert.match(source, /\.dialog-panel \{[^}]*overflow:\s*hidden/)
  assert.match(source, /\.dialog-body \{[^}]*overflow-y:\s*auto/)
  assert.match(source, /<IconButton[^>]*label="关闭"/)
})

test('sheets expose fixed header and footer slots around one scrolling body', () => {
  const source = ui('Sheet.vue')
  assert.match(source, /<header v-if="\$slots\.header"/)
  assert.match(source, /<div class="sheet-body">/)
  assert.match(source, /<footer v-if="\$slots\.footer"/)
  assert.match(source, /\.sheet-panel \{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto[^}]*overflow:\s*hidden/)
  assert.match(source, /\.sheet-body \{[^}]*overflow-y:\s*auto/)
})
