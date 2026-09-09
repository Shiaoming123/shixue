# 日历契约基线（阶段 0）

记录日期：2026-09-09。源码基准：`exp/soft-surface-ui`，HEAD `f840258bd82358b53c6176304e533ac818de8a52`。本文件冻结现有行为，供后续增量实现回归；不修改业务模型，不代表外部日历能力已实现。

开始时工作树仅有未跟踪的 `docs/experiments/calendar-competitor-research.md`，本轮保留原文件。后续阶段不得用本基线覆盖研究文档或其他已有工作。

## 数据与投影

- 当前输入是 `WorkspaceStateV3`，`Task`、`TaskOccurrence`、系列及例外是事实来源；`CalendarItem` 只是纯投影，不持久化、不复制成 Event。
- `src/domain/calendar/range.ts` 使用本地日期 `[start, end)`；日为 1 天，周为 7 天，月固定 42 天，议程为 30 天。无效日期不得静默正规化。
- `project.ts`：`startOn` 投影为全天，不合成时间戳；定时块要求 `startAt` 和时长同时存在；截止日期/时间独立投影为 `deadline-marker`，不能当成已安排时段。
- 删除/取消任务及取消实例不投影；已完成事实仍可投影。重复任务投影实例及 override，不再重复展示父任务安排。
- 非重复时间戳使用其显式 offset 对应的墙上时间；重复实例使用系列 IANA 时区及共用 DST 解析；重复任务的截止时间仍保留自身 offset。不得用设备时区重新解释这些事实。
- `layout.ts` 只布局 timed 项；相邻块可共用列，重叠块稳定分列，排序按日期、显示分钟、较长时长、稳定 key。布局不得写 workspace。

## 写入接缝

现有调用链：`CalendarWorkspace` 的指针/键盘/菜单 → `use-calendar-drag.ts` 共用命令构造 → `executeCommand` prop → `App.vue` 的 `executeCalendarCommand` → `runCalendarCommand` → `TaskCapabilityService.execute` → 现有 WorkspaceStore。

- 保留命令信封的协议版本、source、幂等 key 和最新 `expectedWorkspaceRevision`。服务负责验证、草稿、回执、CAS 保存及 undo；组件不写快照。
- `calendar.move` 必须且只能提供 `startAt` 或 `startOn` 中一个非空目标。普通任务使用 task scope；实例默认 occurrence scope，支持 future/series 的已有确认流程。
- `calendar.resize` 普通任务仅 single scope，实例仅 occurrence scope；时长必须是 5–1440 分钟内的 5 分钟倍数。扩大到未来/整个系列的 resize 不受支持，不得默默降级。
- 初次放入定时时段时，开始时间与时长原子写入；已有移动保留时长；实例调整保留其正确归属和 override 语义。
- CAS 保存失败不得持久化拖拽草稿。预检失败不执行；执行失败刷新后报告未保存；已保存但刷新失败报告已保存并只重试刷新，不重复执行。撤销共用该失败分类。

## 交互与视图

- 指针移动仅预览，有效释放仅执行一次；取消、未过阈值或外来指针不提交。键盘和可见菜单走同一命令构造。
- 移动步长 15 分钟、resize 步长 5 分钟；全天项没有上下移动/调时长的伪定时语义。重叠只警告，越过截止时间需要已有确认。
- 未安排区只接收活跃、无 startAt/startOn、非重复父任务；筛选/分组不改变这个资格判定。
- 紧凑边界为宽度 ≤819，周视图降为日视图；月格先显示 3 项，其余走主题化展开。议程超过 500 个 item 行才启用测量式虚拟化，未测量完整时保留内容，并保护焦点/滚动锚点。
- 全部可见控件沿用主题 UI 与现有锁定设计。阶段 1 的筛选、Quick Add 和任务动作应复用现有能力，不绕过命令接缝。

## 最小定向验证

在本工作树执行以下现有测试，不增加镜像实现的测试套件：

```powershell
node --experimental-strip-types --test tests/calendar-baseline.test.ts tests/calendar-projection.test.ts tests/calendar-layout.test.ts tests/calendar-commands.test.ts tests/calendar-command-handler.test.ts tests/calendar-ui-contract.test.ts tests/calendar-responsive.test.ts tests/live-calendar-date.test.ts
npm run check:docs
```

2026-09-09 第一条实跑：71 tests，71 pass，0 fail，0 skipped，退出码 0，约 675 ms。它包含通过 capability service 的命令接口测试、CAS 失败、undo、时区、导入导出和源码 UI 契约；源码断言不等于浏览器验收。

必要浏览器烟测入口为 `npm run smoke:calendar`。2026-09-09 主任务实跑退出码 0：tasks=6、occurrences=1、viewports=5、consoleErrors=0、pageErrors=0；包含 `build:web` / `vue-tsc` 通过。未运行全量 `npm test`、`verify`、原生或外部账号联调；Web 烟测不构成原生验收。

独立合成样本为 `tests/fixtures/calendar-workspace-v3.json`：仅包含人造标题与固定日期，包含定时/全天/仅截止/未安排任务、IANA 系列、全天 override 和任务状态事件链，不含真实用户数据。`tests/calendar-baseline.test.ts` 使用真实 `parseWorkspaceExport` / `createWorkspaceExport` 校验无损 roundtrip、投影不变及固定 SHA-256，定向实跑 1/1 通过。哈希计算采用 `JSON.stringify(JSON.parse(file))`，忽略文件换行，值为 `48a7e9a2bb639d392323ed3d2c952c5b28279fa71ebe8ddd2c2d42742db1b1ca`。该样本是迁移回归输入，不替代迁移时对真实原快照的备份与校验。

## 后续与回滚点

当前侵入性仅为新增本说明、合成 JSON 样本及一个 Node 校验；回滚仅移除这三个本次新增文件，无需数据回滚。阶段 0 基线已通过上述定向测试和主任务烟测。阶段 1 完成后另存 checkpoint，再进入 V4 迁移。V4 必须先备份并校验原快照，失败不替换；CalendarSource/Event 保持独立事实边界，token 不进入 workspace、导出或日志。Google/飞书真实授权与账号联调需单独记录，fake contract 通过不构成线上通过。
