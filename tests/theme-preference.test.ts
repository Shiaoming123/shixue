import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_THEME_PREFERENCE, loadThemePreference, saveThemePreference } from '../src/assets/themes/apply.ts'

function storage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value },
    removeItem: (key: string) => { delete values[key] },
  }
}

test('theme preference round-trips and migrates legacy keys', () => {
  const values: Record<string, string> = { 'meow-study-theme': 'forest', 'meow-study-appearance': 'dark' }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage(values) })
  assert.deepEqual(loadThemePreference(), { themeId: 'forest', mode: 'dark', customPrimary: '#176b91' })
  const preference = { themeId: 'custom', mode: 'system', customPrimary: '#123456' } as const
  saveThemePreference(preference)
  assert.deepEqual(loadThemePreference(), preference)
})

test('unavailable or corrupt storage fails closed to defaults', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { throw new Error('blocked') } } })
  assert.deepEqual(loadThemePreference(), DEFAULT_THEME_PREFERENCE)
})
