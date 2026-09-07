import type { InjectionKey } from 'vue'

/**
 * 平台检测 —— 用于桌面专属能力的运行时降级。
 *
 * 桌面专属能力（托盘、单实例、全局快捷键）在移动端无对应概念，
 * Rust 侧已用 cfg 排除，前端这里做 UI 层的降级判断。
 */

/** 是否运行在 Tauri 环境（桌面或移动），而非纯浏览器预览 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 是否移动端（Android / iOS）。基于 UA 判断，覆盖 Tauri 移动端与浏览器移动预览 */
export function isMobileUserAgent(
  userAgent: string,
  platform = '',
  maxTouchPoints = 0,
): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1)
}

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return isMobileUserAgent(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  )
}

export type UiPlatform = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web'

type UiNavigator = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>

/** Platform presentation hint. It controls design mappings, never permissions. */
export function detectUiPlatform(source: UiNavigator): UiPlatform {
  const { userAgent, platform, maxTouchPoints } = source
  if (/Android/i.test(userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios'
  if (/Windows/i.test(userAgent)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos'
  if (/Linux/i.test(userAgent)) return 'linux'
  return 'web'
}

/** 是否桌面端 Tauri（有托盘等桌面能力的环境） */
export function isDesktopTauri(): boolean {
  return isTauri() && !isMobile()
}

export type RuntimePlatform = 'web' | 'desktop' | 'mobile'

export type NativePlatform = 'android' | 'ios' | 'linux' | 'macos' | 'windows'

export type RuntimeCapability =
  | 'web-storage'
  | 'native-sql'
  | 'system-tray'
  | 'native-updater'
  | 'global-shortcut'
  | 'native-clipboard'
  | 'native-notification'
  | 'autostart'
  | 'secure-keychain-proxy'

export interface RuntimeInfo {
  platform: RuntimePlatform
  capabilities: readonly RuntimeCapability[]
}

/** Runtime selected by the native host and shared with the Vue shell. */
export const RUNTIME_INFO_KEY: InjectionKey<RuntimeInfo> = Symbol('shixue.runtime-info')

const MOBILE_RUNTIME_INFO: RuntimeInfo = {
  platform: 'mobile',
  capabilities: ['native-sql', 'native-notification'],
}

const DESKTOP_RUNTIME_INFO: RuntimeInfo = {
  platform: 'desktop',
  capabilities: [
    'native-sql',
    'system-tray',
    'native-updater',
    'global-shortcut',
    'native-notification',
    'autostart',
  ],
}

const WEB_RUNTIME_INFO: RuntimeInfo = {
  platform: 'web',
  capabilities: ['web-storage'],
}

export function hasRuntimeCapability(
  runtime: RuntimeInfo,
  capability: RuntimeCapability,
): boolean {
  return runtime.capabilities.includes(capability)
}

/**
 * Maps the native target selected by Rust to the capabilities compiled and
 * authorized by the default mobile/desktop build. Presentation UA data never
 * grants a Tauri capability.
 */
export function runtimeInfoForNativePlatform(platform: string): RuntimeInfo {
  if (platform === 'android' || platform === 'ios') return MOBILE_RUNTIME_INFO
  if (platform === 'linux' || platform === 'macos' || platform === 'windows') {
    return DESKTOP_RUNTIME_INFO
  }
  return WEB_RUNTIME_INFO
}

type LoadNativePlatform = () => Promise<string>

async function loadNativePlatform(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('runtime_platform')
}

/**
 * Reads the platform from the Tauri host for startup routing. The UA fallback
 * remains only for Web previews and old hosts that do not expose this command.
 */
export async function detectNativePlatform(
  load: LoadNativePlatform = loadNativePlatform,
): Promise<NativePlatform | undefined> {
  if (!isTauri()) return undefined

  try {
    const platform = await load()
    if (
      platform === 'android'
      || platform === 'ios'
      || platform === 'linux'
      || platform === 'macos'
      || platform === 'windows'
    ) return platform
  } catch {
    // A safe presentation fallback is handled by detectRuntimeInfo().
  }

  return undefined
}

/** 当前运行时可用能力的单一事实来源。 */
export function detectRuntimeInfo(): RuntimeInfo {
  if (!isTauri()) return WEB_RUNTIME_INFO

  if (isMobile()) return MOBILE_RUNTIME_INFO

  return DESKTOP_RUNTIME_INFO
}
