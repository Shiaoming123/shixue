# 拾学主题系统：颜色审计与改造边界

> 审计基线：`exp/soft-surface-ui`，实现主题自定义前。范围仅含 `src/**/*.vue|css|ts`。

## 1. 现状与颜色使用

扫描命令：

```powershell
rg -n -o --no-heading '#[0-9A-Fa-f]{3,8}\b|rgba?\s*\([^)]*\)|hsla?\s*\([^)]*\)' src -g '*.vue' -g '*.css' -g '*.ts'
```

共命中 130 个字面颜色，分布如下：

| 位置 | 数量 | 判断 |
| --- | ---: | --- |
| `src/assets/themes/index.ts` | 113 | 5 套主题的 light/dark 色板及变量落地回退值，属于主题源数据 |
| `src/assets/themes/global.css` | 15 | 首屏默认语义色 11 个、阴影颜色 4 个，属于启动回退和结构令牌 |
| `src/agent/ui/ChatPanel.vue` | 1 | 停止按钮文字 `#fff`，属于组件硬编码 |
| `src/components/ui/Button.vue` | 1 | `var(--danger-text, #fff)`，属于组件回退硬编码 |

因此组件层已经基本使用语义变量；真正需要迁移的颜色泄漏只有两个白色回退。`transparent`、`currentColor`、`color-mix()` 以及强制颜色模式中的 `Canvas` / `CanvasText` / `Highlight` 是平台语义值，不计为主题色硬编码。

核心令牌当前引用量也说明主题变量已是稳定接缝：`--muted` 199 次、`--accent` 184 次、`--text` 105 次、`--surface` 90 次、`--hairline` 94 次、`--control-fill` 80 次、`--border` 74 次。无需逐组件重写，只需完善主题源与状态入口。

现有能力：

- `ThemeTokens` 已覆盖背景、两级表面、两级文字、边界、强调色/其上文字及成功、警告、危险状态；5 套色板都同时提供 light/dark。
- `global.css` 以语义令牌派生 `--hairline`、`--control-fill`、`--press-fill`、`--focus-ring`，组件不会感知具体主题。
- `apply.ts` 能保存主题 id，并在模块初始化时读取系统深浅色。
- 设置页只有浅色/深色两个按钮，没有主题色板、自定义色或“跟随系统”。

## 2. 根因

问题不是组件缺少换肤能力，而是主题控制链路分裂：

1. `core` 模块调用 `initTheme()`，读取 `meow-study-theme` 并跟随系统；
2. `App.vue` 随后读取另一键 `meow-study-appearance`，固定调用 `applyTheme('study', …)`；
3. 设置页也只发送 light/dark，因而已存在的 ocean、forest、amber、mono 无法从产品界面选择；
4. 主题和显示模式没有统一状态结构，自定义色、迁移和系统模式无法可靠持久化；
5. 没有颜色生成与对比度校正，直接接受任意主色会产生不可读的文字/状态色。

## 3. 可落地方案

保持现有 CSS 变量接缝，只收敛主题源和状态流：

1. 将偏好统一为 `{ themeId, mode, customPrimary }`；`mode` 取 `light | dark | system`。读取时兼容旧的两个存储键，写入后只使用新结构。
2. 提供至少 7 套可区分的预设，每套继续包含 light/dark 两份完整令牌；“基础浅色”和“基础深色”是可直接选择的预设，其余覆盖蓝、绿、暖色、紫等用途。
3. 自定义主题只接收合法 hex 主色，使用一个纯函数派生辅助色、背景层级和状态色，并逐项校正对比度；不引入调色依赖或第二套组件体系。
4. 在 Vue 挂载前应用持久化偏好；运行时只在统一更新函数中写存储、更新根节点 CSS 变量，并在 `mode=system` 时响应媒体查询。
5. 设置页复用现有 section/segmented 样式，增加可键盘操作的主题色卡、三态显示模式和原生 `input[type=color]` 的定制外观入口；`input` 事件用于实时预览。
6. 主题切换只过渡 `background-color`、`border-color` 和 `color`，同时保留 `prefers-reduced-motion` 的全局关闭规则。

## 4. 令牌映射

| 语义令牌 | 组件职责 | 自定义色来源/约束 |
| --- | --- | --- |
| `--bg` | 页面底色 | 根据主色轻微染色，和 surface 保持层级 |
| `--surface` | 卡片、弹窗、主控件 | 接近中性背景，正文对比度不低于 4.5:1 |
| `--surface-alt` | 输入、hover、次级容器 | 与 surface 可辨但不过度着色 |
| `--text` | 正文 | 在 bg、surface、surface-alt 上均不低于 4.5:1 |
| `--muted` | 次要文字 | 在常用背景上均不低于 4.5:1 |
| `--border` | 边界与分隔线 | 从文字/背景混合，不承担文字信息 |
| `--accent` | 主操作、选中态 | 用户主色经对比度修正后的可用值 |
| `--accent-alt` | 辅助强调与色卡层次 | 由主色调整明度/饱和度生成 |
| `--accent-text` | 强调底上的文字 | 自动从深/浅候选中选择，至少 4.5:1 |
| `--success` / `--warning` / `--danger` | 状态文字、图标和边界 | 保留语义色相，按当前表面修正至 4.5:1 |
| `--danger-text` | 危险填充按钮文字 | 自动选择高对比前景，不再在组件内回退 `#fff` |

`--hairline`、`--material-*`、`--control-fill`、`--press-fill`、`--focus-ring` 继续由上述语义令牌派生；间距、圆角、排版、阴影尺寸、平台命中区不随主题改变。

## 5. 迁移边界

- 改主题定义、应用/持久化函数、`App.vue` 的单一状态入口和设置页；不改领域状态、任务数据或页面业务逻辑。
- 移除 `ChatPanel.vue` 与 `Button.vue` 的 `#fff`，改用完整的 `--danger-text` 令牌。
- `global.css` 保留首屏回退色，避免脚本运行前透明或默认白屏；它们必须与默认主题同步，而不是组件可消费的另一套色板。
- 不新增状态库、调色库或运行时网络资源。原生 `matchMedia`、`localStorage`、CSS 变量与颜色输入已足够。
- 自定义主题只保存用户主色和显示模式，不持久化整套派生 token，避免算法调整后产生陈旧数据。

## 6. 验证标准

- 预设主题不少于 7 套，所有预设与自定义主题都能在 light/dark/system 下切换；刷新、跨页面后选择保持一致。
- system 模式仅随 `prefers-color-scheme` 变化；显式 light/dark 不受系统切换影响。
- 正文、次要文字及填充按钮文字的 WCAG 对比度至少 4.5:1；状态色作为文字使用时同样达到 4.5:1。
- 自定义颜色输入非法值时保持上一个有效主题；连续拖动取色器时实时预览且不写入无效值。
- 首次加载在 Vue 挂载前已有正确的 `data-theme`、`data-mode` 与 CSS 变量；刷新无默认主题闪现。
- 键盘可选择色卡和模式，当前项有 `aria-pressed` 或等价选中语义，焦点可见，减少动效偏好仍生效。
- 通过主题纯函数单测、现有 `npm test` / `npm run typecheck` / `npm run build:web`，并对设置页和至少一个业务页做浅色、深色、自定义色浏览器烟测。
