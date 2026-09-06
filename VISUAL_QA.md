# 拾学视觉验收矩阵

## PR4 审查入口（2026-09-05）

本轮基线、问题清单、实施状态与证据限制见 [PR4 产品审查](docs/design/2026-09-05-pr4-product-audit.md)。截图/故障日志在当前 PR4 工作树的 `artifacts/pr4-audit/`，不纳入提交。源工作树 artifacts 保留。

新增定向验收：编辑按钮上 C/J/K 不写后台、两级 Escape 返回正确触发器、Listbox Tab/Shift+Tab 按表单顺序离开、99:99/abc 不能变成有效提醒、导入失败保留候选、唯一 aria-current、存储失败不提示成功、零启动权限请求、贪睡不修改计划。主题测试要求当前拾学语义文字和按钮标签至少 4.5:1。

CSS zoom、等效回流视口、系统真实缩放分别命名；不能以 CSS zoom 截图替代 Windows 200% 缩放。内置浏览器发现的裁切截图拒绝用作固定尺寸通过证据，改用 Edge 当前渲染并等待实际过渡结束。Web/Edge 证据仍不是 Tauri 原生壳证据。

## 1. 基线与待确认画面

现有实现基线：

- `docs/design/shixue-tasks-desktop-implementation.png`（1440×960）
- `docs/design/shixue-tasks-mobile-implementation.png`（390×844）

本轮候选方案：

- `docs/design/shixue-time-planning-desktop-proposal.svg`（可编辑源）
- `docs/design/shixue-time-planning-desktop-proposal.png`（1440×960 渲染稿，用户于 2026-09-04 确认）

时间规划实现必须补齐并经人工确认：

1. 桌面浅色 Today：侧栏、分组任务、快速新增、打开的日期 Listbox。
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
| window-min | 820×560 | 图标侧栏、覆盖抽屉、无横向页面滚动 |
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

- 1280px 以上三栏；820–1279px 图标侧栏 + 详情覆盖抽屉；819px 以下单栏 + 底部导航。
- 日期、重复、提醒、筛选在桌面为定位 Popover，在窄屏为全宽 Sheet；内容和选择结果一致。
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

## 6. 阻断项

- 未合入 Manrope Variable / Noto Sans SC Variable 字体资产。
- 任一核心流程只有鼠标可用。
- 任一可见控件泄露平台默认皮肤。
- 把未经适配的浏览器默认皮肤误当平台原生控件；或为了像素一致而破坏平台惯例。
- 深色、高对比或减少透明度下信息不可辨。
- 截图通过但 console/page error 非零。
- Web 窄屏截图被误报为 iOS/Android 原生证据。
