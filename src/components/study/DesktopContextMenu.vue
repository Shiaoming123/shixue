<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{ open: boolean; x: number; y: number; items: Array<{ id: string; label: string }> }>()
const emit = defineEmits<{ close: []; command: [id: string] }>()
const menu = ref<HTMLElement>()
const menuStyle = computed(() => ({ left: `${Math.max(8, Math.min(props.x, window.innerWidth - 220))}px`, top: `${Math.max(8, Math.min(props.y, window.innerHeight - props.items.length * 38 - 12))}px` }))
watch(() => props.open, (open) => { if (open) nextTick(() => menu.value?.querySelector<HTMLButtonElement>('button')?.focus()) })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="desktop-context-layer" @pointerdown.self="emit('close')">
      <nav ref="menu" class="desktop-context-menu" role="menu" aria-label="上下文菜单" :style="menuStyle" @keydown.esc="emit('close')">
        <button v-for="item in items" :key="item.id" type="button" role="menuitem" @click="emit('command', item.id)">{{ item.label }}</button>
      </nav>
    </div>
  </Teleport>
</template>

<style scoped>
.desktop-context-layer { position: fixed; z-index: var(--z-toast); inset: 0; }
.desktop-context-menu { position: absolute; width: 208px; display: grid; gap: 2px; padding: 6px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: var(--material-regular); box-shadow: var(--shadow-lg), var(--glass-highlight); -webkit-backdrop-filter: var(--glass-filter-strong); backdrop-filter: var(--glass-filter-strong); }
.desktop-context-menu button { min-height: 34px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); font: inherit; font-size: var(--text-sm); text-align: left; }
.desktop-context-menu button:hover, .desktop-context-menu button:focus-visible { outline: 0; background: var(--control-fill); }
</style>
