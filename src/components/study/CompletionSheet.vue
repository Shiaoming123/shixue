<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CheckCircle2, X } from '@lucide/vue'

export interface CompletionPayload {
  learned: string
  evidence: string
  blocker: string
  nextAction: string
  mastery: 1 | 2 | 3 | 4 | 5
}

const props = defineProps<{
  open: boolean
  taskTitle: string
  scratchpad: string
}>()

const emit = defineEmits<{
  close: []
  save: [payload: CompletionPayload]
}>()

const learned = ref('')
const evidence = ref('')
const blocker = ref('')
const nextAction = ref('')
const mastery = ref<1 | 2 | 3 | 4 | 5>(3)
const loadedTask = ref('')

watch([() => props.open, () => props.taskTitle], ([open]) => {
  if (!open) return
  if (loadedTask.value === props.taskTitle) return
  loadedTask.value = props.taskTitle
  learned.value = props.scratchpad.trim()
  evidence.value = ''
  blocker.value = ''
  nextAction.value = ''
  mastery.value = 3
}, { immediate: true })

const ready = computed(() => learned.value.trim() && evidence.value.trim() && nextAction.value.trim())

function submit() {
  if (!ready.value) return
  emit('save', {
    learned: learned.value.trim(),
    evidence: evidence.value.trim(),
    blocker: blocker.value.trim(),
    nextAction: nextAction.value.trim(),
    mastery: mastery.value,
  })
}
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="emit('close')">
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="completion-title">
      <header>
        <div>
          <p>完成学习</p>
          <h2 id="completion-title">把时间变成证据</h2>
        </div>
        <button class="close" title="关闭" @click="emit('close')"><X :size="20" /></button>
      </header>

      <p class="task">{{ taskTitle }}</p>

      <label>
        <span>今天真正弄懂了什么？</span>
        <textarea v-model="learned" placeholder="用自己的话写一句结论" />
      </label>
      <label>
        <span>成果或证据在哪里？</span>
        <input v-model="evidence" placeholder="文件、链接、测试结果或作品" />
      </label>
      <label>
        <span>仍然卡在哪里？<small>（可选）</small></span>
        <input v-model="blocker" placeholder="留下尚未解决的问题" />
      </label>
      <label>
        <span>下一步具体做什么？</span>
        <input v-model="nextAction" placeholder="一个可在下次直接开始的动作" />
      </label>

      <fieldset>
        <legend>现在的掌握程度</legend>
        <button v-for="score in 5" :key="score" type="button" :class="{ active: mastery === score }" @click="mastery = score as 1 | 2 | 3 | 4 | 5">
          {{ score }}
        </button>
      </fieldset>

      <footer>
        <span>记录后将在 1 天后首次复习</span>
        <button class="save" :disabled="!ready" @click="submit"><CheckCircle2 :size="18" />保存学习记录</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  z-index: var(--z-modal);
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--text) 22%, transparent);
  backdrop-filter: saturate(120%) blur(12px);
}

.sheet {
  width: min(100%, 660px);
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 28px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-2xl);
  background: var(--material-regular);
  box-shadow: var(--shadow-lg);
  animation: sheet-in var(--motion-slow) var(--ease-spring);
}

@keyframes sheet-in {
  from { transform: translateY(22px) scale(0.985); opacity: 0; }
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

header p {
  margin: 0 0 4px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

h2 {
  margin: 0;
  font-size: 25px;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.close {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--surface-alt);
  color: var(--muted);
  cursor: pointer;
}

.task {
  margin: 20px 0;
  padding: 12px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 13px;
}

label {
  display: block;
  margin-top: 17px;
}

label > span,
legend {
  display: block;
  margin-bottom: 7px;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

label small {
  color: var(--muted);
  font-weight: 400;
}

input,
textarea {
  width: 100%;
  min-height: 45px;
  padding: 11px 13px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  outline: none;
  background: var(--control-fill);
  color: var(--text);
  font-size: 13px;
}

textarea {
  min-height: 88px;
  resize: vertical;
  line-height: 1.55;
}

input:focus,
textarea:focus {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: var(--focus-ring);
}

fieldset {
  display: flex;
  gap: 8px;
  margin: 18px 0 0;
  padding: 0;
  border: 0;
}

fieldset button {
  width: 42px;
  height: 42px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-alt);
  color: var(--muted);
  cursor: pointer;
}

fieldset button.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 23px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

footer > span {
  color: var(--muted);
  font-size: 11px;
}

.save {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--accent);
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 5px 14px color-mix(in srgb, var(--accent) 20%, transparent);
}

.save:disabled {
  opacity: .42;
  cursor: default;
}

@media (min-width: 820px) {
  .backdrop {
    align-items: center;
  }
}

@media (max-width: 819px) {
  .backdrop {
    padding: 0;
  }

  .sheet {
    position: relative;
    max-height: 94dvh;
    border-width: 1px 0 0;
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    padding: 34px 20px calc(24px + env(safe-area-inset-bottom, 0px));
    animation-name: sheet-up;
  }

  .sheet::before {
    content: '';
    position: absolute;
    top: 9px;
    left: 50%;
    width: 36px;
    height: 5px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 32%, transparent);
  }

  footer {
    align-items: stretch;
    flex-direction: column;
  }

  .save {
    justify-content: center;
  }
}

@keyframes sheet-up { from { transform: translateY(36px); opacity: .75; } }
</style>
