# 拾学 iOS UI/UX 重构验收回顾

- 日期：2026-09-10（Asia/Shanghai）
- 分支：`feat/ios-ui-ux-restructure`
- 设计基准：[`ios-ui-ux-restructure-plan.md`](./ios-ui-ux-restructure-plan.md)
- 结论：WebView 视觉层与交互组件层达到本轮预期；原生 iOS 平台验收仍为 `NOT_RUN`，因此不能把本轮结果表述为原生 iOS 完成。

## 后续复核修正（2026-09-10）

后续实码复核发现，上一轮对“固定 footer”和“重复搜索入口”的 PASS 判定过宽：任务编辑保存/取消仍在滚动表单内，任务页仍常驻局部搜索。后续修复将操作移至共享 Sheet footer，并把局部查询归入筛选区；增强浏览器验收检查保存按钮可见、命中与窄屏滚动后的可达性。原报告的自动测试通过不等于所有设计细节均已完成。

## 实施阶段与交付

| 阶段 | 可验收交付 | 状态 |
| --- | --- | --- |
| 0 设计冻结 | 研究结论、五领域信息架构、token、页面与弹层合同写入计划、`DESIGN.md`、`VISUAL_QA.md` | PASS |
| 1 基础层 | 统一语义 token、Button、IconButton、PageHeader；44px 命中区与语义状态由共享层提供 | PASS |
| 2 导航与页面壳 | 桌面与紧凑端统一为收件箱/今天/日历/清单/学习；搜索与设置进入壳层固定入口 | PASS |
| 3 弹层与表单 | Sheet 统一 header/body/footer；日期、截止、提醒、重复在任务编辑 Sheet 内推进；同一时刻只保留一个模态任务 | PASS |
| 4 页面重排 | Tasks、Today、Calendar、Lists、Learning/Review、Settings 采用统一标题、间距、共享控件和平面内容层 | PASS |
| 5 平台验收 | WebView 320/390/820/1440、浅/深、200% CSS zoom、reduced motion、键盘与控制台 | PASS |
| 5 平台验收 | iOS Simulator、iPhone/iPad safe area、VoiceOver、系统 Dynamic Type、返回手势、触觉、真机性能 | NOT_RUN |

## 原计划逐项核对

| 规范/要求 | 实现证据 | 结论 |
| --- | --- | --- |
| 布局与信息层级 | PageHeader 统一单页标题；320–1440 无文档横向溢出；页面首屏按标题、主要内容、主要动作排序 | PASS |
| 间距 | 4px 基准和 16/20/28/32px 响应式页面边距进入全局 token | PASS |
| 圆角 | 控件与浮层收为 8/12/16/22/pill 语义档位，普通列表不再逐行套大圆角卡片 | PASS |
| 阴影与材质 | 内容层无装饰阴影；阴影只用于 popover/sheet/dialog 等浮层；透明度降低时有不透明回退规则 | PASS |
| 字体 | 系统字体回退与语义字级统一；200% CSS zoom 下主要操作可达 | PASS（Web） |
| 导航 | desktop/sidebar 与 compact/tab 顺序均为五领域；最近 7 天、已完成进入清单智能视图；Tab 不承载业务动作 | PASS |
| 按钮与页头 | 业务页可见操作迁移到共享 Button/IconButton/PageHeader；IconButton 强制可访问名称；每页最多一个 prominent | PASS |
| 列表与任务行 | 任务内容使用平面 section、分隔与语义选中态，删除多重卡片/边框/阴影层级 | PASS |
| 表单 | 快速新增首层提供标题、日期/时间和清单；任务编辑保留标签、截止、提醒、重复、优先级和预计时间能力 | PASS |
| 弹层 | 共享 OverlayHost/Sheet；编辑子页使用 Back；移动端编辑不再叠在详情模态之后；关闭与焦点流程通过浏览器验收 | PASS（Web） |
| 页面覆盖 | 收件箱、今天、日历、清单、学习、回顾、节律、设置均完成新壳层与组件规范接入 | PASS |
| 色彩与无障碍 | 浅/深主题、键盘、焦点、reduced motion、语义标签和状态非纯色表达通过自动化；Increase Contrast/Bold Text/RTL/VoiceOver 未做系统级实测 | PARTIAL |
| 业务边界 | 能力服务、CAS/幂等、undo、重复范围、学习证据、日历写入与本地持久化由完整前端和 Rust 验证保持通过 | PASS |

## 十项验收标准

1. 五领域名称、顺序和状态一致：`PASS`。
2. 低频入口合并且原能力两步内可达：`PASS`。
3. 单页单标题、单 prominent，Tab 仅导航：`PASS`。
4. 可见业务控件来自共享 UI 层或现有平台适配器：`PASS`。
5. 44px 命中区与 200% 主要操作可达：`PASS（Web）`；系统 Dynamic Type 为 `NOT_RUN`。
6. 内容层平面化，功能层材质具备透明度回退：`PASS`。
7. 弹层遵循选择矩阵、单模态任务和焦点恢复：`PASS（Web）`。
8. 危险动作表达对象/后果并保留取消，可撤销动作不重复确认：`PASS`。
9. 浅色、深色和状态非纯色表达：`PASS`；系统 Increase Contrast 为 `NOT_RUN`，本项整体 `PARTIAL`。
10. 业务与持久化回归保持通过：`PASS`。

## 验证证据

- `npm run verify`：PASS。覆盖全部 Node 测试、类型检查、Web/native 构建、布局与文档门槛。
- `npm run rust:verify`：PASS。99 个 Rust 测试及 doc tests 通过。
- `node scripts/smoke-soft-surface.mjs`：PASS。8/8 视口与主题组合成功；每组覆盖 17 个页面/状态，控制台零错误且无文档横向溢出。
- `git diff --check`：PASS。
- 人工复核：390px 编辑任务与日期子页、390px 今天页、1440px 今天页与清单页符合代表流程层级。

自动化中的 200% 是 CSS zoom 证据；它不等同于 iOS Dynamic Type 或操作系统显示缩放。Windows 环境无法提供 iOS Simulator 和真机证据，相关项目保持 `NOT_RUN`。

## 最终判断

本轮已经完成计划中可在当前仓库和 Windows WebView 环境内实现、验证的视觉与交互组件重构，导航减负、共享控件、页面层级、平面内容、Sheet 内推进和业务边界均达到预期。若把目标定义为“符合 iOS 设计语言的跨端实现”，结果达到预期；若把目标定义为“已通过原生 iOS 发布级验收”，结果尚未达到，剩余工作是 iPhone/iPad Simulator 与真机专项验收，而不是继续改写当前业务界面。
