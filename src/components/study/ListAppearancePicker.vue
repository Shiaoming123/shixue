<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen, Code2, Folder, GraduationCap, Languages, NotebookPen, Palette } from '@lucide/vue'
import {
  listAccentPalette,
  listIconIds,
  resolveListAppearance,
  type ListAppearance,
  type ListIconId,
} from '../../lib/list-appearance'
import IconButton from '../ui/IconButton.vue'
import Popover from '../ui/Popover.vue'

const props = defineProps<{ id: string; icon?: ListIconId; color?: string }>()
const emit = defineEmits<{ change: [appearance: ListAppearance] }>()
const open = ref(false)
const draft = ref(resolveListAppearance(props.id, props.icon, props.color))
const iconComponents: Record<ListIconId, typeof Folder> = {
  folder: Folder, book: BookOpen, graduation: GraduationCap, code: Code2,
  languages: Languages, notebook: NotebookPen,
}
const iconLabels: Record<ListIconId, string> = {
  folder: '文件夹', book: '书本', graduation: '课程', code: '代码', languages: '语言', notebook: '笔记',
}
const currentIcon = computed(() => iconComponents[draft.value.icon])

watch(() => [props.id, props.icon, props.color] as const, () => {
  draft.value = resolveListAppearance(props.id, props.icon, props.color)
})

function update(appearance: ListAppearance) {
  draft.value = appearance
  emit('change', appearance)
}
</script>

<template>
  <Popover v-model:open="open" kind="popover" align="end" mobile-sheet mobile-sheet-label="设置清单图标和颜色">
    <template #trigger="{ triggerProps }">
      <IconButton v-bind="triggerProps" label="设置清单图标和颜色" :icon-size="18">
        <component :is="currentIcon" :style="{ color: draft.color }" />
      </IconButton>
    </template>
    <div class="appearance-picker">
      <div class="picker-heading"><Palette :size="18" aria-hidden="true" /><span><strong>清单外观</strong><small>图标和颜色也用于折叠侧栏</small></span></div>
      <fieldset>
        <legend>图标</legend>
        <div class="icon-options">
          <button v-for="iconId in listIconIds" :key="iconId" type="button" :class="{ active: draft.icon === iconId }" :aria-pressed="draft.icon === iconId" @click="update({ ...draft, icon: iconId })">
            <component :is="iconComponents[iconId]" :size="18" aria-hidden="true" /><span>{{ iconLabels[iconId] }}</span>
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>颜色</legend>
        <div class="color-options">
          <button v-for="color in listAccentPalette" :key="color.value" type="button" :class="{ active: draft.color === color.value }" :aria-label="color.label" :aria-pressed="draft.color === color.value" @click="update({ ...draft, color: color.value })"><i :style="{ background: color.value }" /><span>{{ color.label }}</span></button>
        </div>
      </fieldset>
    </div>
  </Popover>
</template>

<style scoped>
:deep(.popover-panel) { width: min(344px, calc(100vw - 16px)); padding: 16px; }
.appearance-picker { display: flex; flex-direction: column; gap: 16px; }
.picker-heading { display: flex; align-items: flex-start; gap: 10px; }.picker-heading > svg { flex: 0 0 auto; color: var(--accent); }.picker-heading span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }.picker-heading strong { font-size: var(--text-base); }.picker-heading small { color: var(--muted); font-size: var(--text-xs); }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; } legend { margin-bottom: 8px; color: var(--muted); font-size: var(--text-xs); font-weight: var(--font-semibold); }
.icon-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }.icon-options button, .color-options button { min-width: 0; min-height: 44px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: transparent; color: var(--muted); }.icon-options button { display: flex; align-items: center; gap: 7px; padding: 0 9px; }.icon-options span, .color-options span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.icon-options button.active, .color-options button.active { border-color: color-mix(in srgb, var(--accent) 48%, var(--hairline)); background: var(--press-fill); color: var(--text); }
.color-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }.color-options button { display: flex; align-items: center; gap: 7px; padding: 0 9px; }.color-options i { width: 14px; height: 14px; flex: 0 0 14px; border: 1px solid color-mix(in srgb, black 10%, transparent); border-radius: 50%; }
@media (max-width: 369px) { .icon-options, .color-options { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
