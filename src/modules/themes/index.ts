import type { Module } from '../types'

/**
 * themes 模块 —— 主题系统。
 * 9 套预设与自定义主题，定义在 src/assets/themes/index.ts。
 * 依赖：core（core 已调用 initTheme，这里仅作为显式声明，便于语义清晰）。
 */
const themes: Module = {
  id: 'themes',
  name: '风格主题',
  dependencies: ['core'],
}

export default themes
