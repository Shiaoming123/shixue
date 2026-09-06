import type { Module } from '../types'

interface ShortcutBindings {
  setEnabled(enabled: boolean): Promise<void>
}

async function loadShortcutBindings(): Promise<ShortcutBindings> {
  const { invoke } = await import('@tauri-apps/api/core')
  return {
    setEnabled: (enabled) => invoke('set_quick_add_shortcut', { enabled }),
  }
}

export function createShortcutModule(
  loadBindings: () => Promise<ShortcutBindings> = loadShortcutBindings,
): Module {
  let bindings: ShortcutBindings | undefined
  return {
    id: 'shortcut',
    name: '全局快捷键',
    dependencies: ['tray'],
    platforms: ['desktop'],
    requiredCapabilities: ['global-shortcut'],
    async setup() {
      bindings ??= await loadBindings()
      await bindings.setEnabled(true)
    },
    async teardown() {
      if (!bindings) return
      await bindings.setEnabled(false)
      bindings = undefined
    },
  }
}

export default createShortcutModule()
