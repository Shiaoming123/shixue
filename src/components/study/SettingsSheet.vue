<script setup lang="ts">
import { ref, watch } from 'vue'
import { Download, Moon, RotateCcw, Sun, X } from '@lucide/vue'

const props = defineProps<{ open: boolean; dark: boolean }>()
const emit = defineEmits<{
  close: []
  export: []
  resetDemo: []
  setAppearance: [mode: 'light' | 'dark']
}>()

const confirmReset = ref(false)
watch(() => props.open, (open) => {
  if (!open) confirmReset.value = false
})

function resetDemo() {
  confirmReset.value = false
  emit('resetDemo')
}
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="emit('close')">
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header>
        <h2 id="settings-title">设置</h2>
        <button title="关闭" @click="emit('close')"><X :size="19" /></button>
      </header>

      <div class="group">
        <span>外观</span>
        <div class="segmented">
          <button :class="{ active: !dark }" @click="emit('setAppearance', 'light')"><Sun :size="17" />浅色</button>
          <button :class="{ active: dark }" @click="emit('setAppearance', 'dark')"><Moon :size="17" />深色</button>
        </div>
      </div>

      <div class="group actions">
        <span>本地数据</span>
        <button @click="emit('export')"><Download :size="18" /><span><strong>导出学习记录</strong><small>保存为可读的 JSON 文件</small></span></button>
        <button v-if="!confirmReset" @click="confirmReset = true"><RotateCcw :size="18" /><span><strong>恢复演示内容</strong><small>回到拾学的初始学习路线</small></span></button>
        <div v-else class="reset-confirm" role="alert">
          <p><strong>覆盖本地记录？</strong><span>现有主题和学习证据会被演示内容替换。建议先导出。</span></p>
          <div><button @click="confirmReset = false">继续保留</button><button class="danger" @click="resetDemo">确认恢复</button></div>
        </div>
      </div>

      <p class="privacy">所有学习内容都保存在这台设备上。拾学首版不需要账号，也不会把记录发送到云端。</p>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  z-index: var(--z-modal);
  inset: 0;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--text) 18%, transparent);
  backdrop-filter: saturate(120%) blur(12px);
}

.sheet {
  width: min(100%, 390px);
  height: 100%;
  padding: 28px 24px;
  border-left: 1px solid var(--hairline);
  background: var(--material-regular);
  box-shadow: var(--shadow-lg);
  animation: slide-in var(--motion-slow) var(--ease-spring);
  backdrop-filter: saturate(160%) blur(24px);
}

@keyframes slide-in { from { transform: translateX(24px); opacity: .7; } }

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--hairline);
}

h2 {
  margin: 0;
  font-size: 23px;
  font-weight: 650;
}

header button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--control-fill);
  color: var(--muted);
}

.group {
  margin-top: 28px;
}

.group > span {
  display: block;
  margin-bottom: 9px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-lg);
  background: var(--control-fill);
}

.segmented button {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}

.segmented button.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.actions > button {
  width: 100%;
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 10px 2px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  text-align: left;
}

.actions > button > span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.actions strong {
  font-size: 13px;
  font-weight: 600;
}

.actions small {
  color: var(--muted);
  font-size: 10px;
}

.reset-confirm {
  padding: 14px 0 4px;
  border-bottom: 1px solid var(--border);
}

.reset-confirm p,
.reset-confirm p span {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.reset-confirm p strong {
  color: var(--danger);
}

.reset-confirm p span {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.reset-confirm > div {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}

.reset-confirm button {
  min-height: 42px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-alt);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.reset-confirm button.danger {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  color: var(--danger);
}

.privacy {
  margin-top: 30px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.65;
}

@media (max-width: 799px) {
  .backdrop {
    align-items: flex-end;
  }

  .sheet {
    position: relative;
    width: 100%;
    height: auto;
    max-height: 90dvh;
    overflow-y: auto;
    border: 1px solid var(--hairline);
    border-bottom: 0;
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    padding: 34px 20px calc(24px + env(safe-area-inset-bottom, 0px));
    animation-name: sheet-up;
  }

  .sheet::before { content: ''; position: absolute; top: 9px; left: 50%; width: 36px; height: 5px; transform: translateX(-50%); border-radius: 999px; background: color-mix(in srgb, var(--muted) 32%, transparent); }
}

@keyframes sheet-up { from { transform: translateY(36px); opacity: .75; } }
</style>
