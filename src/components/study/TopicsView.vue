<script setup lang="ts">
import { computed } from 'vue'
import { Archive, ArrowRight, BookOpen, Check, ChevronRight, Code2, Folder, FolderTree, GraduationCap, Languages, NotebookPen, Pencil } from '@lucide/vue'
import { resolveListAppearance, type ListAppearance, type ListIconId } from '../../lib/list-appearance'
import IconButton from '../ui/IconButton.vue'
import ListAppearancePicker from './ListAppearancePicker.vue'
import ListCreateMenu from './ListCreateMenu.vue'

export interface TopicViewItem {
  id: string
  title: string
  icon?: ListIconId
  color?: string
  goal: string
  successCriteria: string[]
  totalSteps: number
  completedSteps: number
  currentStep: string
  nextAction: string
  recentLabel: string
  evidence: Array<{ id: string; date: string; minutes: number; learned: string; evidence: string; blocker: string }>
}

const props = defineProps<{
  topics: TopicViewItem[]
  groups?: Array<{ id: string; title: string }>
  selectedId: string
}>()

const emit = defineEmits<{
  select: [id: string]
  create: []
  start: [id: string]
  edit: [id: string]
  archive: [id: string]
  createGroup: []
  editGroup: [id: string]
  updateAppearance: [id: string, appearance: ListAppearance]
}>()

const selectedTopic = computed(() => props.topics.find((topic) => topic.id === props.selectedId))
const listIcons: Record<ListIconId, typeof Folder> = {
  folder: Folder, book: BookOpen, graduation: GraduationCap, code: Code2,
  languages: Languages, notebook: NotebookPen,
}
function topicIdentity(topic: Pick<TopicViewItem, 'id' | 'icon' | 'color'>) { return resolveListAppearance(topic.id, topic.icon, topic.color) }
function topicIdentityIcon(topic: Pick<TopicViewItem, 'id' | 'icon' | 'color'>) { return listIcons[topicIdentity(topic).icon] }
function topicIdentityStyle(topic: Pick<TopicViewItem, 'id' | 'icon' | 'color'>) { return { '--list-accent': topicIdentity(topic).color } }
</script>

<template>
  <section class="topics-view">
    <header>
      <div><h1>清单与主题</h1><p>{{ topics.length }} 项</p></div>
      <div class="header-actions"><ListCreateMenu @create-list="emit('create')" @create-group="emit('createGroup')" /></div>
    </header>

    <div v-if="groups?.length" class="group-strip" aria-label="清单分组"><button v-for="group in groups" :key="group.id" :title="`编辑分组 ${group.title}`" @click="emit('editGroup', group.id)"><FolderTree class="group-icon" :size="15" aria-hidden="true" /><span>{{ group.title }}</span><Pencil :size="12" aria-hidden="true" /></button></div>

    <div class="topic-layout">
      <aside class="topic-list">
        <button
          v-for="topic in topics"
          :key="topic.id"
          :class="{ active: topic.id === props.selectedId }"
          @click="emit('select', topic.id)"
        >
          <span class="topic-identity" :style="topicIdentityStyle(topic)"><component :is="topicIdentityIcon(topic)" :size="18" :stroke-width="1.8" aria-hidden="true" /></span>
          <span class="topic-copy">
            <strong>{{ topic.title }}</strong>
            <small>{{ topic.completedSteps }} / {{ topic.totalSteps }} 步 · {{ topic.recentLabel }}</small>
          </span>
          <ChevronRight class="topic-chevron" :size="18" aria-hidden="true" />
        </button>
      </aside>

      <article v-if="selectedTopic" class="topic-detail">
        <div class="detail-heading">
          <div>
            <h2>{{ selectedTopic.title }}</h2>
            <span>{{ selectedTopic.goal }}</span>
          </div>
          <div class="topic-actions"><ListAppearancePicker :id="selectedTopic.id" :icon="selectedTopic.icon" :color="selectedTopic.color" @change="emit('updateAppearance', selectedTopic.id, $event)" /><IconButton label="编辑清单" :icon-size="18" @click="emit('edit', selectedTopic.id)"><Pencil /></IconButton><IconButton label="归档清单" variant="destructive" :icon-size="18" @click="emit('archive', selectedTopic.id)"><Archive /></IconButton></div>
        </div>

        <section class="success-criteria">
          <h3>做到这些，才算学会</h3>
          <p v-for="item in selectedTopic.successCriteria" :key="item"><Check :size="16" />{{ item }}</p>
        </section>

        <section class="current-action">
          <div>
            <small>当前一步</small>
            <strong>{{ selectedTopic.currentStep }}</strong>
            <span>下一步：{{ selectedTopic.nextAction }}</span>
          </div>
          <button @click="emit('start', selectedTopic.id)">继续学习<ArrowRight :size="18" /></button>
        </section>

        <section class="timeline">
          <h3>学习证据</h3>
          <div v-for="entry in selectedTopic.evidence" :key="entry.id" class="timeline-item">
            <i />
            <small>{{ entry.date }} · {{ entry.minutes }} 分钟</small>
            <strong>{{ entry.learned }}</strong>
            <span>证据：{{ entry.evidence }}</span>
            <span v-if="entry.blocker" class="blocker">留下问题：{{ entry.blocker }}</span>
          </div>
          <p v-if="selectedTopic.evidence.length === 0" class="empty">这个主题还没有学习证据。先完成一次 15 分钟的小步骤。</p>
        </section>
      </article>
    </div>
  </section>
</template>

<style scoped>
.topics-view {
  width: min(100%, 980px);
  margin: 0 auto;
  padding: 32px 32px 90px;
}

header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border);
}

header p,
.detail-heading p {
  margin: 0 0 7px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
  font-weight: 650;
  letter-spacing: -0.035em;
}

.current-action button {
  min-height: 45px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.header-actions { display: flex; gap: 8px; }.group-strip { display: flex; gap: 7px; padding: 14px 0 0; overflow-x: auto; }.group-strip button { min-width: 0; min-height: 44px; display: grid; grid-template-columns: 16px minmax(0, 1fr) 12px; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--muted); font-size: var(--text-xs); text-align: left; }.group-strip button span { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.group-icon { color: var(--muted); }

.topic-layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 24px;
  padding-top: 24px;
}

.topic-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.topic-list button {
  width: 100%;
  min-height: 70px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 12px 10px 12px 13px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.topic-list button:hover {
  background: color-mix(in srgb, var(--control-fill) 72%, transparent);
}

.topic-list button.active {
  background: var(--press-fill);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}

.topic-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.topic-identity { width: 20px; height: 20px; display: grid; place-items: center; color: var(--list-accent); }
.topic-chevron { grid-column: 3; flex: 0 0 18px; color: var(--muted); }

.topic-list strong,
.topic-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topic-list strong {
  font-size: 13px;
  font-weight: 650;
}

.topic-list small {
  color: var(--muted);
  font-size: 10px;
}

.topic-detail {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.detail-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.detail-heading > div:first-child { min-width: 0; }
.topic-actions { flex: 0 0 auto; display: flex; gap: 4px; }

.detail-heading h2 {
  margin: 0 0 8px;
  overflow-wrap: anywhere;
  font-size: 25px;
  font-weight: 650;
}

.detail-heading span {
  display: block;
  max-width: 580px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

.success-criteria,
.timeline {
  margin-top: 26px;
  padding-top: 21px;
  border-top: 1px solid var(--border);
}

h3 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 650;
}

.success-criteria p {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 8px 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.success-criteria svg {
  flex: 0 0 auto;
  color: var(--accent);
}

.current-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-top: 26px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.current-action div {
  min-width: 0;
  overflow-wrap: anywhere;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.current-action small,
.current-action span {
  color: var(--muted);
  font-size: 10px;
}

.current-action strong {
  font-size: 14px;
  font-weight: 650;
}

.timeline {
  padding-left: 2px;
}

.timeline-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 5px 0 24px 24px;
  border-left: 1px solid var(--border);
}

.timeline-item i {
  position: absolute;
  left: -5px;
  top: 8px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.timeline-item small,
.timeline-item span {
  color: var(--muted);
  font-size: 10px;
}

.timeline-item strong {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.timeline-item .blocker {
  color: var(--warning);
}

.empty {
  color: var(--muted);
  font-size: 12px;
}

@media (max-width: 819px) {
  .topics-view {
    padding: 28px 20px 126px;
  }

  header {
    align-items: flex-start;
    flex-direction: column;
  }
  .header-actions { width: 100%; justify-content: flex-end; }

  .topic-layout {
    display: block;
  }

  .topic-list {
    flex-direction: row;
    overflow-x: auto;
    margin: 0 -20px 26px;
    padding: 0 20px 8px;
    scrollbar-width: none;
  }

  .topic-list::-webkit-scrollbar { display: none; }

  .topic-list button {
    min-width: 210px;
  }

  .topic-detail { padding: 20px; }

  .current-action {
    align-items: stretch;
    flex-direction: column;
  }

  .current-action button {
    justify-content: center;
  }
}
</style>
