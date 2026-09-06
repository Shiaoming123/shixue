# 拾学 × Todofy 功能对标与落地说明

> 状态：实现基线（2026-09-04）
>
> Todofy 审计基线：[`ff736f53`](https://github.com/salarzeidanlou/todofy/tree/ff736f53eda116ce22a3d933d35f3054899c95d7)
> 方法：以提交固定的 React、Zustand、Tauri/Rust、SQLite、提醒与同步源码为依据，不以 README 或截图代替实现审计。

## 1. 当前项目基线

拾学沿用 MeowStarter 的 Vue 3 + TypeScript + Vite + Tauri 2 技术栈。桌面端以 SQLite 保存一个经过版本化校验的 `WorkspaceStateV3` 快照，Web 端以 IndexedDB 保存同一数据模型；模块能力同时受前端配置、运行时 capability、Cargo feature 与 Tauri permission 约束。

UI 沿用 `study` 主题和既有 token，并把色板收敛为雾灰玻璃、深墨与叶绿强调色；桌面采用导航、列表、详情三栏，移动端采用单栏与底部导航。此次没有引入新组件库或第二套设计语言。

任务主模型是 `Task`，不是脚手架遗留的 `Todo`：`mode: general` 承载通用个人规划，`mode: learning` 作为可选专业模式继续通过连续 `TaskEvent`、专注 `StudySession` 和 `CompletionRecord` 形成可追溯学习证据链。

### 本分支已落地的基础合同

| 基础能力 | 当前状态 | 边界 |
| --- | --- | --- |
| WorkspaceStateV3 与导入导出 | 已实现 | 新导出为 `meow-study/workspace-export` v3；旧 `study-export` v1/v2 先完整迁移、校验，再替换 |
| 能力协议 | 已实现 | 协议版本保持 v1；命令预演、幂等、revision 校验和单次 CAS 保存由统一服务负责 |
| 线上写入路径 | 已实现 | 当前 UI、键盘、通知兼容路径经能力服务写入；不允许绕过服务直接写持久化快照 |
| 主题控件基础 | 已实现，本轮仅做编译验证 | 已有 overlay、popover、listbox、checkbox、switch、dialog、toast 与日期时间控件；本轮不把未运行的交互/视觉检查写成已验证 |
| 重复发生项投影 | 已实现 | `projectTaskItems` 以 `task:<id>` / `occurrence:<id>` 生成稳定行；Today 合并计划、截止、逾期与重复来源，一次发生项只显示一次并保留全部原因；全天发生项保留 `scheduledOn`，不伪造成午夜时间戳 |

`WorkspaceStateV3` 为后续能力预留集合不等于对应业务已经交付。重复规则与发生项、离线自然语言快速新增已实现并通过 focused tests 与真实 Web smoke；共享投递账本、多提醒规则、应用内动作卡、按需通知权限、托盘关闭策略与显式开机启动设置也已实现。当前日历分支增加日/周/月/议程、未安排任务托盘、预览式指针放置/调整和完整键盘替代，并通过隔离 Web 持久化 smoke。Windows 安装包中的系统通知、托盘交互、日历原生壳流程和 200% 系统缩放仍为 `NOT_RUN`，不能由单元测试或 Web 证据代替。Agent 行为仍是计划项；`source: agent` 只是能力信封的调用来源标记，不代表已经存在自动规划或执行 Agent。

## 2. 实际源码审计范围

审计覆盖 Todofy 的以下实现，而不只包括展示材料：

- CRUD 与状态：[`commands.rs`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src-tauri/src/commands.rs)、[`store.ts`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/store.ts)
- 快速新增与全局捕捉：[`QuickAdd.tsx`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/components/QuickAdd.tsx)、[`QuickCapture.tsx`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/components/QuickCapture.tsx)
- 详情编辑与子任务：[`TaskDetail.tsx`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/components/TaskDetail.tsx)、[`SubtaskList.tsx`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/components/SubtaskList.tsx)
- 搜索、过滤、分组与排序：[`SearchBar.tsx`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/components/SearchBar.tsx)、[`grouping.ts`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/lib/grouping.ts)
- 快捷键：[`useKeyboard.ts`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/lib/useKeyboard.ts)
- 本地数据库、提醒、重复任务与调度：[`db.rs`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src-tauri/src/db.rs)、[`notify.rs`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src-tauri/src/notify.rs)、[`recur.rs`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src-tauri/src/recur.rs)
- 账号与同步：[`auth.ts`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/lib/auth.ts)、[`sync.ts`](https://github.com/salarzeidanlou/todofy/blob/ff736f53eda116ce22a3d933d35f3054899c95d7/src/lib/sync.ts)、Supabase migrations 与 Rust secret/sync 命令。

Todofy 仓库声明的许可不允许直接复制，因此这里只借鉴交互与架构事实，所有拾学代码均按自己的领域模型独立实现。

TickTick 的公开产品形态以其[功能页](https://ticktick.com/features)、[Windows 页面](https://ticktick.com/windows)、[更新记录](https://ticktick.com/public/changelog/en.html)与[帮助中心](https://help.ticktick.com/)为准。v0.2.3 已借鉴三栏桌面信息架构、移动端单栏推进、智能清单、清单管理、日期与多级优先级；2026-09-04 确认的下一阶段再引入日历多视图、重复规则、离线自然语言和多提醒。协作、习惯、倒数日与 AI 执行仍不在本阶段。未登录付费账号，因此付费边界与登录后拖动手感不作为已验证事实。

## 3. 功能对比与取舍

| 能力 | Todofy 实现事实 | 拾学取舍 | 当前落地 |
| --- | --- | --- | --- |
| 新增 | 快速输入支持日期、优先级、重复和标签 | 直接借鉴低摩擦输入；高级字段留在编辑步骤 | 视图感知快速新增；中英文离线解析结果以可编辑 chip 呈现，原标题默认保留；今天视图自动带入今天；`N` 已在 Web smoke 验证，`Ctrl+Alt+A` 仅有 source/mock 验证 |
| 查询 | SQLite 全量读取，前端派生视图 | 按现有快照 Store 重写 | SQLite/IndexedDB 共用版本化 `WorkspaceStateV3`，现有学习界面由兼容投影读取 |
| 编辑 | 标题/笔记失焦保存，其他字段立即保存 | 重写为显式表单事务，避免多个字段部分成功 | 标题、笔记、清单、计划/截止日期、精确提醒、优先级、时长、完成标准一次校验保存 |
| 删除 | SQLite tombstone 软删除 | 直接借鉴 tombstone 思路，但必须保留证据链并结束活动 session | 单项/批量二次确认；任务隐藏，事件、session、completion evidence 保留 |
| 状态 | active/done 二态 | 与拾学证据闭环冲突，分成即时勾选与学习收尾 | 普通勾选立即完成/重开；专注完成仍可记录成果、证据、下一步与复习 |
| 分类 | 多对多 labels，没有独立清单实体 | 按拾学方式重写 | 保留 `StudyTopic` 作为学习清单业务实体，并新增独立 `StudyListGroup`：清单可创建、编辑、归档、分组、筛选和移动任务，同时继续承载学习目标；不再为同一业务重复维护一套 `TaskList` |
| 过滤 | smart view + label/priority 多选 | 复用交互层次 | 收件箱、今天（含逾期）、最近 7 天、全部、已完成；清单与优先级可组合筛选 |
| 排序 | 手动 orderIndex 为主，分组内 pinned first | 做得更好：用户可显式选择且结果确定 | 手动顺序、最近更新、截止日期、优先级、标题；纯函数且不改输入 |
| 搜索 | 标题和笔记的大小写不敏感子串 | 做得更好 | 标题、笔记、主题、完成标准、检查项、阻塞原因统一搜索；`/` 聚焦 |
| 子任务 | JSON 数组整体重写 | 按学习动作语义重写 | checklist 稳定 ID、逐项切换与新增；不会误触发任务完成 |
| 批量 | 只有“逾期移到今天” | 做得更好 | 多选后批量完成、移到今天、软删除；写入保留 CAS 与事件链 |
| 持久化 | Tauri SQLite，本地优先 | 保持现有跨端抽象 | 桌面 SQLite、Web IndexedDB；导入前完整校验，失败不覆盖 |
| 导入导出 | 参考项目不是本轮重点 | 补齐前两日建议 | JSON 导出；JSON 文件选择、风险确认、版本迁移和完整替换 |
| 键盘 | `/`、`n`、`j/k`、`e`、完成、删除、帮助等 | 按 Vue 事件层重写 | `/`、`N`、`J/K`、`E`、`C`；输入控件内不劫持按键 |
| 全局捕捉 | 独立 always-on-top 窗口 | 使用现有主窗口与模块契约重写，减少窗口状态复杂度 | 桌面 `Ctrl+Alt+A` 的注册及显示/恢复/聚焦调用已有 source/mock 验证；真实原生运行时端到端为 NOT_RUN |
| 提醒 | Rust 后台每 20 秒检查，窗口隐藏时仍可提醒 | 用共享能力账本解决规则、认领、确认与恢复；Rust 只发 tick | 多条开始/截止偏移或绝对提醒可独立排程与稍后提醒；权限只在首次启用或显式测试时请求；原生动作按钮当前 `UNSUPPORTED`，应用内卡提供完成、稍后与打开。Windows 后台真实投递仍为 `NOT_RUN` |
| 账号同步 | Supabase、LWW、1.5 秒 debounce、30 秒轮询 | 保持可选且 fail-closed；token 不进入 WebView 持久层 | 快照协调器、Rust/keyring 适配器、RLS/CAS migration 与可选设置入口；未配置/未登录时零网络 |
| 空/错状态 | 视图区分空状态；CRUD 错误多为静默 | 做得更好 | 搜索/筛选空状态可恢复，存储错误使用 alert 与 toast，写入失败不伪装成功 |
| 移动端 | 小屏隐藏部分导航且无完全替代 | 做得更好 | 全部核心导航保留，详情全屏，筛选/批量操作可触控且不横向遮挡 |
| 无障碍 | 有焦点环；dialog、嵌套交互、拖拽仍有缺口 | 做得更好 | 原生 button/input/select、显式 label、dialog/alertdialog、aria-live、44px 触控目标、reduced-motion |

### 不直接照搬的 Todofy 模块

- `pinboard`：优先级已经进入任务模型、筛选与排序，不再增加一套相互竞争的置顶事实源。
- 重复任务：Todofy 完成后推进同一任务日期；拾学以 `RecurrenceSeries + TaskOccurrence` 独立实现，完成/跳过只改变当前发生项。查询投影分别展示发生项计划与任务截止，不通过推进父任务日期伪造完成历史。
- Pomodoro 与 Journal：拾学已有可暂停/恢复的 `StudySession`、scratchpad 和 completion records；重复引入同类模型会造成两套计时和笔记事实源。
- 自然语言日期解析：已以完全离线、确定性的中英文解析器实现；识别结果先显示为可编辑 chip，默认不删除标题原文，避免误计划。
- 指针拖拽：Todofy 为规避 WebView 原生 DnD 问题自行实现 Pointer Events。拾学的日历拖动同样采用 Pointer Events，但释放前只更新预览，释放后统一调用能力命令，并提供完整键盘替代。

## 4. 模块拆分与验收点

| 顺序 | 模块 | 验收点 | 状态 |
| --- | --- | --- | --- |
| 1 | 数据模型与持久化 | 旧 v1 可迁移；v2 事件链连续；SQLite/IndexedDB 均可重开；非法导入不覆盖 | 已通过 |
| 2 | 查询层 | 搜索/状态/主题/排序可组合；不修改输入；删除项永不出现 | 已通过 |
| 3 | 单项组件 | 三栏任务工作区、优先级与提醒元信息、详情抽屉、检查项、无文案空状态 | 已通过 |
| 4 | 增删改 | 快速新增；中英文日期/优先级/标签候选可编辑并原子提交；元数据 CAS 更新；删除保留证据；编辑/删除有确认和反馈 | 已通过 |
| 5 | 状态切换 | 普通勾选即时完成/重开；证据式完成继续生成 CompletionRecord；活动 session 安全结束 | 已通过 |
| 6 | 筛选分类排序 | 五个智能清单 + 清单分组 + Topic + priority + search 组合；五种确定排序；桌面与移动端均可管理和切换 | 已通过 |
| 7 | 批量操作 | 完成、移到今天、软删除均有明确反馈；领域批量命令保持全量预验证 | 已通过 |
| 8 | 导入导出 | 浏览器真实下载和文件选择；确认后校验替换；学习证据可找回 | 已通过 |
| 9 | 快捷键 | 输入控件内不劫持；`/`/`N`/`J`/`K`/`E`/`?` 可用；全局快捷键只在桌面注册一次 | 页面快捷键已通过；`Ctrl+Alt+A` source/mock 已通过，原生 focus/restore 为 NOT_RUN |
| 10 | 提醒 | 多规则独立投递；稍后提醒不改任务日程；共享认领/确认可重试；启动不请求权限；应用内动作幂等 | 领域、模块与界面合同已通过；Windows 系统通知、托盘后台投递与退出后静默为 NOT_RUN；原生动作按钮 UNSUPPORTED |
| 11 | 账号同步 | 默认关闭；无配置/会话时零请求；冲突可解释；token 仅在 Rust/keyring；RLS 隔离用户 | 代码与离线门禁已通过；真实 Supabase/RLS/双设备 E2E 为 NOT_RUN |
| 12 | 响应式与无障碍 | 日历五个 Web 固定视口实测；主题化日期 `grid`、桌面 Popover/移动 Sheet 无裁切和页面横向滚动；无 console/page error | Web 已通过；Windows 原生缩放/高对比 NOT_RUN |

## 5. 验证入口

```powershell
npm test
npm run check:protocol
npm run check:modules
npm run typecheck
npm run build
npm run build:web
npm run rust:verify
npm run smoke:web-persistence
npm run smoke:calendar
```

Web 烟测会真实走过重置、输入 `明天下午3点 复习线代 #数学 p1`、编辑计划时间 chip、刷新后核对原标题与结构化计划/优先级/标签、编辑日期/优先级/笔记、搜索、即时完成和已完成视图；同时在 1440×960 与 390×844 保存 picker 打开状态截图，并把 console/page error 作为失败处理。

日历烟测另以隔离浏览器数据库种入重叠日程、仅截止事项、重复发生项和未安排任务，真实执行指针放置、指针调整时长、键盘移动、月/议程切换及刷新恢复；截图覆盖 `VISUAL_QA.md` 的五个 Web 固定视口。它还硬性核对 42 格日期 ARIA 网格、820px 图标侧栏、移动 Sheet 的名称/模态语义/焦点闭环、44px 移动目标，并拒绝页面横向滚动、视口外浮层和可见的未经适配原生控件。该证据标记为 `web-implementation`，不升级 Windows/Tauri 原生验证状态。

发布 bundle 性能基准在 Windows 10.0.22631、Node 24.14.1、x64、AMD Ryzen 7 9850X3D 上运行，fixture 包含 10,000 个任务、1,000 个活动重复系列和 50,000 个发生项。一次不计时预热后运行 7 次样本并取中位数：Today 7.9 ms、7 天 7.6 ms、日历 42 天范围 138.1 ms（实际投影 41,960 项），分别低于 100/100/150 ms 门槛；本机单次运行最大值为 10.7/8.0/143.9 ms。该结果只记录数量与环境，不输出任务内容，不代表其他硬件具有相同耗时。

## 6. 下一阶段详细方案

2026-09-04 的产品访谈已确认“时间规划优先”的六 PR 路线。v2→v3 数据迁移、能力协议与现有写入切换、统一控件基础、重复发生项、离线自然语言快速新增、多提醒与托盘业务已在对应阶段落地；PR5 日历分支实现日/周/月/议程和未安排任务交互，并完成上述 Web 验收。Windows 原生壳与安装包仍按证据边界保持 `NOT_RUN`。Agent 行为仍是计划，不因 v3 类型或命令来源占位而视为已交付。总规格见[拾学通用待办与时间规划基础规格](./superpowers/specs/2026-09-04-shixue-time-planning-foundation.md)。根目录 `DESIGN.md` 与 `VISUAL_QA.md` 分别约束视觉实现和验收；在代表性方案得到确认前，业务实现不得自行冻结新视觉。
