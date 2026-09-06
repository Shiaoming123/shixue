import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse as parseVue } from '@vue/compiler-sfc'
import postcss from 'postcss'

const { descriptor } = parseVue(readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8'))
const appCss = postcss.parse(descriptor.styles.map(({ content }) => content).join('\n'))
const globalCss = postcss.parse(readFileSync(new URL('../src/assets/themes/global.css', import.meta.url), 'utf8'))

test('the root shell uses containing-block width across compact and desktop layouts, excluding a classic scrollbar', () => {
  const widths: string[] = []
  appCss.walkRules((rule) => {
    if (rule.selectors.includes('.shell')) rule.walkDecls('width', ({ value }) => { widths.push(value) })
  })
  assert.ok(widths.length > 0)
  assert.ok(widths.every((value) => value === '100%'), `shell widths must use available space, found ${widths.join(', ')}`)
  // The same rule applies at 320/720/1440px: 100% tracks 310/710/1430px
  // with a 10px scrollbar; 100vw would overrun the document at every size.
})

test('root minimum widths cannot force the 320px viewport past its 310px usable width', () => {
  const minimums: string[] = []
  globalCss.walkRules((rule) => {
    if (rule.selectors.some((selector) => selector === 'html' || selector === 'body')) {
      rule.walkDecls('min-width', ({ value }) => { minimums.push(value) })
    }
  })
  assert.ok(minimums.length > 0)
  assert.ok(minimums.every((value) => value === '0' || value === '0px'), `root minimum widths must allow the scrollbar gutter, found ${minimums.join(', ')}`)
})

test('desktop workspace can shrink and compact workspace/main follow the corrected shell', () => {
  const values = new Map<string, string[]>()
  appCss.walkRules((rule) => {
    for (const selector of ['.workspace', 'main']) {
      if (!rule.selectors.includes(selector)) continue
      rule.walkDecls(/^(width|min-width)$/, ({ prop, value }) => {
        const key = `${selector}:${prop}`
        values.set(key, [...(values.get(key) ?? []), value])
      })
    }
  })
  assert.deepEqual(values.get('.workspace:min-width'), ['0'])
  assert.deepEqual(values.get('.workspace:width'), ['100%'])
  assert.deepEqual(values.get('main:width'), ['100%'])
})
