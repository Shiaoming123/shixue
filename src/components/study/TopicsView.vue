<script setup lang="ts">
import { computed } from 'vue'
import { Archive, ArrowRight, Check, ChevronRight, Folder, Pencil, Plus } from '@lucide/vue'

export interface TopicViewItem {
  id: string
  title: string
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
}>()

const selectedTopic = computed(() => props.topics.find((topic) => topic.id === props.selectedId))
</script>

<template>
  <section class="topics-view">
    <header>
      <div><h1>清单与主题</h1><p>{{ topics.length }} 项</p></div>
      <div class="header-actions"><button class="secondary-add" title="新建分组" aria-label="新建分组" @click="emit('createGroup')"><Folder :size="17" /></button><button class="add" title="新建清单" @click="emit('create')"><Plus :size="18" />新建</button></div>
    </header>

    <div v-if="groups?.length" class="group-strip" aria-label="清单分组"><button v-for="group in groups" :key="group.id" :title="`编辑分组 ${group.title}`" @click="emit('editGroup', group.id)"><Folder :size="14" />{{ group.title }}<Pencil :size="12" /></button></div>

    <div class="topic-layout">
      <aside class="topic-list">
        <button
          v-for="topic in topics"
          :key="topic.id"
          :class="{ active: topic.id === props.selectedId }"
          @click="emit('select', topic.id)"
        >
          <span>
            <strong>{{ topic.title }}</strong>
            <small>{{ topic.completedSteps }} / {{ topic.totalSteps }} 步 · {{ topic.recentLabel }}</small>
          </span>
          <ChevronRight :size="18" />
        </button>
      </aside>

      <article v-if="selectedTopic" class="topic-detail">
        <div class="detail-heading">
          <div>
            <h2>{{ selectedTopic.title }}</h2>
            <span>{{ selectedTopic.goal }}</span>
          </div>
          <div class="topic-actions"><button title="编辑" aria-label="编辑清单" @click="emit('edit', selectedTopic.id)"><Pencil :size="17" /></button><button title="归档" aria-label="归档清单" @click="emit('archive', selectedTopic.id)"><Archive :size="17" /></button></div>
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
  padding: 48px 44px 90px;
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

.add,
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
.header-actions { display: flex; gap: 8px; }.secondary-add { width: 45px; min-height: 45px; display: grid; place-items: center; border: 1px solid var(--hairline); border-radius: 12px; background: var(--control-fill); color: var(--muted); }.group-strip { display: flex; gap: 7px; padding: 14px 0 0; overflow-x: auto; }.group-strip button { min-height: 32px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid var(--hairline); border-radius: var(--radius-full); background: var(--control-fill); color: var(--muted); font-size: 11px; white-space: nowrap; }

.topic-layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 34px;
  padding-top: 28px;
}

.topic-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.topic-list button {
  width: 100%;
  min-height: 70px;
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.topic-list span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

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
}

.detail-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.topic-actions { display: flex; gap: 4px; }.topic-actions button { width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: var(--control-fill); color: var(--muted); }.topic-actions button:hover { color: var(--accent); }

.detail-heading h2 {
  margin: 0 0 8px;
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
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--hairline));
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.current-action div {
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
}

.timeline-item .blocker {
  color: var(--warning);
}

.empty {
  color: var(--muted);
  font-size: 12px;
}

@media (max-width: 799px) {
  .topics-view {
    padding: 28px 20px 126px;
  }

  header {
    align-items: flex-start;
    flex-direction: column;
  }
  .header-actions { width: 100%; }.add { flex: 1; justify-content: center; }

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

  .current-action {
    align-items: stretch;
    flex-direction: column;
  }

  .current-action button {
    justify-content: center;
  }
}
</style>
