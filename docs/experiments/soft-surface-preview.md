# 拾学 Soft Surface 实验体验

分支 `exp/soft-surface-ui`，开发基线 `fdba96e`（PR #43），不是正式 main 或公开 v0.3.0 发布包。

## 直接体验

解压预览 ZIP；需要 Node.js 22 或更新版本，**不需要 npm install**。在解压目录执行：

```powershell
node scripts/preview-soft-surface.mjs
```

打开 http://127.0.0.1:18476 。服务器仅监听本机；用 Ctrl+C 停止。端口被占用时先检查现有进程，禁止结束其他开发服务。使用同一浏览器、同一地址与端口保留实验数据；本地 IndexedDB 不会同步到 Windows 安装版。私密浏览/清除站点数据会丢失实验记录，设置中的 JSON 导出可备份。

本包是完整业务 Web 应用，包含所有核心页面。原生系统通知、托盘、后台保活与移动系统手势不在 Web 验证范围；应用内提醒可体验。不包含 MSI 或 EXE。

## 从源码重建

```powershell
npm ci
npm run doctor
npm run verify
node scripts/preview-soft-surface.mjs
```

`verify` 最后生成 Web dist。开发热更新使用 `npm run dev:web -- --port 18476`；预览服务已运行时先 Ctrl+C。浏览器验收使用 `node scripts/smoke-soft-surface.mjs`（先启动预览），截图与报告写入 `artifacts/soft-surface/`。

## 体验路线与评价

1. 收件箱连续添加3条普通任务，试中文日期/优先级识别与取消chip；切换学习按钮观察明确状态。
2. 今天/最近七天/清单/已完成切换，选择详情并修改计划、重复和提醒；关闭浮层检查焦点与草稿。
3. 日历切换日/周/月/议程，拖移计划并用键盘替代操作；检查操作失败提示与撤销。
4. 学习→主题→节律→回顾；学习任务专注、随手记、证据式完成，再重载检查记录。
5. 设置切深色；缩窄窗口，检查底栏、编辑Sheet和日期选择；系统减少动态效果后再快速切换。

建议体验3–7天，记录每次“找不到入口/多点一步/动效等待/读不清”的任务和操作路径。评估记录包含日期、页面、期望、实际、影响、是否可重现，不把配色偏好当成功能完成证据。

## 对比分析

- [竞品实现研究](./task-products-research.md)
- [拾学基线使用链路审计](./shixue-baseline-audit.md)

视觉与动效已在本实验迁移；任务手动排序、滑动快捷动作、Quick Add草稿持久化、提醒离开应用后可靠投递等清单项是后续建议，不能视为本实验已实现。
