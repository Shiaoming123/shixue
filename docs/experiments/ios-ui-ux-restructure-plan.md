# 拾学 iOS 风格 UI/UX 重构调研与方案

- 状态：`AUTHORIZED / IMPLEMENTATION STARTED`
- 调研日期：2026-09-10（Asia/Shanghai）
- 代码基线：`origin/main@3c3119076d2f5f22ab9d7681c0ef9b4cdd9e1222`
- 范围：视觉层、信息层级、导航与交互组件；保持能力服务、数据模型、命令语义、重复任务作用域、学习完成证据链和持久化边界不变
- 证据：Apple 官方 HIG、WWDC 官方设计讲座、Apple Design Resources、当前源码与本轮 Web 代表流程截图

## 1. 结论

拾学不需要再增加一套组件或给全部卡片套玻璃。当前代码已经有 Button、Dialog、Sheet、Popover、Toast 与统一 OverlayHost，真正的问题是业务页面仍绕过底座、同一动作使用不同样式、导航层级偏多、列表依赖外框和分隔线建立层次、移动端在一个页面里同时出现品牌栏、页面栏、工具栏和底栏。

本轮重构采用三个原则：

1. **内容优先**：任务、学习记录和日历是稳定的内容层；导航与临时操作才进入功能层。
2. **语义统一**：同一动作只保留一种组件语法；字号、间距、圆角、阴影按语义角色使用，不由页面自行决定。
3. **入口减负**：顶层导航只表达稳定领域，当前页动作进入工具栏，低频动作进入 More，重复的管理入口合并到一个来源。

用户于 2026-09-10 明确授权本轮全新设计覆盖现有组件布局与界面排版约束；本文件与 `DESIGN.md` 顶部的重构覆盖合同共同构成实现依据。业务语义与数据边界仍保持不变。

## 2. Apple 官方规则与项目决策

下表刻意区分 Apple 明文指导与拾学建议值。Apple 没有规定所有 App 都采用统一 8 pt 网格、16 pt 页边距、12 pt 圆角或某组 CSS 阴影。

| 维度 | Apple 官方指导 | 拾学项目决定 |
| --- | --- | --- |
| 布局 | 尊重 safe area、系统 margin 与 layout guide；根据可用空间、窗口、Dynamic Type、本地化和键盘适配，而不是只看设备型号。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 保留 320 / 820 / 1280 三档窗口策略；背景可延伸，文字与操作留在安全可达区域。紧凑页横向内边距 16，常规 20–24，桌面 28–32。 |
| 信息层级 | 重要信息位于阅读顺序起点；用对齐、留白、材料或分隔表达分组；次要信息渐进披露。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 页面只保留一个主标题；任务标题为第一层，日期/清单/状态为第二层，审计与同步事实进入详情或设置。 |
| 控件尺寸 | 当前 HIG Accessibility 表列 iOS/iPadOS 默认控件 44×44 pt、最小 28×28 pt；Apple 另建议有 bezel 元素周围约 12 pt、无 bezel 元素周围约 24 pt 空间。[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | 拾学触摸热区统一不小于 44×44；图标可小于热区。日历格和密集工具栏也不降低可点面积。 |
| 圆角 | 圆角应与外层容器、设备或窗口形成同心关系；系统组件随尺寸和上下文变化。[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) | `8 / 12 / 16 / 22 / pill` 五档；嵌套半径遵循外层半径减内边距，不给所有内容加 24 px 大圆角。 |
| 材质 | Liquid Glass 是内容之上的导航/控制功能层，不用于内容层；大多数情况用 regular，clear 留给照片/视频等丰富背景。[Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | iOS/iPadOS 的 tab、toolbar、popover、sheet chrome 可映射 regular glass；任务行、列表、记录正文保持不透明。Web/Windows 使用可降级的语义材质，不伪造光学折射。 |
| 阴影 | 官方强调阴影随浮起关系和玻璃环境变化，没有一组全局 CSS 参数。[Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) | 内容层默认无阴影；popover/sheet/dialog 只用一层低透明度浮层阴影。选中态用背景或描边，不用加深阴影。 |
| 字体 | iOS/iPadOS 使用 SF Pro 系统字体；优先系统 text styles，支持 Dynamic Type、Bold Text 和最大辅助字号，避免小字号轻字重。[Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | iOS 用系统栈与 PingFang SC；Web/Windows 继续合法的 Manrope/Noto Sans SC 回退。组件只引用语义字级。 |
| 色彩 | 使用语义色，适配浅色、深色和 Increase Contrast；不能只靠颜色表达状态；小文本通常按 4.5:1、较大/粗体按 3:1 检查。[Color](https://developer.apple.com/design/human-interface-guidelines/color) · [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | 蓝色只表达主要交互/选择，成功、警告、危险均配文字或图标；每个视图最多一个填充式主动作。 |
| 导航 | Tab bar 只承载顶层导航并保持稳定；当前页操作属于 toolbar；iPad 可在 tab 和 sidebar 之间适配。[Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | 桌面和紧凑端共享五个核心领域；“最近 7 天”和“已完成”降为智能清单，不再占桌面一级入口。 |
| 弹层 | Popover 用于少量、与触发源相关的临时任务，紧凑宽度改用 sheet；sheet 承载范围明确的短任务；alert 只用于重要且可行动的中断。[Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers) · [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) · [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts) | 所有业务浮层复用现有 OverlayHost；按任务类型选择容器，禁止页面自行复制 backdrop、焦点陷阱和 footer。 |

### 2.1 iOS 字体基线

以下是 Apple 当前默认 Large 内容尺寸下的字号/行高，必须通过 Dynamic Type 语义映射，不应硬编码后停止缩放：

| 角色 | iOS 字号/行高 | 拾学用途 |
| --- | --- | --- |
| Large Title | 34/41 pt | iPhone 顶层页首，滚动后折叠 |
| Title 1 | 28/34 pt | 复杂编辑或学习阶段标题 |
| Title 2 | 22/28 pt | 桌面/紧凑页面标题 |
| Title 3 | 20/25 pt | 弹层与分组标题 |
| Headline | 17/22 pt Semibold | 任务标题、关键标签 |
| Body | 17/22 pt | 正文、表单值 |
| Callout | 16/21 pt | 次级动作、摘要 |
| Subheadline | 15/20 pt | 元信息 |
| Footnote | 13/18 pt | 辅助说明 |
| Caption 1 / 2 | 12/16、11/13 pt | 非关键标注；不得承载主要事实 |

## 3. 当前界面诊断

本轮在干净 `main` 上重跑 `scripts/smoke-soft-surface.mjs`，覆盖 1440×960、390×844、320×740 的浅色/深色、17 个页面或状态、创建任务、重载、编辑、日期选择、专注、证据完成、200% CSS zoom 与 reduced motion。六组均通过且浏览器控制台无错误。它证明当前流程可用，但 WebView 截图不是原生 iOS、VoiceOver 或真机证据。

### 3.1 主要问题

1. **移动端 chrome 过多**：品牌栏、页面标题、三枚页内动作、快速新增、搜索框和底部 tab 同时占据首屏。视觉焦点被多组横向控件分散。
2. **列表被大卡片包裹**：任务行本身已用分隔线与状态色组织，又被 24 px 大圆角容器包裹，层级重复，留给标题的宽度减少。
3. **详情 Sheet 仍像桌面抽屉**：顶部同时出现编辑、删除、关闭，底部又有延期、阻塞、取消与主要动作；破坏动作显著度过高，主次不够明确。
4. **Sheet 内再浮出日期面板**：技术上焦点栈正确，但紧凑屏形成明显的“面板压面板”。日期是编辑任务的一部分，应使用同一 sheet 内的推进层级或替换内容。
5. **按钮规格分叉**：公共 Button 与主题页/业务页自定义按钮的字重、半径和命中区不同；相同“保存/取消/新建”呈现不一致。
6. **标题和页边距不齐**：任务页、设置页和学习页使用不同标题字号与横向 padding，切页时内容基线跳动。
7. **导航语义重复**：桌面七个入口与移动五个入口不一致；“最近 7 天/已完成”本质是任务集合视图；清单和主题存在重复管理入口；回顾页再进入完成记录增加一步。

### 3.2 已有资产，应保留并收口

- `Button.vue`：继续作为按钮唯一底座，补齐语义 size、role 与 loading，不重建第二套按钮。
- `Dialog.vue / Sheet.vue / Popover.vue / ToastRegion.vue`：继续复用统一 OverlayHost、Escape、焦点返回和模态管理。
- `workspace-view.ts`：继续作为导航语义来源，重排入口但不改变领域数据。
- 现有 4 px spacing 基准、语义色 token、平台字体映射、reduced-motion / reduced-transparency 支持继续保留。
- TaskCapabilityService、calendar capability、重复系列作用域、CAS/幂等、undo、学习完成证据和本地存储不进入本轮重写。

## 4. 新的信息架构

### 4.1 顶层导航

| 现状 | 新位置 | 处理 |
| --- | --- | --- |
| 收件箱 | 顶层：收件箱 | 保留，承担未整理捕获物 |
| 今天 | 顶层：今天 | 保留，默认落点 |
| 最近 7 天 | 清单 > 智能清单 | 从桌面一级入口移除，移动端原本已在补充入口 |
| 日历 | 顶层：日历 | 保留 |
| 清单 | 顶层：清单 | 保留，汇总智能清单和用户清单 |
| 已完成 | 清单 > 智能清单 | 从桌面一级入口移除 |
| 学习 | 顶层：学习 | 保留 |
| 设置 | 侧栏/标题栏固定入口 | 保留为独立页面，不进入业务 tab |
| 全局搜索 | 顶部工具栏 | 保留一个入口；移动端可在工具栏展开，不同时保留第二个搜索框 |

结果是桌面、iPhone 与窄 WebView 都使用 **收件箱 / 今天 / 日历 / 清单 / 学习** 五个稳定领域。iPad 宽窗口映射为 sidebar，紧凑窗口映射为 tab bar，切换宽度不改变目的地或状态。

### 4.2 学习区域

- 学习首页默认显示“待继续 / 待复习 / 最近记录”，先回答下一步做什么。
- “回顾”和“完成记录”合为同一页的 `待复习 / 学习记录` 分段视图，保留原数据和操作。
- “节律”作为学习页的分析分段，不再与高频执行入口同等突出。
- 清单/主题的新建、重命名、分组和排序统一放在“清单”管理；学习页只引用学习清单并提供跳转，不再复制整套管理按钮。

### 4.3 页面工具栏

- leading：返回或当前页标题。
- trailing：一个当前页主动作；搜索、筛选、排序、视图与低频管理按频率分组。
- 三个以上次级动作进入 More；More 内按“查看 / 组织 / 危险”分组。
- 图标无法独立说明时使用短文字；icon-only 必须有可访问名称和 tooltip（指针平台）。
- Tab bar 不承载新增、保存、同步等动作。

## 5. 设计 Token 提案

这些值是拾学为 WebView/跨端一致性制定的建议，不是 Apple 全局规则。

### 5.1 间距

| Token | 值 | 用途 |
| --- | --- | --- |
| `space-1` | 4 | 图标内部微调 |
| `space-2` | 8 | 图标与文字、紧凑行内间距 |
| `space-3` | 12 | 控件组间距、带 bezel 控件周边 |
| `space-4` | 16 | 紧凑屏页边距、表单字段间距 |
| `space-5` | 20 | 常规内容 padding |
| `space-6` | 24 | section 间距、桌面卡片内边距 |
| `space-8` | 32 | 页面大分区 |
| `space-10` | 40 | 空状态与内容组分隔 |

页面横向 padding：320–389 为 16；390–819 为 20；820–1279 为 24–28；1280 以上为 32。正文长列设置可读宽度，不随窗口无限拉伸。

### 5.2 圆角

| Token | 值 | 用途 |
| --- | --- | --- |
| `radius-sm` | 8 | badge、细小状态底 |
| `radius-md` | 12 | 输入、普通按钮、分段控件 |
| `radius-lg` | 16 | popover、小型浮层 |
| `radius-xl` | 22 | 大型 sheet、浮动 tab/toolbar |
| `radius-pill` | 999 | 独立胶囊按钮 |

任务行和设置列表默认不用独立圆角；只有整个 section 需要独立背景时使用 `radius-lg`。内层半径根据外层半径和内边距自动收小，避免多个互不相关的 24 px 圆角套叠。

### 5.3 阴影与层级

| 层级 | 表现 |
| --- | --- |
| content | 无阴影；用背景、留白或一条低对比分隔线 |
| selected | 语义选中底色 + 1 px 边界；无阴影 |
| toolbar/tab | 材质或不透明回退 + scroll edge effect |
| popover | 单层柔和阴影，例如 `0 8px 24px rgba(15,23,42,.12)` |
| sheet/dialog | 单层更大范围阴影，例如 `0 18px 48px rgba(15,23,42,.18)` |

减少透明度时材质回退为不透明 surface；深色模式降低黑色阴影作用，更多依靠边缘亮度与表面层级。

### 5.4 色彩

- `canvas / surface / surface-raised / chrome / separator` 管理表面层级。
- `label-primary / secondary / tertiary / disabled` 管理文字，不让页面自行降低 opacity。
- `accent / success / warning / danger` 只表达其语义；静态装饰不用 accent。
- 同一视图最多一个填充 accent 主动作；危险动作使用红色文字或菜单项，只有最终不可逆确认才使用危险填充。
- 每套主题必须提供 light、dark、Increase Contrast 变体；完成、逾期、同步异常同时使用图标/文字。

## 6. 组件重构规范

### 6.1 Button 与 IconButton

- 角色：`prominent / standard / quiet / destructive`；尺寸只改变密度，不表达优先级。
- iOS 触控热区至少 44×44；视觉图标 17–20 pt，文本跟随 Dynamic Type。
- 必须有 pressed、focus-visible、disabled、loading；loading 保持按钮宽度并防重复提交。
- 文案说明结果：“保存任务”“开始学习”“删除此任务”，不用含糊的“确定”。
- 同一 footer 最多一个 prominent；取消使用 standard/quiet，危险动作不自动成为默认焦点。

### 6.2 PageHeader 与 Toolbar

- PageHeader 统一标题、可选副标题、leading 导航、trailing actions。
- iPhone 顶层页使用 large title，可滚动折叠；详情和编辑使用 inline title。
- 每页只渲染一次标题；品牌名仅在应用壳层出现。
- 任务页当前的视图、筛选、排序归入一个逻辑 action group；在窄宽度保留筛选快捷键，其余进入 More。

### 6.3 List、TaskRow 与 Section

- 任务列表采用平面行：完成控件、标题、一次元信息、详情指示。
- 状态 badge 只显示能改变决策的信息；“已计划 + 今日截止”等重复事实合并成一句元信息。
- 点击行进入详情；勾选只完成；chevron 只表示进入下一层，不能表示状态。
- 列表分组用 section title + 间距；避免“外层卡片 + 每行底色 + 分隔线 + 阴影”四重分组。

### 6.4 表单

- 新建任务先显示标题、日期/时间与清单；提醒、重复、优先级按需展开。
- label 持久可见，placeholder 仅提供示例；错误紧邻字段且保留用户输入。
- 日期、时间、重复、提醒使用同一 form-row 语法和 accessory 值。
- footer 固定为取消/保存，键盘出现时仍可达；保存中明确反馈。

### 6.5 弹层选择规则

| 任务 | 组件 | 例子 |
| --- | --- | --- |
| 简短、锚定触发源、可随时关闭 | Popover；紧凑端转 Sheet | 筛选、排序、视图、单一日期快捷选择 |
| 明确的短任务，需要输入 | Sheet | 新建/编辑任务、提醒、重复规则 |
| 阻塞当前流程的重要决定 | Dialog / Alert | 丢弃未保存内容、不可逆删除 |
| 用户主动动作引出的多项结果 | Action Sheet / anchored menu | 修改重复任务“本次/今后/整个系列” |
| 长时间沉浸或复杂多步 | Full-screen cover | 专注学习、确有多步的复杂编辑 |
| 非阻塞结果 | Toast / Inline status | 已保存、可撤销、同步暂不可用 |

统一视觉结构：

1. 可选 grabber（仅可调整或可下滑的 sheet）。
2. header：标题 + 可选说明；Close 与 Back 不能混用。
3. body：一个滚动容器，字段按 section 分组。
4. footer：取消/主动作；危险确认使用取消/危险动作。
5. 所有容器继续复用 OverlayHost、焦点陷阱、Escape 和焦点恢复。

禁止：嵌套模态、业务组件自建 backdrop、普通成功消息弹 alert、可撤销删除每次确认、点击外部静默丢失编辑。

### 6.6 日期与重复编辑

- 桌面/iPad 宽屏：日期 Popover 锚定触发行。
- iPhone/紧凑：在当前编辑 Sheet 内推进到日期子页；顶部提供 Back，选择后返回并保留表单。
- 重复作用域仍显式呈现“本次 / 今后 / 整个系列”，不能为了简洁合并语义。
- 日期型和定时型保持两种事实，不把全天事项伪装成 00:00。

### 6.7 Toast 与状态

- 成功且无需操作：短时 toast。
- 可撤销：带“撤销”和关闭按钮，用户交互时暂停计时。
- 错误可在当前上下文修复：inline alert，紧邻失败对象。
- 阻塞且需要选择：dialog。
- 不用 toast 代替持久同步状态，也不用 dialog 报告普通网络波动。

## 7. 页面级改造

### 收件箱 / 今天 / 最近 7 天 / 已完成

- 四者复用同一 TasksPage 模板；最近 7 天和已完成变为清单页中的智能清单。
- 顶部只保留 PageHeader 和一个紧凑 Quick Add；页面内第二个搜索框移除，由全局搜索或列表过滤承担。
- 任务列表移除大卡片阴影，改用平面 section；空状态只保留一句解释和一个主动作。

### 任务详情

- 顶部只保留关闭/返回和 More；编辑作为明确主动作或点击字段进入编辑。
- 删除、取消任务、标记受阻进入 More 的危险/状态分组，避免与关闭并列。
- 底部只保留一个当前主动作“开始学习/继续学习”；延期等次级动作改为菜单或行内属性。
- 任务记录按时间线呈现，但降低系统迁移文案的视觉权重。

### 任务编辑

- 使用统一 Sheet anatomy；标题和必要字段首屏可达。
- 日期、截止、提醒、重复进入子页或 anchored popover，不再叠一个视觉同级的白色面板。
- 提交前显示重复范围；非法时间就地报错，不能自动修正为另一时刻。

### 日历

- 标题栏保留 Today、视图切换和一个新增主动作；筛选/同步状态进入 More 或 inline status。
- 同一事件在 agenda/day/week/month 之间保持选择状态与术语。
- 颜色之外增加图标/文字表达冲突、重复、全天；拖动必须保留菜单/键盘替代。

### 清单

- 第一段为智能清单：最近 7 天、已完成；第二段为用户清单。
- 新建清单是唯一显著动作；新建分组、排序、编辑放 More 或编辑模式。
- 学习主题引用同一清单事实，不在学习页复制管理入口。

### 学习 / 回顾

- 学习首页展示“继续上次”“待复习”“最近记录”，减少指标看板感。
- 待复习和学习记录合并为同页分段；记录正文优先，节律数据退为次级分析。
- 专注页保持沉浸，导航与设置收起；完成后证据填写仍为必经业务语义。

### 设置

- 使用 iOS Settings 式 grouped list：外观、通知与提醒、日历与账号、数据、安全与关于。
- 每行只表达一个设置；布尔项用 Switch，层级项用 chevron，危险数据操作独立分区。
- 运行时/协议诊断继续保留，但放在“高级/诊断”，不占普通用户首屏。

## 8. 动效、触觉与可访问性

- 动效只说明空间关系：push/pop、sheet 上移、popover 从触发源展开、列表完成淡出；不做持续装饰动画。
- 使用短时系统感弹性；Reduce Motion 下改为淡入淡出或立即切换。
- iOS 只在提交成功、错误和关键选择使用克制触觉；状态仍必须视觉和语义可见。
- VoiceOver 顺序遵循标题→主要内容→主要动作；图标按钮有明确名称，数值包含单位。
- Dynamic Type 测到 200%：允许标题换行、行高增大、水平按钮堆叠为纵向、列数减少；不裁掉保存/取消。
- 测试 Reduce Transparency、Increase Contrast、Bold Text、Differentiate Without Color、全键盘、RTL、本地化长文本和虚拟键盘。

## 9. 实施分期

### Phase 0：设计冻结

- 产出 390×844 与 1440×960 的“今天→详情→编辑日期→开始学习→证据完成→回顾”代表流程。
- 确认五项导航、PageHeader、TaskRow、Sheet anatomy 和 token 表。
- 更新 `DESIGN.md` 与 `VISUAL_QA.md`，获得设计确认后锁定。

### Phase 1：基础层收口

- 调整现有 token；统一 Button/IconButton、PageHeader、FormRow、Section。
- 业务功能和页面结构保持原样，先消除自定义按钮/标题/间距分叉。
- 组件状态截图覆盖浅/深/高对比/放大字号。

### Phase 2：导航与页面壳

- 桌面七入口收为五领域；移动端保持五 tab；iPad 宽度映射 sidebar。
- 最近 7 天、已完成进入清单智能视图；全局搜索只留一个入口。
- 保持各目的地的状态、快捷键和深链接映射。

### Phase 3：弹层与表单

- 清单/分组编辑从 App.vue 提取为业务内容组件，但继续调用原保存函数。
- 统一任务详情、任务编辑、日期、重复、提醒和危险确认的容器与 footer。
- 紧凑端将日期/重复改为 sheet 内层级推进，消除同级面板叠加。

### Phase 4：页面视觉重排

- 依次处理 Tasks、Calendar、Lists、Learning/Review、Settings。
- 删除重复边框、阴影、卡片和说明文案；保持功能入口可发现。
- 每页完成后跑现有行为测试和代表截图，不把全仓重写压到一个 PR。

### Phase 5：平台验收

- WebView：320、390、820、1440，浅/深、200% zoom、reduced effects、键盘与控制台。
- iOS Simulator：iPhone 竖/横屏、iPad 全屏/分屏、safe area、键盘、Dynamic Type、VoiceOver、Reduce Motion/Transparency、Increase Contrast。
- 真机：触控热区、手势返回、触觉、性能和系统材质；没有真机证据时保持 `NOT_RUN`。

## 10. 验收标准

1. 五个核心领域在 desktop/sidebar 和 compact/tab 中名称、顺序和状态一致。
2. 最近 7 天、已完成、完成记录、主题管理减少重复入口，但原能力仍可在两步内找到。
3. 每页一个标题、一个 prominent 主动作；Tab bar 不执行动作。
4. 所有可见按钮、输入、菜单、popover、dialog、sheet、toast 都来自共享 UI 层或明确平台适配器。
5. iOS 触摸热区不小于 44×44；文字按 Dynamic Type 语义角色缩放，200% 不丢主要操作。
6. 普通列表不叠加卡片、边框和阴影；玻璃只用于功能层并有 Reduce Transparency 回退。
7. 弹层按选择矩阵使用；任一时刻只有一个模态任务；关闭后焦点返回触发源。
8. 危险动作说明对象与后果并提供取消；可撤销动作无需重复确认。
9. 浅色、深色和 Increase Contrast 均达到目标对比度；状态不只靠颜色。
10. 现有能力服务、幂等/CAS、undo、重复范围、学习完成证据、日历写入边界与本地持久化测试全部保持通过。

## 11. 证据边界

- Apple Design Resources 当前页面已经列出 iOS 27 / iPadOS 27 UI Kit；部分 Apple iPhone 使用指南仍标 iOS 26。具体搜索位置、材质参数和控件外观需要按目标系统版本重新核对。[Apple Design Resources](https://developer.apple.com/design/resources/)
- 本轮 Web 自动流程通过，证明当前基线可操作；它不证明原生 Liquid Glass、系统字体度量、safe area、VoiceOver、触觉、真机性能或 App Store 质量。
- Apple 官方指导提供语义和平台行为，拾学 token 表是项目建议。实施后必须以目标设备和真实内容重新验证，不能用规范文档替代可用性证据。
