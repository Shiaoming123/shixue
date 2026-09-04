# 贡献指南

感谢你考虑为拾学做出贡献！拾学是一个本地优先的个人学习记录与复习助手，欢迎围绕任务闭环、数据可靠性、无障碍和 Windows 桌面体验提交改进。

## 开发环境

参见 [README](./README.md) 的「环境要求」，确保本地已安装 Node.js 22+、npm 10+ 与 Rust 1.77.2+。

## 分支策略

- `main` 为保护分支，只接受通过 Pull Request 的合并。
- 功能开发从 `main` 切出 `feat/xxx`，缺陷修复用 `fix/xxx`。

## 提交规范

提交信息采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新增 xxx
fix: 修复 xxx
docs: 更新文档
chore: 构建 / 依赖调整
refactor: 重构（无功能变化）
```

## Pull Request 流程

1. Fork 本仓库并切出功能分支。
2. 确保 `npm run verify` 与 `npm run rust:verify` 通过；涉及桌面交付时，再完成 `npm run smoke:windows-package`。
3. 提交 PR，并填写 PR 模板中的检查清单。
4. 至少一次 review 通过后合并。

## 报告问题

- 功能请求与可复现的缺陷，请使用 Issue 模板。
- 安全相关漏洞请走 [SECURITY.md](./SECURITY.md) 的私下披露渠道，**不要**通过公开 Issue 报告。

## 代码风格

- Rust：以 `cargo fmt` 输出为准。
- TypeScript / Vue：以项目现有风格为准，提交前自行 `npm run typecheck`。
