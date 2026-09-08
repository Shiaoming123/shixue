import assert from 'node:assert/strict'
import test from 'node:test'
import { contrastRatio, createCustomTheme, getTheme, themes } from '../src/assets/themes/index.ts'

function assertReadable(tokens: ReturnType<typeof getTheme>['light']) {
  for (const role of ['text', 'muted', 'accent', 'accentAlt', 'success', 'warning', 'danger'] as const) {
    for (const background of ['bg', 'surface', 'surfaceAlt'] as const) {
      assert.ok(contrastRatio(tokens[role], tokens[background]) >= 4.5, `${role} on ${background}`)
    }
  }
  for (const [label, fill] of [['accentText', 'accent'], ['accentAltText', 'accentAlt'], ['successText', 'success'], ['warningText', 'warning'], ['dangerText', 'danger']] as const) {
    assert.ok(contrastRatio(tokens[label], tokens[fill]) >= 4.5, `${label} on ${fill}`)
  }
}

test('all preset palettes are distinct and readable', () => {
  assert.ok(themes.length >= 7)
  assert.equal(new Set(themes.map((theme) => theme.id)).size, themes.length)
  assert.equal(new Set(themes.map((theme) => theme.light.accent)).size, themes.length)
  for (const theme of themes) { assertReadable(theme.light); assertReadable(theme.dark) }
})

test('custom primary generates readable light and dark palettes', () => {
  for (const primary of ['#ffffff', '#000000', '#22c55e', '#ff1493']) {
    const theme = createCustomTheme(primary)
    assertReadable(theme.light); assertReadable(theme.dark)
  }
})
