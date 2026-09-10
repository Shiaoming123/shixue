<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Archive, Check, Pencil, Plus, Tags, X } from '@lucide/vue'
import type { Tag } from '../../domain/workspace/types'
import Sheet from '../ui/Sheet.vue'
import IconButton from '../ui/IconButton.vue'

const props = withDefaults(defineProps<{
  open: boolean
  tags: Tag[]
  busy?: boolean
  error?: string
}>(), { busy: false, error: '' })

const emit = defineEmits<{
  close: []
  create: [title: string]
  rename: [tagId: string, title: string]
  archive: [tagId: string]
}>()

const createTitle = ref('')
const editingId = ref('')
const editingTitle = ref('')
const createInput = ref<HTMLInputElement | null>(null)
const activeTags = computed(() => props.tags
  .filter((tag) => tag.archivedAt === null)
  .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)))
const archivedTags = computed(() => props.tags
  .filter((tag) => tag.archivedAt !== null)
  .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)))

watch(() => props.open, async (open) => {
  if (!open) return
  editingId.value = ''
  editingTitle.value = ''
  await nextTick()
  createInput.value?.focus()
})

function submitCreate() {
  const title = createTitle.value.trim()
  if (!title || props.busy) return
  emit('create', title)
}

function created() { createTitle.value = '' }

function beginRename(tag: Tag) {
  if (props.busy) return
  editingId.value = tag.id
  editingTitle.value = tag.title
}

function cancelRename() { editingId.value = ''; editingTitle.value = '' }

function submitRename(tag: Tag) {
  const title = editingTitle.value.trim()
  if (!title || title === tag.title || props.busy) return
  emit('rename', tag.id, title)
}

function renamed() { cancelRename() }

defineExpose({ created, renamed })
</script>

<template>
  <Sheet :open="open" label="管理标签" size="lg" @close="emit('close')">
    <div class="tag-manager">
      <header>
        <div><span><Tags :size="17" />整理学习标签</span><h2>管理标签</h2><p>标签可跨清单整理任务与学习证据；归档后历史关联仍会保留。</p></div>
        <IconButton class="icon-button" label="关闭标签管理" @click="emit('close')"><X /></IconButton>
      </header>

      <form class="create-row" @submit.prevent="submitCreate">
        <label for="new-tag-title">新标签</label>
        <div><input id="new-tag-title" ref="createInput" v-model="createTitle" maxlength="40" autocomplete="off" placeholder="例如：论文阅读" /><button type="submit" :disabled="busy || !createTitle.trim()"><Plus :size="16" />创建</button></div>
      </form>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <section aria-labelledby="active-tags-heading">
        <div class="section-heading"><h3 id="active-tags-heading">正在使用</h3><span>{{ activeTags.length }}</span></div>
        <ul v-if="activeTags.length">
          <li v-for="tag in activeTags" :key="tag.id">
            <form v-if="editingId === tag.id" class="rename-row" @submit.prevent="submitRename(tag)">
              <input v-model="editingTitle" :aria-label="`重命名标签 ${tag.title}`" maxlength="40" autocomplete="off" autofocus />
              <IconButton type="submit" class="icon-button primary" label="保存标签名称" :disabled="busy || !editingTitle.trim() || editingTitle.trim() === tag.title"><Check /></IconButton>
              <IconButton class="icon-button" label="取消重命名" @click="cancelRename"><X /></IconButton>
            </form>
            <template v-else>
              <span class="tag-title">{{ tag.title }}</span>
              <div class="row-actions">
                <IconButton class="icon-button" :label="`重命名标签 ${tag.title}`" :disabled="busy" :icon-size="16" @click="beginRename(tag)"><Pencil /></IconButton>
                <IconButton class="icon-button archive" :label="`归档标签 ${tag.title}`" variant="destructive" :disabled="busy" :icon-size="16" @click="emit('archive', tag.id)"><Archive /></IconButton>
              </div>
            </template>
          </li>
        </ul>
        <p v-else class="empty">还没有标签。创建一个后即可在任务编辑与全局搜索中使用。</p>
      </section>

      <details v-if="archivedTags.length">
        <summary>已归档 {{ archivedTags.length }} 个</summary>
        <ul class="archived-list"><li v-for="tag in archivedTags" :key="tag.id"><span class="tag-title">{{ tag.title }}</span><small>保留在历史任务与完成记录中</small></li></ul>
      </details>
    </div>
  </Sheet>
</template>

<style scoped>
.tag-manager { width: 100%; } header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding-bottom: 18px; border-bottom: 1px solid var(--hairline); } header > div > span { display: inline-flex; align-items: center; gap: 7px; color: var(--accent); font-size: var(--text-xs); font-weight: 650; } h2 { margin: 7px 0 5px; font-size: var(--text-xl); font-weight: 650; } header p { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.55; }
.icon-button { width: 38px; height: 38px; display: inline-grid; flex: 0 0 auto; place-items: center; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--muted); }.icon-button:hover { color: var(--text); }.icon-button:disabled { opacity: .42; }.icon-button.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }.icon-button.archive:hover { color: var(--danger); }
.create-row { margin-top: 20px; }.create-row > label { display: block; margin-bottom: 7px; color: var(--muted); font-size: var(--text-xs); font-weight: 600; }.create-row > div { display: grid; grid-template-columns: 1fr auto; gap: 9px; }.create-row input, .rename-row input { min-width: 0; min-height: var(--field-min-height); padding: 0 12px; border: 1px solid transparent; border-radius: var(--radius-md); outline: 0; background: var(--field-fill); color: var(--text); font: inherit; }.create-row input:hover:not(:focus), .rename-row input:hover:not(:focus) { background: var(--field-hover-fill); }.create-row input:focus, .rename-row input:focus { border-color: var(--accent); background: var(--field-focus-fill); box-shadow: var(--field-focus-ring); }.create-row button { min-height: var(--field-min-height); display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 15px; border: 0; border-radius: var(--radius-md); background: var(--accent); color: var(--accent-text); font: inherit; font-size: var(--text-xs); font-weight: 650; }.create-row button:disabled { opacity: .42; }
.error { margin: 10px 0 0; padding: 10px 12px; border-radius: var(--radius-md); background: color-mix(in srgb, var(--danger) 10%, var(--surface)); color: var(--danger); font-size: var(--text-xs); }
section { margin-top: 24px; }.section-heading { display: flex; align-items: center; gap: 8px; }.section-heading h3 { margin: 0; font-size: var(--text-sm); }.section-heading span { min-width: 22px; height: 20px; display: grid; place-items: center; border-radius: var(--radius-full); background: var(--control-fill); color: var(--muted); font-size: 10px; } ul { margin: 10px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--hairline); } li { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--hairline); }.tag-title { min-width: 0; overflow: hidden; font-size: var(--text-base); text-overflow: ellipsis; white-space: nowrap; }.row-actions { display: flex; gap: 7px; }.rename-row { width: 100%; display: grid; grid-template-columns: 1fr auto auto; gap: 7px; align-items: center; }.empty { margin: 10px 0 0; padding: 18px; border-radius: var(--radius-lg); background: var(--surface-alt); color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
details { margin-top: 22px; } summary { min-height: 44px; display: flex; align-items: center; color: var(--muted); font-size: var(--text-xs); cursor: pointer; }.archived-list { margin-top: 0; }.archived-list li { align-items: flex-start; flex-direction: column; justify-content: center; gap: 3px; opacity: .72; }.archived-list small { color: var(--muted); font-size: 10px; }
@media (max-width: 819px) { .icon-button { width: 44px; height: 44px; }.create-row > div { grid-template-columns: 1fr; }.create-row button { width: 100%; }.rename-row { grid-template-columns: minmax(0, 1fr) 44px 44px; } }
</style>
