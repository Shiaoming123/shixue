<script setup lang="ts">
import { Minus, Square, X } from '@lucide/vue'
import IconButton from '../ui/IconButton.vue'

async function windowAction(action: 'minimize' | 'maximize' | 'close') {
  const current = (await import('@tauri-apps/api/window')).getCurrentWindow()
  if (action === 'minimize') await current.minimize()
  else if (action === 'maximize') await current.toggleMaximize()
  else await current.close()
}
</script>

<template>
  <header class="desktop-titlebar" data-tauri-drag-region @dblclick="windowAction('maximize')">
    <div class="desktop-titlebar__brand" data-tauri-drag-region><img src="/shixue-mark.svg" alt="" /><span>拾学</span></div>
    <div class="desktop-titlebar__controls">
      <IconButton label="最小化窗口" @click="windowAction('minimize')"><Minus /></IconButton>
      <IconButton label="最大化或还原窗口" @click="windowAction('maximize')"><Square /></IconButton>
      <IconButton class="desktop-titlebar__close" label="关闭窗口" @click="windowAction('close')"><X /></IconButton>
    </div>
  </header>
</template>

<style scoped>
.desktop-titlebar { height: 38px; flex: 0 0 38px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--hairline); background: var(--material-thin); color: var(--text); user-select: none; }
.desktop-titlebar__brand { min-width: 0; display: flex; align-items: center; gap: 8px; padding-left: 12px; font-size: var(--text-sm); font-weight: var(--font-medium); }
.desktop-titlebar__brand img { width: 20px; height: 20px; }
.desktop-titlebar__controls { height: 100%; display: flex; }
.desktop-titlebar__controls :deep(.icon-button) { width: 46px; height: 100%; min-height: 0; border-radius: 0; }
.desktop-titlebar__close:hover { background: #c42b1c !important; color: white !important; }
@media (prefers-reduced-transparency: reduce) { .desktop-titlebar { background: var(--surface); } }
</style>
