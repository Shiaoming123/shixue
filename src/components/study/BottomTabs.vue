<script setup lang="ts">
import { BookOpen, CalendarDays, History, ListTodo } from '@lucide/vue'
import type { StudyPage } from './AppSidebar.vue'

defineProps<{ active: StudyPage }>()
const emit = defineEmits<{ navigate: [page: StudyPage] }>()

const items = [
  { key: 'today' as const, label: '今天', icon: CalendarDays },
  { key: 'tasks' as const, label: '任务', icon: ListTodo },
  { key: 'topics' as const, label: '主题', icon: BookOpen },
  { key: 'review' as const, label: '回顾', icon: History },
]
</script>

<template>
  <nav class="tabbar" aria-label="移动端主导航">
    <button
      v-for="item in items"
      :key="item.key"
      class="tab"
      :class="{ active: active === item.key }"
      :aria-current="active === item.key ? 'page' : undefined"
      @click="emit('navigate', item.key)"
    >
      <span class="icon-wrap">
        <component :is="item.icon" :size="22" :stroke-width="1.7" />
      </span>
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  display: none;
}

@media (max-width: 799px) {
  .tabbar {
    position: fixed;
    z-index: var(--z-sticky);
    left: 10px;
    right: 10px;
    bottom: max(8px, env(safe-area-inset-bottom, 0px));
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    min-height: 68px;
    padding: 7px 9px;
    padding-bottom: calc(7px + env(safe-area-inset-bottom, 0px));
    border: 1px solid var(--hairline);
    border-radius: var(--radius-2xl);
    background: var(--material-regular);
    box-shadow: var(--shadow-lg);
    backdrop-filter: saturate(180%) blur(28px);
    -webkit-backdrop-filter: saturate(180%) blur(28px);
  }

  .tab {
    min-height: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }

  .icon-wrap {
    width: 38px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    transition: background var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease-spring);
  }

  .tab:active .icon-wrap {
    transform: scale(0.92);
  }

  .tab.active {
    color: var(--accent);
  }

  .tab.active .icon-wrap {
    background: color-mix(in srgb, var(--accent) 13%, var(--surface));
    box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--accent) 15%, transparent);
  }
}
</style>
