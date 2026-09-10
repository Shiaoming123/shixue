# 拾学 iOS UI/UX 大重构执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变拾学业务能力、数据模型和持久化边界的前提下，把导航、页面层级、基础组件、弹层和核心页面统一为简洁、直观、优雅的 iOS 设计语言。

**Architecture:** 继续使用现有 Vue 3、语义 token、共享 UI primitives 和 OverlayHost。先通过合同测试固定新的五领域导航和组件语义，再逐层替换页面自定义视觉；不新建第二套 UI 框架，不引入依赖，不重写能力服务。

**Tech Stack:** Vue 3、TypeScript、CSS Custom Properties、Lucide Vue、Node test runner、Playwright smoke、Tauri 2 WebView。

**Spec:** `docs/experiments/ios-ui-ux-restructure-plan.md`

## Global Constraints

- 新设计覆盖旧组件布局与页面排版约束；`DESIGN.md` 和 `VISUAL_QA.md` 必须同步更新。
- 保持 TaskCapabilityService、CAS、幂等、undo、重复范围、日历写入授权、学习完成证据和持久化语义不变。
- 不增加 UI、日期、动画或状态管理依赖；优先扩展现有组件。
- iOS 触摸热区至少 44×44；支持 Dynamic Type、深浅色、Increase Contrast、Reduce Motion、Reduce Transparency。
- 当前 WebView 截图不能作为原生 iOS、VoiceOver、触觉或真机证据。
- 每个阶段先写能因目标实现缺失而失败的测试，再写最小实现；阶段结束提交一次可独立审查的 commit。

---

### Task 1: 锁定设计合同和验收矩阵

**Files:**
- Modify: `DESIGN.md`
- Modify: `VISUAL_QA.md`
- Create: `docs/experiments/ios-ui-ux-restructure-plan.md`
- Create: `docs/superpowers/plans/2026-09-10-ios-ui-ux-restructure.md`

**Produces:** 新导航、token、组件、页面和证据边界的唯一设计来源。

- [ ] 将提案状态标为用户已授权，并记录覆盖旧布局的范围。
- [ ] 在 `DESIGN.md` 顶部加入本轮合同：五领域导航、一个页面标题、一个 prominent 动作、内容/功能层分离、统一弹层选择表。
- [ ] 在 `VISUAL_QA.md` 加入重构视口和代表流程矩阵。
- [ ] 运行 `npm run check:docs` 与 `git diff --check`。
- [ ] 提交 `docs(design): lock iOS UI restructuring contract`。

### Task 2: 建立新的 UI 合同测试

**Files:**
- Create: `tests/ios-ui-restructure-contract.test.ts`
- Modify: `tests/workspace-navigation.test.ts`
- Modify: `tests/global-search-entry.test.ts`
- Modify: `tests/calendar-ui-contract.test.ts`

**Consumes:** Task 1 设计合同。

**Produces:** 对五领域导航、共享 PageHeader、触控尺寸、材质用途和弹层复用的可执行约束。

- [ ] 测试 desktop 和 mobile 主导航都严格为“收件箱、今天、日历、清单、学习”。
- [ ] 测试 upcoming/completed 路由仍可解析，但只出现在清单智能入口。
- [ ] 测试所有核心页使用共享 `PageHeader`，不再各自定义页面标题样式。
- [ ] 测试 Button/IconButton 角色、44px iOS 命中 token、内容层无玻璃、功能层材质回退。
- [ ] 测试 App 业务弹层继续复用 Sheet/Dialog/Popover/OverlayHost。
- [ ] 运行定向测试并确认因实现尚缺失而正确失败。

### Task 3: 收口 token、Button 和 PageHeader

**Files:**
- Modify: `src/assets/themes/global.css`
- Modify: `src/components/ui/Button.vue`
- Create: `src/components/ui/PageHeader.vue`
- Modify: `src/components/ui/index.ts`
- Modify: `docs/design-system.md`

**Produces:** `Button` 的 prominent/standard/quiet/destructive 角色与共享 `PageHeader`。

- [ ] 将页面 padding、字体角色、圆角和浮层阴影改为设计合同值。
- [ ] 保留现有 Button API，新增所需角色/尺寸而不破坏调用者。
- [ ] PageHeader 提供 title、subtitle、leading、actions slots；只负责排版和语义。
- [ ] 保证 iOS 44px、Android 48px、Windows 32px 平台命中映射。
- [ ] 运行 UI 合同、字体、主题对比度和 typecheck；转绿后提交。

### Task 4: 五领域导航与统一应用壳

**Files:**
- Modify: `src/lib/workspace-view.ts`
- Modify: `src/components/study/AppSidebar.vue`
- Modify: `src/components/study/BottomTabs.vue`
- Modify: `src/App.vue`
- Modify: `tests/workspace-navigation.test.ts`
- Modify: `tests/responsive-shell.test.ts`

**Produces:** desktop/sidebar 与 compact/tab 共用五领域；旧路由仍兼容。

- [ ] 从 desktop 一级导航移除“最近 7 天”“已完成”，保留其可序列化路由。
- [ ] 在清单区域增加两个智能清单入口和计数。
- [ ] 保留设置为固定独立入口，全局搜索只保留一个壳层入口。
- [ ] 简化移动品牌栏，避免品牌栏、页面栏和动作栏同时重复。
- [ ] 验证侧栏排序迁移会忽略旧键并追加新键，不丢用户自建清单顺序。
- [ ] 运行导航、响应式、侧栏设置和全局搜索测试；提交。

### Task 5: 核心任务页与列表视觉重排

**Files:**
- Modify: `src/components/study/TasksView.vue`
- Modify: `src/components/study/QuickAdd.vue`
- Modify: `src/components/study/TaskDetailDrawer.vue`
- Modify: `src/components/study/TaskActionSheet.vue`
- Modify: `tests/task-detail-layout.test.ts`
- Modify: `tests/quick-add-ui-contract.test.ts`

**Produces:** 一个标题、平面任务 section、一个主动作和收敛后的详情操作。

- [ ] 用 PageHeader 替换 TasksView 自定义标题区。
- [ ] 移除 task-section 卡片阴影与重复外框，以 section、留白和单分隔线组织。
- [ ] Quick Add 保留标题、日期/时间、清单与提交；高级选项渐进披露。
- [ ] 详情顶部只保留关闭/返回和 More；删除/取消/阻塞进入分组动作。
- [ ] 底部只保留“开始/继续学习” prominent 动作。
- [ ] 运行任务、Quick Add、详情、完成路由相关测试；提交。

### Task 6: 统一 Sheet、Dialog、Popover 和表单

**Files:**
- Modify: `src/components/ui/Sheet.vue`
- Modify: `src/components/ui/Dialog.vue`
- Modify: `src/components/ui/Popover.vue`
- Modify: `src/components/study/TaskEditSheet.vue`
- Modify: `src/components/study/DatePicker.vue`
- Modify: `src/components/study/ReminderEditor.vue`
- Modify: `src/components/study/RecurrenceEditor.vue`
- Modify: `tests/modal-overlay-lifecycle.test.ts`
- Modify: `tests/popover-mobile-sheet-contract.test.ts`
- Modify: `tests/ui-control-contract.test.ts`

**Produces:** 一套 header/body/footer anatomy；紧凑端日期/重复在当前 Sheet 内推进。

- [ ] 共享 Sheet 支持 title、subtitle、back、close、footer 和 compact navigation state。
- [ ] 桌面/iPad 宽屏维持 anchored Popover；紧凑端使用 Sheet 内子页，避免同级模态叠加。
- [ ] 保留所有焦点陷阱、Escape、outside dismissal 和焦点返回语义。
- [ ] 保留重复范围“本次/今后/整个系列”和预览门禁。
- [ ] 运行 business sheet、modal lifecycle、popover、recurrence、reminder 定向测试；提交。

### Task 7: Calendar、Lists、Learning/Review 与 Settings 统一

**Files:**
- Modify: `src/components/calendar/CalendarView.vue`
- Modify: `src/components/study/TopicsView.vue`
- Modify: `src/components/study/ReviewView.vue`
- Modify: `src/components/study/RhythmView.vue`
- Modify: `src/components/study/SettingsView.vue`
- Modify: `src/App.vue`
- Modify/Add focused tests under `tests/` for each changed navigation or component contract.

**Produces:** 核心页面共用标题、section、表单与动作层级。

- [ ] Calendar 工具栏按 Today/视图/新增/More 分组，保留移动、缩放和范围语义。
- [ ] Topics 移除重复清单管理按钮，改为引用“清单”管理入口。
- [ ] Review 合并“待复习/学习记录”分段，不改变记录与复习数据。
- [ ] Rhythm 降为学习分析分段，减少与执行入口竞争。
- [ ] Settings 改为 grouped list：外观、提醒、日历与账号、数据、安全与关于/诊断。
- [ ] 运行 calendar、review、settings、search、tags 相关测试；提交。

### Task 8: 全量视觉验收与最初方案回查

**Files:**
- Modify: `scripts/smoke-soft-surface.mjs`（仅当选择器因已批准结构变化而需要更新）
- Create: `docs/experiments/ios-ui-ux-restructure-review.md`
- Modify: `VISUAL_QA.md`

**Produces:** 可复现报告、截图和逐项合规结论。

- [ ] 运行 `npm run verify`、`npm run rust:verify`、`git diff --check`。
- [ ] 在 1440×960、820×900、390×844、320×740 运行浅/深色代表流程。
- [ ] 验证今天→详情→编辑日期→开始学习→证据完成→回顾及 Calendar/Lists/Settings。
- [ ] 验证 200% zoom、reduced motion、reduced transparency、键盘焦点、无横向溢出和零 console error。
- [ ] 对照 `docs/experiments/ios-ui-ux-restructure-plan.md` 的布局、层级、间距、圆角、阴影、字体、导航、按钮和弹层逐项写 PASS/PARTIAL/NOT_RUN。
- [ ] 明确 WebView 与原生 iOS/VoiceOver/真机的证据边界。
- [ ] 提交最终实现与回顾；不在未经用户要求的情况下合并或推送。

## Self-review

- Spec coverage：布局、层级、间距、圆角、阴影、字体、组件、导航合并、弹层统一、页面改造、可访问性和最终回查均映射到 Task 1–8。
- Placeholder scan：无 TBD/TODO/implement later；平台不可用证据明确标为 NOT_RUN。
- Interface consistency：继续使用现有 WorkspaceView、ShellDestination、OverlayHost 和能力服务；新增共享接口仅为 PageHeader 与 Button 视觉角色。

