# 拾学基线：可达交互与学习链路审计

基线为 `fdba96e9c9707640798e96329868e922e49808de`。本报告通过 `git show HEAD:<path>` / `git grep HEAD` 读取实验样式修改前的代码，不把设计文档、孤立组件或历史测试当作当前可用功能。以下步数是代码推导的最短动作数，不是用户测试结果或竞品实测；一次点击/键盘命令算一个动作，连续填写一个字段单列为一次输入，不把输入字符数混作动作。通知权限弹窗、滚动与网络等待未纳入最短数。

## 一、真正可达的结构

`src/App.vue:1753–1777` 采用条件渲染切换工作区；Today 与 Tasks 共用 `TasksView`，右侧由 `TaskDetailDrawer` 呈现详情。学习工作区下是 Topics / Rhythm / Review；专注会替换主工作区。日历独立使用 CalendarWorkspace → Toolbar / UnscheduledTray / TimeGrid / MonthGrid / AgendaView → CalendarItem。覆盖层统一经 OverlayHost / Sheet / Popover 承载。

| 核心页/状态 | 实际组件及样式入口 | 审计重点 |
|---|---|---|
| 今天、收件箱、未来七天、清单 | `TasksView.vue:140–190`：`.tasks-view .page-header .quick-add-composer .search-field .filters .task-row` | 同一信息布局而非各自首页；Quick Add、搜索、筛选、批量操作共存 |
| 详情/编辑/完成 | `TaskDetailDrawer.vue:76–149`；`TaskEditSheet.vue:242–264`；`CompletionSheet.vue:60–99` | 详情另开编辑 Sheet；学习完成要求三项文本 |
| 专注 | `FocusView.vue:27–57`：`.focus-view .focus-heading .criteria .scratchpad .focus-actions` | 计时、暂存笔记、暂停、完成 |
| 清单/主题 | `TopicsView.vue`：`.topics-view`；App `1773` 接入 | 清单和学习路线的概念仍交叠 |
| 学习节律 | `LearningRhythmView.vue:66–132`：`.rhythm-view .rhythm-list .rhythm-row .progress-track .empty-state` | 按重复 occurrence 聚合有证据完成、连续次数、下一次 |
| 复习/记录/周复盘 | `ReviewView.vue:261–375`：`.review-view .segmented .review-card .weekly-summary .record-list` | 到期复习、历史证据、周统计和溯源挤在同一工作区 |
| 日历 | `CalendarWorkspace.vue:210–220`、`CalendarItem.vue:88–121` | 拖移/改时长与菜单、键盘共享 command |
| 设置 | `SettingsView.vue:153–273`：`.settings-view .settings-grid .settings-section .setting-row` | 外观、导航、快速添加、通知、数据、可选云同步 |

重要反例：`TodayView.vue:151` 虽然有 HTML draggable 排序面板，但 `git grep 'TodayView' HEAD -- src` 无引用；它不是当前 Today 路由。不能用它证明当前任务列表支持拖拽。

## 二、从用户目标计数

| 具体起点 → 结果 | 最短动作/输入 | 实现依据与心智负担 |
|---|---|---|
| 今天列表 → 新普通任务 | 聚焦输入 1 + 标题输入 1 + Enter 1 | `QuickAddComposer.vue:257–272` 原生 form；今天默认日期来自 `App.vue:1766`，无需重复选今天 |
| 今天列表 → 明天的任务 | 聚焦 1 + 含日期标题输入 1 + Enter 1 | `QuickAddComposer.vue:53–74,114–127` parser → candidates → command；无歧义时不强制二次确认 |
| 今天列表 → 学习任务 | 上述 3 + “学习任务”切换 1 = 4 | `QuickAddComposer.vue:268` 原生 `aria-pressed`；成功后 mode 重置（`150–156`），连续录入学习任务每次要再切一次 |
| 已有具体开始时间任务 → 开始时提醒 | 打开任务 1 + 编辑 1 + 添加提醒 1 + 保存整个编辑 1 = 4 | `TaskDetailDrawer.vue:79`；`ReminderEditor.vue:23,93–94` 默认 at_start；`TaskEditSheet.vue:258,264`。提醒添加先进入草稿，不能误把“添加提醒”当最终落盘 |
| 无具体时间任务 → 提醒 | 上述路径另加时间选取，不能沿用 4 步 | `ReminderEditor.vue:33–48,90`：仅日期不足以使用开始时提醒，需具体开始时间或自定义；Quick Add candidate 没有 reminder 类型（`QuickAddComposer.vue:226–229`） |
| 普通任务行 → 完成 | 完成按钮 1 | `TasksView.vue` 发 toggle-complete → `App.vue:1331`；普通与学习的完成路由明确分开 |
| 学习任务行 → 留证完成（无暂存笔记） | 完成按钮 1 + 收获/证据/下一步输入各 1 + 保存 1 = 5 | `CompletionSheet.vue:44` ready 必须三个非空字段；blocker 可选，mastery 默认 3。不应为减步把学习证据要求删除 |
| 运行中的学习专注 → 留证完成 | 完成并记录 1 + 三项输入最多 3 + 保存 1；已有 scratchpad 可少填收获 | `FocusView.vue:57`；`CompletionSheet.vue:34–44` 自动把 scratchpad 放入 learned |
| 待复习关联任务行 → 完成复习 | 完成入口 1 + 查看证据 1 + 评级 1 = 3（回忆时间另计） | `App.vue:874,1331` 定位对应卡片；`ReviewView.vue:268–278` 回忆→揭示→三档评级；不是勾选即默认记得清楚 |
| 已在记录页 → 从下一步继续 | 展开记录 1 + 从下一步建任务 1 | `ReviewView.vue:355–366`。若从待复习视图起点，还要“完成记录”切换 1 |
| 创建学习节律 | Quick Add 聚焦 1 + 含重复语句的标题输入 1 + 学习模式 1 + Enter 1 = 4 | `QuickAddComposer.vue:82–88,114–143` 创建重复 series；节律页没有独立创建 CTA，空态只说明去设置重复（`LearningRhythmView.vue:128–131`） |
| 已在节律页 → 本次留证完成 | 继续本次 1 + 详情完成 1 + 三文本输入 3 + 保存 1 = 6 | `LearningRhythmView.vue:114–124` 跳 occurrence，`TaskDetailDrawer.vue:136–149` 完成本次，再走 CompletionSheet |

这说明拾学的差距不是“没有自然语言添加/重复/复盘”。主要阻力是提醒的二层保存、学习连续录入重置、节律空态缺少直达入口，以及复盘之后继续行动需要切换到记录模式。

## 三、交互、状态和动效的实现判断

- **任务排序缺口**：`TasksView.vue:77–82` 有“手动排序”选项，但可达模板没有 draggable、pointer 拖动或上下移按钮，App 对 TasksView 也没有 reorder 接口（`1766`）。现状可选既有 manual order，却不能在该列表直接调整。侧栏排序和日历改期不等于任务排序。
- **手势边界**：任务行没有 swipe/long-press 行动作。日历确有 Pointer Events，`use-calendar-drag.ts:48–71` 用 pointer capture、session/preview ref 和 4 px 位移阈值；`CalendarWorkspace.vue:210` 处理 cancel/lostcapture/Escape，`TimeGrid.vue:84–91` 对时间吸附及边界裁剪。不是只能鼠标拖；但本审计不宣称触屏实测通过。
- **快捷键是真实存在**：`TasksView.vue:117–125` 的 `/`、N、J/K/方向键、E、C；输入框或覆盖层激活时退出，减少误操作。全局 Ctrl/Cmd+K 在 `App.vue:839–840`。快捷键可发现性弱：搜索有 `/` 提示，其他行为主要藏在实现中。
- **已有状态复用价值**：Quick Add 的本地 ref/computed 负责文本与候选，再送 capability service，带 expectedWorkspaceRevision/idempotencyKey（`QuickAddComposer.vue:133–152`）；App 聚合 state 并 `refreshState`（`App.vue:686`）。编辑先复制 task/reminder/recurrence 草稿再保存（`TaskEditSheet.vue:192–229`）。改视觉时应保留这些提交边界，不另加全局 store 或假数据层。
- **基础动效已有但列表连续性不足**：`global.css:104–108` 为 140/220/360 ms、`cubic-bezier(.22,.61,.36,1)` 和 overshoot `.34,1.56,.64,1`；基础按钮只做颜色/opacity/shadow/transform（`161–167`）。Sheet 使用 Vue Transition，opacity+transform 220 ms（`Sheet.vue:37,119–121`）。App 页面条件切换无 Transition；TasksView 列表无 TransitionGroup/FLIP，因此新增/移除会直接布局变化，不能宣称已有完整列表动画系统。
- **加载/空态**：App 初始加载是纯文本（`1754`）；Quick Add spinner 800 ms linear（`QuickAddComposer.vue:337`）；节律空态没有行动按钮。适合先做状态可理解与稳定占位，再决定是否需要骨架；不应为了动效延迟真实保存。
- **减弱动态应保留**：`global.css:218–223` 将动画/过渡压至 `.01ms`；Quick Add 单独关闭 spinner（`349`）。实验新增动效应沿用该开关。

## 四、视觉差距是规则执行不一致

字体栈已自托管 Manrope / Noto Sans SC，`global.css:13–35`；语义色由主题应用层写入，结构 token 共享。已有四像素间距、8/10/14/20/26 圆角、正文 13 px、辅助 11/12 px，不能称作“没有设计系统”。但组件仍大量硬编码：Review 卡片标题 18、记录副文 10（`ReviewView.vue:383,389`）；详情移动端标题 25（`TaskDetailDrawer.vue:168`）；字体 token 注释要求 400/500，组件使用 550/570/620/650。页面 padding、卡片阴影也各自定义，改变全局 token 不足以覆盖全页。

浅深色通常通过 `var(--surface/text/muted)` 连贯，但 global shadow 使用固定深绿色 rgba（`global.css:88–90`），其深色层次需要视觉复核。此报告不以代码颜色值代替对比度测量。实验应统一页面骨架、section/row/card 用法、字体层级和深色 surface 层级，而非只把品牌色换掉。

## 五、可行动清单

成本为单工程师含必要验证的估计，非交付承诺。参考实现栏先给项目内可复用实现；外部成熟产品实现由竞品研究报告补证，不臆测闭源参数。

| 类别 | 问题 → 用户感受 | 参考实现/最小改法 | 成本 | 优先级 |
|---|---|---|---|---|
| 功能缺失 | 当前任务手动排序不可操作 → 想把下一件放前面却找不到入口 | 复用既有 manual order 命令，借日历 pointer capture+取消边界；提供上下移动替代 | 2–4 天 | P1 |
| 功能缺失 | 普通任务列表无触屏滑动快捷动作 → 单手要反复开详情 | 复用行完成/延期命令，限定横向阈值、滚动让路和撤销；不能仅装拖拽库 | 2–4 天 | P2 |
| 功能缺失 | “习惯”目前是学习重复 occurrence 聚合，非任意计数习惯 → 饮水数量等无法表达 | `LearningRhythmView` / workspace RecurrenceSeries 已覆盖学习节律；通用计数习惯要新业务模型，不应视觉实验顺带扩张 | 5–10 天 | P2 |
| 体验不足 | 页面和列表直接替换 → 状态变化方向与对象位置不清 | Vue 内置 Transition/TransitionGroup，沿用 motion token；先稳定 key 和焦点恢复 | 1–2 天 | P1 |
| 体验不足 | 辅助文字 10–11 px、每页字号留白各异 → 深色和小屏难扫读 | 集中语义 token+页面层级，移除冲突局部值；不新增设计系统框架 | 2–3 天 | P1 |
| 体验不足 | N/E/C 等不可发现 → 用户以为只能点鼠标 | 沿用现有 handler，紧凑帮助/菜单显示快捷键 | 0.5 天 | P2 |
| 链路冗余 | 提醒“添加”后还要“保存” → 容易以为已生效 | 保留原子草稿语义，文案标明“待保存”，最终保存一处反馈 | 0.5–1 天 | P1 |
| 链路冗余 | 节律空态仅说明 → 用户不知道从哪里开始 | 增加直达现有 Quick Add 的学习重复入口；不新建第二套表单 | 0.5–1 天 | P1 |
| 链路冗余 | 连续学习录入每次切换模式 → 批量录入费操作 | 评估会话内保留显式选择；清楚显示当前 mode，避免普通任务误分类 | 0.5–1 天 | P2 |
| 链路冗余 | “需要重学”评级后下一行动不突出 → 记录结果却不知道做什么 | 复用记录 nextAction→任务能力，在结果反馈给直达动作；保留评级事实 | 1–2 天 | P1 |

没有发现足以仅凭此次静态读取定为 P0 的数据丢失/阻断证据。上述 P1/P2 不代表都属于此次视觉实验实现范围。审计未执行浏览器交互、通知投递或设备性能测量，不能以最短路径推导冒充实测。
