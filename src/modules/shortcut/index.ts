import type { Module } from '../types'

const shortcutModule: Module = {
  id: 'shortcut',
  name: '全局快捷键',
  dependencies: ['tray'],
  platforms: ['desktop'],
  requiredCapabilities: ['global-shortcut'],
}

export default shortcutModule
