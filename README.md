<p align="center">
  <img src="./public/shixue-mark.svg" alt="拾学应用图标，一本书上长出嫩芽" width="88" />
</p>

<h1 align="center">拾学</h1>

<p align="center">
  <strong>把待办安排进时间，也把想学会的事变成可完成、可回顾的一小步。</strong><br />
  面向 Windows 的本地优先个人待办与时间规划应用，学习模式可选。
</p>

<p align="center">
  <a href="./README.en.md">English</a>
  ·
  <a href="https://github.com/Shiaoming123/shixue/releases/latest">下载最新版</a>
  ·
  <a href="./docs/README.md">项目文档</a>
</p>

> **脚手架来源**：拾学基于开源项目 [MeowStarter](https://github.com/Shiaoming123/meow-starter) 构建。它提供 Tauri 2、Vue 3、本地存储、多端能力边界和发布工具；拾学在此基础上实现通用任务与可选学习模式、完整产品链路和独立视觉系统。

![拾学任务中心：桌面端同时展示任务列表与详情时间线](./docs/design/shixue-tasks-desktop-implementation.png)

## 产品定位

拾学先是一款单人、本地优先的通用待办与时间规划应用：快速记录任务，再决定今天做什么、何时开始、何时截止以及是否重复。需要学习时，可以为同一任务补充主题、专注会话、完成证据和复习安排。

通用任务和可选学习模式共用同一条本地工作流：

`快速记录 → 整理任务 → 安排学习 → 专注执行 → 证据式完成 → 1 / 3 / 7 天复习`

它适合希望在一台 Windows 电脑上管理个人待办、日程和学习记录，又不想先注册账号或上传任务数据的人。当前范围不包含团队协作、云同步、外部日历接入或 AI 自动规划。

## 界面

界面采用暖纸色、深墨色和低饱和鼠尾草绿，并用系统字体、圆角分组、半透明材质、底部 Sheet 与克制动效建立统一视觉语言。桌面端提供收件箱、今天、最近 7 天、日历、清单、已完成、学习七个一级入口；320–819px 紧凑布局使用收件箱、今天、日历、清单、学习五项底栏，最近 7 天和已完成仍可从更多菜单到达。1280px 以上显示三栏，820–1279px 将详情放入抽屉，320–819px 使用单栏和全屏详情。

| Windows 桌面任务中心 | 390px 移动布局 |
| --- | --- |
| [![桌面端任务中心缩略图](./docs/design/shixue-tasks-desktop-implementation.png)](./docs/design/shixue-tasks-desktop-implementation.png) | [![移动端任务列表缩略图](./docs/design/shixue-tasks-mobile-implementation.png)](./docs/design/shixue-tasks-mobile-implementation.png) |

设计稿、实现截图和偏差说明见 [视觉保真记录](./docs/design/fidelity-ledger.md)。

## 任务与时间规划

- **通用待办**：收件箱只需标题即可保存；整理时可补充清单、标签、优先级、计划时间、截止时间和预计时长。
- **今天与最近 7 天**：今天合并计划在今天、今天截止、已逾期和今天的重复发生项并稳定去重；最近 7 天按日期浏览即将到来的任务。
- **日历**：提供日、周、月和议程四种视图；可安排未计划任务。日历移动支持普通任务、单次发生项、未来发生项和整个系列；调整时长仅支持普通任务或单次发生项，未来/系列范围会被明确拒绝。
- **重复任务**：支持按日、周、月、年和“完成后”生成发生项，并保留完成、跳过和例外历史。
- **离线快速新增**：确定性的中英文规则在本机解析日期、时间、截止、优先级、重复、`#标签` 与 `@清单`；模糊或冲突结果留给用户确认，不依赖模型或网络。
- **多提醒与托盘**：任务可设置多个提醒；应用运行或驻留托盘且系统权限可用时才尝试提交系统通知，完全退出后不保证提醒。系统原生动作不可用时由应用内卡片提供完成、稍后和打开任务。
- **可选学习模式**：为任务增加主题、专注会话、完成标准、成果证据和 1 / 3 / 7 天复习；普通待办不要求填写学习字段。
- **本地数据演进**：WorkspaceState v3 支持 Study v1/v2 迁移与导入；IndexedDB / SQLite 在迁移前保留旧快照，新导出使用 `meow-study/workspace-export` v3。旧版本应用不能读取 v3 数据，升级前备份不包含升级后的新增记录，也不提供自动降级恢复。

## Windows 下载

前往 [GitHub 最新 Release](https://github.com/Shiaoming123/shixue/releases/latest)。下载页始终指向当前公开最新版；本页描述的时间规划源码只有在对应 Release 说明明确列出时，才可视为已进入安装包。

| 选择 | Release 资产名称 | 适用场景 |
| --- | --- | --- |
| **免安装版（优先）** | `Shixue_*_x64_Portable.exe` | 直接运行，不写入 Windows 安装记录。若当前 Release 未附此资产，请使用 Setup 安装版。 |
| **安装版** | `Shixue_*_x64-setup.exe` | 当前用户安装，适合日常长期使用。 |
| **MSI** | `Shixue_*_x64.msi` | 适合需要 Windows Installer 的部署环境。 |

使用前请了解三个边界：

1. Portable 指“应用程序本体免安装”，不代表数据随 EXE 移动。任务数据库和偏好仍保存在 Windows 的 AppData 应用数据目录中。
2. 应用依赖 Microsoft Edge WebView2 Runtime。Windows 10/11 通常已经提供；缺失时请从 [Microsoft WebView2 官方页面](https://developer.microsoft.com/microsoft-edge/webview2/) 安装。
3. 当前 Windows 包没有 Authenticode 代码签名，SmartScreen 可能显示“未知发布者”。请只从本仓库 Release 下载，并在需要时核对 Release 或本地交付包提供的 SHA-256 信息。

完整的本地 Windows 交付包还可以包含 Portable、NSIS、MSI、`SHA256SUMS.txt`、`manifest.json` 和交付说明；构建与审计方法见 [Release Kit](./docs/release-kit.md)。

## 从源码运行

### Web 开发模式

需要 Node.js 22+：

```bash
npm ci
npm run dev:web
```

### Windows 桌面开发

除 Node.js 外，还需要 Rust 1.77.2+ 和 [Tauri 的 Windows 前置依赖](https://tauri.app/start/prerequisites/)：

```bash
npm ci
npm run doctor
npm run tauri dev
```

### 构建完整 Windows 本地交付包

```bash
npm run release:check
npm run verify
npm run rust:verify
npm run package:windows
npm run smoke:windows-package
```

输出位于 `release-artifacts/windows/<version>/`。该目录是构建产物，不纳入源码版本控制。

## 数据与隐私

- Windows 桌面端使用 SQLite；Web 端使用当前站点来源下的 IndexedDB。
- 任务与学习数据默认不需要账号，也不会作为同步数据上传。应用检查更新时可能访问 GitHub Releases。
- JSON 导出用于备份或在 Web/桌面运行时之间手动迁移；两端不会自动互相同步。
- 取消任务不会物理删除任务、会话、事件或完成记录；迁移失败不会覆盖原状态。
- Portable 与安装版共用操作系统管理的应用数据位置。仅删除 EXE 或卸载应用不应被当作已经清除学习数据。
- 当前正式交付边界不包含云同步、外部日历、多人协作、AI 自动规划或账号体系；开发分支的原生能力证据见下方说明。

在导入导出、迁移与存储边界上的详细规则见 [应用协议](./docs/application-protocol.md)。

### 开发与原生验收边界

| 项目 | 当前证据 |
| --- | --- |
| Windows 基础安装包 | v0.2.4 无签名 NSIS 自动安装、启动存活和清理 smoke 为 `PASS`；本轮时间规划累计版的双击启动、数据保留、托盘、提醒动作、快速新增、四种日历视图、深色模式和卸载人工验收为 `NOT_RUN`。 |
| Authenticode | `NOT_RUN`；当前 Windows 包未签名，Tauri updater `.sig` 和 SHA-256 都不代表 Windows 发布者签名。 |
| 已发布版本自动更新 | `NOT_RUN`；仓库有 updater 元数据与载荷签名构建链路，但尚无安装端跨已发布版本的端到端升级证据。 |
| Windows 原生缩放与读屏 | 系统 200% 缩放和 Narrator 均为 `NOT_RUN`；Web 的 CSS zoom、等效回流和 Edge 截图不能替代原生证据。 |
| 移动原生 | iOS、iPadOS、Android 模拟器/真机的当前产品验收及原生通知均为 `NOT_RUN`；320–819px Web 截图只证明响应式布局。 |

多提醒、应用内动作、通知权限与关闭行为已有源码和 Web/自动化证据。未知旧提醒记录会阻止投递并报告错误；发送与确认之间崩溃不承诺恰好一次。逐项提醒证据见 [PR4 产品审查](./docs/design/2026-09-05-pr4-product-audit.md)。视觉合同保持用户批准的 `LOCKED / NAVIGATION AMENDED` 状态，验收边界见 [VISUAL_QA.md](./VISUAL_QA.md)。

## 架构

```text
Vue 3 通用待办与可选学习界面
      │
      ▼
领域命令与任务状态机
      │
      ▼
Workspace 数据端口
   ┌──┴───────────────┐
   ▼                  ▼
SQLite（Tauri/Windows） IndexedDB（Web）
```

- **应用外壳**：Tauri 2，负责 Windows 窗口、SQLite 和可选系统能力。
- **界面**：Vue 3 + TypeScript + Vite，桌面与移动宽度共享同一套业务组件。
- **领域层**：`WorkspaceState` 中的任务模型是唯一事实源；UI 只能调用应用能力与领域命令，不能绕过状态机直接修改持久化状态。
- **存储层**：IndexedDB 与 SQLite 实现同一数据端口；迁移、备份、校验和替换遵循失败不覆盖原则。
- **发布层**：GitHub Actions 生成 Windows Release；本地 Release Kit 额外生成并审计完整交付目录。

进一步阅读：[应用协议](./docs/application-protocol.md) · [开发指南](./docs/development.md) · [设计系统](./docs/design-system.md) · [模块化架构](./docs/modular-architecture.md)

## 验证

```bash
npm run verify
npm run rust:verify
npm run smoke:web-persistence
```

`verify` 包含领域与存储测试、应用协议、CSP、桌面/Web/移动模块契约、类型检查、桌面/Web 构建、移动布局和文档链接检查。Web smoke 与日历 smoke 证明浏览器路径和响应式行为；它们不证明 Tauri 原生壳、Windows 安装包、系统通知、原生缩放、Narrator 或移动原生运行时。

Windows 本地交付另运行 `npm run smoke:windows-package`：它在隔离目录中安装 NSIS 包、启动应用、确认进程存活，再清理本次测试目录。此结果证明本地包生命周期可运行，不等同于 Authenticode 签名、SmartScreen 信誉或商店审核。

## 路线图

- [x] 通用任务、Today / 最近 7 天、七入口桌面导航与五入口紧凑导航
- [x] 日/周/月/议程日历、重复任务、离线中英文快速新增与多提醒源码链路
- [x] 可选学习模式、专注会话、证据式完成与复习闭环
- [x] IndexedDB / SQLite 本地持久化、Study v1/v2 → Workspace v3 迁移与 JSON 交换
- [x] Windows x64 Portable、NSIS、MSI 本地打包和安装启动 smoke
- [x] GitHub Release 与 Tauri updater 元数据构建链路（不代表端到端升级已验证）
- [ ] Authenticode 签名与签名后安装验证
- [ ] 自动更新的已发布版本端到端升级验证
- [ ] Android/iOS 原生真机、签名与商店交付

外部日历同步、统计仪表盘、看板、甘特图、云同步、多人协作和 AI 自动规划不属于当前范围。路线图表示验证方向，不承诺交付日期。

## 参与贡献

欢迎提交可复现的缺陷、界面可用性反馈和范围明确的改进。开始编码前请先阅读 [贡献指南](./CONTRIBUTING.md) 和 [工作约定](./AGENTS.md)，并运行与改动范围对应的验证命令。

- [提交 Issue](https://github.com/Shiaoming123/shixue/issues)
- [查看变更记录](./CHANGELOG.md)
- [安全问题报告](./SECURITY.md)
- [行为准则](./CODE_OF_CONDUCT.md)

## 许可证与来源

拾学采用 [MIT License](./LICENSE)。第三方素材、脚手架来源和许可证边界记录在 [PROVENANCE.md](./PROVENANCE.md)；母项目为 [MeowStarter](https://github.com/Shiaoming123/meow-starter)。
