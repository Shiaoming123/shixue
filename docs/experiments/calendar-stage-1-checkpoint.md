# 阶段 1：任务日历体验 checkpoint

2026-09-09；分支 exp/soft-surface-ui；基准 HEAD f840258bd82358b53c6176304e533ac818de8a52，以下改动尚未提交。

## 完成与边界

- 进入日/周定位当前时间，其他日期定位09:00前一小时；“今天”重新定位。时钟刷新不覆盖用户滚动。
- 未安排区按真实当前时刻分逾期、仅截止日期、无日期；当前范围全天和缺时长任务可继续细排，各组可折叠。保留现有安排菜单、键盘与拖拽。
- 日历通过slot复用QuickAddComposer，并预填所选日期；四视图卡片及未安排任务打开同一个TaskDetailDrawer。详情覆盖显示，不挤压周列。
- 普通任务完成、重开、安排和专注调用现有动作，返回保持日历日期/筛选。学习完成仍经过证据流程。
- 重复发生项只允许既有完成本次/跳过/改期；当前命令没有发生项专注归属或重开，详情明确说明，不能以父任务动作替代。
- 读模型显示优先级、标签、完成/跳过状态。筛选复用workspace search的文本/标签语义，并按发生项自身状态筛选；隐藏项仍参加重叠警告。
- 筛选使用共享Popover/Listbox/Input/Button，窄屏使用现有Sheet。内部Task未复制成Event，没有新增持久化业务实体。

## 实际验证

- 7个相关Node文件：43/43通过（query、actions、plan、UI contract、responsive、projection、layout）。之后只重复受变更影响的query/UI contract：11/11通过。
- `npm run smoke:calendar`：通过，包含`build:web`和`vue-tsc`；保留原拖拽、resize、键盘移动、刷新持久化检查，新增QuickAdd/详情/完成/重开/专注/筛选/clock流程。
- 浏览器覆盖1440、1280、820、390、320宽度；consoleErrors=0，pageErrors=0。截图在`artifacts/visual-qa/calendar/`，主任务已查看桌面拖拽和320px安排Sheet。
- `npm run check:docs`通过。未执行全量`npm test`、`npm run verify`或原生/外部账号联调；Web证据不替代原生证据。

## 侵入性与回滚

低至中：组件接线、纯查询/分组与显示字段；Workspace仍是V3。阶段0合成fixture不变。回滚只回退本阶段指定组件、查询/分组、测试和smoke改动；不清理原竞品研究文档或其他已有工作，不触及用户数据。

## 下一步：阶段 2

先保存并核验V3原快照，再升级V4；失败不替换。旧StudyStore写入必须白名单限制为V1/V2，避免其当前`!=3`判断允许覆盖V4。保留历史V3 review修复路径。Source/Event独立事实，所有写入经TaskCapabilityService命令信封、CAS、幂等、undo；token不进入Workspace/导出/日志。

阶段2完整验收还包括事件CRUD、跨日/全天/时区、重复例外、提醒owner及四视图闭环。仅完成schema或迁移不等于阶段2完成。
