<script setup lang="ts">
import { BookOpen, CalendarDays, History, Inbox } from '@lucide/vue'
import type { StudyPage, StudySmartView } from './AppSidebar.vue'

defineProps<{ active: StudyPage }>()

const emit = defineEmits<{
  navigate: [page: StudyPage]
  'smart-view': [view: StudySmartView]
}>()

type MobileNavItem = {
  key: StudyPage
  label: string
  icon: typeof CalendarDays
  smartView?: StudySmartView
}

const items: MobileNavItem[] = [
  { key: 'today', label: '今天', icon: CalendarDays, smartView: 'today' },
  { key: 'tasks', label: '收件箱', icon: Inbox, smartView: 'inbox' },
  { key: 'topics', label: '主题', icon: BookOpen },
  { key: 'review', label: '回顾', icon: History },
]

function activate(item: MobileNavItem) {
  if (item.smartView) emit('smart-view', item.smartView)
  emit('navigate', item.key)
}
</script>

<template>
  <nav class="tabbar" aria-label="移动端主导航">
    <button
      v-for="item in items"
      :key="item.key"
      class="tab"
      :class="{ active: active === item.key }"
      :aria-current="active === item.key ? 'page' : undefined"
      :aria-label="item.label"
      :title="item.label"
      @click="activate(item)"
    >
      <span class="icon-wrap" aria-hidden="true">
        <component :is="item.icon" :size="21" :stroke-width="1.8" />
      </span>
      <span class="tab-label">{{ item.label }}</span>
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
    left: 12px;
    right: 12px;
    bottom: max(8px, env(safe-area-inset-bottom, 0px));
    min-height: 64px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: 6px 8px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, white 22%, var(--hairline));
    border-radius: var(--radius-xl);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 7%, transparent), transparent 64%),
      var(--material-regular);
    box-shadow: var(--shadow-lg);
    backdrop-filter: saturate(180%) blur(28px);
    -webkit-backdrop-filter: saturate(180%) blur(28px);
  }

  .tab {
    min-width: 0;
    min-height: 50px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 2px 4px;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .icon-wrap {
    width: 38px;
    height: 29px;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    transition:
      background var(--motion-fast) var(--ease),
      border-color var(--motion-fast) var(--ease),
      color var(--motion-fast) var(--ease),
      transform var(--motion-fast) var(--ease-spring);
  }

  .tab-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab:active .icon-wrap {
    transform: scale(0.9);
  }

  .tab.active {
    color: var(--accent);
  }

  .tab.active .icon-wrap {
    border-color: color-mix(in srgb, var(--accent) 13%, var(--hairline));
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    box-shadow: var(--shadow-sm);
  }
}

@media (max-width: 359px) {
  .tabbar {
    left: 8px;
    right: 8px;
  }

  .tab {
    font-size: 10px;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .tabbar {
    background: var(--surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

:global(html[data-ui-platform='android']) .tabbar {
  border-color: var(--hairline);
  background: var(--surface);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
</style>
