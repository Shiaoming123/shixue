# iOS 开发规划与执行指引

本文把拾学的 iOS 工作接入当前时间规划路线，供 iOS 与共享业务开发同步推进。它记录的是执行边界和验收顺序，不把“已有响应式页面”或“Tauri 支持 iOS”当成原生可交付证据。

## 1. 当前基线

截至 PR5（日历工作区）合并：

- `WorkspaceStateV3`、v1/v2 迁移、`WorkspaceStore` 与事务能力服务是跨端共享的数据和写入边界。
- recurrence 规则、date-only/timed schedule、occurrence materialization、离线快速日期解析、多提醒账本、日历投影/移动/缩放和对应 capability commands 已进入共享 TypeScript 层；iOS 只复用，不另建原生规则实现。
- Vue 界面已有窄屏布局、安全区和移动端导航基础；这些只证明前端适配，不证明 iOS 工程可编译或可运行。
- Rust 入口已有 `tauri::mobile_entry_point`，托盘、单实例、更新器、全局快捷键和提醒调度器按桌面目标隔离。
- 通知插件可在移动端装配，但当前前端轮询不能保证应用挂起或终止后的投递；原生后台提醒仍未实现。
- Android 已有调试构建证据；iOS 已在 macOS/Xcode 26.6 上执行 `tauri ios init` 并完成 Apple Silicon Simulator 无签名 Debug 原生编译。最新模拟器启动在 Wry WebView 初始化、前端与 SQLite 运行前以 `SIGTRAP` 失败，因此没有模拟器成功、真机、签名或商店证据。

iOS 基础分支已同步 `origin/main@140c012`，包含 PR2、PR3、PR4 和 PR5。PR6（导航/集成/发布）尚未实现；它可以与 iOS 运行阻断排查并行，但不得从未合并的功能分支复制生成工程或领域规则。

## 2. 与整体路线的并行关系

| 主路线 | iOS 同期工作 | 合并约束 |
| --- | --- | --- |
| PR1：领域基础 | 已合并；复用 V3、store 和 capability service | 所有状态修改继续经过共享事务边界 |
| PR2：重复任务 | 已合并；iOS 直接消费共享 recurrence/occurrence 合同 | 不在 Swift/Rust 复制规则；运行恢复后补 V3 重启持久化证据 |
| PR3：快速添加 | 已合并共享解析器；待验证触摸输入、键盘弹出、日期选择和前后台恢复 | iOS 不实现桌面全局快捷键；用可见的 App 内入口替代 |
| PR4：多提醒/Windows 调度 | 已合并共享规则、delivery 账本和命令；待实现 iOS 本地通知适配器 | Windows 托盘轮询与 iOS 系统调度分离，共用规则和能力命令 |
| PR5：日历工作区 | 已合并共享投影、命令和 Web 交互；待验证 iOS 紧凑宽度、动态字体、手势与可见操作替代 | 日历投影和命令共享，平台层只负责交互与呈现 |
| PR6：导航/集成/Windows 发布 | 收口 iPhone/iPad 导航、场景恢复和跨端视觉一致性 | Windows 发布不阻塞 iOS 基础开发；iOS 发布另设证据链 |

`feat/ios-foundation` PR 只完成原生工程、编译、存储和平台降级。提醒、日历 iOS 验证与发布能力分别进入后续小 PR，避免一个长期 iOS 大分支持续漂移。

## 3. iOS 分阶段交付

### I0：环境就绪

前置条件：一台可运行项目所需 Xcode 版本的 macOS 设备。Windows 和 PowerShell 7 可以继续用于共享代码开发，但不能产生 iOS 编译证据。

在 macOS 上安装并检查：

```bash
xcodebuild -version
xcode-select -p
pod --version
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
npm run mobile:doctor
```

模拟器初始化和编译不需要 Apple Developer 账号。真机、Archive 和 TestFlight 开始前才需要确认 Apple Developer Team、`com.shiaoming123.shixue` 的 Bundle Identifier 所有权、签名/Provisioning 管理方式和测试设备。证书、私钥、Provisioning Profile、账号 token 及其路径不得提交到仓库或输出到日志。

完成定义：doctor 明确报告 Xcode、CocoaPods 和 Rust iOS targets 可用。仅安装 Command Line Tools 不算完成。

### I1：iOS 原生基础 PR

从最新远端主线创建隔离 worktree，不切换或清理已有工作区：

```bash
git fetch --prune origin
git worktree add -b feat/ios-foundation ../shixue-ios-foundation origin/main
cd ../shixue-ios-foundation
npm ci
npm run tauri -- ios init
```

执行内容：

1. 默认沿用 Android 的可重建生成工程策略，让 `src-tauri/gen/apple/` 保持忽略；把初始化参数和后续原生修改固化为脚本或受控补丁。只有 entitlement、通知扩展等无法重建的必要修改出现时，才窄范围解除 `gen/apple/` 的忽略并单独审查，始终排除 DerivedData、`xcuserdata` 和签名材料。
2. 给主窗口添加明确覆盖 iOS 的 capability；桌面 updater capability 继续只覆盖 Linux、macOS 和 Windows。检查默认 capability 中的窗口、global-shortcut 和插件权限在 iOS 生成/编译时是否有效，必要时拆出移动端 capability。
3. 确认 `tray`、`single-instance`、`updater`、`global-shortcut`、桌面提醒调度器及 `autostart` 不进入 iOS 目标。`autostart` 的 Rust 注册和依赖都应受 `desktop + feature` 双重条件约束。
4. 让 iOS 使用现有 SQLite `WorkspaceStore`，启动时只经 V3 解析/迁移入口读写。
5. 验证首次启动、写入一条任务、结束并重新启动后数据仍存在。
6. 用可靠、可注入的原生平台来源替换仅凭 User-Agent 判断桌面/移动端的关键能力路由，尤其验证 iPad；能力清单必须同时满足“平台支持、Cargo feature 已编译、capability 已授权”，不能只靠静态声明。
7. 校准当前移动端 `native-clipboard` 声明：默认 Cargo feature 和 capability 未启用时不得报告可用；云同步仍保持桌面限定，直至 iOS 安全凭据存储有明确方案。
8. 检查 `viewport-fit=cover` 与 `env(safe-area-inset-*)` 在 WKWebView 中实际生效；记录 Blob 下载、文件选择式导入在 iOS 上是已验证、需原生分享/文件适配，还是明确不可用。
9. 记录实际生成的 Xcode scheme、最低系统版本和使用的模拟器型号，后续 CI 不依赖开发机默认值。

最低自动门槛以编译为主：

```bash
npm run typecheck
npm run build
npm run mobile:ios:prepare -- aarch64-sim
npm run tauri -- ios build --debug --target aarch64-sim
```

上述命令面向 Apple Silicon 模拟器；Intel 模拟器使用 `--target x86_64`。若官方 CLI 仍触发签名或无法稳定复现，必须完成无签名的 iOS Simulator `xcodebuild`，并把准确的 workspace、scheme 和 destination 命令固化到脚本后再合并。不能用 Web/Vite 构建代替 iOS 原生编译。

Tauri CLI 2.11.4 不会覆盖上一次生成的 Simulator `.app`，连续构建时会在归档完成后以 `Directory not empty` 退出。`mobile:ios:prepare` 只清理当前 target 对应的、被 Git 忽略的旧 `.app` 和 AppleDouble sidecar；它不修改生成工程、源码或签名材料。Intel 模拟器改用 `npm run mobile:ios:prepare -- x86_64`。

完成定义：干净 checkout 能重复完成前端构建和 iOS Simulator 原生编译。模拟器启动与持久化结果单独标注；未执行时写 `NOT_RUN`，不影响“编译就绪”，但不得声称“模拟器验证完成”。

### I1 实际证据快照（2026-09-05）

| 检查 | 状态 | 实际证据 |
| --- | --- | --- |
| macOS 工具链 | PASS | Xcode 26.6 (17F113)、CocoaPods 1.17.0、Rust iOS 三个 targets、`npm run mobile:doctor` ready |
| 工程生成 | PASS | `npm run tauri -- ios init`；生成且忽略 `src-tauri/gen/apple/`，scheme `meow-study_iOS`，minimum iOS 14.0 |
| 前端门槛 | PASS | `npm run typecheck`、`npm run build` |
| 原生 Simulator 编译 | PASS | `npm run mobile:ios:prepare -- aarch64-sim` 后执行 `CARGO_TARGET_DIR=/Users/wuling/Library/Caches/shixue-ios-foundation/cargo-target npm run tauri -- ios build --debug --target aarch64-sim --no-sign --ci`，产出 `build/arm64-sim/拾学.app` |
| iPhone 17 Pro / iOS Simulator 26.5 启动 | FAIL | `simctl install` 与 `simctl launch` 成功返回 pid，但进程以 `SIGTRAP` 退出；crash 栈在 Wry 0.55.1 `platform_webview_version` 的 `NSBundle::bundleWithIdentifier`，发生在 WebView 与前端启动前 |
| WorkspaceStateV3 SQLite 写入与重启读取 | NOT_RUN | 应用未到达前端/SQLite 写入路径；仅发现沙盒数据库文件不构成迁移或持久化验收 |
| safe area、viewport-fit、系统字体、44pt 触控、Blob 下载/HTML 文件输入 | NOT_RUN | 源码含相应设计和 viewport 声明，但尚无 WKWebView 运行证据 |
| 真机、TestFlight、App Store | NOT_RUN | 未请求或使用签名材料、Apple Developer 身份或发布权限 |

本工作区位于 exFAT 卷时，Tauri/Cargo 读取 capability 前会受到 AppleDouble
sidecar 干扰。每次原生 Simulator 构建先运行 `npm run mobile:ios:prepare -- <target>`，并把
`CARGO_TARGET_DIR` 指向本机 APFS 缓存目录；这两步是可重复编译所需的环境
准备，不是运行成功的证据。

该故障在应用业务代码、`runtime_platform` command、SQLite 以及 capability service 执行之前发生。I1 不通过复制 Swift/Rust 状态机或绕过 capability service 规避它；恢复运行后，首个验收仍是 V3 任务写入、彻底终止、重启读取，再继续视觉与文件输入验证。

### I2：共享功能持续接入

PR2 的 recurrence/occurrence、PR3 的快速日期解析、PR4 的提醒账本和 PR5 的日历投影/命令已保持平台无关。iOS 只提供以下适配：

- 输入：触摸命中区不小于 44×44pt，支持动态字体、屏幕键盘和安全区。
- 导航：iPhone 使用不超过五项的底部一级导航；更多入口进入明确的列表/更多页面。iPad 可转换为侧栏，但路由描述保持一致。
- 快速添加：保留 App 内按钮和键盘操作；桌面全局快捷键不是 iOS 能力。
- 日历：拖动和手势必须有可见按钮或编辑表单替代；拖动中的状态只作预览，提交仍走 capability service。
- 生命周期：前后台切换或系统回收后，从持久层恢复；不要依赖常驻 WebView 定时器。
- 导入导出：浏览器 Blob 下载和文件输入只有在 WKWebView 实测通过后才能保留；否则接入系统分享表单和文件选择器。

每个共享 PR 至少确认 `npm run typecheck` 和 `npm run build`。触及 Rust、Tauri 配置、插件或生成 Apple 工程时，再增加 iOS 原生编译；纯领域 TypeScript 变更不强制每次重建 Xcode 工程。

### I3：原生提醒

iOS 提醒与 Windows 提醒共享 `ReminderRule`、幂等 delivery id、snooze/complete capability command，但实现不同：

共享 delivery id、状态所有权和 claim/ack 语义以 [PR4 提醒计划](./superpowers/plans/2026-09-04-multi-reminder-windows-scheduler.md) 确定并合入主线的契约为依赖；I0/I1 不等待它，I3 不另建一套竞争的业务投递账本。iOS 系统请求标识映射到同一 delivery id，但“系统接受调度”不等于“已经投递”，不得直接据此确认 delivered。沿用共享重试/恢复边界，并单独验证挂起、终止及动作重复回调；系统提交与本地 ack 无法原子完成，不承诺 exactly-once 投递。

- Windows：应用/托盘调度器负责轮询和动作回传。
- iOS：由系统本地通知调度负责后台投递，不能要求应用常驻。

实现要求：

1. 只在用户第一次创建提醒时请求通知权限，不在启动或 onboarding 时请求。
2. 规则保存与系统调度分两步；权限拒绝时保留规则，并显示“无法投递”的可恢复状态。
3. 创建、修改、完成、删除、撤销和 snooze 都要重算或撤销对应系统请求。
4. 时区、夏令时和系统时间变化后重新协调未来请求。
5. 系统通知动作回到应用后仍通过 capability service 写入，禁止绕过 CAS、审计和幂等边界。

完成定义：原生编译通过；模拟器或真机投递、拒权、修改、撤销和重启恢复属于独立运行证据，未执行不得升级成熟度声明。

### I4：iOS 集成与发布候选

功能冻结后完成：

- 冷启动、热启动、后台恢复、深链/通知打开路径。
- iPhone 紧凑宽度、横屏及至少一种 iPad 窗口尺寸。
- 浅色/深色、动态字体、VoiceOver、Reduce Motion 与 Increase Contrast。
- 隐私用途说明、App 图标各外观、启动画面、版本号和 Bundle Identifier。
- Archive、真机安装、TestFlight 内测、崩溃与数据迁移回滚方案。

App Store 交付必须单独确认账号权限、隐私清单、出口合规、截图/元数据和审核状态。一次成功 Archive 不等于 TestFlight 或 App Store 已发布。

## 4. 跨端架构边界

| 能力 | 共享层 | iOS 适配 | 不得复用 |
| --- | --- | --- | --- |
| 数据 | V3 schema、迁移、序列与校验 | SQLite 沙盒路径、生命周期恢复 | 直接修改 SQLite 绕过 store |
| 写入 | preview/execute、CAS、幂等、审计、undo | 原生事件转为同一 command DTO | Swift/Rust 复制领域状态机 |
| 重复任务 | 规则、日期计算、occurrence | 本地时区与界面输入 | 毫秒天数近似 |
| 快速添加 | 离线确定性解析器 | 触摸/键盘输入壳 | 桌面全局快捷键 |
| 提醒 | 规则、delivery id、动作命令 | `UNUserNotificationCenter` 或受支持插件适配 | Windows 托盘轮询 |
| 日历 | range/layout 投影、移动/缩放命令 | 手势、动态字体、紧凑布局 | 手势作为唯一操作方式 |
| 更新 | 版本与迁移策略 | App Store/TestFlight | 桌面 updater |
| 云同步 | Workspace 导入导出和 outbox 契约 | 待确定的 iOS 安全凭据存储 | 把 token 放 Web storage 或日志 |

## 5. 设计与体验契约

Windows、Android、iOS 使用同一套语义设计令牌、信息架构、任务状态和组件意图，不追求逐像素复制平台控件：

- 内容层保持一致；导航栏、工具栏、侧栏和浮动操作属于功能层，可按平台使用不同密度和呈现。
- iOS 正文默认按 17pt/22pt 和动态字体设计；Windows/macOS 可采用更高信息密度，但层级名称和操作优先级一致。
- iOS 触控目标至少 44×44pt；桌面指针控件可更紧凑。所有手势都必须有可见替代。
- 每个视图最多一个突出的强调色主操作；危险操作始终提供取消或可撤销路径。
- iPhone 使用安全区、底部浮动导航和 sheet；Windows 使用侧栏、键盘快捷键与窗口级交互；Android 可保留系统返回和平台反馈，但不得改变业务语义。
- 字体使用系统栈/项目许可字体，不把 SF 字体文件打包到非 Apple 平台。

详细令牌和平台差异以 `DESIGN.md` 为单一规范，`VISUAL_QA.md` 只记录已获得的视觉证据。

## 6. PR 与证据要求

每个 iOS PR 的说明必须列出：

```text
基线 main SHA：
变更边界：
共享协议是否变化：是/否；版本：
执行环境：macOS / Xcode / Rust / Node：
编译：PASS / FAIL / NOT_RUN；命令：
模拟器：PASS / FAIL / NOT_RUN；设备：
真机：PASS / FAIL / NOT_RUN；系统版本：
签名/TestFlight/App Store：VERIFIED / BLOCKED / NOT_STARTED：
已知限制：
```

默认只要求与改动相称的编译门槛，不做无关的全仓静态审计。以下变化例外：schema/迁移、通知调度、权限、签名、隐私或商店配置必须执行对应的窄范围检查，并明确失败或未运行状态。

## 7. 禁止升级的声明

在获得对应证据前，不得声称：

- “iOS 已支持”——只有响应式页面、Rust cfg 或生成工程时仍不成立。
- “iOS 已验证”——只有 Vite、TypeScript、Cargo 桌面或 Android 构建时仍不成立。
- “提醒可靠”——只有前台定时器或一次通知发送时仍不成立。
- “可发布”——只有模拟器、Debug、Archive 或本地签名其中一项时仍不成立。
- “已上架”——只有 TestFlight 或 App Store Connect 配置时仍不成立。

成熟度依次记录为：`Deferred` → `Compile-ready` → `Simulator-verified` → `Device-verified` → `TestFlight` → `App Store`。每次升级必须同时更新本文、`mobile.md`、`delivery-path.md` 和 `app.protocol.json` 中受影响的交付声明。
