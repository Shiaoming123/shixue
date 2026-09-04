<script setup lang="ts">
import { BookOpen, CalendarDays, History, ListTodo, Settings } from '@lucide/vue'

export type StudyPage = 'today' | 'tasks' | 'topics' | 'review'

defineProps<{ active: StudyPage }>()
const emit = defineEmits<{
  navigate: [page: StudyPage]
  settings: []
}>()

const items = [
  { key: 'today' as const, label: '今天', icon: CalendarDays },
  { key: 'tasks' as const, label: '任务', icon: ListTodo },
  { key: 'topics' as const, label: '主题', icon: BookOpen },
  { key: 'review' as const, label: '回顾', icon: History },
]
</script>

<template>
  <aside class="sidebar" aria-label="主导航">
    <div class="brand">
      <img src="/shixue-mark.svg" alt="" />
      <span>拾学</span>
    </div>

    <nav class="nav-list">
      <button
        v-for="item in items"
        :key="item.key"
        class="nav-item"
        :class="{ active: active === item.key }"
        :aria-current="active === item.key ? 'page' : undefined"
        @click="emit('navigate', item.key)"
      >
        <component :is="item.icon" :size="21" :stroke-width="1.75" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <button class="nav-item settings" @click="emit('settings')">
      <Settings :size="21" :stroke-width="1.75" />
      <span>设置</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 216px;
  min-width: 216px;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 26px 16px 18px;
  background: var(--material-thin);
  border-right: 1px solid var(--hairline);
  backdrop-filter: saturate(170%) blur(28px);
  -webkit-backdrop-filter: saturate(170%) blur(28px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 52px;
  padding: 0 10px;
  color: var(--text);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.brand img {
  width: 39px;
  height: 39px;
}

.nav-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  padding-top: 46px;
}

.nav-item {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text);
  font-size: 15px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease-spring);
}

.nav-item:hover {
  background: var(--control-fill);
}

.nav-item:active {
  transform: scale(0.985);
}

.nav-item.active {
  background: var(--press-fill);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}

.settings {
  margin-top: auto;
  border-top: 1px solid var(--hairline);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  padding-top: 15px;
}

@media (max-width: 799px) {
  .sidebar {
    display: none;
  }
}
</style>
