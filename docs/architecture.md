# 拾学软件架构

[English](./architecture.en.md) · [返回中文 README](../README.md)

本文描述当前 `main` 的已实现架构与已验证边界。图中实线表示运行或数据流，虚线表示条件回退、独立验证关系或自动化不能证明的范围。所有图均为 SVG，可以点击打开后缩放；对应 Mermaid 图源与 SVG 放在同一目录。

## 总览

[![拾学软件架构总览](./design/shixue-architecture-overview.svg)](./design/shixue-architecture-overview.svg)

平台 adapter 在 Vue 挂载前完成选择和注册。所有实时工作区业务写入经过 `TaskCapabilityService`；UI 只读刷新可以直接调用 `WorkspaceStore.load()`。`WorkspaceStore.save()` 接受可选 `expectedUpdatedAt`，能力服务的实时写入固定使用 CAS。

## 运行与数据架构

[![拾学运行与数据架构详图](./design/shixue-runtime-data-architecture.svg)](./design/shixue-runtime-data-architecture.svg)

- **启动与装配**：Web、Tauri desktop 和 Tauri mobile 共享 Vue 应用；Rust 原生宿主提供原生目标，前端将其映射为 `RuntimeInfo` 的平台与能力声明。模块加载器只装配已启用、兼容且依赖顺序成立的模块。
- **应用与领域**：版本化命令信封进入 `TaskCapabilityService`，经过版本、幂等和 workspace revision 校验后路由到领域命令。每次事务克隆并严格校验 `WorkspaceStateV3` 快照；它承载任务、清单、标签、重复、提醒、专注、回执和事件。Today、Upcoming、搜索、节律和周回顾是派生只读模型。
- **本地持久化**：Web 使用 `meow-study · studyState/current` IndexedDB；Tauri desktop/mobile 使用 `study.db · study_state(id=1)` SQLite。内存实现是 registry 的启动默认值；持久化 adapter 装配失败会显式报告错误并让该默认值继续生效，但已注册数据库的运行时读写失败不会自动切回内存。
- **迁移与交换**：Workspace JSON v3 导入执行严格校验；Study v1/v2 先校验、迁移，再按 v3 重新校验。旧版迁移或受控修复在替换当前状态前保存并核验原始载荷。JSON v3 是完整工作区备份，但不包含设备偏好、密钥或同步会话；Learning Markdown 是单向只读证据投影。

## 平台能力与验证交付

[![拾学平台能力与验证交付架构详图](./design/shixue-platform-delivery-architecture.svg)](./design/shixue-platform-delivery-architecture.svg)

平台能力还受模块配置、平台兼容性、依赖拓扑、Rust 编译绑定和 Tauri 权限共同约束。原生插件或源码存在本身不代表运行时可用。Sync、Agent、Clipboard 与 MCP 默认关闭；Sync 远端状态导入经过能力服务，Agent 仍为规划状态，MCP 是依赖 Agent 的独立模块。

四条验证与交付泳道相互独立：

| 泳道 | 当前证明 | 不会因此证明 |
| --- | --- | --- |
| 常规 CI | Node 测试、协议与模块合同、Web/desktop 构建、Rust fmt/clippy/test/check | Web 已部署、原生设备体验或已安装升级 |
| 手动 Android | 隔离 x86_64 emulator 中的 APK 身份、Activity、五阶段 readiness、前台稳定进程，以及应用进程重启后的 SQLite 恢复 | Android 真机、emulator reboot、原生通知、签名或商店交付 |
| 本地 Windows Release Kit | NSIS、MSI、Portable 的格式、大小、SHA-256 与 manifest；NSIS 安装/启动/重启/卸载生命周期 | MSI 安装、Portable 运行、200% 缩放、Narrator、Authenticode 或已安装 updater E2E |
| 版本标签 Release | 标签门禁、草稿资产、Portable 摘要回查和校验后公开 | 下载资产在用户机器上的完整安装与升级体验 |

当前 iOS 运行、移动签名与商店、部署后的 Web、macOS/Linux 包以及 macOS notarization 也没有被这些泳道验证。

## 完整全景与图源

- [打开完整可缩放全景 SVG](./design/shixue-software-architecture.svg)
- [编辑完整全景 Mermaid 图源](./design/shixue-software-architecture.mmd)
- [编辑 README 总览图源](./design/shixue-architecture-overview.mmd)
- [编辑运行与数据详图](./design/shixue-runtime-data-architecture.mmd)
- [编辑平台与交付详图](./design/shixue-platform-delivery-architecture.mmd)

使用 Mermaid CLI `11.17.0` 渲染。提交图源改动时应同步提交 SVG，并运行 `npm run check:docs` 和 `npm run verify`。
