/** Semantic colour tokens. Layout, type and motion tokens stay in global.css. */
export interface ThemeTokens {
  bg: string
  surface: string
  surfaceAlt: string
  text: string
  muted: string
  border: string
  accent: string
  accentAlt: string
  accentText: string
  accentAltText: string
  success: string
  successText: string
  warning: string
  warningText: string
  danger: string
  dangerText: string
}

export interface Theme {
  id: string
  name: string
  description: string
  light: ThemeTokens
  dark: ThemeTokens
}

type RGB = [number, number, number]
type HSL = [number, number, number]

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

function normalizeHex(value: string) {
  const match = value.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i)
  if (!match) return '#176b91'
  const raw = match[1].length === 3 ? [...match[1]].map((part) => part + part).join('') : match[1]
  return `#${raw.toLowerCase()}`
}

function hexToRgb(value: string): RGB {
  const hex = normalizeHex(value).slice(1)
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as RGB
}

function rgbToHex([red, green, blue]: RGB) {
  return `#${[red, green, blue].map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')}`
}

function rgbToHsl([red, green, blue]: RGB): HSL {
  const [r, g, b] = [red, green, blue].map((value) => value / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue = max === r
    ? ((g - b) / delta + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / delta + 2) / 6 : ((r - g) / delta + 4) / 6
  return [hue * 360, saturation, lightness]
}

function hslToHex([hue, saturation, lightness]: HSL) {
  const h = ((hue % 360) + 360) % 360 / 360
  if (saturation === 0) return rgbToHex([lightness * 255, lightness * 255, lightness * 255])
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (offset: number) => {
    let t = h + offset
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return rgbToHex([channel(1 / 3) * 255, channel(0) * 255, channel(-1 / 3) * 255])
}

function luminance(value: string) {
  const [red, green, blue] = hexToRgb(value).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

export function contrastRatio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function readableColor(value: string, backgrounds: string[], direction: 'darken' | 'lighten') {
  const [hue, saturation, initialLightness] = rgbToHsl(hexToRgb(value))
  for (let step = 0; step <= 100; step += 1) {
    const lightness = clamp(initialLightness + (direction === 'lighten' ? step : -step) / 100)
    const candidate = hslToHex([hue, saturation, lightness])
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= 4.5)) return candidate
  }
  return direction === 'lighten' ? '#ffffff' : '#000000'
}

function labelOn(fill: string) {
  return contrastRatio('#ffffff', fill) >= contrastRatio('#111827', fill) ? '#ffffff' : '#111827'
}

function palette(primary: string, dark: boolean, intensity: number): ThemeTokens {
  const [hue, saturation] = rgbToHsl(hexToRgb(primary))
  const tint = clamp(intensity)
  const chroma = Math.min(saturation, 0.55) * tint
  const bg = hslToHex([hue, chroma, dark ? 0.055 : 0.985 - 0.025 * tint])
  const surface = hslToHex([hue, chroma, dark ? 0.095 : 0.998])
  const surfaceAlt = hslToHex([hue, chroma, dark ? 0.16 + 0.02 * tint : 0.955 - 0.055 * tint])
  const backgrounds = [bg, surface, surfaceAlt]
  const direction = dark ? 'lighten' : 'darken'
  const accent = readableColor(primary, backgrounds, direction)
  const accentAlt = readableColor(hslToHex([hue + 42, Math.max(saturation, 0.55), dark ? 0.62 : 0.42]), backgrounds, direction)
  const success = readableColor('#18864b', backgrounds, direction)
  const warning = readableColor('#a85d00', backgrounds, direction)
  const danger = readableColor('#b42318', backgrounds, direction)
  return {
    bg, surface, surfaceAlt,
    text: readableColor(dark ? '#eef2f7' : '#20242c', backgrounds, direction),
    muted: readableColor(dark ? '#aab2c0' : '#626873', backgrounds, direction),
    border: hslToHex([hue, Math.min(chroma, 0.22), dark ? 0.29 + 0.03 * tint : 0.86 - 0.08 * tint]),
    accent, accentAlt,
    accentText: labelOn(accent),
    accentAltText: labelOn(accentAlt),
    success, successText: labelOn(success),
    warning, warningText: labelOn(warning),
    danger, dangerText: labelOn(danger),
  }
}

function theme(id: string, name: string, description: string, primary: string, intensity = 1): Theme {
  return { id, name, description, light: palette(primary, false, intensity), dark: palette(primary, true, intensity) }
}

export const themes: Theme[] = [
  theme('paper', '基础浅色', '清晰的白色画布与靛蓝强调', '#4f46e5', 0.12),
  theme('midnight', '基础深色', '低眩光深色表面与紫色强调', '#8b5cf6'),
  theme('study', '拾学蓝', '安静、可靠的学习蓝', '#176b91', 0.72),
  theme('ocean', '海洋蓝', '冷静而清晰的效率配色', '#2563eb'),
  theme('forest', '森林绿', '适合长期阅读与知识整理', '#18794e'),
  theme('amber', '暖阳橙', '温暖、有活力的生活记录配色', '#b45309'),
  theme('violet', '灵感紫', '接近创作工具的鲜明紫色', '#7c3aed'),
  theme('rose', '番茄红', '醒目但克制的行动感配色', '#be185d'),
  theme('mono', '极简黑白', '接近文档工具的中性黑白', '#262626', 0),
]

export function createCustomTheme(primary: string): Theme {
  const normalized = normalizeHex(primary)
  return theme('custom', '自定义', `基于 ${normalized} 自动生成`, normalized)
}

export function getTheme(id: string): Theme {
  return themes.find((item) => item.id === id) ?? themes.find((item) => item.id === 'study')!
}

export function applyTheme(id: string, dark: boolean, customPrimary?: string) {
  const selected = id === 'custom' ? createCustomTheme(customPrimary ?? '#176b91') : getTheme(id)
  const tokens = dark ? selected.dark : selected.light
  const root = document.documentElement
  root.dataset.theme = selected.id
  root.dataset.mode = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
  const map: Record<string, string> = {
    '--bg': tokens.bg, '--surface': tokens.surface, '--surface-alt': tokens.surfaceAlt,
    '--text': tokens.text, '--muted': tokens.muted, '--border': tokens.border,
    '--accent': tokens.accent, '--accent-alt': tokens.accentAlt,
    '--accent-text': tokens.accentText, '--accent-alt-text': tokens.accentAltText,
    '--success': tokens.success, '--success-text': tokens.successText,
    '--warning': tokens.warning, '--warning-text': tokens.warningText,
    '--danger': tokens.danger, '--danger-text': tokens.dangerText,
  }
  for (const [key, value] of Object.entries(map)) root.style.setProperty(key, value)
}
