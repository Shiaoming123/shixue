/** Persisted theme selection and system appearance integration. */
import { applyTheme, getTheme, themes } from './index.ts'

export type { Theme, ThemeTokens } from './index.ts'
export { themes, getTheme, createCustomTheme, applyTheme } from './index.ts'

export type ThemeMode = 'system' | 'light' | 'dark'
export interface ThemePreference { themeId: string; mode: ThemeMode; customPrimary: string; fontScale: number }

export const THEME_STORAGE_KEY = 'meow-study-theme-preference'
const LEGACY_THEME_KEY = 'meow-study-theme'
const LEGACY_MODE_KEY = 'meow-study-appearance'

export const DEFAULT_THEME_PREFERENCE: ThemePreference = { themeId: 'study', mode: 'system', customPrimary: '#176b91', fontScale: 1 }

const validThemeId = (value: unknown) => value === 'custom' || themes.some((item) => item.id === value)
const validMode = (value: unknown): value is ThemeMode => value === 'system' || value === 'light' || value === 'dark'

export function loadThemePreference(): ThemePreference {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? 'null') as Partial<ThemePreference> | null
    if (saved && validThemeId(saved.themeId) && validMode(saved.mode)) {
      return {
        themeId: saved.themeId!, mode: saved.mode,
        customPrimary: /^#[\da-f]{6}$/i.test(saved.customPrimary ?? '') ? saved.customPrimary! : DEFAULT_THEME_PREFERENCE.customPrimary,
        fontScale: validFontScale(saved.fontScale) ? saved.fontScale : DEFAULT_THEME_PREFERENCE.fontScale,
      }
    }
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY)
    const legacyMode = localStorage.getItem(LEGACY_MODE_KEY)
    return {
      ...DEFAULT_THEME_PREFERENCE,
      themeId: validThemeId(legacyTheme) ? legacyTheme! : DEFAULT_THEME_PREFERENCE.themeId,
      mode: validMode(legacyMode) ? legacyMode : DEFAULT_THEME_PREFERENCE.mode,
    }
  } catch {
    return { ...DEFAULT_THEME_PREFERENCE }
  }
}

export function saveThemePreference(preference: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('shixue:appearance-change', { detail: preference }))
}

export function prefersDark(): boolean { return window.matchMedia('(prefers-color-scheme: dark)').matches }
export function resolveThemeDark(mode: ThemeMode, systemDark = prefersDark()) { return mode === 'system' ? systemDark : mode === 'dark' }
export function applyThemePreference(preference: ThemePreference) {
  applyTheme(preference.themeId, resolveThemeDark(preference.mode), preference.customPrimary)
  document.documentElement.style.setProperty('--font-scale', String(validFontScale(preference.fontScale) ? preference.fontScale : 1))
}

function validFontScale(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= .85 && value <= 1.15 }

export function getSavedTheme(): string { return loadThemePreference().themeId }
export function setTheme(id: string) {
  const preference = { ...loadThemePreference(), themeId: validThemeId(id) ? id : getTheme(id).id }
  saveThemePreference(preference)
  applyThemePreference(preference)
}

let mediaQuery: MediaQueryList | undefined
let onSystemModeChange: ((event: MediaQueryListEvent) => void) | undefined

export function initTheme() {
  applyThemePreference(loadThemePreference())
  if (mediaQuery && onSystemModeChange) mediaQuery.removeEventListener('change', onSystemModeChange)
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  onSystemModeChange = () => {
    const preference = loadThemePreference()
    if (preference.mode === 'system') applyThemePreference(preference)
  }
  mediaQuery.addEventListener('change', onSystemModeChange)
}
