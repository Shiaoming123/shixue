<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  CircleCheckBig,
  Folder,
  History,
  Inbox,
  ListTodo,
  Pencil,
  Plus,
  Settings,
} from '@lucide/vue'

export type StudyPage = 'today' | 'tasks' | 'topics' | 'review'
export type StudySmartView = 'inbox' | 'today' | 'next7' | 'all' | 'completed'
export type StudySmartViewCounts = Partial<Record<StudySmartView, number>>

const props = defineProps<{
  active: StudyPage
  activeSmartView?: StudySmartView
  counts?: StudySmartViewCounts
  groups?: Array<{ id: string; title: string }>
  lists?: Array<{ id: string; groupId: string | null; title: string; count: number }>
  activeListId?: string
}>()

const emit = defineEmits<{
  navigate: [page: StudyPage]
  settings: []
  'smart-view': [view: StudySmartView]
  'select-list': [id: string]
  'create-list': []
  'create-group': []
  'edit-group': [id: string]
}>()

const fallbackSmartView = ref<StudySmartView>('inbox')

const smartItems = [
  { key: 'inbox' as const, label: '收件箱', icon: Inbox },
  { key: 'today' as const, label: '今天', icon: CalendarDays },
  { key: 'next7' as const, label: '最近 7 天', icon: CalendarRange },
  { key: 'all' as const, label: '全部', icon: ListTodo },
  { key: 'completed' as const, label: '已完成', icon: CircleCheckBig },
]

const learningItems = [
  { key: 'topics' as const, label: '主题', icon: BookOpen },
  { key: 'review' as const, label: '回顾', icon: History },
]

const listSections = computed(() => {
  const lists = props.lists ?? []
  return [
    { id: '', title: '', lists: lists.filter(({ groupId }) => !groupId) },
    ...(props.groups ?? []).map((group) => ({ ...group, lists: lists.filter(({ groupId }) => groupId === group.id) })),
  ].filter((section) => section.id || section.lists.length)
})

const currentSmartView = computed<StudySmartView | null>(() => {
  if (props.activeSmartView) return props.activeSmartView
  if (props.active === 'today') return 'today'
  if (props.active === 'tasks') return fallbackSmartView.value
  return null
})

function selectSmartView(view: StudySmartView) {
  fallbackSmartView.value = view
  emit('smart-view', view)
  emit('navigate', view === 'today' ? 'today' : 'tasks')
}

function displayCount(view: StudySmartView) {
  return Math.min(Math.max(0, props.counts?.[view] ?? 0), 999)
}

function smartLabel(view: StudySmartView, label: string) {
  const count = props.counts?.[view]
  return typeof count === 'number' ? `${label}，${Math.max(0, count)} 项` : label
}
</script>

<template>
  <aside class="sidebar" aria-label="主导航">
    <div class="brand">
      <span class="brand-mark"><img src="/shixue-mark.svg" alt="" /></span>
      <span>拾学</span>
    </div>

    <nav class="navigation" aria-label="待办导航">
      <section class="nav-section" aria-labelledby="smart-list-heading">
        <h2 id="smart-list-heading">智能清单</h2>
        <div class="nav-list">
          <button
            v-for="item in smartItems"
            :key="item.key"
            class="nav-item"
            :class="{ active: currentSmartView === item.key }"
            :aria-current="currentSmartView === item.key ? 'page' : undefined"
            :aria-label="smartLabel(item.key, item.label)"
            :title="item.label"
            @click="selectSmartView(item.key)"
          >
            <component :is="item.icon" class="nav-icon" :size="18" :stroke-width="1.8" aria-hidden="true" />
            <span class="nav-label">{{ item.label }}</span>
            <span class="nav-count" aria-hidden="true">{{ displayCount(item.key) }}</span>
          </button>
        </div>
      </section>

      <section class="nav-section list-section" aria-labelledby="my-lists-heading">
        <div class="section-heading"><h2 id="my-lists-heading">我的清单</h2><div><button type="button" title="新建分组" aria-label="新建分组" @click="emit('create-group')"><Folder :size="15" /></button><button type="button" title="新建清单" aria-label="新建清单" @click="emit('create-list')"><Plus :size="15" /></button></div></div>
        <div v-for="section in listSections" :key="section.id || 'ungrouped'" class="list-group">
          <div v-if="section.id" class="group-heading"><span>{{ section.title }}</span><button type="button" title="编辑分组" :aria-label="`编辑分组 ${section.title}`" @click="emit('edit-group', section.id)"><Pencil :size="12" /></button></div>
          <div class="nav-list">
            <button v-for="list in section.lists" :key="list.id" class="nav-item" :class="{ active: activeListId === list.id }" :title="list.title" @click="emit('select-list', list.id)">
              <Folder class="nav-icon" :size="17" :stroke-width="1.8" />
              <span class="nav-label">{{ list.title }}</span><span class="nav-count">{{ list.count }}</span>
            </button>
          </div>
        </div>
      </section>

      <section class="nav-section learning-section" aria-labelledby="learning-heading">
        <h2 id="learning-heading">学习</h2>
        <div class="nav-list">
          <button
            v-for="item in learningItems"
            :key="item.key"
            class="nav-item"
            :class="{ active: active === item.key }"
            :aria-current="active === item.key ? 'page' : undefined"
            :aria-label="item.label"
            :title="item.label"
            @click="emit('navigate', item.key)"
          >
            <component :is="item.icon" class="nav-icon" :size="18" :stroke-width="1.8" aria-hidden="true" />
            <span class="nav-label">{{ item.label }}</span>
          </button>
        </div>
      </section>
    </nav>

    <button class="nav-item settings" aria-label="设置" title="设置" @click="emit('settings')">
      <Settings class="nav-icon" :size="18" :stroke-width="1.8" aria-hidden="true" />
      <span class="nav-label">设置</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 232px;
  min-width: 232px;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 12px 14px;
  border-right: 1px solid var(--hairline);
  background:
    linear-gradient(180deg, color-mix(in srgb, white 5%, transparent), transparent 38%),
    var(--material-thin);
  box-shadow: inset -1px 0 color-mix(in srgb, white 24%, transparent);
  backdrop-filter: saturate(170%) blur(28px);
  -webkit-backdrop-filter: saturate(170%) blur(28px);
}

.brand {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  color: var(--text);
  font-size: var(--text-lg);
  font-weight: var(--font-medium);
  letter-spacing: 0.02em;
}

.brand-mark {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, white 32%, var(--hairline));
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  box-shadow: var(--shadow-sm);
}

.brand img {
  width: 27px;
  height: 27px;
}

.navigation {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding-top: 24px;
  scrollbar-width: none;
}

.navigation::-webkit-scrollbar {
  display: none;
}

.nav-section h2 {
  margin: 0 8px 7px;
  color: color-mix(in srgb, var(--muted) 86%, transparent);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  letter-spacing: 0.04em;
}

.section-heading { display: flex; align-items: center; justify-content: space-between; padding-right: 5px; }.section-heading > div { display: flex; }
.section-heading button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); }
.section-heading button:hover { background: var(--control-fill); color: var(--accent); }
.list-section { margin-top: 20px; padding-top: 17px; border-top: 1px solid color-mix(in srgb, var(--hairline) 80%, transparent); }
.list-group + .list-group { margin-top: 8px; }.group-heading { min-height: 25px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; color: var(--muted); font-size: 11px; }.group-heading button { width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); opacity: 0; }.group-heading:hover button, .group-heading button:focus-visible { opacity: 1; }

.learning-section {
  margin-top: 20px;
  padding-top: 17px;
  border-top: 1px solid color-mix(in srgb, var(--hairline) 80%, transparent);
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nav-item {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: color-mix(in srgb, var(--text) 88%, var(--muted));
  font-size: var(--text-base);
  font-weight: var(--font-regular);
  text-align: left;
}

.nav-item:hover {
  background: color-mix(in srgb, var(--control-fill) 76%, transparent);
}

.nav-item.active {
  border-color: color-mix(in srgb, var(--accent) 12%, var(--hairline));
  background: color-mix(in srgb, var(--accent) 11%, var(--surface));
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.nav-icon {
  flex: 0 0 auto;
  color: var(--muted);
  transition: color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease-spring);
}

.nav-item:hover .nav-icon,
.nav-item.active .nav-icon {
  color: var(--accent);
}

.nav-item:active .nav-icon {
  transform: scale(0.92);
}

.nav-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-count {
  min-width: 22px;
  height: 20px;
  display: inline-grid;
  place-items: center;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--surface-alt) 72%, transparent);
  color: var(--muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.nav-item.active .nav-count {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent);
}

.settings {
  margin-top: 12px;
  border-top-color: color-mix(in srgb, var(--hairline) 76%, transparent);
}

@media (max-width: 799px) {
  .sidebar {
    display: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .sidebar {
    background: var(--surface);
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
