# 拾学时间规划视觉合同

- 模式：`EXISTING`（基于现有拾学视觉演进）
- 状态：`LOCKED / CROSS-PLATFORM AMENDED`（桌面方向于 2026-09-04 确认；跨端设计系统于 2026-09-05 按用户要求纳入）
- 适用范围：Windows、iOS/iPadOS、Android 与 Web 的时间规划阶段六个 PR，以及后续清单、执行分析和“小拾”操作卡片
- 现有基线：`docs/design/shixue-tasks-desktop-implementation.png`、`docs/design/shixue-tasks-mobile-implementation.png`

## 1. 视觉命题

拾学是一张安静但高密度的个人规划桌：深墨文字像铅笔记录，低饱和鼠尾草绿只标记当前行动，雾灰背景与克制材质建立轻薄层次。它应像成熟的生产力工具，而不是营销网站、卡片画廊或系统控件拼装页。

记忆点是“时间脊线”：桌面任务列表与日历沿一条细窄的半透明时间轨对齐，计划块、截止标记和当前时间共用同一视觉语法；移动端这条线缩为左侧时间刻度，不牺牲任务密度。

## 2. 不可变原则

- 简约 UI 与直观 UX 优先于解释性文字。控件通过位置、标准图标、状态、占位符、悬浮提示和动效表达用途。
- 排版使用语义角色，不用一套像素值覆盖所有平台。Windows 保持 13–14px 高密度正文；iOS 使用系统 Dynamic Type，默认 Body 17/22pt；Android 默认 Body 16sp 并跟随系统字体缩放。
- 界面分为内容层与功能层：内容层承载任务和日历，保持清晰、近乎不透明；玻璃、亚克力或平台浮层材质只用于导航、工具栏、抽屉和临时控件。
- 不给每条任务套独立厚卡片。使用分区、细分隔线、行高和选中底色组织密度。
- 强调色只标记主操作、当前选择、计划块和键盘焦点；危险色仅用于不可逆动作与逾期事实。
- 文案只保留用户决策所需内容；空状态使用轻量插画、对象名称和一个主要行动，不写操作说明书。
- “跨端一致”指品牌、信息架构、术语、状态、操作优先级和组件意图一致；导航容器、字体度量、命中尺寸、系统反馈和材质遵循各平台惯例，不追求逐像素相同。

## 3. 字体与排版

业务组件只引用 `large-title / title-1 / title-2 / headline / body / callout / subheadline / footnote / caption` 等语义角色，由平台映射数值：

| 角色 | Windows | iOS/iPadOS | Android |
| --- | --- | --- | --- |
| 页面大标题 | 26/32px，600 | Large Title 34/41pt，支持折叠为 inline title | 32/40sp，600 |
| 一级标题 | 20/26px，600 | Title 1 28/34pt | 24/32sp，600 |
| 标题/强调 | 15–17/20–22px，600 | Headline 17/22pt Semibold | 16/24sp，500–600 |
| 正文 | 13–14/18–20px | Body 17/22pt | Body 16/24sp |
| 辅助信息 | 10–12/13–16px | Footnote 13/18pt；最低 11pt | 12–14/16–20sp；最低 12sp |

- iOS/iPadOS 优先系统栈 `-apple-system, BlinkMacSystemFont, PingFang SC`，不分发或嵌入 SF 字体文件。
- Windows 优先项目自带 `Manrope Variable` / `Noto Sans SC Variable`，回退到 Segoe UI 与 Microsoft YaHei UI。
- Android 优先系统 Roboto / Noto Sans CJK，Web 壳无法获得时回退到项目自带 Manrope / Noto Sans SC。
- 数字时间、日期和计时器启用 `font-variant-numeric: tabular-nums`；字号放大到 200% 时允许换行和纵向扩展，主要操作不得消失。
- 大标题只用于页面入口或明确的单一主旨；高密度 Windows 工作区继续使用紧凑标题，不为模仿移动端而放大。

## 4. 色彩、材质与层级

继续使用现有 `study` 主题与语义 token：`--bg`、`--surface`、`--surface-alt`、`--text`、`--muted`、`--border`、`--accent`、`--success`、`--warning`、`--danger`。实现层同时提供 `canvas/content/chrome/floating` 与 `label-primary/secondary/separator` 意图别名；新增组件只能引用语义，不得硬编码另一套色板。

材质层级：

1. `canvas`：雾灰窗口背景，无阴影；Windows 可映射 Mica 背景，移动端背景延伸到安全区。
2. `content`：任务/日历主面，近乎不透明，以空间和背景层级组织，分隔线作为最后手段；内容卡片禁止玻璃。
3. `chrome`：导航、工具栏、侧栏和浮动操作。iOS/iPadOS 映射为 regular Liquid Glass，并在滚动内容交界使用渐进 blur/fade 的 scroll-edge effect；Windows 映射 Mica/Acrylic；Android 映射 tonal surface/elevation，不伪造 iOS 玻璃。
4. `floating`：菜单、日期选择器、对话框和 Sheet。只有一层轮廓与一层柔和阴影；iPhone Sheet 提供 detent/grabber，iPad 优先锚定 Popover。

`clear` glass 只允许覆盖照片或视频等丰富内容，亮背景后需 35% 暗化层；拾学常规任务界面默认只用 `regular`。减少透明度时所有功能材质回退为不透明 `--surface`，减少动效时 scroll-edge 只保留静态可读分隔。

深色模式不是颜色反相：背景保持深墨灰，文字避免纯白，玻璃边缘提高亮度而非加重阴影。

## 5. 布局合同

### 桌面 1280px 以上

```text
┌──────────────┬────────────────────────────┬───────────────────┐
│ 品牌 / 搜索   │ Today · 日期      视图/筛选 │ 任务详情 / 日历日程 │
│ 收件箱        ├────────────────────────────┤                   │
│ 今天          │ 逾期                         │ 计划时间           │
│ 最近七天      │ ○ 任务行       截止 / 优先级 │ 截止 / 多提醒       │
│ 日历          │ 今天计划                      │ 重复 / 清单 / 标签   │
│ 清单分组      │ ○ 任务行       时间块         │ 检查项 / 学习能力    │
│ 学习          │ 快速新增（固定底部）           │                   │
└──────────────┴────────────────────────────┴───────────────────┘
```

- 左栏 224–248px；主区最小 480px；详情 320–380px，可关闭。
- 列表行默认 48px；含两行元信息时 64px。点击行打开详情，复选框只切换完成。
- Today 按“逾期 / 今天计划 / 今天截止 / 今天重复”分组；同一投影项只出现一次，显示多个来源标记。

### 中等窗口 820–1279px

- 左栏收为 72px 图标轨；详情改为右侧覆盖抽屉，不压缩主区低于 480px。
- 日历周视图允许横向时间轴，但页面本身不得横向滚动。

### 紧凑窗口 320–819px

- 单栏内容 + 底部玻璃导航；详情、筛选、日期与重复规则使用全宽 Sheet。
- 主要触控目标最小 44×44px；任务行可滑动但必须保留可见菜单替代。
- 虚拟键盘出现时快速新增保持可见，底部导航可暂时让位。

断点描述的是窗口尺寸而不是操作系统：iPad、Android 平板和折叠屏根据当前窗口选择 `compact / medium / expanded`，不能仅凭 User-Agent 固定成手机或桌面布局。`820px` 是当前产品的 compact/medium 边界，旧移动文档中的 `768px` 不再作为实现真相。

平台导航映射：

- Windows：expanded/medium 使用可隐藏侧栏与工具栏；指针态保留 hover、右键和键盘快捷键，所有命令也应有可见入口。
- iPhone：一级底部浮动 tab 不超过五项且只承载导航，选中图标可用填充态；大标题随滚动收为 inline title，支持系统返回手势。
- iPad：根据窗口宽度在 tab 与侧栏间转换，支持指针和外接键盘。
- Android：compact 使用 Navigation Bar，宽屏切换 Navigation Rail/Drawer；遵循系统返回和 predictive back，关键动作不能依赖返回手势才能发现。

## 6. 统一控件合同

任何用户可见控件都必须来自 `src/components/ui/`、平台适配器或经过设计系统审查的业务复合组件。禁止未经适配的浏览器默认皮肤；允许为可访问性和平台熟悉度使用经过审查的原生 picker、sheet、switch、菜单或系统能力桥接。共享组件保证语义、状态与 API 一致，不要求三个平台像素相同。

| 控件 | 必须提供 | 禁止 |
| --- | --- | --- |
| `Button` / `IconButton` | default/hover（支持时）/pressed/focus/disabled/loading，图标按钮有 tooltip 与可访问名；每视图至多一个 prominent 背景 | 无状态裸 `<button>`、危险操作作为默认主操作 |
| `TextField` / `TextArea` | label 或可访问名、placeholder、错误、只读、清除 | 以说明段落替代 label |
| `Select` / `Listbox` | 自绘触发器与列表、选中标记、方向键/Home/End/Enter/Escape、外点关闭、碰撞定位 | 可见原生 `<select>` 弹出菜单 |
| `Combobox` | 输入过滤、无结果、清除、ARIA combobox/listbox 关系 | 只支持鼠标 |
| `Checkbox` / `Radio` / `Switch` | 隐藏原生语义控件、自绘可见层、indeterminate、焦点、禁用 | 直接显示平台默认方框/开关 |
| `Menu` / `Popover` / `Tooltip` | Portal、层级 token、焦点返回、边界翻转、Escape | 被父容器裁剪、永久 tooltip |
| `Dialog` / `Sheet` | 单层模态、标题关联、初始/返回焦点、取消或撤销；iPhone detent/grabber，iPad 锚定 Popover，桌面对话框 | 用浏览器 `alert/confirm`、嵌套 Sheet、危险操作缺少取消 |
| `DatePicker` / `TimePicker` | 快捷日期、日/月/年导航、键盘网格、时区/本地时间说明、清除 | 可见默认日期/时间控件作为唯一入口 |
| `CalendarGrid` | 当前时间、拖动预览、键盘移动替代、跨日/冲突状态 | 仅靠颜色表达状态 |
| `Toast` / `InlineAlert` | 成功/错误/撤销、aria-live、可暂停超时 | 静默失败或堆叠无限增长 |
| `Scrollbar` | 桌面主题化、触控隐藏但仍可滚动 | 高对比模式下不可见 |

允许用原生 input 作为不可见语义层或系统能力桥接；可见层由拾学组件或明确的平台适配器呈现。所有 WebView 浮层共用 `OverlayManager` 管理 Portal、堆叠、外点关闭、Escape 和焦点恢复，避免各业务组件自行复制。

命中目标：Windows 指针控件通常不小于 28×28px，标准操作建议 32px；Windows 触摸模式与 iOS 不小于 44×44；Android 不小于 48×48dp。独立图标周围应保留额外呼吸空间。

图标以“语义图标名”作为共享接口：iOS 原生层映射 SF Symbols，Windows 映射 Fluent/Lucide，Android 映射 Material Symbols；WebView 当前统一使用 Lucide 且保持同一 stroke。SF 字体或 Symbol 资产不得打包到非 Apple 发行物。

App 图标跨端共享“书页 + 新芽”概念，但输出遵循平台：Apple 使用 1024×1024 分层背景/前景并准备 default、dark、clear、tinted 外观，由系统施加遮罩，源图不得预圆角；Android 使用 adaptive foreground/background 与 monochrome layer；Windows 生成对应方形/透明尺寸资产。概念图或已烘焙圆角 PNG 不能直接作为 Apple 发布母版。

## 7. 核心交互

- 快速新增只显示输入、日期、优先级、清单与提交；自然语言解析结果显示为可编辑 chips，不默认从标题删除原词。
- `N` 聚焦快速新增，`/` 聚焦搜索，`J/K` 移动选择，`E` 编辑，`Space` 完成；输入态不劫持快捷键。
- 日期、重复和提醒选择器复用同一弹层视觉与键盘语法。
- 日历拖动先显示半透明预览，释放后走能力命令；失败则回弹并显示原因。
- 单项可逆写入立即反馈并提供撤销；批量、删除、导入覆盖和系列范围修改先展示影响摘要。
- 过渡只用于空间关系：浮层淡入上移、抽屉侧滑、拖动回弹、完成勾选；不为静态装饰持续动画。
- 按压反馈按平台映射：iOS 使用约 80% opacity 或轻微 scale，不使用 ripple；Android 可使用受控 ripple/触觉；Windows 使用 hover/focus/pressed。状态不得只靠动效或触觉表达。
- iOS 权限只在首次使用相关功能时请求；Android 权限遵循系统流程；Windows 系统能力失败就地说明。三个平台均恢复上次位置和未完成上下文。

## 8. 可访问性与质量门槛

- 目标为 WCAG 2.2 AA；文本与交互控件对比度分别达到 4.5:1 与 3:1。
- 所有功能可只用键盘完成；拖拽必须有菜单或键盘替代。
- 支持 `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`。
- 320px 宽不横向溢出；200% 缩放下不丢失主要操作。
- 组件状态通过定向组件检查；代表性主流程按 Windows、iOS/iPadOS、Android 分别记录截图与交互证据。Web 窄屏截图不能替代原生模拟器或真机证据。

## 9. 跨端一致性矩阵

| 维度 | 共享不变量 | Windows | iOS/iPadOS | Android |
| --- | --- | --- | --- | --- |
| 品牌 | 鼠尾草绿是唯一主 tint；深墨/雾灰层级 | Manrope/Noto、Mica/Acrylic | 系统字体、Liquid Glass 功能层 | Roboto/Noto、tonal surface |
| 导航 | 相同目的地、顺序和术语 | Sidebar/Toolbar | iPhone Tab、iPad Sidebar | Navigation Bar/Rail |
| 反馈 | 同一状态和结果 | Hover/键盘/右键 | Press/手势/触觉 | Ripple/系统返回/触觉 |
| 模态 | 单一任务、明确关闭、危险可取消 | Dialog/Popover | Sheet/Popover | Bottom Sheet/Dialog |
| 无障碍 | 不只靠颜色/动效，语义和可见替代一致 | Narrator/高对比/全键盘 | VoiceOver/Dynamic Type | TalkBack/系统字体缩放 |

## 10. 方案冻结规则

用户已确认 `docs/design/shixue-time-planning-desktop-proposal.png` 所代表的品牌与桌面方向；2026-09-05 又明确要求将 Apple Design 原则纳入统一跨端设计系统，因此本次跨端修订视为已授权的合同补充。此后六个 PR 只能使用本文共享语义、平台映射、组件与交互；日历周视图、iOS/iPadOS 和 Android 代表流程仍需在对应实现 PR 中取得平台证据，但不得自行改换品牌或信息架构。新增模式或重大偏离仍需先更新本文件和 `VISUAL_QA.md` 并重新取得确认。
