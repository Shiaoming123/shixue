# 拾学视觉验收矩阵

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

## 2. 固定视口

| 名称 | 尺寸 | 核验重点 |
| --- | --- | --- |
| desktop-wide | 1440×960 | 三栏密度、浮层不裁切、Today 去重分组 |
| desktop-min | 1280×800 | 详情宽度、快速新增、日历信息完整 |
| window-min | 820×560 | 图标侧栏、覆盖抽屉、无横向页面滚动 |
| mobile | 390×844 | 44px 触控、底部 safe area、Sheet |
| mobile-min | 320×700 | 文案截断、控件不重叠、200% 缩放后主操作可达 |

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
| reduced motion/transparency | 无位移动画；玻璃回退为不透明 surface |

## 4. 响应式行为

- 1280px 以上三栏；820–1279px 图标侧栏 + 详情覆盖抽屉；819px 以下单栏 + 底部导航。
- 日期、重复、提醒、筛选在桌面为定位 Popover，在窄屏为全宽 Sheet；内容和选择结果一致。
- Calendar 的日/周/月/议程视图不通过缩小文字解决空间问题；窄屏优先日视图并保留视图切换。
- 原生可见 `<select>`、默认复选框、默认日期/时间输入、浏览器确认框出现即为视觉验收失败。

## 5. 自动化与人工验收

每个 UI PR 执行：

```powershell
npm test
npm run typecheck
npm run build
npm run build:web
npm run check:docs
```

代表性路径使用 Playwright 记录 console/page error，并在上述五个视口截图。人工审查按以下顺序进行：

1. 先看信息层级与一眼可理解性。
2. 再看控件是否属于同一视觉语言。
3. 核对键盘、触控、焦点与浮层边界。
4. 最后比较基线截图，只记录有意变化，不以像素相似替代可用性判断。

## 6. 阻断项

- 未合入 Manrope Variable / Noto Sans SC Variable 字体资产。
- 任一核心流程只有鼠标可用。
- 任一可见控件泄露平台默认皮肤。
- 深色、高对比或减少透明度下信息不可辨。
- 截图通过但 console/page error 非零。
