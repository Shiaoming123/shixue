import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const globalCss = readFileSync(new URL('../src/assets/themes/global.css', import.meta.url), 'utf8')
const notices = readFileSync(new URL('../public/third-party-font-licenses.txt', import.meta.url), 'utf8')

test('bundles the product typefaces locally and exposes them through design tokens', () => {
  assert.match(main, /@fontsource-variable\/manrope/)
  assert.match(main, /@fontsource-variable\/noto-sans-sc/)
  assert.match(globalCss, /--font-sans:/)
  assert.match(globalCss, /--font-display:/)
  assert.match(globalCss, /font-family:\s*var\(--font-sans\)/)
})

test('ships the required open-font copyright and license notices with the app', () => {
  assert.match(notices, /Copyright 2019 The Manrope Project Authors/)
  assert.match(notices, /Google Inc\./)
  assert.match(notices, /SIL OPEN FONT LICENSE Version 1\.1/)
})
