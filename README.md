<p align="center">
  <img src="./public/shixue-mark.svg" alt="拾学标志" width="96" />
</p>

<h1 align="center">拾学</h1>

<p align="center">
  <strong>把想学会的事，变成每天能完成、能证明、会复习的一小步。</strong><br />
  一个本地优先、桌面优先，同时适配 Web 与移动尺寸的个人学习记录助手。
</p>

![拾学 v0.2 任务中心](./docs/design/shixue-tasks-desktop-implementation.png)

## 它解决什么

普通清单擅长提醒“要做什么”，但学习还需要回答三个问题：这一步怎样才算学会、留下了什么证据、什么时候应该回来复习。拾学借鉴滴答清单的“今天 / 清单 / 专注 / 回顾”心智模型，把它改造成一条更适合学习的闭环：

`快速记录 → 整理任务 → 安排学习 → 专注执行 → 证据式完成 → 1/3/7 天复习`

## 已实现

- **今天**：汇总多个主题的今日任务，进行中任务优先，并把逾期任务留给用户重新安排。
- **学习任务**：用收件箱快速捕捉想法，再补充主题、计划日、截止日、时长、完成标准与检查项。
- **任务追踪**：开始、暂停、延期、阻塞、完成、取消和重开都有可查看的事件记录。
- **学习主题**：按目标组织任务，查看当前进展和历次学习证据。
- **专注计时**：开始、暂停、继续；随手记录会自动保存，刷新页面仍可恢复。
- **完成记录**：完成任务必须保存收获、成果链接或文件、下一步和掌握程度；记录支持搜索、复习与派生下一任务。
- **间隔复习**：按 1 / 3 / 7 天生成复习队列，通过“重学 / 模糊 / 清楚”调整后续安排。
- **本周回顾**：汇总闭环次数、投入时间、最大进展、反复卡点和下周优先事项。
- **本地数据**：Web 使用 IndexedDB，Tauri 桌面端使用 SQLite；StudyState v2 可从旧数据迁移并在升级前备份，JSON 导入兼容 v1/v2。
- **自适应体验**：桌面四项一级导航与移动四项底部标签栏，使用暖纸色、森林绿和接近 iOS/macOS 的克制动效与 44px 触控目标。

## 运行

环境要求：Node.js 22+；运行桌面版还需要 Rust 与对应平台的 Tauri 依赖。

```bash
npm ci
npm run dev:web
```

桌面开发：

```bash
npm run tauri dev
```

## 验证

```bash
npm run verify
npm run rust:verify
npm run smoke:web-persistence
```

Windows x64 本地交付：

```bash
npm run package:windows
npm run smoke:windows-package
```

交付目录位于 `release-artifacts/windows/<version>/`，包含 NSIS、MSI、便携
EXE、SHA-256 校验文件和机器可读 manifest。当前本机构建为未签名包，公开
分发前仍需配置可信代码签名证书；详见 [Release Kit](./docs/release-kit.md)。

`verify` 覆盖前端、领域、存储和安全测试，以及类型检查、桌面与 Web 构建、跨端模块契约和移动布局契约。Web 持久化 smoke 会走通捕捉、整理、开始、暂停、刷新恢复、证据式完成和记录搜索，并生成桌面和移动截图。

## 当前边界

- Web 构建、IndexedDB 持久化和响应式页面已验证。
- Rust 格式、Clippy、单元测试和完整类型检查已验证。
- 尚未生成或人工验收 Windows 安装包，也未做 iOS / Android 原生真机验证。
- 同步、账号、AI 对话和通知没有进入首版；首版刻意保持单人、本地、低干扰。

设计对照见 [视觉保真记录](./docs/design/fidelity-ledger.md)，竞品与功能取舍见 [产品研究](./docs/product-research.md)。底层基于 `meow-starter` 的 Tauri 2 + Vue 3 架构；代码许可证与第三方边界见 [LICENSE](./LICENSE) 和 [来源说明](./PROVENANCE.md)。
