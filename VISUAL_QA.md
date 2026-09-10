# 拾学视觉验收矩阵

## Glass Chrome 与视图切换回归（2026-09-10）

- 1440×960：在“最近 7 天”打开内联任务详情后切换“日历”，点击帧及 16/120/240ms 均不得在 `#ui-overlay-host` 出现 `.sheet-layer--inline`；侧栏的 x、宽度和 opacity 全程不变，页面主区域 opacity 为 1。
- 820×560、390×844、320×700：详情、编辑、Popover 与底部导航各自只出现一个实例；跨 819/820 与 1279/1280 断点时 placement 与宿主一致，不产生横向滚动。
- 侧栏、日历工具栏、Sheet、Dialog、Popover、移动端顶部与底部导航使用共享玻璃 token；任务行、日历网格、设置正文保持清晰平面，不出现逐行 blur 或方形强阴影。
- 浅色、深色、至少两个非默认主题及自定义主题均检查文字对比、玻璃边缘与层级。`prefers-reduced-transparency` 和“减少玻璃效果”下 filter 必须为 `none` 且材质完全不透明；`prefers-reduced-motion` 下不得保留位移离场。
- 检查键盘焦点、浮层关闭后的焦点恢复、全局纵横向滚动和控制台错误。Web 浏览器证据不升级为原生壳或真实设备结论。

## 主题系统实验

运行 `node scripts/smoke-theme-system.mjs http://127.0.0.1:18476/`，逐一切换全部预设，并验证系统模式联动、自定义主色、刷新持久化、语义色对比度、控制台错误及桌面/移动设置页截图。证据输出到 `artifacts/theme-system/`；该证据属于 Web 实现，不替代原生壳验证。

## Soft Surface 实验

本分支按用户授权执行新模式，合同见 DESIGN.md 的实验覆盖节。
运行 `node scripts/smoke-soft-surface.mjs` 记录构建预览的核心路由、深浅色、桌面与窄屏截图及真实创建/重载交互；报告写入 `artifacts/soft-surface/report.json`。验收结论以实际报告为准，历史矩阵不代表本实验已验证。
任务行过渡覆盖仍存在的分组内部；删除最后一项引起整组卸载时无退场动效，不宣称跨组 FLIP。Web 试用仅证明浏览器行为，不能替代 native-simulator/native-device 验收。

## PR4 审查入口（2026-09-05）

本轮基线、问题清单、实施状态与证据限制见 [PR4 产品审查](docs/design/2026-09-05-pr4-product-audit.md)。截图/故障日志在当前 PR4 工作树的 `artifacts/pr4-audit/`，不纳入提交。源工作树 artifacts 保留。

新增定向验收：编辑按钮上 C/J/K 不写后台、两级 Escape 返回正确触发器、Listbox Tab/Shift+Tab 按表单顺序离开、99:99/abc 不能变成有效提醒、导入失败保留候选、唯一 aria-current、存储失败不提示成功、零启动权限请求、贪睡不修改计划。主题测试要求当前拾学语义文字和按钮标签至少 4.5:1。

CSS zoom、等效回流视口、系统真实缩放分别命名；不能以 CSS zoom 截图替代 Windows 200% 缩放。内置浏览器发现的裁切截图拒绝用作固定尺寸通过证据，改用 Edge 当前渲染并等待实际过渡结束。Web/Edge 证据仍不是 Tauri 原生壳证据。

## 1. 已确认基线与实现证据

现有实现基线：

- `docs/design/shixue-tasks-desktop-implementation.png`（1440×960）
- `docs/design/shixue-tasks-mobile-implementation.png`（390×844）

已确认的时间规划方向：

- `docs/design/shixue-time-planning-desktop-proposal.svg`（可编辑源）
- `docs/design/shixue-time-planning-desktop-proposal.png`（1440×960 渲染稿，用户于 2026-09-04 确认）

已确认方向的 Web 实现证据继续覆盖：

1. 桌面浅色 Today：侧栏、分组任务、快速新增、打开的主题化日期 ARIA `grid` Popover。
2. 桌面深色日历周视图：时间脊线、未计划任务托盘、拖动预览。
3. 桌面浅色任务详情：计划、截止、多提醒、自定义重复范围对话框。
4. 移动深色 Today：底部导航、任务操作 Sheet、虚拟键盘后的快速新增。
5. 桌面浅色任务页：单一页面标题、侧栏展开/图标两态及菜单重排反馈。
6. 桌面浅色设置页：独立页面、分区设置、无右侧抽屉遮挡。

## 2. 固定视口

| 名称 | 尺寸 | 核验重点 |
| --- | --- | --- |
| desktop-wide | 1440×960 | 三栏密度、浮层不裁切、Today 去重分组 |
| desktop-min | 1280×800 | 详情宽度、快速新增、日历信息完整 |
| window-min | 820×560 | 用户可切换侧栏、覆盖抽屉、无横向页面滚动 |
| mobile | 390×844 | 44px 触控、底部 safe area、Sheet |
| mobile-min | 320×700 | 文案截断、控件不重叠、200% 缩放后主操作可达 |

以上 `mobile` 截图仍属于 Web/响应式证据。跨端设计系统另设原生证据矩阵：

| 平台证据 | 代表尺寸 | 核验重点 |
| --- | --- | --- |
| Windows | 1440×960、820×560；100%/200% 缩放 | 侧栏/抽屉、键盘、hover/focus、高对比、窗口控件 |
| iPhone | 393×852 或 402×874pt | 44pt 命中、安全区、浮动 tab、Dynamic Type、Sheet/返回 |
| iPad | 834×1210pt 与一个分屏尺寸 | tab/侧栏转换、Popover、指针与外接键盘 |
| Android phone | 412×915dp 左右 | 48dp 命中、Navigation Bar、系统/预测返回、字体缩放 |
| Android tablet/foldable | 一个 medium 和一个 expanded 窗口 | Navigation Rail/Drawer、窗口类切换、无横向丢失 |

每张证据必须标记 `concept`、`web-implementation`、`native-simulator` 或 `native-device`。文件名包含 iOS/Android 不代表原生验证；模拟器截图也不能升级为真机证据。

## 3. 状态矩阵

每个基础控件至少覆盖：default、hover（支持时）、pressed、focus-visible、disabled、loading/error（适用时）、light、dark、high-contrast。浮层类额外覆盖顶部/底部边界翻转、Escape、外点关闭和焦点返回。

| 业务状态 | 必须看到 |
| --- | --- |
| 全新空状态 | 轻量插画、简短标题、一个主要行动；无教学段落 |
| 搜索无结果 | 查询词、清除筛选入口 |
| 存储失败 | 原状态未被伪装更新、可重试错误提示 |
| 今天有逾期 | 原截止时间保留，批量移到今天/推迟/跳过重复/取消 |
| 重复规则编辑 | 本次/本次及以后/整个系列的影响数量 |
| 提醒权限未授予 | 在首次设置提醒时就地请求，不在启动时打扰 |
| 提醒触发 | 完成、稍后提醒、打开任务三个动作 |
| 拖动冲突 | 预览显示冲突；失败回弹且原因可读 |
| reduced motion/transparency | 无位移动画；玻璃回退为不透明 surface 并关闭 backdrop blur |
| Dynamic Type/系统字体放大 | 200% 时正文换行、列表增高、主要操作仍可达 |
| 系统返回 | iOS 返回手势、Android predictive back 与可见关闭动作结果一致 |
| 侧栏定制 | 展开/图标切换自然；拖动后顺序持久化；`Alt+↑/↓` 可完成同等排序；设置入口保持固定 |
| 独立设置页 | 页面标题唯一；外观、侧栏、快速新增、提醒、数据和云端分区可滚动到达；危险操作仍需确认 |

## 4. 响应式行为

- 1280px 以上三栏；820–1279px 保留用户选择的展开/图标侧栏 + 详情覆盖抽屉；819px 以下单栏 + 底部导航。
- 锚定式日期等普通 Popover 在桌面为有名称的非模态 `dialog`，菜单型 Popover 由内部 `menu` 提供语义；两者切到窄屏 adaptive Sheet 后均为有名称的模态 `dialog`。任务、重复与多提醒编辑复用共享 Sheet/Dialog 宿主。每个共享 panel 单独拥有 dialog 语义，日期选择使用 6×7 的 ARIA `grid`/`gridcell`，内容和选择结果一致。
- Calendar 的日/周/月/议程视图不通过缩小文字解决空间问题；窄屏优先日视图并保留视图切换。
- 未经设计系统适配的浏览器 `<select>`、默认复选框、默认日期/时间输入和浏览器确认框出现即为视觉验收失败；经过平台适配器审查的原生 picker、switch、sheet 或菜单允许使用。

## 5. 自动化与人工验收

默认 UI PR 只执行与改动相称的编译门槛：

```powershell
npm run typecheck
npm run build
npm run check:docs
```

新增视觉模式、修改导航/材质/排版、或准备平台发布候选时，才追加对应平台的一条代表主流程截图与交互核验；不做无关的全仓视觉审计。人工审查按以下顺序进行：

1. 先看信息层级与一眼可理解性。
2. 再看控件是否属于同一视觉语言。
3. 核对键盘、触控、焦点与浮层边界。
4. 最后比较基线截图，只记录有意变化，不以像素相似替代可用性判断。

## 6. 阻断项与证据边界

- 任一核心流程只有鼠标可用。
- 任一可见控件泄露平台默认皮肤。
- 把未经适配的浏览器默认皮肤误当平台原生控件；或为了像素一致而破坏平台惯例。
- 深色、高对比或减少透明度下信息不可辨。
- 截图通过但 console/page error 非零。
- Web 窄屏截图被误报为 iOS/Android 原生证据。
- Web smoke 不能替代 Windows 或移动原生证据。v0.3.0 精确本地候选已另行通过安装应用基础验收；最终重建 SHA 的复习完成 UI、提醒/托盘动作、200% 原生缩放、Narrator、Windows 系统通知投递，以及签名、更新器和 iOS/Android 原生流程仍为 `NOT_RUN` 或 `BLOCKED`，详见[验收账本](./docs/releases/v0.3.0-acceptance.md)。
