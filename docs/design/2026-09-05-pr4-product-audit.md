# PR4 产品审查与验收记录

日期：2026-09-05。状态：审查与 PR4 必做修复完成；自动化门禁和 Windows 无签名制品 smoke 已通过，原生人工观察项仍按下文保留为 `NOT_RUN` / `UNSUPPORTED`。

## 基线与范围

- 用户指定源：`.worktrees/shixue-offline-quick-add`，`feat/offline-quick-add`，HEAD `71290b1749b25b1e68ccefa5d980a5a7fa7c1042`。
- 当前源界面在 127.0.0.1:1420 运行，已核对监听进程命令指向该工作树。未使用父目录 meow-study 的旧界面。
- PR4 原计划为多提醒/Windows 调度，约定分支 `feat/multi-reminder-windows`。现场没有 PR4 分支/worktree/远端 PR，故建立同级 `shixue-multi-reminder-windows`；在 PR3 HEAD 上应用当前 tracked diff 并逐文件复制 5 个新增源码/测试文件。
- PR3 GitHub #14 仍 OPEN。此为依赖 PR3 的开发工作树，不能宣称“PR1–3 已合并”或已具备合并资格。没有修改、提交、重置或清理源工作树和源 artifacts；原始 hash 清单保存在新树 `artifacts/pr4-audit/`。
- 原计划 SettingsSheet 路径与 2026-09-05 `LOCKED / NAVIGATION AMENDED` 冲突，采用较新的 SettingsView、单一标题与自定义侧栏合同。日期统一控件、焦点、错误恢复是遵循合同的修复，不新增视觉模式。
- 检查覆盖完整任务路径、主题/回顾、设置和安全边界；日历属于 PR5，未实现页面不作为现有 UI 缺陷。

## 当前运行证据

基线截图均为本轮 `web-implementation`，路径相对于工作树的 `artifacts/pr4-audit/`：01 Today 1440、02 Settings 1440、03 Settings 820、04 Settings 320、05 小屏材质列表、06 详情 320、07 编辑 Escape 失败、08 Today 390、09 Today 1280。源数据为页面现有演示内容；仅导航/主题等界面偏好检查，不修改用户任务。

复现：320px 打开详情→编辑→Escape，编辑仍打开，焦点仍为背后“编辑任务”按钮。屏幕无页面横向溢出，但模态缺少隔离。截图尺寸和 DOM 检查分别记录，不以截图代替交互结论。

修复后证据为 `after-today-1440x960-edge.png`、`after-settings-1280x800-edge.png`、`after-detail-820x560-edge.png`、`after-reminder-editor-390x844-edge.png`、`after-settings-320x700-edge.png`、`after-settings-dark-1280x800-edge.png`、`after-settings-high-contrast-reduced-1280x800-edge.png`、`after-settings-forced-colors-1280x800-edge.png` 与 `after-web-200-percent-equivalent-720x480-edge.png`。Edge 复验中又捕获并修复了嵌套模态仍暴露底层内容和根布局 `100vw`/`min-width` 导致窄窗横向滚动两项问题；修复后 720px 与 320px 均满足 `scrollWidth === clientWidth`，顶层编辑之外的详情与工作区具备 `inert`/`aria-hidden`，关闭编辑后焦点返回“编辑任务”。

独立 Web smoke 进一步暴露 820–1279px 会在导航后自动选首任务并弹出模态详情，导致新页面和快速新增被正确隔离后无法操作。自动选择现已限定为 1280px 及以上的并排详情布局；中等宽度保持列表可操作，用户主动打开任务时仍使用模态详情。

## 按优先级排列的清单

没有确认 P0。P1 表示可能造成误操作/错误提醒或破坏核心键盘路径；P2 为可恢复的一致性、信息或可访问性问题。每项仅基于当前运行/源码证据，不把个人审美偏好列为缺陷。

| ID / 优先级 | 当前证据、影响 | 最小方案与组件依据 | 涉及文件 | 验收 / 方法 | PR4 必做 |
| --- | --- | --- | --- | --- | --- |
| A1 P1 | 07 截图，编辑 Escape 无效且焦点在背景；TasksView 全局快捷键可更换任务或完成任务 | 编辑使用共享 Dialog/OverlayManager，后台快捷键遇活动模态退出；同一 Portal 和返回焦点协议 | TaskEditSheet、TasksView、ui/Dialog、use-overlay | Tab 困在前景，C/J/K 不改背景，Escape 只关顶层并返回；浏览器+定向测试 | 是 |
| A2 P1 | DateTimePicker 将 abc 改为09:00、99:99截为23:59，用户保存非意愿时间 | 复用现有时间校验，保留非法草稿、就地错误、禁止应用；复用日期网格键盘语法 | ui/DateTimePicker、TimePicker、DatePicker | 无效输入不写值；9:00归一09:00；日期键盘可达；测试+浏览器 | 是 |
| A3 P1 | Rust scheduler 不读前端开关，前端启动能申请权限；“仅数量”与实际标题不一致 | 权限仅用户首次设置/测试请求；明确显示通知内容和能力范围；新调度前停止旧发送，统一事务账本 | App、SettingsView、notification、reminder_scheduler、reminder commands | 启动零权限请求、关闭即不投递、失败可重试；自动测试+Windows证据另列 | 是；平台验收不可省略 |
| A4 P1 | 原多提醒计划尚无单一权威 claim/ack 与旧账本迁移，兼容单提醒删除规则可破坏引用 | 先锁定持久化迁移/并发/崩溃政策，再接平台；保留未知legacy记录 | workspace、capabilities、reminders、Rust adapter | 并发只一方领取，重启不重放已ack，snooze不改计划，未知行不猜测；故障测试 | 原 PR4 必做 |
| A5 P2 | Settings 页面仍同时高亮 Today；源码两个 aria-current | 依真实 page/具体list计算唯一当前目的地，保留排序协议 | AppSidebar | 今天/清单/主题/回顾/设置各恰一个当前项；DOM+测试 | 是 |
| A6 P2 | 云下载只刷新 StudyState，recurrenceWorkspace仍旧 | 统一刷新读取模型；属于成功反馈的真实性修复 | App | mock导入重复/标签后无需重载即可一致；定向测试，真实云NOT_RUN | 是 |
| A7 P2 | localStorage getItem 抛错发生在初始化 finally 外，loading 永不结束 | 偏好读失败回退默认并报告，领域初始化继续 | App、偏好helper | 注入读失败仍加载工作区；测试 | 是 |
| A8 P2 | resetSidebarOrder 吞掉写失败后无条件成功通知 | 持久化返回结果，仅成功反馈；既有Toast模式 | App | 写失败保留旧顺序且只有错误；故障测试 | 是 |
| A9 P2 | 导入/重置确认仅泛化警告，没有覆盖数量；导入失败清空候选 | 确认前只读解析，显示当前/候选清单任务记录数量，取消不写，失败可重试；共享危险Dialog | SettingsView、App、study import helpers | 非法备份不可确认，空备份摘要可见，取消不写；浏览器+测试 | 是 |
| A10 P2 | Listbox Tab 退出未关闭；Teleport 子层与父模态焦点边界分离 | 统一选择浮层 Tab/Shift+Tab 关闭并按触发器表单顺序移动 | ui/Listbox、Popover、Dialog | Tab到相邻表单项且不落后台，Escape回触发器；浏览器 | 是 |
| A11 P2 | 06 全屏详情仍为普通aside，焦点留在被盖任务；检查项只有CSS状态 | 并排详情保持aside，覆盖时走共享焦点/关闭协议；检查项用aria-pressed | TaskDetailDrawer、TasksView | 820/390打开进入详情，关闭回任务；检查状态可读；浏览器 | 是 |
| A12 P2 | 默认closeBehavior=ask未接线，Rust始终hide；自启配置不能当系统实态 | 按平台能力呈现真实状态；关闭采用现有Dialog，托盘退出绕过询问 | window lifecycle、tray、App、SettingsView、lib.rs | ask/tray/quit与失败恢复测试；原生进程/托盘单列 | 原 PR4 必做 |

## 修复结果

- A1、A10、A11 已统一到共享 overlay 焦点栈：顶层处理 Escape/Tab，底层对话框与工作区使用 `inert`/`aria-hidden` 隔离，背景快捷键停用，覆盖式详情进入后可返回原任务；检查项暴露可读状态。
- A2 已改为保留非法日期/时间草稿并显示错误，非法值不能提交；日期网格、时间输入和相邻字段继续使用统一键盘路径。
- A3、A4 已由共享 reminder capability 账本负责规则、投递、claim、ack、恢复、重试与 legacy 迁移；Rust 只发轮询 tick，不再维护第二套发送账本。启动查询权限不会弹窗，只有首次启用提醒或显式测试可请求权限；未知 legacy 行失败关闭并保留证据。
- A5 已按当前真实目的地计算唯一可见、可访问的 `aria-current`；A6 使用一次工作区读取同时刷新两套投影；A7 的设备偏好读取失败不再阻塞工作区初始化。
- A8、A9 的失败路径不再显示成功：侧栏写失败保留旧值，导入/重置先显示实际数量，导入失败保留已验证候选供重试。
- A12 已接通 ask/tray/quit、托盘快速新增和系统实际 autostart 状态；异步原生能力初始化期间卸载也不会在 teardown 后重新创建计时器。原生交互是否符合预期仍以人工 Windows 项为准。
- 窄窗根布局改用可用宽度，移除根节点固定最小宽度；未用 `overflow-x: hidden` 掩盖溢出。对应布局回归测试覆盖 320px 与移动断点。

## 显示和材质判断

继续使用当前系统的 Manrope/Noto、深墨/雾灰/鼠尾草，不更换字体或色板。日期/计时/数值采用 tabular-nums 以避免跳动；正文和标题不应普遍改为等宽。代码和标识符只有实际显示且需逐字符辨别时用已有等宽栈。长任务/主题必须在详情可读，列表可截断但保持可访问名。

后续运行矩阵记录浅色、深色、高对比、减少透明度、减少动效、200%缩放的布局/焦点/颜色测量。测量通过只证明已测状态，不构成完整 WCAG 或原生读屏合规声明。导航/浮层可用玻璃，内容层保持不透明；若现有语义 token 已满足对比度，不进行纯审美重绘。

## 验证状态

- [x] 源工作树/分支/未提交改动/原 artifacts 保护清单
- [x] 当前源界面五个指定视口的基线截图
- [x] 源码审查与复现问题清单
- [x] PR4 必做问题修复、定向测试
- [x] 完整 `npm run verify`：457/457 tests、0 skipped，通过 typecheck、桌面/Web build、layout、docs、protocol、CSP 与 desktop/web/mobile modules
- [x] `npm run rust:verify`：11/11 Rust tests，通过 check、clippy、默认及 all-features 编译
- [x] Windows 无签名本地制品：`Shixue_0.2.3_x64_Setup.exe`（9,399,119 bytes），SHA-256 `37fd6f9c17ddfbf0ff163f135486e1a65b540832d976ed284f1bbb7c1801600d`
- [x] Windows 无签名本地制品：`Shixue_0.2.3_x64_Installer.msi`（11,337,728 bytes），SHA-256 `0f39fb866a3b4e26da673ee9fc05bd77099a7bb2344fdec6793b8757e7805dce`
- [x] Windows 无签名本地制品：`Shixue_0.2.3_x64_Portable.exe`（22,780,928 bytes），SHA-256 `629c9909aa8d077f69d9fae727fd17596248d90b162e9d07e2fff56fb4d2a3d9`
- [x] `npm run smoke:windows-package` 自动部分 `PASS`：NSIS 构建、隔离静默安装、安装后进程存活探针
- [x] 浏览器核心操作链、非法时间错误恢复、模态焦点/背景隔离；Edge console warnings/errors 为 0，fresh-browser smoke 的 page errors 为 0
- [x] 浅色、深色、高对比、减少透明度、减少动效、强制颜色与指定视口截图验收；720×480 作为 Web 200% 等效布局压力检查，系统 200% 仍归入下方 Windows 人工项
- [ ] Windows 人工原生验收：首次提醒权限、单任务双提醒、稍后、完成、隐藏/恢复/退出托盘、退出后静默和系统 200% 缩放均为 `NOT_RUN`

Windows 原生通知操作按钮当前为 `UNSUPPORTED`，应用内提醒卡承接 Complete / Snooze / Open；自动 smoke 的 `PASS` 只证明包、安装和进程生命周期，不证明通知已显示或托盘行为已被观察。iOS/iPadOS、Android、真实云同步当前均 `NOT_RUN`。日历拖动/冲突属于 PR5；不在本轮凭空新增日历。原生权限、后台唤醒、系统字体与屏幕阅读器测试须在有对应运行证据后更新状态。
