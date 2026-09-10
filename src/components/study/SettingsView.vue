<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import {
  Bell, Cloud, Download, Eye, FileJson, FileText, Monitor, Moon, PanelLeft, RotateCcw,
  ShieldCheck, Sun, Upload,
} from '@lucide/vue'
import { themes } from '../../assets/themes'
import type { PlanningPreferences } from '../../lib/planning-preferences'
import type { SidebarDisplayMode } from '../../lib/sidebar-preferences'
import type { WorkspaceStateV4 } from '../../domain/workspace/types'
import { prepareWorkspaceImport, summarizeWorkspace } from '../../lib/workspace-data-summary'
import Button from '../ui/Button.vue'
import Dialog from '../ui/Dialog.vue'
import Listbox, { type ListboxOption } from '../ui/Listbox.vue'
import Switch from '../ui/Switch.vue'

export type CloudAccountStatus = 'signed-out' | 'signed-in' | 'syncing' | 'failed'

const props = defineProps<{
  dark: boolean
  themeId: string
  themeMode: 'system' | 'light' | 'dark'
  customPrimary: string
  remindersAvailable: boolean
  remindersEnabled: boolean
  quickAddRemoveRecognizedText: boolean
  defaultEstimateMinutes: number | null
  reducedGlassOverride: PlanningPreferences['reducedGlassOverride']
  sidebarDisplayMode: SidebarDisplayMode
  sidebarOrderCustomized: boolean
  cloudAvailable: boolean
  cloudStatus: CloudAccountStatus
  cloudEmail?: string
  cloudMessage?: string
  workspace: WorkspaceStateV4 | null
  reminderBusy?: boolean
  reminderMessage?: string
  reminderCount?: number
  lifecycleAvailable?: boolean
  closeBehavior?: PlanningPreferences['closeBehavior']
  autostartAvailable?: boolean
  autostartEnabled?: boolean
  autostartBusy?: boolean
  deviceMessage?: string
}>()

const emit = defineEmits<{
  exportJson: []
  exportMarkdown: []
  import: [content: string, complete: (success: boolean) => void]
  resetDemo: [complete: (success: boolean) => void]
  resetSidebarOrder: []
  setTheme: [id: string]
  setThemeMode: [mode: 'system' | 'light' | 'dark']
  setCustomPrimary: [color: string]
  setReminders: [enabled: boolean]
  testNotification: []
  openReminders: []
  setCloseBehavior: [value: PlanningPreferences['closeBehavior']]
  setLaunchAtLogin: [enabled: boolean]
  setQuickAddRemoveRecognizedText: [enabled: boolean]
  setDefaultEstimateMinutes: [minutes: number | null]
  setReducedGlass: [value: PlanningPreferences['reducedGlassOverride']]
  setSidebarDisplayMode: [mode: SidebarDisplayMode]
  cloudSignIn: [email: string, password: string]
  cloudSignOut: []
  cloudSync: []
}>()

const confirmReset = ref(false)
const pageTitle = ref<HTMLHeadingElement>()
const importInput = ref<HTMLInputElement>()
const importFileName = ref('')
const importPreview = shallowRef<ReturnType<typeof prepareWorkspaceImport> | null>(null)
const importOpen = ref(false)
const dataBusy = ref(false)
const importError = ref('')
const resetError = ref('')
const currentSummary = computed(() => props.workspace ? summarizeWorkspace(props.workspace) : '记录暂时不可用')
const cloudEmailDraft = ref('')
const cloudPassword = ref('')
const themePreviews = computed(() => themes.map((theme) => ({
  ...theme,
  preview: props.dark ? theme.dark : theme.light,
})))
const estimateOptions: ListboxOption[] = [
  { value: 'none', label: '不设置' },
  { value: '15', label: '15 分钟' },
  { value: '25', label: '25 分钟' },
  { value: '30', label: '30 分钟' },
  { value: '45', label: '45 分钟' },
  { value: '60', label: '1 小时' },
  { value: '90', label: '1.5 小时' },
]
const closeOptions: ListboxOption[] = [
  { value: 'ask', label: '每次询问' },
  { value: 'tray', label: '隐藏到托盘' },
  { value: 'quit', label: '退出拾学' },
]

async function selectImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (dataBusy.value) return
  importError.value = ''
  importFileName.value = file.name
  importPreview.value = null
  if (!file.name.toLocaleLowerCase().endsWith('.json')) {
    importError.value = '请选择拾学导出的 JSON 文件。'
    return
  }
  try {
    importPreview.value = prepareWorkspaceImport(await file.text())
    confirmReset.value = false
    importOpen.value = true
  } catch (error) {
    importError.value = error instanceof Error ? error.message : '文件读取失败，请重新选择。'
  }
}

function clearImport() {
  importFileName.value = ''
  importPreview.value = null
  importOpen.value = false
  importError.value = ''
  if (importInput.value) importInput.value.value = ''
}
function confirmImport() {
  if (!importPreview.value || !props.workspace || dataBusy.value) return
  dataBusy.value = true
  importError.value = ''
  emit('import', importPreview.value.content, (success) => {
    dataBusy.value = false
    if (success) clearImport()
    else importError.value = '导入未完成，文件仍保留，可重试或取消。'
  })
}
function openReset() { importOpen.value = false; resetError.value = ''; confirmReset.value = true }
function resetDemo() {
  if (!props.workspace || dataBusy.value) return
  dataBusy.value = true
  resetError.value = ''
  emit('resetDemo', (success) => {
    dataBusy.value = false
    if (success) confirmReset.value = false
    else resetError.value = '恢复未完成，请重试或继续保留当前记录。'
  })
}
function signIn() {
  if (!cloudEmailDraft.value.trim() || !cloudPassword.value) return
  emit('cloudSignIn', cloudEmailDraft.value.trim(), cloudPassword.value)
  cloudPassword.value = ''
}
function setDefaultEstimate(value: string) { emit('setDefaultEstimateMinutes', value === 'none' ? null : Number(value)) }
function setCustomPrimary(event: Event) {
  emit('setCustomPrimary', (event.target as HTMLInputElement).value)
}
onMounted(() => pageTitle.value?.focus())
</script>

<template>
  <div class="settings-view">
    <aside class="settings-navigation" aria-label="设置分类">
      <strong>设置</strong>
      <nav>
        <a href="#settings-appearance"><Eye :size="17" />外观</a>
        <a href="#settings-navigation"><PanelLeft :size="17" />导航</a>
        <a href="#settings-input"><FileJson :size="17" />输入与操作</a>
        <a href="#settings-reminders"><Bell :size="17" />提醒与启动</a>
        <a href="#settings-data"><Download :size="17" />数据</a>
        <a v-if="cloudAvailable" href="#settings-cloud"><Cloud :size="17" />同步</a>
      </nav>
    </aside>
    <main class="settings-content">
    <header class="page-header">
      <div>
        <h1 ref="pageTitle" tabindex="-1">设置</h1>
        <p>管理拾学在这台设备上的显示、导航、快捷记录与数据。</p>
      </div>
      <span class="local-badge"><ShieldCheck :size="15" />本地优先</span>
    </header>

    <div class="settings-grid">
      <section id="settings-appearance" class="settings-section settings-section--wide">
        <div class="section-title"><Eye :size="18" /><div><h2>外观与显示</h2><p>更改会立即应用到当前设备。</p></div></div>
        <div class="setting-block">
          <span class="setting-label">配色方案</span>
          <div class="theme-grid" role="group" aria-label="配色方案">
            <button
              v-for="theme in themePreviews"
              :key="theme.id"
              type="button"
              class="theme-card"
              :class="{ active: themeId === theme.id }"
              :aria-pressed="themeId === theme.id"
              :style="{
                '--preview-bg': theme.preview.bg,
                '--preview-surface': theme.preview.surfaceAlt,
                '--preview-accent': theme.preview.accent,
              }"
              @click="emit('setTheme', theme.id)"
            >
              <span class="theme-swatches" aria-hidden="true"><i /><i /><i /></span>
              <span><strong>{{ theme.name }}</strong><small>{{ theme.description }}</small></span>
            </button>
            <label
              class="theme-card theme-card--custom"
              :class="{ active: themeId === 'custom' }"
              :style="{ '--preview-bg': 'var(--bg)', '--preview-surface': 'var(--surface-alt)', '--preview-accent': customPrimary }"
              @click="emit('setTheme', 'custom')"
            >
              <input :value="customPrimary" type="color" aria-label="选择自定义主色" @input="setCustomPrimary" />
              <span class="theme-swatches" aria-hidden="true"><i /><i /><i /></span>
              <span><strong>自定义</strong><small>{{ customPrimary.toUpperCase() }} · 自动协调背景与状态色</small></span>
            </label>
          </div>
        </div>
        <div class="setting-block">
          <span class="setting-label">显示模式</span>
          <div class="segmented segmented--three" role="group" aria-label="显示模式">
            <button type="button" :class="{ active: themeMode === 'system' }" :aria-pressed="themeMode === 'system'" @click="emit('setThemeMode', 'system')"><Monitor :size="17" />跟随系统</button>
            <button type="button" :class="{ active: themeMode === 'light' }" :aria-pressed="themeMode === 'light'" @click="emit('setThemeMode', 'light')"><Sun :size="17" />浅色</button>
            <button type="button" :class="{ active: themeMode === 'dark' }" :aria-pressed="themeMode === 'dark'" @click="emit('setThemeMode', 'dark')"><Moon :size="17" />深色</button>
          </div>
        </div>
      </section>

      <section id="settings-navigation" class="settings-section">
        <div class="section-title"><PanelLeft :size="18" /><div><h2>侧边栏</h2><p>桌面窗口可自由切换显示形态。</p></div></div>
        <div class="setting-block sidebar-mode-control">
          <span class="setting-label">默认显示</span>
          <div class="segmented" role="group" aria-label="侧边栏默认显示">
            <button type="button" :class="{ active: sidebarDisplayMode === 'expanded' }" :aria-pressed="sidebarDisplayMode === 'expanded'" @click="emit('setSidebarDisplayMode', 'expanded')"><PanelLeft :size="17" />展开文字</button>
            <button type="button" :class="{ active: sidebarDisplayMode === 'icons' }" :aria-pressed="sidebarDisplayMode === 'icons'" @click="emit('setSidebarDisplayMode', 'icons')"><PanelLeft :size="17" />仅图标</button>
          </div>
        </div>
        <button class="action-row" type="button" :disabled="!sidebarOrderCustomized" @click="emit('resetSidebarOrder')">
          <RotateCcw :size="18" /><span><strong>恢复默认菜单顺序</strong><small>{{ sidebarOrderCustomized ? '清除当前拖动排序结果' : '当前已使用默认顺序' }}</small></span>
        </button>
      </section>

      <section id="settings-input" class="settings-section">
        <div class="section-title"><FileJson :size="18" /><div><h2>快速新增</h2><p>控制输入解析后的默认行为。</p></div></div>
        <Switch :model-value="quickAddRemoveRecognizedText" label="移除已识别文字" description="提交时从标题中移除已确认的日期、优先级等文字" @update:model-value="emit('setQuickAddRemoveRecognizedText', $event)" />
        <div class="setting-row">
          <span><strong>默认预计时长</strong><small>只在快速新增时应用</small></span>
          <Listbox :model-value="defaultEstimateMinutes === null ? 'none' : String(defaultEstimateMinutes)" :options="estimateOptions" label="默认预计时长" variant="compact" @update:model-value="setDefaultEstimate" />
        </div>
      </section>

      <section id="settings-reminders" class="settings-section">
        <div class="section-title"><Bell :size="18" /><div><h2>提醒</h2><p>通知内容保持最少披露。</p></div></div>
        <Switch :model-value="remindersEnabled" :disabled="reminderBusy" label="任务提醒" :description="remindersAvailable ? '系统通知会显示任务标题；完成与稍后提醒在应用内操作' : '仅应用内提醒；浏览器页面保持打开时可用'" @update:model-value="emit('setReminders', $event)" />
        <button v-if="remindersAvailable" type="button" class="action-row" :disabled="reminderBusy" @click="emit('testNotification')"><Bell :size="18" /><span>测试系统通知</span></button>
        <button type="button" class="action-row" @click="emit('openReminders')"><Bell :size="18" /><span>查看任务提醒（{{ reminderCount ?? 0 }}）</span></button>
        <p v-if="reminderMessage" role="status">{{ reminderMessage }}</p>
      </section>

      <section v-if="lifecycleAvailable || autostartAvailable || deviceMessage" class="settings-section">
        <div class="section-title"><PanelLeft :size="18" /><div><h2>窗口与启动</h2><p>管理这台设备上的桌面行为。</p></div></div>
        <div v-if="lifecycleAvailable" class="setting-row">
          <span><strong>关闭窗口时</strong><small>退出拾学后不会继续发送提醒</small></span>
          <Listbox :model-value="closeBehavior ?? 'ask'" :options="closeOptions" label="关闭窗口时" variant="compact" @update:model-value="emit('setCloseBehavior', $event as PlanningPreferences['closeBehavior'])" />
        </div>
        <Switch v-if="autostartAvailable" :model-value="Boolean(autostartEnabled)" :disabled="autostartBusy" label="开机启动" description="跟随系统实际设置" @update:model-value="emit('setLaunchAtLogin', $event)" />
        <p v-if="deviceMessage" role="status">{{ deviceMessage }}</p>
      </section>

      <section id="settings-data" class="settings-section settings-section--wide">
        <div class="section-title"><Download :size="18" /><div><h2>本地数据</h2><p>备份、迁移或恢复这台设备上的记录。</p></div></div>
        <div class="data-actions">
          <button class="action-row" type="button" :disabled="!workspace" @click="emit('exportJson')"><FileJson :size="18" /><span><strong>导出 JSON 备份</strong><small>完整备份，可重新导入拾学</small></span></button>
          <button class="action-row" type="button" :disabled="!workspace" @click="emit('exportMarkdown')"><FileText :size="18" /><span><strong>导出 Markdown 阅读版</strong><small>只含完成记录，无需拾学也能阅读</small></span></button>
          <input ref="importInput" class="file-input" type="file" accept="application/json,.json" tabindex="-1" @change="selectImport" />
          <button v-if="!importFileName" class="action-row" type="button" :disabled="dataBusy || !workspace" @click="importInput?.click()"><Upload :size="18" /><span><strong>导入学习记录</strong><small>完整验证后替换本地记录</small></span></button>
          <div v-else class="confirm-row" :role="importError ? 'alert' : 'status'">
            <p><strong>{{ importFileName }}</strong><span>{{ importError || '文件已验证，确认影响后导入。' }}</span></p>
            <div><button type="button" :disabled="dataBusy" @click="clearImport">取消</button><button v-if="importPreview" type="button" :disabled="dataBusy" @click="confirmReset = false; importOpen = true">查看导入摘要</button><button type="button" :disabled="dataBusy" @click="importInput?.click()">重新选择</button></div>
          </div>
          <button class="action-row" type="button" :disabled="dataBusy || !workspace" @click="openReset"><RotateCcw :size="18" /><span><strong>恢复演示内容</strong><small>替换为拾学的初始学习路线</small></span></button>
        </div>
      </section>

      <section v-if="cloudAvailable" id="settings-cloud" class="settings-section settings-section--wide">
        <div class="section-title"><Cloud :size="18" /><div><h2>可选云同步</h2><p>本地记录始终是事实源。</p></div></div>
        <div v-if="cloudEmail && cloudStatus !== 'signed-out'" class="cloud-session">
          <p><strong>{{ cloudStatus === 'syncing' ? '正在同步…' : cloudStatus === 'failed' ? '同步需要重试' : '已安全登录' }}</strong><small>{{ cloudEmail }}</small></p>
          <div><button type="button" :disabled="cloudStatus === 'syncing'" @click="emit('cloudSync')">立即同步</button><button type="button" class="danger" :disabled="cloudStatus === 'syncing'" @click="emit('cloudSignOut')">退出账号</button></div>
        </div>
        <form v-else class="cloud-form" @submit.prevent="signIn">
          <p>登录令牌只保存在系统钥匙串，不写入 WebView 存储。</p>
          <label><span>邮箱</span><input v-model="cloudEmailDraft" type="email" autocomplete="username" required /></label>
          <label><span>密码</span><input v-model="cloudPassword" type="password" autocomplete="current-password" required /></label>
          <button type="submit" :disabled="!cloudEmailDraft.trim() || !cloudPassword">登录并同步</button>
        </form>
        <p v-if="cloudMessage" class="cloud-message" :class="{ error: cloudStatus === 'failed' }" role="status">{{ cloudMessage }}</p>
      </section>
    </div>

    <p class="privacy">拾学默认只把学习内容保存在这台设备上。只有显式配置并登录可选云同步时，学习快照才会发送到所选项目。</p>
    </main>

    <Dialog v-model:open="importOpen" title="替换本地记录？" description="导入会替换全部本地记录，建议先导出备份。" role="alertdialog">
      <template v-if="importPreview">
        <p>当前：{{ currentSummary }}</p>
        <p>导入后：{{ importPreview.summary }}</p>
        <p>备份日期：{{ new Date(importPreview.exportedAt).toLocaleString() }}</p>
        <p>数量包含已归档、已删除的记录；专注会话、事件和提醒也会一并替换。</p>
        <p v-if="importError" role="alert">{{ importError }}</p>
      </template>
      <template #footer>
        <Button variant="secondary" :disabled="dataBusy" @click="clearImport">取消</Button>
        <Button variant="danger" :disabled="!importPreview || !workspace || dataBusy" @click="confirmImport">{{ dataBusy ? '正在导入…' : '确认导入' }}</Button>
      </template>
    </Dialog>
    <Dialog v-model:open="confirmReset" title="覆盖本地记录？" description="全部记录会被拾学的初始演示内容替换，建议先导出备份。" role="alertdialog">
      <p>将被替换：{{ currentSummary }}</p>
      <p>数量包含已归档、已删除的记录；专注会话、事件和提醒也会一并替换。</p>
      <p v-if="resetError" role="alert">{{ resetError }}</p>
      <template #footer>
        <Button variant="secondary" :disabled="dataBusy" @click="confirmReset = false">继续保留</Button>
        <Button variant="danger" :disabled="!workspace || dataBusy" @click="resetDemo">{{ dataBusy ? '正在恢复…' : '确认恢复' }}</Button>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.settings-view { width: min(100%, 1100px); min-height: 100%; display: grid; grid-template-columns: 224px minmax(0, 1fr); margin: 0 auto; }
.settings-navigation { position: sticky; top: 0; align-self: start; max-height: 100dvh; overflow-y: auto; padding: 28px 16px; border-right: 1px solid var(--glass-border); background: var(--material-thin); box-shadow: var(--glass-highlight); -webkit-backdrop-filter: var(--glass-filter); backdrop-filter: var(--glass-filter); }
.settings-navigation > strong { display: block; padding: 0 10px 18px; font-size: var(--text-lg); font-weight: 650; }
.settings-navigation nav { display: grid; gap: 3px; }
.settings-navigation a { min-height: 42px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border-radius: var(--radius-md); color: var(--muted); font-size: var(--text-sm); text-decoration: none; }
.settings-navigation a:hover, .settings-navigation a:focus-visible { outline: 0; background: var(--control-fill); color: var(--text); }
.settings-content { width: min(100%, 820px); min-width: 0; margin: 0 auto; padding: 28px 28px 80px; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-6); margin-bottom: var(--space-8); }
.page-header h1 { margin: 0; font-size: 26px; line-height: 1.25; font-weight: 650; letter-spacing: -.025em; }
.page-header p { margin: 7px 0 0; color: var(--muted); font-size: var(--text-base); line-height: 1.55; }
.local-badge { min-height: 32px; display: inline-flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-full); background: var(--control-fill); color: var(--accent); font-size: var(--text-xs); white-space: nowrap; }
.settings-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
.settings-section { min-width: 0; scroll-margin-top: 20px; padding: 20px; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); }
.settings-section--wide { grid-column: 1 / -1; }
.section-title { display: flex; align-items: flex-start; gap: var(--space-3); padding-bottom: var(--space-4); border-bottom: 1px solid var(--hairline); }
.section-title > svg { flex: 0 0 auto; margin-top: 2px; color: var(--accent); }
.section-title h2 { margin: 0; font-size: var(--text-lg); line-height: 1.4; font-weight: 650; }
.section-title p { margin: 3px 0 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
.setting-block { padding-top: var(--space-4); }
.setting-label { display: block; margin-bottom: var(--space-2); color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
.theme-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.theme-card { position: relative; min-width: 0; min-height: 112px; display: flex; flex-direction: column; align-items: stretch; gap: var(--space-3); padding: var(--space-3); overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); outline: 0; background: var(--control-fill); color: var(--text); text-align: left; cursor: pointer; transition: border-color var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease); }
.theme-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.theme-card.active { border-color: var(--accent); background: var(--surface); box-shadow: var(--focus-ring); }
.theme-card:focus-visible, .theme-card--custom:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.theme-card > span:last-child { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.theme-card strong { overflow: hidden; font-size: var(--text-sm); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.theme-card small { display: -webkit-box; overflow: hidden; color: var(--muted); font-size: var(--text-xs); line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.theme-swatches { height: 34px; display: grid; grid-template-columns: 1.5fr 1fr 1fr; overflow: hidden; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--preview-bg); }
.theme-swatches i { background: var(--preview-bg); }
.theme-swatches i:nth-child(2) { background: var(--preview-surface); }
.theme-swatches i:nth-child(3) { background: var(--preview-accent); }
.theme-card--custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.segmented { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1); padding: var(--space-1); border-radius: var(--radius-lg); background: var(--control-fill); }
.segmented--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.segmented button { min-height: 40px; display: flex; align-items: center; justify-content: center; gap: var(--space-2); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted); font-size: var(--text-sm); }
.segmented button.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
.setting-row, .action-row { width: 100%; min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) 2px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--text); text-align: left; }
.setting-row > span, .action-row > span { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.setting-row strong, .action-row strong { font-size: var(--text-base); font-weight: 600; }
.setting-row small, .action-row small { color: var(--muted); font-size: var(--text-xs); line-height: 1.45; }
.setting-row :deep(.listbox) { width: 142px; flex: 0 0 142px; }
.action-row { justify-content: flex-start; cursor: pointer; }
.action-row > svg { flex: 0 0 auto; color: var(--accent); }
.action-row:hover { color: var(--accent); }
.action-row:disabled { cursor: default; opacity: .5; }
.data-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--space-6); }
.file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.confirm-row { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); padding: var(--space-4) 0; border-bottom: 1px solid var(--border); }
.confirm-row p { min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); margin: 0; }
.confirm-row p strong { color: var(--danger); font-size: var(--text-base); }
.confirm-row p span { color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
.confirm-row > div, .cloud-session > div { display: flex; gap: var(--space-2); }
.confirm-row button, .cloud-session button, .cloud-form > button { min-height: 38px; padding: 0 var(--space-4); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--control-fill); color: var(--text); font-size: var(--text-sm); font-weight: 600; white-space: nowrap; }
.danger { color: var(--danger) !important; }
.cloud-session { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); padding-top: var(--space-4); }
.cloud-session p { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; }
.cloud-session strong { color: var(--accent); font-size: var(--text-base); }
.cloud-session small, .cloud-message { color: var(--muted); font-size: var(--text-xs); }
.cloud-form { display: grid; grid-template-columns: 1fr 1fr auto; align-items: end; gap: var(--space-3); padding-top: var(--space-4); }
.cloud-form > p { grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: var(--text-xs); }
.cloud-form label span { display: block; margin-bottom: var(--space-2); font-size: var(--text-xs); font-weight: 600; }
.cloud-form input { width: 100%; min-height: 40px; padding: 0 var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); outline: 0; background: var(--control-fill); color: var(--text); font-size: var(--text-base); }
.cloud-form input:focus { border-color: var(--accent); box-shadow: var(--focus-ring); }
.cloud-form > button { border: 0; background: var(--accent); color: var(--accent-text); }
.cloud-form > button:disabled { opacity: .4; }
.cloud-message { margin: var(--space-3) 0 0; }.cloud-message.error { color: var(--danger); }
.privacy { margin: var(--space-8) var(--space-1) 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.65; }
@media (max-width: 819px) {
  .settings-view { width: 100%; display: block; }
  .settings-navigation { display: none; }
  .settings-content { width: 100%; padding: var(--space-5) var(--screen-inline) calc(118px + env(safe-area-inset-bottom, 0px)); }
  .page-header { margin-bottom: var(--space-6); }.page-header h1 { font-size: 24px; }.page-header p { max-width: 240px; }.local-badge { display: none; }
  .settings-grid { grid-template-columns: 1fr; gap: var(--space-4); }.settings-section--wide { grid-column: auto; }
  .settings-section { padding: var(--space-4); }
  .theme-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .data-actions { grid-template-columns: 1fr; }.confirm-row, .cloud-session { align-items: stretch; flex-direction: column; }.confirm-row > div, .cloud-session > div { justify-content: flex-end; }
  .cloud-form { grid-template-columns: 1fr; }.cloud-form > p { grid-column: auto; }
}
@media (max-width: 420px) { .setting-row { align-items: stretch; flex-direction: column; }.setting-row :deep(.listbox) { width: 100%; flex-basis: auto; }.segmented button { gap: var(--space-1); font-size: var(--text-xs); }.theme-grid { grid-template-columns: 1fr; } }

.settings-navigation > strong, .page-header h1, .section-title h2 { font-weight: var(--font-semibold); }
.theme-card strong, .setting-row strong, .action-row strong { font-weight: var(--font-medium); }
.setting-row, .action-row { padding-inline: var(--space-3); border: 0; border-radius: var(--radius-lg); }
.setting-row:hover, .action-row:hover { background: color-mix(in srgb, var(--control-fill) 70%, transparent); }
.data-actions { gap: var(--space-1) var(--space-2); }
</style>
