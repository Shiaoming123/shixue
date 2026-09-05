<script setup lang="ts">
import { ref, watch } from 'vue'
import { Bell, Download, Moon, RotateCcw, Sun, Upload, X } from '@lucide/vue'
import Switch from '../ui/Switch.vue'

export type CloudAccountStatus = 'signed-out' | 'signed-in' | 'syncing' | 'failed'

const props = defineProps<{
  open: boolean
  dark: boolean
  remindersAvailable: boolean
  remindersEnabled: boolean
  cloudAvailable: boolean
  cloudStatus: CloudAccountStatus
  cloudEmail?: string
  cloudMessage?: string
}>()
const emit = defineEmits<{
  close: []
  export: []
  import: [content: string]
  resetDemo: []
  setAppearance: [mode: 'light' | 'dark']
  setReminders: [enabled: boolean]
  cloudSignIn: [email: string, password: string]
  cloudSignOut: []
  cloudSync: []
}>()

const confirmReset = ref(false)
const importInput = ref<HTMLInputElement>()
const importFileName = ref('')
const importContent = ref('')
const importError = ref('')
const cloudEmailDraft = ref('')
const cloudPassword = ref('')
watch(() => props.open, (open) => {
  if (!open) {
    confirmReset.value = false
    clearImport()
    cloudPassword.value = ''
  }
})

function resetDemo() {
  confirmReset.value = false
  emit('resetDemo')
}

async function selectImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importError.value = ''
  if (!file.name.toLocaleLowerCase().endsWith('.json')) {
    importContent.value = ''
    importFileName.value = file.name
    importError.value = '请选择拾学导出的 JSON 文件。'
    return
  }
  try {
    importContent.value = await file.text()
    importFileName.value = file.name
  } catch {
    importContent.value = ''
    importError.value = '文件读取失败，请重新选择。'
  }
}

function clearImport() {
  importFileName.value = ''
  importContent.value = ''
  importError.value = ''
  if (importInput.value) importInput.value.value = ''
}

function confirmImport() {
  if (!importContent.value) return
  emit('import', importContent.value)
  clearImport()
}

function signIn() {
  if (!cloudEmailDraft.value.trim() || !cloudPassword.value) return
  emit('cloudSignIn', cloudEmailDraft.value.trim(), cloudPassword.value)
  cloudPassword.value = ''
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
        <input ref="importInput" class="file-input" type="file" accept="application/json,.json" @change="selectImport" />
        <button v-if="!importFileName" @click="importInput?.click()"><Upload :size="18" /><span><strong>导入学习记录</strong><small>验证后替换这台设备上的记录</small></span></button>
        <div v-else class="import-confirm" role="alert">
          <p><strong>{{ importError ? '无法导入这个文件' : '替换本地记录？' }}</strong><span>{{ importError || `${importFileName} 已读取。导入前建议先导出现有记录。` }}</span></p>
          <div><button @click="clearImport">取消</button><button v-if="!importError" class="danger" @click="confirmImport">确认导入</button><button v-else @click="importInput?.click()">重新选择</button></div>
        </div>
        <button v-if="!confirmReset" @click="confirmReset = true"><RotateCcw :size="18" /><span><strong>恢复演示内容</strong><small>回到拾学的初始学习路线</small></span></button>
        <div v-else class="reset-confirm" role="alert">
          <p><strong>覆盖本地记录？</strong><span>现有主题和学习证据会被演示内容替换。建议先导出。</span></p>
          <div><button @click="confirmReset = false">继续保留</button><button class="danger" @click="resetDemo">确认恢复</button></div>
        </div>
      </div>

      <div v-if="remindersAvailable" class="group actions">
        <span>提醒</span>
        <Switch :model-value="remindersEnabled" label="到期与复习提醒" description="仅发送数量，不把任务内容交给系统通知" @update:model-value="emit('setReminders', $event)">
          <template #leading><Bell :size="18" /></template>
        </Switch>
      </div>

      <div v-if="cloudAvailable" class="group cloud-account">
        <span>可选云同步</span>
        <div v-if="cloudEmail && cloudStatus !== 'signed-out'" class="cloud-session">
          <p><strong>{{ cloudStatus === 'syncing' ? '正在同步…' : cloudStatus === 'failed' ? '同步需要重试' : '已安全登录' }}</strong><small>{{ cloudEmail }}</small></p>
          <div><button :disabled="cloudStatus === 'syncing'" @click="emit('cloudSync')">立即同步</button><button class="danger" :disabled="cloudStatus === 'syncing'" @click="emit('cloudSignOut')">退出账号</button></div>
        </div>
        <form v-else class="cloud-form" @submit.prevent="signIn">
          <p>本地记录仍是事实源。登录令牌只保存在系统钥匙串，不写入 WebView 存储。</p>
          <label><span>邮箱</span><input v-model="cloudEmailDraft" type="email" autocomplete="username" required /></label>
          <label><span>密码</span><input v-model="cloudPassword" type="password" autocomplete="current-password" required /></label>
          <button type="submit" :disabled="!cloudEmailDraft.trim() || !cloudPassword">登录并同步</button>
        </form>
        <p v-if="cloudMessage" class="cloud-message" :class="{ error: cloudStatus === 'failed' }" role="status">{{ cloudMessage }}</p>
      </div>

      <p class="privacy">拾学默认只把学习内容保存在这台设备上。只有你显式配置并登录可选云同步时，学习快照才会发往所选项目。</p>
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

.cloud-session { padding: 14px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); }.cloud-session p { display: flex; flex-direction: column; gap: 4px; margin: 0; }.cloud-session strong { color: var(--accent); font-size: 13px; }.cloud-session small { color: var(--muted); font-size: 10px; }.cloud-session > div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 13px; }.cloud-session button, .cloud-form > button { min-height: 40px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font-size: 11px; font-weight: 650; }.cloud-session button.danger { color: var(--danger); }.cloud-session button:disabled { opacity: .4; }
.cloud-form { padding: 14px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); }.cloud-form > p { margin: 0 0 12px; color: var(--muted); font-size: 10px; line-height: 1.55; }.cloud-form label { display: block; margin-top: 10px; }.cloud-form label span { display: block; margin-bottom: 5px; font-size: 10px; font-weight: 650; }.cloud-form input { width: 100%; min-height: 42px; padding: 0 11px; border: 1px solid var(--hairline); border-radius: var(--radius-md); outline: 0; background: var(--control-fill); color: var(--text); font-size: 12px; }.cloud-form input:focus { border-color: var(--accent); box-shadow: var(--focus-ring); }.cloud-form > button { width: 100%; margin-top: 12px; border: 0; background: var(--accent); color: var(--accent-text); }.cloud-form > button:disabled { opacity: .4; }.cloud-message { margin: 9px 2px 0; color: var(--muted); font-size: 10px; line-height: 1.5; }.cloud-message.error { color: var(--danger); }

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

.file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

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

.reset-confirm,
.import-confirm {
  padding: 14px 0 4px;
  border-bottom: 1px solid var(--border);
}

.reset-confirm p,
.reset-confirm p span,
.import-confirm p,
.import-confirm p span {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.reset-confirm p strong,
.import-confirm p strong {
  color: var(--danger);
}

.reset-confirm p span,
.import-confirm p span {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.reset-confirm > div,
.import-confirm > div {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}

.reset-confirm button,
.import-confirm button {
  min-height: 42px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-alt);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.reset-confirm button.danger,
.import-confirm button.danger {
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
