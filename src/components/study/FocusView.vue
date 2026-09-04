<script setup lang="ts">
import { ArrowLeft, Check, Pause, Play, Square } from '@lucide/vue'

defineProps<{
  topicTitle: string
  taskTitle: string
  criteria: string[]
  timeLabel: string
  running: boolean
  scratchpad: string
}>()

const emit = defineEmits<{
  back: []
  toggle: []
  finish: []
  'update:scratchpad': [value: string]
}>()

function updateScratchpad(event: Event) {
  emit('update:scratchpad', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <section class="focus-view">
    <button class="back" @click="emit('back')"><ArrowLeft :size="18" />回到今天</button>

    <div class="focus-heading">
      <p>{{ running ? '正在学习' : '已暂停' }}</p>
      <strong>{{ timeLabel }}</strong>
    </div>

    <p class="topic">{{ topicTitle }}</p>
    <h1>{{ taskTitle }}</h1>

    <div class="criteria">
      <p v-for="item in criteria" :key="item"><Check :size="17" :stroke-width="1.8" />{{ item }}</p>
    </div>

    <label class="scratchpad">
      <span>临时记录，不需要整理</span>
      <textarea
        :value="scratchpad"
        placeholder="随手写下线索、疑问或关键代码……"
        @input="updateScratchpad"
      />
      <small>内容会保存在本地，结束时可以整理成学习记录。</small>
    </label>

    <div class="focus-actions">
      <button class="secondary" @click="emit('toggle')">
        <Pause v-if="running" :size="19" fill="currentColor" />
        <Play v-else :size="19" fill="currentColor" />
        {{ running ? '暂停' : '继续' }}
      </button>
      <button class="primary" @click="emit('finish')"><Square :size="17" fill="currentColor" />完成并记录</button>
    </div>
  </section>
</template>

<style scoped>
.focus-view {
  width: min(100%, 720px);
  min-height: 100%;
  margin: 0 auto;
  padding: 44px 52px 90px;
}

.back {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
}

.focus-heading {
  display: flex;
  align-items: baseline;
  gap: 13px;
  margin-top: 70px;
}

.focus-heading p {
  margin: 0;
  color: var(--accent);
  font-size: 14px;
  font-weight: 600;
}

.focus-heading strong {
  font-variant-numeric: tabular-nums;
  font-size: 54px;
  font-weight: 570;
  letter-spacing: -0.055em;
}

.topic {
  margin: 36px 0 9px;
  color: var(--muted);
  font-size: 14px;
}

h1 {
  max-width: 620px;
  margin: 0;
  font-size: clamp(30px, 4vw, 42px);
  line-height: 1.2;
  font-weight: 650;
  letter-spacing: -0.035em;
}

.criteria {
  margin: 28px 0 34px;
  padding: 18px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.criteria p {
  display: flex;
  align-items: center;
  gap: 11px;
  margin: 0;
  min-height: 38px;
  color: var(--muted);
  font-size: 13px;
}

.criteria svg {
  color: var(--accent);
}

.scratchpad {
  display: block;
}

.scratchpad > span {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
}

textarea {
  width: 100%;
  min-height: 154px;
  resize: vertical;
  padding: 16px 17px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-xl);
  outline: none;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  line-height: 1.65;
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--text) 4%, transparent), var(--shadow-sm);
  transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease);
}

textarea:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring), var(--shadow-sm);
}

.scratchpad small {
  display: block;
  margin-top: 8px;
  color: var(--muted);
  font-size: 11px;
}

.focus-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.focus-actions button {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 0 21px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-weight: 550;
  cursor: pointer;
  transition: transform var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease);
}

.focus-actions button:active {
  transform: scale(0.98);
}

.secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.primary {
  border: 0;
  background: var(--accent);
  color: var(--accent-text);
  box-shadow: 0 5px 13px color-mix(in srgb, var(--accent) 20%, transparent);
}

@media (max-width: 799px) {
  .focus-view {
    padding: 22px 20px 118px;
  }

  .focus-heading {
    margin-top: 46px;
  }

  .focus-heading strong {
    font-size: 46px;
  }

  .focus-actions {
    display: grid;
    grid-template-columns: 0.78fr 1.22fr;
  }
}
</style>
