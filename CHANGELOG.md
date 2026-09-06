# 更新日志

本文件格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [SemVer](https://semver.org/)。

## [Unreleased]

### Changed

- Windows 多提醒与桌面生命周期候选包使用 `0.2.4` 版本身份，避免与已发布的 `0.2.3` 便携版和安装包混淆。

### Fixed

- Windows 安装 smoke 使用独立产品标识，并在验证后运行自身卸载与注册表清理，避免污染真实应用的快捷方式、安装路径和卸载记录。

## [0.2.3] - 2026-09-04

### Added

- GitHub Release 现提供稳定命名的 Windows x64 Portable EXE 与独立 SHA-256 校验文件；上传并回查成功后才公开 Release。
- 新增个人开发者 Windows 分发与 Authenticode 选择指南，明确 Portable、WebView2、AppData、updater 签名与 SmartScreen 边界。

### Changed

- 中英文 README 重写为完整产品入口，并显眼标注拾学基于 MeowStarter 构建。

## [0.2.2] - 2026-09-04

### Fixed

- 发布流水线改用当前 `tauri-action@v0` 实际接受的 `includeUpdaterJson` 与 `assetNamePattern` 参数。

## [0.2.1] - 2026-09-04

### Fixed

- GitHub Release 使用稳定 ASCII 资产名，避免中文产品名被清洗后导致 updater 签名匹配失败。
- 发布流水线显式上传 `latest.json`，确保应用内更新端点具备完整元数据。

### Added

- **拾学 v0.2 学习任务闭环**：新增学习收件箱、跨主题今日队列、任务状态与事件历史、证据式完成记录库和任务重开链路
- **四栏信息架构**：桌面与移动端统一为「今天 / 任务 / 主题 / 回顾」，任务详情提供清单、排期和可追溯时间线
- **StudyState v2**：旧学习步骤无损迁移为唯一任务事实源，Web IndexedDB 与桌面 SQLite 在升级前保留恢复备份
- **Windows x64 交付包**：一条命令生成并审计简体中文 NSIS、zh-CN MSI、便携 EXE、SHA-256 校验表与机器可读 manifest
- **拾学应用图标**：以书页与新芽为核心视觉，生成 Windows、macOS、iOS、Android 所需的完整 Tauri 图标集
- **Web 运行模式**：`npm run dev:web` / `build:web` / `preview:web`，同一份 Vue 代码可在浏览器中直接运行
- **`storage` 模块**（始终启用）：领域存储契约 + 内存安全回退；Tauri 走 SQLite、Web 走 IndexedDB
- **`indexedDb` 模块**（默认开）：Web 端 IndexedDB 持久化，仅在浏览器运行时装配
- **`sync` 模块**（Preview，默认关闭）：本地优先同步接缝，内置 outbox 引擎、白名单策略与 HTTP transport，不绑定任何云厂商
- **模块兼容性过滤**：`Module` 契约新增 `platforms` 与 `requiredCapabilities`，装配前按 `detectRuntimeInfo()` 跳过当前平台不支持的模块
- 新增文档：[docs/web.md](./docs/web.md)、[docs/sync.md](./docs/sync.md)

### Changed

- **图标加载方式**：由动态 per-icon import 改为静态注册表（`src/assets/icons/registry.ts`），构建期确定依赖，不再依赖 `@lucide/vue` 的内部文件路径
- **成熟度表述**：Agent P1/P2 由「已实现」改为 Preview；移除「`secureProxy: false` 降级为前端直连」这条不安全的回滚路径
- CI 门禁加强：新增 `cargo fmt --check`、`cargo clippy -D warnings`、`cargo test`、`npm test`、`check:layout`、`check:docs`、`build:web`

### Fixed

- **移动端底部导航**：`.shell` 改为纵向布局、`.main` 补 `min-height: 0`、`.tabbar` 补 `env(safe-area-inset-bottom, 0px)`，成为真正的底部 bar
- **模块拓扑排序**：缺失依赖由静默跳过改为显式报错，并新增循环依赖检测
- **更新器**：`plugins.updater.endpoints` 为模板占位值时不再发起无效请求，状态改为 `unconfigured`
- **流式代理**：`proxy_stream` 的 channel 由 `String` 改为 `Vec<u8>`，避免多字节字符在分块边界被截断

### Security

- **密钥不再进入 WebView**：云端模型请求改为整体经 Rust 侧代理（注入自定义 `fetch`），前端持有的只是占位串
- **不提供密钥读回**：Rust 侧 `get_api_key` 改为 `has_api_key`，只返回存在性
- **代理目标白名单**：默认仅放行 `api.openai.com` 与 `api.anthropic.com`；强制 HTTPS、固定 `/v1` 路径前缀、禁重定向、禁 URL 内嵌凭据、2 MiB 请求体上限、错误响应不回显 body
- **工具审批 fail-closed**：审批判定函数抛错时按拒绝处理
- 钥匙串标识符字符集与密钥长度校验

> ⚠️ **注意**：云端代理白名单目前只放行 OpenAI 与 Anthropic 的官方端点。DeepSeek、Moonshot、Groq 等 OpenAI 兼容服务若配置钥匙串密钥会被拒绝，扩展方法见 [docs/agent-integration.md §3.4.1](./docs/agent-integration.md)。本地模型（Ollama / vLLM）走直连不受影响。

## [0.1.0] - 2026-08-31

### 初始模板

- Vue 3.5 + TypeScript + Vite 6 前端底座，深色模式跟随系统
- SQLite 数据层（`tauri-plugin-sql`，启动自动迁移 + 索引示例）
- 系统托盘（左键切换 / 右键菜单）、单实例、关闭窗口隐藏
- 自动更新（签名 → 下载 → 安装 → 重启）全链路
- GitHub Actions 三端打包矩阵 + CI 质量门禁
- 已生成更新签名密钥并写入公钥
- 开源社区健康文件：LICENSE / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / Issue·PR 模板 / dependabot
