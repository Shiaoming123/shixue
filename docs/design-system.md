# 设计系统开发指引

> 给下载 meow-starter 的 agent：你无需通读所有代码也能保持视觉与交互的一致性。这份文档讲解设计 token、组件用法、性能与可访问性惯例、性能优化建议，以及「你何时该新建一个组件」。

---

## 0. 一分钟概览

```text
src/
├── assets/themes/
│   ├── index.ts        ← 主题色板（默认 study，另含 ocean/forest/amber/mono）
│   ├── apply.ts        ← 主题持久化、跟随系统深浅色
│   └── global.css       ← 全局 reset + 结构 token（间距/圆角/字号/阴影/动效/层级）
└── components/
    ├── Icon.vue         ← Lucide 图标封装（静态注册表，构建期确定依赖）
    └── ui/
        ├── Button.vue
        ├── Input.vue
        ├── Card.vue
        ├── Badge.vue
        ├── Progress.vue
        ├── EmptyState.vue
        ├── Listbox.vue / Checkbox.vue / Switch.vue
        ├── DateTimePicker.vue
        ├── Popover.vue / Dialog.vue / Sheet.vue / ToastRegion.vue
        └── OverlayHost.vue / use-overlay.ts
```

设计系统分四层：

1. **语义色**（`--bg` / `--surface` / `--accent` / `--success` / `--warning` / `--danger` / `--text` / `--muted` / `--border`）：随主题切换，由 `applyTheme()` 动态写入 `<html>` 元素。
2. **结构 token**（`--space-*` / `--radius-*` / `--text-*` / `--font-*` / `--shadow-*` / `--motion-*` / `--z-*`）：与主题无关，在 `global.css` 里静态定义，全主题共享。
3. **材质 token**（`--hairline` / `--material-*` / `--control-fill` / `--press-fill` / `--focus-ring`）：在语义色之上构成 iOS 风格的细分隔线、半透明面板和控件状态。
4. **平台意图 token**（`--control-hit` / `--icon-hit` / `--field-min-height` / `--row-min-height` / `--font-body-*` / `--screen-inline`）：由根节点的 `data-ui-platform` 映射 Windows、iOS/iPadOS 和 Android 度量。业务组件只消费意图，不自行判断操作系统。

> **原则**：写组件时只用 CSS 变量，绝不写死颜色、字号、间距。主题负责品牌配色，平台映射负责字体、密度、材质和反馈；业务语义在各端保持一致，但不追求像素一致。

### 0.1 内容层与功能层

- `canvas/content` 是任务、列表、日历和正文所在的内容层，使用不透明或近乎不透明 surface；不能为了“高级感”把普通卡片和输入框做成玻璃。
- `chrome/floating` 是导航、工具栏、侧栏、Sheet、Popover 和临时操作所在的功能层。iOS 映射为 regular Liquid Glass 与 scroll-edge effect，Windows 映射 Mica/Acrylic，Android 映射 tonal surface/elevation。
- `clear` glass 只用于图片/视频背景上的短暂控件；亮背景后增加 35% 暗化层。减少透明度时所有功能材质关闭 blur 并回退为不透明 surface。

---

## 1. 设计 Token 速查

### 1.1 语义色（11 个）

| Token | 用途 |
|---|---|
| `--bg` | 页面/窗口整体背景 |
| `--surface` | 卡片、按钮、弹窗等"凸起"容器的背景 |
| `--surface-alt` | 次级表面（hover 态、tooltip、输入框） |
| `--text` | 正文文字 |
| `--muted` | 次要文字（hint、说明） |
| `--border` | 1px 分隔线 |
| `--accent` | 强调色（主按钮、激活态、品牌色） |
| `--accent-text` | 强调色背景上的文字（几乎总是白或黑） |
| `--success` | 成功状态 |
| `--warning` | 警告状态 |
| `--danger` | 危险状态（删除按钮、错误） |

### 1.2 结构 token（覆盖排版与节奏）

**间距**（4px 基准，命名从 1 到 12）：

| Token | 值 | 常用场景 |
|---|---|---|
| `--space-1` | 4px | 图标与文字之间的小间距 |
| `--space-2` | 8px | 内联间距、小按钮内 padding |
| `--space-3` | 12px | 卡片标题与内容间距 |
| `--space-4` | 16px | 卡片内 padding、组件间 gap |
| `--space-5` | 20px | 卡片 padding-lg |
| `--space-6` | 24px | section 间大间距 |
| `--space-8` | 32px | 页面顶部 padding |
| `--space-10` | 40px | 大块空白 |
| `--space-12` | 48px | hero 区域 |

**圆角**：

| Token | 值 | 适用 |
|---|---|---|
| `--radius-sm` | 8px | tag、小 badge |
| `--radius-md` | 10px | 小按钮、分段控件 |
| `--radius-lg` | 14px | 按钮、输入框 |
| `--radius-xl` | 20px | 内容分组、卡片 |
| `--radius-2xl` | 26px | Sheet、浮动导航 |
| `--radius-full` | 999px | 圆形（头像、dot、徽章） |

**字号**（克制：只 6 档）：

| Token | 值 | 用途 |
|---|---|---|
| `--text-xs` | 11px | hint、底部小字 |
| `--text-sm` | 12px | 标签、说明 |
| `--text-base` | 13px | 按钮、次要正文 |
| `--text-md` | 14px | 卡片标题、正文 |
| `--text-lg` | 16px | 主区顶栏标题 |
| `--text-xl` | 20px | 页面主标题 |

**字重**（正文使用 token，产品页标题可使用系统字体的可变字重）：

| Token | 值 | 用途 |
|---|---|---|
| `--font-regular` | 400 | 正文、placeholder |
| `--font-medium` | 500 | 按钮、标题、强调 |

> 正文和普通控件优先使用 400 / 500；标题可在 550–650 之间建立清晰层级，避免大面积使用 700。

**字体**（离线随应用分发）：

| Token | 字体栈 | 用途 |
|---|---|---|
| `--font-sans` | Manrope Variable → Noto Sans SC Variable → Segoe UI Variable → Segoe UI → PingFang SC → Microsoft YaHei UI → sans-serif | 正文、控件、中英文混排 |
| `--font-display` | Manrope Variable → Noto Sans SC Variable → Segoe UI Variable → Segoe UI → PingFang SC → Microsoft YaHei UI → sans-serif | 页面标题、面板标题 |

Manrope 和 Noto Sans SC 均以 SIL Open Font License 1.1 发布。字体通过 Fontsource 包本地加载，不依赖在线字体服务；发行产物同时包含 `third-party-font-licenses.txt`。保留系统字体回退，确保字体资源异常时界面仍可读。

**阴影**（三层叠加）：

| Token | 值 | 适用 |
|---|---|---|
| `--shadow-sm` | 细描边 + 1px 轻投影 | 分段控件、列表分组 |
| `--shadow-md` | 双层低对比投影 | 主任务、复习卡片 |
| `--shadow-lg` | 大范围柔和投影 | Sheet、抽屉、浮动导航 |

**动效**（一致节奏）：

| Token | 值 | 适用 |
|---|---|---|
| `--motion-fast` | 140ms | hover / focus 微反馈 |
| `--motion-base` | 220ms | 卡片展开、面板切换 |
| `--motion-slow` | 360ms | 模态层进入 |
| `--ease` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | 标准缓动 |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Sheet、抽屉轻弹性进入 |

**层级**：

| Token | 值 | 适用 |
|---|---|---|
| `--z-base` | 1 | 一般浮起 |
| `--z-sticky` | 100 | 顶栏、侧栏 |
| `--z-overlay` | 200 | dropdown、tooltip |
| `--z-modal` | 300 | 模态对话框 |
| `--z-toast` | 400 | 全局提示 |

### 1.3 平台意图 token

| Token | Windows/细指针 | iOS/iPadOS | Android | 用途 |
| --- | --- | --- | --- | --- |
| `--control-hit` | 32px | 44px | 48px | 常规交互命中高度 |
| `--icon-hit` | 28px | 44px | 48px | 独立图标按钮命中区 |
| `--field-min-height` | 40px | 44px | 48px | 字段与选择器 |
| `--row-min-height` | 40px | 48px | 48px | 列表行基础高度 |
| `--font-body-size/leading` | 13/18px | 17/22px | 16/24px | 平台正文角色 |
| `--screen-inline` | 28px | 16px | 16px | 紧凑页面边距 |

入口在挂载 Vue 前设置 `data-ui-platform=windows|macos|linux|ios|android|web` 和 `data-input=fine|coarse`。它们只控制表现，不授予任何 Tauri 权限。iPadOS 的桌面 UA 通过 `MacIntel + maxTouchPoints` 识别为 iOS；真正的能力可用性仍以运行时 capability 为准。

字体映射：iOS/iPadOS 使用系统字体与 PingFang SC，不打包 SF；Android 使用 Roboto/Noto；Windows 保留 Manrope/Noto/Segoe 品牌栈。Lucide 是当前 WebView 的统一图标实现，原生壳可把同一语义图标名映射为 SF Symbols、Fluent 或 Material Symbols。

---

## 2. 组件用法

所有组件用 Vue 3 `<script setup lang="ts">` 写法，单文件 SFC，scoped 样式。

### 2.1 Button

```vue
<Button variant="primary" @click="save">保存更改</Button>
<Button variant="ghost" size="sm">取消</Button>
<Button variant="danger" :disabled="busy">删除</Button>
```

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `variant` | `primary` / `secondary` / `ghost` / `danger` | `secondary` | 视觉变体 |
| `size` | `sm` / `md` | `md` | 尺寸 |
| `disabled` | boolean | `false` | 禁用 |
| `type` | `button` / `submit` | `button` | 原生 type |

**写法约定**：按钮文案用祈使句（"保存"、"删除"、"开始对话"），不用名词短语。

每个视图最多一个填充强调色的主按钮。iOS 按压使用 opacity/轻微 scale 且无 ripple；Android 可以由平台适配器使用受控 ripple；Windows 保留 hover、focus 和 pressed。危险操作不能成为默认主操作，并始终提供取消或撤销。

### 2.2 Input

```vue
<Input v-model="title" label="待办标题" placeholder="说点什么…" />
```

| Prop | 类型 | 说明 |
|---|---|---|
| `v-model` | string | 双向绑定 |
| `label` | string | 顶部标签 |
| `placeholder` | string | 占位文案 |

### 2.3 Card

```vue
<Card title="数据层" padding="lg">…内容…</Card>
<Card padding="md">
  <template #title>自定义标题</template>
  <template #action><Button>操作</Button></template>
  …内容…
</Card>
```

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `title` | string | — | 卡片标题（可选） |
| `padding` | `sm` / `md` / `lg` | `md` | 内边距档位 |
| `flat` | boolean | `false` | 去掉阴影（用于视觉分组更轻的场景） |

**何时用 Card**：任何需要"区分上下文"的块（数据列表、设置项、统计、demo 等）。**不要**对每个 div 都套 Card——会显得支离破碎。

### 2.4 Badge

```vue
<Badge>默认</Badge>
<Badge tone="success">已完成</Badge>
<Badge tone="warning">待处理</Badge>
<Badge tone="danger">失败</Badge>
<Badge tone="accent">进行中</Badge>
```

`tone` 对应 5 种语义色。用 Badge 标记状态（短小文字），不要当按钮用。

### 2.5 Progress

```vue
<Progress :value="percent" />
<Progress indeterminate />
```

确定性进度（百分比已知）传 `value`；不确定时（加载中、不知何时结束）用 `indeterminate`，会显示横向滑动动画。

### 2.6 EmptyState

```vue
<EmptyState
  icon="clipboard-list"
  title="还没有数据"
  description="添加一条待办，体验 SQLite 的本地持久化能力。"
>
  <Button variant="primary" @click="add">添加第一条</Button>
</EmptyState>
```

**空状态是邀请行动**：写清「这是什么」+「怎么开始」。永远不要写"暂无数据"这种让用户摸不着头脑的句子。

### 2.7 Icon（静态注册表）

```vue
<Icon name="settings" :size="16" />
<Icon name="folder-open" :size="18" />
<Icon name="CircleCheck" :size="14" class="text-success" />
```

名称支持 PascalCase、kebab-case、空格或下划线（自动转换）。默认注册表只包含模板实际使用的 5 个图标；需要其他 Lucide 图标时，在 `src/assets/icons/registry.ts` 增加静态 import 和映射。图标名未注册会在控制台 warn，不会抛错导致白屏。

### 2.8 统一选择、日期与布尔控件

```vue
<Listbox v-model="sort" :options="sortOptions" label="排序" />
<Checkbox v-model="selected" accessible-label="选择这项任务" />
<Switch v-model="reminders" label="到期与复习提醒" description="只发送到期数量" />
<DateTimePicker v-model="plannedOn" label="计划日期" />
<DateTimePicker v-model="reminderAt" mode="datetime" label="提醒时间" />
```

- `Listbox` 的 `options` 使用 `{ value, label, disabled? }`；它提供方向键、Home / End、Enter / Space、Escape 和外点关闭。
- `Checkbox` 与 `Switch` 保留 `.ui-native-underlay` 原生语义层，页面上只显示主题化外观。
- `DateTimePicker` 的日期值为本地 `YYYY-MM-DD`，日期时间值为本地 `YYYY-MM-DDTHH:mm`；日期、时间和日历数字均使用等宽数字。`datetime` 模式明确按当前设备本地时间解释。

### 2.9 浮层与提示

应用根部只挂载一次 `<OverlayHost />`。`Popover`、`Dialog`、`Sheet` 与 `ToastRegion` 会传送到这个宿主；业务组件不要再创建新的 Portal 根节点。

```vue
<Popover v-model:open="open">
  <template #trigger="{ triggerProps }"><button v-bind="triggerProps">打开</button></template>
  <div>浮层内容</div>
</Popover>

<Dialog :open="confirming" title="确认操作？" role="alertdialog" @close="confirming = false">
  <template #footer>…确认与取消按钮…</template>
</Dialog>

<ToastRegion :message="notice" action-label="撤销" @action="undo" @dismiss="notice = ''" />
```

`use-overlay.ts` 统一维护浮层顺序、Escape、外点策略和关闭后的焦点返回。`Dialog` 与 `Sheet` 负责各自的焦点陷阱；普通 `Popover` 的桌面 panel 使用有名称的非模态 `dialog`，菜单型 Popover 由内部 `menu` 提供语义，紧凑视口的 adaptive Sheet 使用有名称的模态 `dialog`。每个共享 panel 只拥有一层 dialog 语义。`ToastRegion` 在悬浮或键盘焦点进入时暂停超时。

带操作（例如“撤销”）的 Toast 不自动消失，并必须有明确关闭按钮；纯状态 Toast 才可短时自动关闭。业务抽屉与移动面板必须复用共享 `Sheet`；提醒、重复和任务编辑器只提供业务内容，不得各自复制 backdrop、焦点或嵌套 dialog 语义。

---

## 3. 添加新主题

只改 `src/assets/themes/index.ts`，在 `themes` 数组里加一项：

```ts
{
  id: 'mint',          // 唯一 id，用于持久化存储
  name: '薄荷青',       // 显示名
  description: '…',     // 主题选择器里的副标题
  light: { bg, surface, surfaceAlt, text, muted, border, accent, accentText, success, warning, danger },
  dark:  { ...同上 },
}
```

> 结构 token（间距、字号、动效）**不属于主题**。如果你想为某个场景定制更大字号，去 `global.css` 改 `--text-xl` 即可，主题会自动跟随。

主题切换立即生效，自动持久化到 `localStorage`（key=`meow-study-theme`），并跟随系统深浅色（`prefers-color-scheme`）。

---

## 4. 添加新组件

### 什么时候新建组件？

- 在两个或更多地方出现，且每次都是相同或相似的样式 → 抽组件
- 包含交互状态（hover、active、disabled、loading）→ 必抽组件
- 一段 HTML + 一段 CSS + 一段 JS 三者绑在一起 → 抽组件

### 新建步骤

1. **文件名**：单文件 SFC，放在 `src/components/ui/` 下，PascalCase 命名（`Tooltip.vue`、`Avatar.vue`）。
2. **Token 优先**：所有色、间距、圆角、字号、动效一律用 CSS 变量，**绝不写死**。
3. **样式 scoped**：组件内样式只影响组件本身；用 `:deep()` 穿透到子组件。
4. **Props 类型化**：用 `withDefaults(defineProps<{…}>(), { … })`。
5. **emit 显式**：`defineEmits<{ name: [payload: T] }>()`。
6. **可访问性**：交互元素有可见焦点（`focus-visible` 全局已配）；有 label；icon-only 按钮配 `title`。
7. **动效**：用 `--motion-*` + `--ease`，并在 `@media (prefers-reduced-motion: reduce)` 下自动缩短（已全局配）。

### 反模式（不要这样做）

```vue
<!-- 颜色硬编码 -->
<button style="background: #2f6feb">…</button>

<!-- 字号硬编码 -->
<p style="font-size: 14px">…</p>

<!-- 间距硬编码 -->
<div style="margin-top: 24px">…</div>

<!-- 不需要的 props 全开 -->
<Button :variant="x" :size="y" :loading="x" :disabled="x" :icon="x" @click="x">…</Button>

<!-- 装饰性元素加边框加阴影堆三层 -->
<div style="border: 1px solid; box-shadow: 0 0 0 1px, 0 4px 12px rgba">…</div>
```

---

## 5. 性能优化建议

### 5.1 图标按需注册

`Icon` 组件通过小型静态注册表加载图标，让 Vite 能在构建时确定真实依赖。不要导入 Lucide 的全量图标映射；新增图标时只导入需要的组件：

```vue
<script setup lang="ts">
import { Search, Settings as SettingsIcon } from '@lucide/vue'  // 同步，但只你用到的
</script>
```

### 5.2 组件代码分割（路由级别）

如果以后加 `vue-router`，用 `() => import('./pages/TodoList.vue')` 做路由级懒加载。Tauri WebView 不需要 SEO，可以放心首屏只加载主框架。

### 5.3 流式响应

AI 类应用（Vercel AI SDK 等）建议：
- 流式 UI：把 `for await` 拿到的事件直接 append 到响应式变量，而不是等完整结果一次性渲染
- 工具调用：`onToolCall` 事件单独展示在「工具调用卡片」中，不要塞进主消息流
- 长会话：实现消息压缩（保留最近 N 轮 + 早期摘要），别无上限累加

### 5.4 SQLite 索引

数据量上来后，**索引先行**：在 Rust 侧 `db.rs` 的迁移中加 `CREATE INDEX IF NOT EXISTS ...`，不要等发现慢再加。

---

## 6. 可访问性底线

- 键盘 `Tab` 可遍历所有交互元素，`focus-visible` 有可见焦点环（2px accent 边）
- `prefers-reduced-motion: reduce` 自动把所有动效缩短到 0.01ms（全局 CSS 已配）
- 颜色对比度：主题需同时校验浅色与深色模式；高对比度偏好会自动加强分隔线
- `prefers-reduced-transparency` 会把半透明材质回退为不透明 surface
- 移动端使用 `100dvh` 与顶部/底部 safe-area，避免刘海、任务栏和虚拟键盘遮挡
- Tauri 窗口最小尺寸为 800×560；响应式壳仍以 819/820 和 1279/1280 为精确边界，内容不得靠强制缩放隐藏溢出
- Web 固定视口、ARIA 与键盘自动化不等同于 Windows 原生证据；v0.3.0 精确本地候选的安装应用验收已单独通过，200% 系统缩放、Narrator 和原生高对比验收保持 `NOT_RUN`

---

## 7. 与脚手架其他能力的衔接

- **数据**：先定义小型领域 Store 接口，再分别实现 Tauri SQLite、Web IndexedDB 和内存测试适配器；参考 `src/storage/todos/`。
- **设置项**：用 `tauri-plugin-store` 持久化用户偏好（主题已经存在 localStorage，可以改造到 store）。
- **Agent（Preview）**：`src/agent/` 提供 Vercel AI SDK inline 适配器并默认关闭；启用前请完成 Provider 与安全代理验证。需要演示 UI 时可在业务入口显式引入 `ChatPanel.vue`。

---

## 8. 文件结构约定（保持整洁）

新增功能时按以下分类放：

| 内容类型 | 放哪 |
|---|---|
| 可复用 UI 组件 | `src/components/ui/` |
| 业务专属组件 | `src/components/`（根目录，自子子自己用） |
| 业务逻辑（无 UI） | `src/lib/` |
| 类型定义 | 与使用方同目录，或单独 `src/types/` |
| 静态资源 | `src/assets/` |
| Agent 能力 | `src/agent/`（按 `runtime/` `providers/` `tools/` `memory/` `hooks/` `ui/` 分子目录） |

---

## 9. 一句话提醒

> **写组件时只用 CSS 变量；写完后问自己：这个组件如果换主题，还能保持一致好看吗？**
>
> 如果答案是「能」，说明你用对了 token。
> 如果答案是「不行」，找一找哪个值被硬编码了。
