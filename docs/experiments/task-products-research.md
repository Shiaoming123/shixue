# 拾学任务产品实现对照与实验优先级

调研日期：2026-09-08。拾学基线：`fdba96e9c9707640798e96329868e922e49808de`（本实验修改前）。本文的“当前差距”均指这个基线，不把实验新增样式倒算成既有能力。

## 结论与证据边界

拾学的问题不是缺少所有任务工具：它已有自然语言 Quick Add、循环实例、日历指针拖动、侧栏排序、键盘操作、提醒投递协议、专注证据与复习。主要差距是这些能力在触屏发现性、状态连续性、视觉一致性和下一步引导上没有形成同样顺滑的入口。学习完成强制留下证据是产品差异，不应为了减少点击直接删除。

竞品身份：本文的 Todoify 指 **Polydez 的 Todoify - Fast & Easy Tasks，App Store ID 6482852961**。不是 Todoist，也不是 GitHub 上同名练习项目。商店页面能支持它有清单、快捷任务、Pro 提醒、iCloud、离线与深色模式，不能支持“成熟度与滴答相当”，也没有足够公开资料证明它具备手势排序、习惯或复盘。若用户实际指另一产品，应替换此行对照，其他研究仍有效。[Todoify 官方商店页](https://apps.apple.com/pt/app/todoify-fast-easy-tasks/id6482852961)

证据分层：

- **S：源码核验**。开源 Super Productivity 与拾学固定 commit 的实际组件、样式、状态入口；可独立复查。
- **D：厂商文档声明**。TickTick、Todoify 的公开行为与功能；不冒充本机操作实测。
- **H：待实验假设**。用户感受、预期省步数与建议参数；需要可用性测试验证。

本轮没有解包闭源客户端，没有取得 TickTick/Todoify 内部组件树、真实动画曲线或数据库实现；这些字段保持未知。以下开源代码是可实现的参照，不是闭源竞品的逆向结果。未安装、登录或测量竞品，因此不报告其真实响应耗时、帧率或精确点击总数。

## 固定源码证据索引

Super Productivity 源码快照：`b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9`。所有以下链接固定此 SHA；不依赖滚动 master。Angular/CDK/NgRx 是该项目的实现，拾学无需引入同一框架。

| ID | 实际实现与证据 |
|---|---|
| S1 | [task-list.component.html L26–51](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/features/tasks/task-list/task-list.component.html#L26)：列表注册 CDK drop container，行携带任务实体，触摸有启动延迟，小屏锁 y 轴，drop 只发一个组件事件。 |
| S2 | [task-list.component.ts L401 起](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/features/tasks/task-list/task-list.component.ts#L401)：drop 分辨来源、目标和分组；通过 `getAnchorFromDragDrop` 与 Store action 写排序，不能把 DOM 排序当持久化。跨 tag 移动还涉及标签语义。 |
| S3 | [input-intent.ts L6–15](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/util/input-intent.ts#L6) 与 [app.constants.ts L58](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/app.constants.ts#L58)：依据当前输入意图而非仅屏宽判断触摸；触摸延迟 500ms，鼠标 0ms。防止滚动被拖拽抢走。 |
| S4 | [add-task-bar-state.service.ts L17–56](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/features/tasks/add-task-bar/add-task-bar-state.service.ts#L17)：输入与备注独立 signal；sessionStorage 恢复并由 effect 保存，语法状态不与自由文本混用。 |
| S5 | [add-task-bar-parser.service.ts L79–139](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/features/tasks/add-task-bar/add-task-bar-parser.service.ts#L79)：异步解析 runId 拒绝过时结果；高亮范围绑定原始输入，防止旧结果覆盖新输入。 |
| S6 | [animation.const.ts L1–29](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/ui/animations/animation.const.ts#L1)：标准 225ms `(0.4,0,0.2,1)`；进入 225ms `(0,0,0.2,1)`；离开 195ms `(0.4,0,1,1)`；短 150ms、长 375ms。 |
| S7 | [standard-list.ani.ts L12–37](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/ui/animations/standard-list.ani.ts#L12) 与 [task-list-ani.ts L4–7](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/features/tasks/task-list/task-list-ani.ts#L4)：增删用 225ms 高度/scale 过渡，入场 stagger 40ms、退场 -40ms；drop 后 BLOCK 分支禁用重复列表动画。大列表不能不加限制地照抄 stagger。 |
| S8 | [magic-side-nav.animations.ts](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/core-ui/magic-side-nav/magic-side-nav.animations.ts)：移动面板 translateX(100%) 入场，桌面淡入，共享 enter/leave 常量；相同目的按空间形态选择动画。 |
| S9 | [task.reducer.ts](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/features/tasks/store/task.reducer.ts)：NgRx reducer、entity adapter、persistent action meta；任务状态由领域 action 修改，不靠组件局部副本充当权威数据。 |
| S10 | [reminder.service.ts L77–110](https://github.com/super-productivity/super-productivity/blob/b6ef6255c422ed96917d47ec9ccd0fb835a4fbc9/src/app/features/reminder/reminder.service.ts#L77)：Web Worker 接收 Store 中计划/截止提醒，调度与 UI 渲染解耦。这不等价于浏览器退出后仍能提醒。 |

拾学源码可用 `git show fdba96e:路径` 复查：`src/components/study/{TasksView,QuickAddComposer,AppSidebar,ReviewView}.vue`，`src/components/calendar/{CalendarItem,UnscheduledTray}.vue`，`src/assets/themes/global.css`，`src/domain/capabilities/service.ts`，`src/lib/reminder-runtime.ts`，`src/storage/study/{indexeddb,tauri-sqlite}.ts`。以下行号均以基线为准。

## 四个维度的实质差距

### 1. 交互：操作就在对象上，但有安全边界

**捕获。** TickTick Windows 官方支持全局 `Alt+Shift+A`，输入时不必离开当前应用；官网也说明时间自然语言解析。它省掉的是切换上下文，并不只是少一个按钮。[Windows 官方说明](https://www.ticktick.com/windows)、[功能页](https://ticktick.com/features?language=zh_tw)

拾学 `TasksView.vue:117–124` 已有 N、/、J/K、E、C，且输入区/弹层活动时不截获；`QuickAddComposer.vue:126–163` 在成功执行带 revision/idempotencyKey 的 command 后才清空和回焦。失败保留输入，这是应保留的底线。输入本身是组件 `ref('')`（L31），没有像 S4 的恢复草稿机制；页面卸载/刷新可能丢失未提交文字。应先做轻量草稿恢复与快捷键可见提示。学习模式 `aria-pressed` 已实现，不能列为缺失。

**原生全局捕获已经存在。** `src/modules/shortcut/index.ts` 的桌面模块调用 Rust `set_quick_add_shortcut`；`src-tauri/src/shortcut.rs:4–5` 注册 Ctrl+Alt+A，Pressed 时复用 `tray::show_quick_add`，发出 `shixue:quick-add`，由 App 现有入口处理。`docs/development.md:24–26` 还记录了权限故障与修复路径。需要验证安装版在外部应用前台、托盘隐藏及快捷键冲突时的实际表现，并提高发现性；不应新增捕获窗口或重复注册系统。Web 预览不能验证这项原生能力。

**拖拽。** 拾学侧栏原生 draggable 配有 Alt+方向键；日历 `CalendarItem.vue` 已有 move/resize pointer 操作。缺的是 `TasksView` 任务行自定义顺序：当前排序选项是查询排序，没有可持久化手动行序与拖拽事件。S1–S3 展示正确拆分：输入识别→拖动预览→drop 目标验证→一次领域写入→恢复一致顺序。不能仅添加 draggable 属性或让排序在刷新后丢失。循环实例与普通任务混排时需先定义顺序模型，成本不是一天 CSS。

**触屏快捷操作。** `TasksView.vue:203` 小屏隐藏 `.row-actions`；点行仍可进详情，但桌面悬浮的快捷能力不再可见。滴答曾公开滑动习惯累计打卡及拖动 + 插入任务的行为；文章为 2020 年，只证明历史交互思路，不保证当前平台相同。[官方历史交互说明](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/)

最小改进是触屏保留有标签的更多菜单，确保键盘等价路径；手势作为增强，不让“发现隐藏动作”成为使用前提。若加入横滑，必须区分滚动/横移，取消手势不能触发完成，学习任务仍进入证据链，不能滑一下绕过评级。

### 2. 动效：表达因果和空间，不等待装饰

拾学基线 token 为 140/220/360ms、`cubic-bezier(.22,.61,.36,1)`；Dialog/Sheet/Popover 已共享 token。任务行 L199 只有 background transition，任务区普通 v-for，没有 TransitionGroup；完成导致行消失时缺少定位反馈。侧栏却已有 `nav-order-move`，说明不是需要安装新动画库，而是现有机制覆盖不均。

S6–S8 给出可检查的参考参数：入场/退场不同曲线、移动面板来自屏边、列表增删与拖动后动画互斥。不能把 S7 的 scale(0) 与大批 stagger 直接搬来：100 行错峰会把结果拖慢；高度动画还有布局成本。拾学实验宜用 180–240ms 的 opacity/小距离 transform，批量变化直接完成，reduced-motion 禁用位移；持久化成功才反馈“已完成”，失败保持对象位置。

加载与空态：Quick Add 已有提交 spinner/disabled；任务空态区只区分搜索无结果、尚无完成、清单清空，没有把可执行下一步写在空态里。应按原因显示“清除筛选”或“添加第一项”，避免用统一庆祝图形把“数据尚未载入”伪装成“没有任务”。TickTick/Todoify 的精确加载时长与动画参数均未核验，不赋值。

### 3. 视觉：层级密度与主题语义

拾学并非没有主题系统：`global.css` 有字号/间距/语义色，业务组件使用 `--surface`、`--muted` 等。问题是基线存在局部硬编码字号/圆角、玻璃侧栏、不同页面的密度差异。例如 TasksView 行 64px，而 ReviewView 卡片 margin 28px、padding 27/29px、块引用 18px；这种对比不是必然错误，需由“快速扫描”与“回忆阅读”的任务决定，而不能各页随机设计。

Todoify 商店声明原生深色、强调色和轻量清单，未公开字号、栅格或组件源码；不能从截图推出 SwiftUI、字体 token 或布局算法。TickTick 的可定制主题亦不能证明对比度自动合格。此处可靠改造依据是拾学自己的共享 token 和用户指定的 Soft Surface 规范，而不是声称竞品用了某个圆角。

实验需覆盖导航、任务列表/详情、日历、专注、回顾、清单管理、设置及所有弹层；深色使用独立语义色而非 invert。表单边界、focus ring、危险/警告色与 disabled 文本都要检查。屏幕宽度变化时既控制留白，也保留点击目标；不能为了“精致”缩成只有鼠标能点的图标。

### 4. 链路：创建不是结束，复盘不是统计图

TickTick 厂商文档明确串联任务、提醒、专注、习惯、统计；这可作为覆盖面参考，但具体跨页摩擦仍未实测。[官方帮助中心](https://help.ticktick.com/)、[习惯频率与提醒设计](https://blog.ticktick.com/2019/06/03/habit510/)

拾学已有更强的学习语义：Quick Add 明示 learning mode，完成记录学习/证据，到期复习揭示证据后 clear/fuzzy/relearn，周复盘可钻取具体记录（`ReviewView.vue:258–357`）。这些动作刻意增加认知加工，不应统称冗余。真正值得减负的是“我现在该点哪一个”：普通完成、学习完成、关联复习完成的结果不同，需要在入口及按钮文案说明；重学评级后下一步行动的反馈要更明确。

提醒也不是无功能：`reminder-runtime.ts:27–56` 有恢复 armed claims、reconcile、claim、ack 和失败/不确定结果。视觉实验不能绕开这套协议直接发通知。Web 原生通知、Tauri 托盘驻留、彻底退出分别有能力边界，必须在体验说明中清楚标注，不能把浏览器预览宣称为系统级离线提醒验证。

习惯方面，循环任务与本周节律已经提供重复事项及真实聚合：`src/domain/views/learning-rhythm.ts:15–34` 含计划次数、有/无证据完成、跳过、取消、下一实例及 streakCount；L181–195 的 evidenceStreak 从最近合格实例倒序累计，遇到未完成或缺证据即中断，`LearningRhythmView.vue:61` 展示“连续完成 N 次”。这是**连续有证据的实例次数**，不是自然日连续天数，不能报告为没有连续统计。通用累计量习惯（如一天喝 8 杯水）、独立打卡日志属于不同模型；是否值得加入，应先用已有学习节律及复习回访率验证需求。

## 步数：可复核口径，而非假造竞品测速

口径：起点为应用已打开、任务列表可见、无弹层、已选正确清单；连续一次输入算一次操作，点击/快捷键/确认各算一次，等待不计动作但另测耗时。下表是拾学**源码路径计数**，不是已经完成的三产品录像测量。

| 场景 | 拾学基线最短路径 | 比较与验收 |
|---|---|---|
| 普通新建 | 聚焦输入→输入→Enter，3 步；已聚焦为 2 步 | TickTick 全局快捷能减少切回应用的上下文成本；竞品总步数待安装实测。 |
| 学习新建 | 聚焦→输入→切换学习任务→Enter，4 步 | 模式默认关闭避免购物类事项误进学习链；这 1 步有业务价值。 |
| 已选普通任务完成 | C，1 步 | 输入框/弹层内 C 不得触发。并检查写入失败后任务仍可见。 |
| 关联复习任务完成 | 完成入口→揭示→评级，至少 3 次激活；回忆时间单独记录 | 减少跳页/保留焦点，不把评级默认成 clear。 |
| 调整触屏任务属性 | 点任务进入详情，再找到对应操作；总步数随属性不同 | 需按改期/移动清单/删除分别录制；不填一个统一数字。 |
| 清空后的再添加 | 当前依赖已有 Quick Add | 空态提供同一入口的聚焦操作即可，无需第二个创建实现。 |

建议正式试用记录每产品同样 6 个场景：带时间添加、改期、批量整理、提醒到达处理、完成后复盘、次日再次行动；桌面鼠标/键盘与手机分开记录。保留版本、系统、订阅档位、起点、动作数、失败/撤销次数及 1–7 心智负担。没有这些条件时“少 40% 点击”不可成立。

## 优化清单

成本为一位熟悉代码的开发者实现与基本验证的人日估计，不含未知平台审核。P0 表示可导致数据/操作正确性问题的验收门禁，不表示已确认有缺陷；P1 为实验优先，P2 需真实需求触发。

| 类别 | 问题 / 用户感受 | 参考实现 | 最小改造与成本 | 优先级 |
|---|---|---|---|---|
| 体验不足 | 视觉重构可能损害焦点/对比度/移动端点击；“好看了却难操作” | 现有 ui primitives 与 Soft Surface 规范 | 复用 token，检查浅深色/缩放/键盘/reduced-motion；2–4 天 | P0 验收门禁 |
| 体验不足 | Quick Add 未提交草稿随卸载丢失；“刚写的没了” | S4、拾学成功后才清空的语义 | 带 workspace 范围的最小草稿恢复；失败保留、成功删除；0.5–1 天 | P1 |
| 体验不足 | 任务列表增删缺位置连续性；“不知道哪项消失” | S6/S7，现有 Vue TransitionGroup | 少量行 opacity/transform，批量不 stagger，减少动画分支；0.5–1 天 | P1 |
| 体验不足 | 触屏隐藏行操作；“每次都要进详情找” | 滴答历史手势、S3 输入意图 | 明示更多菜单并复用现有动作；手势另计；0.5–1 天 | P1 |
| 体验不足 | 页面密度、圆角与材质不统一；“像拼在一起” | 本项目全局 token | 全核心页与共享弹层语义覆盖；2–4 天 | P1 |
| 链路冗余 | 空态没有下一步；“我接下来做什么” | 现有 Quick Add focus API | 按无结果/无任务显示清筛选/聚焦添加；0.5 天 | P1 |
| 链路冗余 | 快捷键只在使用者知道时省事；“功能藏着” | TasksView 已有 N / J K E C | 同一帮助入口展示现有键位，避免新增注册系统；0.5 天 | P1 |
| 链路冗余 | 重学后缺清晰下一步反馈；“评级完还是不会” | 本项目 review 领域模型 | 先明确下一次计划/返回入口；需要新任务时复用能力命令并防重复；1–2 天 | P1 |
| 功能缺失 | 手动排序已有可见选项但缺少行重排入口；“选了仍无法按我的顺序做” | S1–S3、S9 | 先修正不可操作的承诺，再确定普通/实例混排顺序、事务保存、键盘替代与刷新一致性；完整实现成本较大，3–5 天 | P1 |
| 体验不足 | 已有 Ctrl+Alt+A 原生捕获入口，但安装版行为与发现性需验证；“不知道可以在外部应用直接添加” | TickTick Windows；拾学 shortcut.rs 与 tray 共享入口 | 复用现有事件/窗口，补可见提示及冲突/隐藏恢复验证；0.5–1 天 | P1 |
| 功能缺失 | 缺通用累计量习惯模型；现有学习节律已展示连续有证据完成次数 | TickTick 习惯官方文档；拾学 learning-rhythm.ts | 保留现有节律聚合，只有喝水等累计量需求成立才建独立模型；4–7 天 | P2 |
| 体验不足 | 提醒权限/退出边界不明显；“我以为它会响” | S10；拾学 claim/ack runtime | 入口显示可用性与失败原因，复用提醒状态；平台验证另计；1–2 天 | P1 |

本次全量视觉实验与上述功能研究分开验收：CSS/组件外观不能宣称新增了手势排序、累计量习惯或后台提醒；原生全局捕获和学习节律则属于应保留的已有能力。保留当前任务命令与存储适配层，避免为了换外观重写状态管理。试用后优先用行为证据决定 P2 是否值得实现。

## 实验实施状态

本报告完成时，实验工作树已有共享主题 token、导航、任务/详情、日历、专注、回顾、本周节律、清单管理、设置与公共弹层的视觉修改，以及页面/列表动效与预览脚本；这些是**代码改动已落地、最终验收待主任务汇总**，不等于本文已验证全部页面通过 QA。本轮交付 Web 预览包，不是 MSI，未附加实现 P2 功能。本表作为总优先级：可见但不可操作的手动排序列为 P1，独立累计习惯为 P2。

本报告只完成研究与优化建议，没有实施草稿恢复、持久化任务手动排序、新手势或累计习惯模型。安装版全局快捷捕获、后台提醒及移动端系统行为仍需各自平台验证；不能用网页预览替代。构建、截图、键盘/深浅色验证及最终可体验产物以主任务交付记录为准。
