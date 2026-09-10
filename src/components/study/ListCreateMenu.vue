<script setup lang="ts">
import { ref } from 'vue'
import { FolderPlus, ListPlus, Plus } from '@lucide/vue'
import IconButton from '../ui/IconButton.vue'
import Popover from '../ui/Popover.vue'

const emit = defineEmits<{ createList: []; createGroup: [] }>()
const open = ref(false)

function choose(kind: 'list' | 'group') {
  open.value = false
  if (kind === 'list') emit('createList')
  else emit('createGroup')
}
</script>

<template>
  <Popover v-model:open="open" kind="menu" align="end">
    <template #trigger="{ triggerProps }">
      <IconButton v-bind="triggerProps" label="新建清单或分组" :icon-size="18"><Plus /></IconButton>
    </template>
    <div class="create-menu" role="menu" aria-label="新建清单或分组">
      <button type="button" role="menuitem" @click="choose('list')">
        <ListPlus :size="20" aria-hidden="true" />
        <span><strong>新建清单</strong><small>收纳具体任务和学习步骤</small></span>
      </button>
      <button type="button" role="menuitem" @click="choose('group')">
        <FolderPlus :size="20" aria-hidden="true" />
        <span><strong>新建分组</strong><small>归类多个清单，不直接存放任务</small></span>
      </button>
    </div>
  </Popover>
</template>

<style scoped>
:deep(.popover-panel) { width: min(286px, calc(100vw - 16px)); padding: 6px; }
.create-menu { display: flex; flex-direction: column; gap: 2px; }
.create-menu button { width: 100%; min-height: 58px; display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 12px; padding: 8px 10px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text); text-align: left; }
.create-menu button:hover, .create-menu button:focus-visible { background: var(--control-fill); outline: 0; }
.create-menu button > svg { color: var(--accent); }
.create-menu span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.create-menu strong, .create-menu small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.create-menu strong { font-size: var(--text-sm); font-weight: var(--font-semibold); }
.create-menu small { color: var(--muted); font-size: var(--text-xs); }
</style>
