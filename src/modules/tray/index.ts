import type { Module } from '../types'

/**
 * tray 模块 —— 系统托盘。
 * Rust 侧由 tray.rs 实现（见 src-tauri/src/tray.rs），
 * 前端主要负责「关闭窗口 → 隐藏到托盘」的交互与更新事件监听。
 */
interface TrayBindings {
  listenQuickAdd(handler: () => void): Promise<() => void>
  dispatchQuickAdd(): void
}

async function loadTrayBindings(): Promise<TrayBindings> {
  const { listen } = await import('@tauri-apps/api/event')
  return {
    listenQuickAdd: (handler) => listen('shixue:quick-add', handler),
    dispatchQuickAdd: () => window.dispatchEvent(new CustomEvent('shixue:quick-add')),
  }
}

export function createTrayModule(load: () => Promise<TrayBindings> = loadTrayBindings): Module {
  let unlistenQuickAdd: (() => void) | undefined
  return {
    id: 'tray',
    name: '系统托盘',
    dependencies: [],
    platforms: ['desktop'],
    requiredCapabilities: ['system-tray'],
    async setup() {
      if (unlistenQuickAdd) return
      const bindings = await load()
      unlistenQuickAdd = await bindings.listenQuickAdd(bindings.dispatchQuickAdd)
    },
    teardown() { unlistenQuickAdd?.(); unlistenQuickAdd = undefined },
  }
}

export default createTrayModule()
