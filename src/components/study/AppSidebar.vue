<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  BookOpen, CalendarClock, CalendarDays, CalendarRange, CircleCheckBig, Folder, History, Inbox,
  ListTodo, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Settings,
} from '@lucide/vue'
import { moveSidebarItem, type SidebarDisplayMode } from '../../lib/sidebar-preferences'
import {
  desktopWorkspaceNavigation,
  learningWorkspaceNavigation,
  type ShellDestination,
  type WorkspaceNavigationDescriptor,
  type WorkspaceView,
} from '../../lib/workspace-view'
import type { StudySmartView } from '../../lib/sidebar-navigation'

export type StudySmartViewCounts = Partial<Record<StudySmartView, number>>

const props = defineProps<{
  active: ShellDestination
  counts?: StudySmartViewCounts
  groups?: Array<{ id: string; title: string }>
  lists?: Array<{ id: string; groupId: string | null; title: string; count: number }>
  displayMode: SidebarDisplayMode
  order: string[]
}>()

const emit = defineEmits<{
  navigate: [destination: ShellDestination]
  'update:displayMode': [mode: SidebarDisplayMode]
  reorder: [order: string[]]
  'create-list': []
  'create-group': []
  'edit-group': [id: string]
}>()

const draggedKey = ref('')
const dropTargetKey = ref('')
const reorderMessage = ref('')

const icons: Record<WorkspaceView['kind'], typeof Inbox> = {
  inbox: Inbox, today: CalendarDays, upcoming: CalendarRange, calendar: CalendarClock,
  lists: ListTodo, list: Folder, completed: CircleCheckBig, learning: BookOpen,
}
const primaryItems = desktopWorkspaceNavigation.map((item) => ({ ...item, icon: icons[item.view.kind] }))
const reviewItem = { ...learningWorkspaceNavigation[1], icon: History }
const primaryKeys = primaryItems.map(({ preferenceKey }) => preferenceKey)
const orderedPrimaryItems = computed(() => sortItems(primaryItems, ({ preferenceKey }) => preferenceKey))
const orderedListSections = computed(() => {
  const lists = props.lists ?? []
  return [
    { id: '', title: '', lists: sortItems(lists.filter(({ groupId }) => !groupId), ({ id }) => listKey(id)) },
    ...(props.groups ?? []).map((group) => ({
      ...group,
      lists: sortItems(lists.filter(({ groupId }) => groupId === group.id), ({ id }) => listKey(id)),
    })),
  ].filter((section) => section.id || section.lists.length)
})

function listKey(id: string) { return `list:${id}` }
function listKeys(lists: Array<{ id: string }>) { return lists.map(({ id }) => listKey(id)) }

function sortItems<T>(items: T[], keyFor: (item: T) => string): T[] {
  const rank = new Map(props.order.map((key, index) => [key, index]))
  return [...items].sort((left, right) => (rank.get(keyFor(left)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(keyFor(right)) ?? Number.MAX_SAFE_INTEGER))
}

function destinationKey(destination: ShellDestination) {
  if (destination.kind === 'settings') return 'page:settings'
  if (destination.kind === 'list') return listKey(destination.listId)
  if (destination.kind === 'learning') return destination.section === 'review' ? 'page:review' : 'page:topics'
  return desktopWorkspaceNavigation.find(({ view }) => view.kind === destination.kind)?.preferenceKey ?? 'smart:inbox'
}
const currentDestination = computed(() => destinationKey(props.active))
function smartViewFor(view: WorkspaceView): StudySmartView | undefined {
  return ({ inbox: 'inbox', today: 'today', upcoming: 'next7', lists: 'all', completed: 'completed' } as Partial<Record<WorkspaceView['kind'], StudySmartView>>)[view.kind]
}
function displayCount(view: StudySmartView) { return Math.min(Math.max(0, props.counts?.[view] ?? 0), 999) }
function smartLabel(view: StudySmartView, label: string) {
  const count = props.counts?.[view]
  return typeof count === 'number' ? `${label}，${Math.max(0, count)} 项` : label
}
function primaryLabel(item: WorkspaceNavigationDescriptor) {
  const smartView = smartViewFor(item.view)
  return smartView ? smartLabel(smartView, item.label) : item.label
}

function startDrag(event: DragEvent, key: string) {
  draggedKey.value = key
  dropTargetKey.value = ''
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', key)
  }
}
function markDropTarget(key: string, keys: string[]) { dropTargetKey.value = keys.includes(draggedKey.value) ? key : '' }
function dropItem(event: DragEvent, target: string, keys: string[]) {
  event.preventDefault()
  const source = draggedKey.value || event.dataTransfer?.getData('text/plain') || ''
  commitMove(source, target, keys)
  clearDrag()
}
function clearDrag() { draggedKey.value = ''; dropTargetKey.value = '' }
function moveByKeyboard(event: KeyboardEvent, key: string, keys: string[]) {
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  event.preventDefault()
  const orderedKeys = [...keys].sort((left, right) => props.order.indexOf(left) - props.order.indexOf(right))
  const index = orderedKeys.indexOf(key)
  const target = orderedKeys[index + (event.key === 'ArrowUp' ? -1 : 1)]
  if (target) commitMove(key, target, keys)
}
function commitMove(source: string, target: string, keys: string[]) {
  if (!keys.includes(source) || !keys.includes(target) || source === target) return
  const nextOrder = moveSidebarItem(props.order, source, target)
  emit('reorder', nextOrder)
  reorderMessage.value = `菜单项已移至第 ${nextOrder.filter((key) => keys.includes(key)).indexOf(source) + 1} 位。`
}
</script>

<template>
  <aside class="sidebar" :class="{ icons: displayMode === 'icons' }" aria-label="主导航">
    <div class="brand">
      <span class="brand-mark"><img src="/shixue-mark.svg" alt="" /></span>
      <span class="brand-copy">拾学</span>
      <button class="mode-toggle" type="button" :aria-label="displayMode === 'icons' ? '展开侧边栏' : '收起侧边栏'" :title="displayMode === 'icons' ? '展开侧边栏' : '收起侧边栏'" @click="emit('update:displayMode', displayMode === 'icons' ? 'expanded' : 'icons')">
        <PanelLeftOpen v-if="displayMode === 'icons'" :size="17" />
        <PanelLeftClose v-else :size="17" />
      </button>
    </div>

    <p id="sidebar-order-help" class="sr-only">拖动菜单项可调整顺序，也可使用 Alt 加上方向键上移或下移。</p>
    <p class="sr-only" aria-live="polite">{{ reorderMessage }}</p>

    <nav class="navigation" aria-label="待办导航">
      <section class="nav-section" aria-labelledby="smart-list-heading">
        <h2 id="smart-list-heading">智能清单</h2>
        <TransitionGroup name="nav-order" tag="div" class="nav-list">
          <button v-for="item in orderedPrimaryItems" :key="item.preferenceKey" class="nav-item" :class="{ active: currentDestination === item.preferenceKey, dragging: draggedKey === item.preferenceKey, 'drop-target': dropTargetKey === item.preferenceKey }" :aria-current="currentDestination === item.preferenceKey ? 'page' : undefined" :aria-label="primaryLabel(item)" aria-describedby="sidebar-order-help" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" :title="`${item.label} · 拖动排序`" draggable="true" @click="emit('navigate', item.view)" @dragstart="startDrag($event, item.preferenceKey)" @dragover.prevent="markDropTarget(item.preferenceKey, primaryKeys)" @drop="dropItem($event, item.preferenceKey, primaryKeys)" @dragend="clearDrag" @keydown="moveByKeyboard($event, item.preferenceKey, primaryKeys)">
            <component :is="item.icon" class="nav-icon" :size="18" :stroke-width="1.8" aria-hidden="true" />
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="smartViewFor(item.view)" class="nav-count" aria-hidden="true">{{ displayCount(smartViewFor(item.view)!) }}</span>
          </button>
        </TransitionGroup>
      </section>

      <section class="nav-section list-section" aria-labelledby="my-lists-heading">
        <div class="section-heading"><h2 id="my-lists-heading">我的清单</h2><div><button type="button" title="新建分组" aria-label="新建分组" @click="emit('create-group')"><Folder :size="15" /></button><button type="button" title="新建清单" aria-label="新建清单" @click="emit('create-list')"><Plus :size="15" /></button></div></div>
        <div v-for="section in orderedListSections" :key="section.id || 'ungrouped'" class="list-group">
          <div v-if="section.id" class="group-heading"><span>{{ section.title }}</span><button type="button" title="编辑分组" :aria-label="`编辑分组 ${section.title}`" @click="emit('edit-group', section.id)"><Pencil :size="12" /></button></div>
          <TransitionGroup name="nav-order" tag="div" class="nav-list">
            <button v-for="list in section.lists" :key="list.id" class="nav-item" :class="{ active: currentDestination === listKey(list.id), dragging: draggedKey === listKey(list.id), 'drop-target': dropTargetKey === listKey(list.id) }" :aria-current="currentDestination === listKey(list.id) ? 'page' : undefined" :aria-label="`${list.title}，${list.count} 项`" aria-describedby="sidebar-order-help" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" :title="`${list.title} · 拖动排序`" draggable="true" @click="emit('navigate', { kind: 'list', listId: list.id })" @dragstart="startDrag($event, listKey(list.id))" @dragover.prevent="markDropTarget(listKey(list.id), listKeys(section.lists))" @drop="dropItem($event, listKey(list.id), listKeys(section.lists))" @dragend="clearDrag" @keydown="moveByKeyboard($event, listKey(list.id), listKeys(section.lists))">
              <Folder class="nav-icon" :size="17" :stroke-width="1.8" aria-hidden="true" />
              <span class="nav-label">{{ list.title }}</span><span class="nav-count" aria-hidden="true">{{ list.count }}</span>
            </button>
          </TransitionGroup>
        </div>
      </section>

      <section class="nav-section learning-section" aria-labelledby="learning-heading">
        <h2 id="learning-heading">学习</h2>
        <div class="nav-list">
          <button class="nav-item" :class="{ active: currentDestination === reviewItem.preferenceKey }" :aria-current="currentDestination === reviewItem.preferenceKey ? 'page' : undefined" :aria-label="reviewItem.label" :title="reviewItem.label" @click="emit('navigate', reviewItem.view)">
            <component :is="reviewItem.icon" class="nav-icon" :size="18" :stroke-width="1.8" aria-hidden="true" />
            <span class="nav-label">{{ reviewItem.label }}</span>
          </button>
        </div>
      </section>
    </nav>

    <button class="nav-item settings" :class="{ active: currentDestination === 'page:settings' }" :aria-current="currentDestination === 'page:settings' ? 'page' : undefined" aria-label="设置" title="设置" @click="emit('navigate', { kind: 'settings' })">
      <Settings class="nav-icon" :size="18" :stroke-width="1.8" aria-hidden="true" />
      <span class="nav-label">设置</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar { width: 232px; min-width: 232px; height: 100%; display: flex; flex-direction: column; padding: 18px 12px 14px; border-right: 1px solid var(--hairline); background: linear-gradient(180deg, color-mix(in srgb, white 5%, transparent), transparent 38%), var(--material-thin); box-shadow: inset -1px 0 color-mix(in srgb, white 24%, transparent); backdrop-filter: saturate(170%) blur(28px); -webkit-backdrop-filter: saturate(170%) blur(28px); transition: width var(--motion-base) var(--ease), min-width var(--motion-base) var(--ease), padding var(--motion-base) var(--ease); }
.sidebar.icons { width: 72px; min-width: 72px; padding-inline: 8px; }
.brand { position: relative; min-height: 42px; display: flex; align-items: center; gap: 10px; padding: 0 8px; color: var(--text); font-size: var(--text-lg); font-weight: var(--font-medium); letter-spacing: .02em; }
.brand-mark { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, white 32%, var(--hairline)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 72%, transparent); box-shadow: var(--shadow-sm); transition: width var(--motion-base) var(--ease), opacity var(--motion-fast) var(--ease), border-width var(--motion-base) var(--ease); }
.brand img { width: 27px; height: 27px; }
.brand-copy { min-width: 0; max-width: 120px; flex: 1; overflow: hidden; opacity: 1; white-space: nowrap; transition: max-width var(--motion-base) var(--ease), opacity var(--motion-fast) var(--ease), transform var(--motion-base) var(--ease); }
.mode-toggle, .section-heading button, .group-heading button { display: grid; place-items: center; border: 0; background: transparent; color: var(--muted); }
.mode-toggle { width: 30px; height: 30px; flex: 0 0 30px; border-radius: var(--radius-sm); }
.mode-toggle:hover, .section-heading button:hover { background: var(--control-fill); color: var(--accent); }
.sidebar.icons .brand { justify-content: center; padding-inline: 0; }
.sidebar.icons .brand-copy { max-width: 0; opacity: 0; transform: translateX(-6px); }
.sidebar.icons .mode-toggle { position: absolute; left: 5px; opacity: 0; pointer-events: none; }
.sidebar.icons .brand:hover .brand-mark, .sidebar.icons .brand:focus-within .brand-mark { opacity: 0; }
.sidebar.icons .brand:hover .mode-toggle, .sidebar.icons .mode-toggle:focus-visible { opacity: 1; pointer-events: auto; }
.navigation { min-height: 0; flex: 1; overflow-y: auto; padding-top: 24px; scrollbar-width: none; }
.navigation::-webkit-scrollbar { display: none; }
.nav-section h2 { max-height: 18px; margin: 0 8px 7px; overflow: hidden; color: color-mix(in srgb, var(--muted) 86%, transparent); font-size: var(--text-xs); font-weight: var(--font-medium); letter-spacing: .04em; opacity: 1; white-space: nowrap; transition: max-height var(--motion-base) var(--ease), margin var(--motion-base) var(--ease), opacity var(--motion-fast) var(--ease); }
.section-heading { display: flex; align-items: center; justify-content: space-between; padding-right: 5px; }
.section-heading > div { display: flex; max-width: 60px; overflow: hidden; opacity: 1; transition: max-width var(--motion-base) var(--ease), opacity var(--motion-fast) var(--ease); }
.section-heading button { width: 28px; height: 28px; border-radius: var(--radius-sm); }
.list-section, .learning-section { margin-top: 20px; padding-top: 17px; border-top: 1px solid color-mix(in srgb, var(--hairline) 80%, transparent); }
.list-group + .list-group { margin-top: 8px; }
.group-heading { min-height: 25px; display: flex; align-items: center; justify-content: space-between; overflow: hidden; padding: 0 8px; color: var(--muted); font-size: var(--text-xs); opacity: 1; transition: min-height var(--motion-base) var(--ease), opacity var(--motion-fast) var(--ease); }
.group-heading button { width: 24px; height: 24px; border-radius: var(--radius-sm); opacity: 0; }
.group-heading:hover button, .group-heading button:focus-visible { opacity: 1; }
.nav-list { display: flex; flex-direction: column; gap: 3px; }
.nav-item { position: relative; width: 100%; min-height: 40px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: color-mix(in srgb, var(--text) 88%, var(--muted)); font-size: var(--text-base); font-weight: var(--font-regular); text-align: left; cursor: grab; transition: background var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease), opacity var(--motion-fast) var(--ease), padding var(--motion-base) var(--ease); }
.nav-item:active { cursor: grabbing; }
.nav-item:hover { background: color-mix(in srgb, var(--control-fill) 76%, transparent); }
.nav-item.active { border-color: color-mix(in srgb, var(--accent) 12%, var(--hairline)); background: color-mix(in srgb, var(--accent) 11%, var(--surface)); color: var(--text); box-shadow: var(--shadow-sm); }
.nav-item.dragging { opacity: .42; transform: scale(.98); }
.nav-item.drop-target::before { content: ''; position: absolute; left: 8px; right: 8px; top: -3px; height: 2px; border-radius: var(--radius-full); background: var(--accent); }
.nav-order-move { transition: transform var(--motion-base) var(--ease); }
.nav-icon { flex: 0 0 auto; color: var(--muted); transition: color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease-spring); }
.nav-item:hover .nav-icon, .nav-item.active .nav-icon { color: var(--accent); }
.nav-item:active .nav-icon { transform: scale(.92); }
.nav-label { min-width: 0; max-width: 150px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 1; transition: max-width var(--motion-base) var(--ease), opacity var(--motion-fast) var(--ease), transform var(--motion-base) var(--ease); }
.nav-count { min-width: 22px; max-width: 54px; height: 20px; display: inline-grid; place-items: center; overflow: hidden; padding: 0 6px; border-radius: var(--radius-full); background: color-mix(in srgb, var(--surface-alt) 72%, transparent); color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; opacity: 1; transition: max-width var(--motion-base) var(--ease), min-width var(--motion-base) var(--ease), padding var(--motion-base) var(--ease), opacity var(--motion-fast) var(--ease); }
.nav-item.active .nav-count { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--accent); }
.settings { margin-top: 12px; border-top-color: color-mix(in srgb, var(--hairline) 76%, transparent); cursor: pointer; }
.sidebar.icons .nav-section h2 { max-height: 0; margin-block: 0; opacity: 0; }
.sidebar.icons .section-heading { justify-content: center; padding-right: 0; }
.sidebar.icons .section-heading > div, .sidebar.icons .group-heading { max-width: 0; min-height: 0; visibility: hidden; opacity: 0; pointer-events: none; }
.sidebar.icons .nav-item { justify-content: center; gap: 0; padding-inline: 0; }
.sidebar.icons .nav-label { max-width: 0; opacity: 0; transform: translateX(-6px); }
.sidebar.icons .nav-count { min-width: 0; max-width: 0; padding-inline: 0; opacity: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (min-width: 820px) and (max-width: 1279px) {
  .sidebar { width: 72px; min-width: 72px; padding-inline: 8px; }
  .brand { justify-content: center; padding-inline: 0; }
  .mode-toggle { display: none; }
  .brand-copy, .nav-section h2, .section-heading > div, .group-heading, .nav-label, .nav-count { max-width: 0; min-width: 0; max-height: 0; min-height: 0; margin: 0; padding-inline: 0; border-width: 0; opacity: 0; pointer-events: none; }
  .section-heading > div, .group-heading { visibility: hidden; }
  .nav-item { justify-content: center; gap: 0; padding-inline: 0; }
}
@media (max-width: 819px) { .sidebar { display: none; } }
@media (prefers-reduced-motion: reduce) { .sidebar, .brand-copy, .brand-mark, .nav-section h2, .section-heading > div, .group-heading, .nav-item, .nav-label, .nav-count, .nav-order-move { transition: none; } }
@media (prefers-reduced-transparency: reduce) { .sidebar { background: var(--surface); box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; } }
</style>
