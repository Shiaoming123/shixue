import assert from 'node:assert/strict'
import test from 'node:test'
import { getTheme } from '../src/assets/themes/index.ts'

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

for (const mode of ['light', 'dark'] as const) {
  test(`study ${mode}: small functional text remains readable on all content surfaces`, () => {
    const tokens = getTheme('study')[mode]
    for (const role of ['text', 'muted', 'accent', 'success', 'warning', 'danger'] as const) {
      for (const background of ['bg', 'surface', 'surfaceAlt'] as const) {
        assert.ok(contrast(tokens[role], tokens[background]) >= 4.5, `${role} on ${background}`)
      }
    }
    assert.ok(contrast(tokens.accentText, tokens.accent) >= 4.5, 'primary action label')
    assert.ok(contrast(tokens.dangerText!, tokens.danger) >= 4.5, 'destructive action label')
  })
}
