下面这份路线基于当前 `exp/soft-surface-ui` worktree 的实际代码设计。本轮只输出技术方案，没有修改业务代码。

## 一、现有架构与模块边界

当前真实运行链路：

```text
main.ts
  → mountModules()
      → core / storage
      → IndexedDB（Web）或 SQLite（Tauri）
  → App.vue
      → WorkspaceStateV3
      → TaskCapabilityService
      → WorkspaceStore.save(CAS)
      → CalendarWorkspace
          → calendarRange
          → projectCalendarItems
          → layoutTimedItems
          → 日 / 周 / 月 / 议程
```

### 1. 当前目录职责

| 目录 | 当前职责 | 日历后续开发中的定位 |
|---|---|---|
| `src/components/calendar` | 日历视图、工具栏、卡片、拖拽、未安排区 | 只负责展示和交互，不直接写 Store 或调用第三方 |
| `src/domain/calendar` | 日期范围、任务投影、重叠布局、拖拽目标计算 | 演进为统一 `CalendarEntry` 投影和纯排程算法 |
| `src/domain/capabilities` | 命令、预览、幂等、CAS、撤销、审计回执 | 所有任务、日程和外部写入的唯一业务入口 |
| `src/domain/workspace` | `WorkspaceStateV3`、严格解析和迁移 | 升级为 V4，承载本地日程和关联事实 |
| `src/storage/workspace` | `WorkspaceStore.load/save` 接缝 | 接口保持不变 |
| `src/storage/study` | Memory、IndexedDB、SQLite adapter | 继续存完整 Workspace JSON，不立即拆多表 |
| `src/sync` | 通用 outbox 同步接缝 | 可复用模式，但不能直接冒充 Google/飞书日历同步 |
| `src/modules` | 平台能力、兼容性、按需装配 | 外部日历连接器进入此层；日历领域本身不做可关闭模块 |
| `src/lib` | UI 与领域间的编排、平台运行时 | 承载 connector runtime、命令执行和错误反馈 |
| `src-tauri` | SQLite、通知、密钥、原生宿主 | OAuth token 必须进入原生安全存储，不能进入 Workspace |
| `tests` / `scripts` | 分层测试、烟测、性能和交付门禁 | 阶段内精选测试，最后统一全量门禁 |

相关事实可见 [architecture.md](../../docs/architecture.md)、[capabilities/types.ts](../../src/domain/capabilities/types.ts)、[WorkspaceStore](../../src/storage/workspace/types.ts) 和 [module contract](../../src/modules/contract.ts)。

### 2. 已实现、可直接复用的能力

- 日、周、月、议程四视图及日期范围计算。
- 任务的定时、全天和截止日期投影。
- 重复任务系列、实例、单次/未来/整组修改。
- 15 分钟吸附、拖动、调整时长、全天互转和键盘操作。
- 未安排任务拖入时间轴。
- 命令预览、风险等级、幂等键、CAS、撤销、审计回执。
- 多提醒规则、投递 claim/ack、稍后提醒和原生通知。
- Quick Add、优先级、标签、预计时长、截止时间。
- 专注会话、完成记录、下一步任务和周复盘。
- IndexedDB、SQLite、Memory 三种存储 adapter。
- 工作区导入导出、旧版本备份、迁移后校验。

### 3. 当前主要架构风险

- [App.vue](../../src/App.vue) 已超过 1800 行。后续只能增加少量装配，不应把 provider、排程和同步逻辑继续放进去。
- [CalendarItem](../../src/domain/calendar/project.ts) 当前强绑定 `taskId`，必须改为任务/日程联合投影，不能为外部会议伪造任务。
- Workspace 是单 JSON 快照。当前规模下适合继续使用；没有性能证据前不拆 SQLite 多表。
- 现有 `study-cloud-sync` 是工作区快照同步，不是外部日历同步，不能混用协议。
- 当前提醒属于任务。事件提醒应复用投递状态机，但扩展 owner，而不是复制一套 runtime。

## 二、目标技术结构

建议形成四个深模块，调用方只依赖其小接口。

### 1. Calendar Projector

```ts
projectCalendar(
  workspace: WorkspaceStateV4,
  range: CalendarRange,
  filters: CalendarFilters,
): CalendarEntry[]
```

隐藏任务、重复实例、截止日期、本地事件、外部事件、跨日分段和视觉元数据的合并逻辑。

约束：

- 纯函数，无 I/O。
- 一个跨日对象可以投影成多个 segment，但所有 segment 引用同一事实实体。
- 投影结果不可作为持久化事实回写。

### 2. Calendar Provider Port

只有进入外部日历阶段才建立真实接缝，因为届时至少存在 Google、飞书和测试 adapter。

```ts
interface CalendarProviderPort {
  listCalendars(connection: CalendarConnection): Promise<RemoteCalendar[]>
  pullChanges(request: PullRequest): Promise<PullResult>
  queryFreeBusy(request: FreeBusyRequest): Promise<BusyInterval[]>
  pushOperation?(operation: ExternalCalendarOperation): Promise<PushResult>
}
```

约束：

- 拉取必须支持分页、游标失效、tombstone 和限流重试。
- `pushOperation` 在只读阶段不可用。
- 外部写入采用 at-least-once 和 provider 幂等，不宣称分布式原子。
- token、cursor、outbox 和连接缓存不进入 Workspace 导出。

### 3. Availability/Scheduling

```ts
suggestTaskSchedule(input: {
  task: Task
  busy: BusyInterval[]
  workingHours: WorkingHours
  lockedIntervals: TimeInterval[]
}): ScheduleCandidate[]
```

约束：

- 首版只处理单个任务、单个连续时间段。
- 返回建议和无法排入原因，不直接写状态。
- 执行时携带 `taskRevision + workspaceRevision + availabilityFingerprint`。
- 任何版本变化均拒绝执行并要求重新预览。

### 4. Capability command seam

继续使用现有 `TaskCapabilityService`，新增命令族：

```text
event.create / update / delete / move / resize
calendar_source.create / update / archive
calendar_external.apply
calendar_connection.refresh / disconnect
event_attendee.invite / respond
task.auto_schedule
event.create_followup
event_outcome.save
```

所有本地事实写入仍走命令信封、严格校验、CAS 和撤销；UI 与 provider adapter 均无权直接修改 Workspace。

## 三、分阶段实现路径

依赖关系：

```text
阶段 0 → 阶段 1 → 阶段 2
                    ├─→ 阶段 3 ─┐
                    └─→ 阶段 4 ─┴─→ 阶段 5 → 阶段 7
                                      └─→ 阶段 6
全部完成 → 阶段 8 集中验证
```

### 阶段 0：冻结现有日历契约（P0）

目标：先保护当前正确行为，避免后续把任务和日程混成一个实体。

任务：

- 固化四视图、任务投影、拖拽、重复范围、CAS 和撤销契约。
- 明确 `Task` 是可完成对象，`CalendarEvent` 是时间占用对象。
- 明确内部任务不复制为 `CalendarEvent`。
- 记录 V3 数据基线和导出样本。

改动范围：测试契约和技术文档，不改业务状态。

最小验证：

```powershell
node --experimental-strip-types --test `
  tests/calendar-projection.test.ts `
  tests/calendar-layout.test.ts `
  tests/calendar-commands.test.ts `
  tests/calendar-ui-contract.test.ts `
  tests/calendar-responsive.test.ts
npm run smoke:calendar
```

侵入性：低。

风险与回滚：无数据变化，提交可直接回退。

交付标准：现有任务日历行为形成可执行基线；后续阶段不得破坏。

---

### 阶段 1：补齐现有任务日历体验（P0）

目标：先使用已有能力解决低成本、高感知问题。

任务：

- 时间轴自动定位当前时间或工作时间开始处。
- 未安排区按逾期、全天、仅截止日、无日期分组。
- 日历内复用 Quick Add。
- 卡片打开任务详情、完成、重开、开始专注。
- 优先级主色、来源色条、标签徽标、完成状态。
- 日历内搜索和筛选。
- 指针、菜单和键盘操作保持等价。

涉及模块：

- `src/components/calendar/*`
- `src/domain/calendar/project.ts`
- `src/domain/search/workspace-search.ts`
- 少量 `App.vue` 事件接线

接口约定：不新增持久化实体；仅扩展 `CalendarEntry` 读模型字段。

最小验证：

- 投影、布局、搜索、UI contract、responsive 精选测试。
- `npm run smoke:calendar`。
- 320/390/820/1280 四个代表宽度人工烟测。
- 不运行 `npm test` 和 `npm run verify`。

侵入性：低—中。

主要风险：跨日 segment 被当成多个任务；日历完成状态与任务完成状态产生双份事实。

兼容/回滚：segment 只保存源实体引用；本阶段无数据迁移，可整体关闭新 UI 或回退提交。

交付标准：任务能够在日历内完成“收集—安排—执行—完成”，无需跳转多个页面。

---

### 阶段 2：Workspace V4 与本地日程内核（P0）

目标：建立真正的日历事实模型，但暂不接外部服务。

建议数据增量：

```ts
WorkspaceStateV4 {
  ...WorkspaceStateV3
  calendarSources: CalendarSource[]
  calendarEvents: CalendarEvent[]
  calendarEventLinks: CalendarEventLink[]
  eventOutcomes: EventOutcome[]
}
```

其中：

- `CalendarSource`：本地/Google/飞书/ICS、颜色、分组、权限、显隐。
- `CalendarEvent`：timed/all-day 联合时间类型、时区、地点、参与者、忙闲、状态、重复系列和例外。
- `CalendarEventLink`：仅关联独立日程产生的跟进任务或纪要。
- `EventOutcome`：保证会后动作幂等。

任务：

- V3→V4 迁移、解析、导入导出和备份。
- 默认创建一个本地日历源。
- 本地日程 CRUD、移动、resize、删除、撤销。
- 全天排他结束日、跨日、固定/浮动时间、DST。
- 重复系列与单次例外。
- Reminder owner 从任务专属升级为 `task | event`。
- 四种视图投影一致。

预计改动范围：

- `src/domain/calendar/types.ts`
- `src/domain/workspace/{types,parse,migrate}.ts`
- `src/domain/capabilities/{types,catalog,service}.ts`
- 新增 `event-commands.ts`
- IndexedDB/SQLite 的迁移备份键
- protocol/export version 与相应契约测试

最小验证：

- V3→V4 迁移、重复执行迁移、失败不替换原状态。
- event CRUD、CAS、幂等、undo。
- 全天、跨日、DST 和系列例外。
- Memory Store + IndexedDB adapter 联调。
- `npm run typecheck`，但不运行全量测试。

侵入性：高，这是唯一不可避免的核心数据升级阶段。

主要风险：

- 老版本不能读取 V4。
- 时区或重复例外造成不可逆日期漂移。
- Reminder owner 迁移遗漏。

兼容/回滚：

- 首次迁移前保存并校验原始 V3 快照。
- 新状态只有在 V4 解析和回读成功后才替换。
- 提供 task-only V3 导出工具，作为旧版本回退路径。
- 一个兼容周期内读取旧 Reminder 字段，但所有新写入使用统一 owner。
- 不允许旧版本静默忽略 V4 日程数据。

交付标准：离线状态下已经能独立完成成熟单人日历的创建、编辑、重复、全天、时区和提醒闭环。

---

### 阶段 3：统一日历交互与手动时间盒（P0）

依赖：阶段 2。

目标：让任务和日程在一个界面协作，但保持事实类型分离。

任务：

- 空白时段点击/拖选创建，默认轻量编辑器。
- 创建时明确选择任务或日程。
- Plan shelf 拖入时间轴，自动补默认时长。
- 外部/本地日程只作为 busy interval，不自动变成任务。
- 任务卡片完成状态直接回写 Task。
- 日程结束显示“跟进任务 / 纪要 / 无需跟进”，默认不自动制造待办。
- 月视图和议程补齐编辑入口；拖拽能力按视图合理降级。

接口约定：

- 内部任务继续直接投影，不创建 link。
- `CalendarEventLink` 只用于日程→跟进任务/纪要。
- unlink 不删除任务或日程。
- 首版禁止删除传播。

最小验证：

- Quick Add、拖入、完成/重开和 link/unlink 的命令 round-trip。
- 刷新、导出、重新导入后结果一致。
- 会后动作以 `eventId + occurrenceKey + artifactType` 去重。
- 日历浏览器烟测。

侵入性：中。

风险：循环同步、重复创建跟进任务、取消关联时误删事实。

回滚：使用功能开关隐藏融合入口；已存在的 Task、Event、Outcome 均独立保留。

交付标准：任务和日程在同一时间轴协作，任一侧关闭都不会破坏另一侧数据。

---

### 阶段 4：Google/飞书只读连接器（P0）

依赖：阶段 2；可与阶段 3 并行。

目标：获得真实日历占用、多日历显隐和忙闲能力，暂不产生外部写操作。

任务：

- 增加可选 `calendarConnections` runtime 模块。
- Google adapter 先行，稳定后实现飞书 adapter。
- 账户连接、日历列表、分组显隐、颜色和只读权限。
- 增量拉取、分页、tombstone、游标过期后的受控全量重拉。
- free/busy 独立查询，不要求读取会议详情。
- 离线使用最近缓存。
- 外部事件点击跳转来源应用。

本地存储边界：

- Workspace 保存规范化事件和来源引用。
- token、refresh token、sync cursor、连接状态和 outbox 放设备本地 connector store。
- token 不进入 Workspace、JSON 导出、localStorage、日志和 WebView 明文状态。

最小验证：

- Fake provider contract：分页、删除、429、5xx、游标失效、重复实例。
- 离线启动读取缓存。
- disconnect 不影响本地 Task/Event。
- 使用隔离测试账号分别做一次 Google/飞书 OAuth、共享日历、时区和 busy-only 联调。
- 只运行 provider 和 projection 相关测试。

侵入性：中—高。

风险：授权范围过大、token 泄漏、重复/丢失事件、权限降级错误。

回滚：

- provider kill switch。
- 断开时撤销 token，只清理对应 source 缓存。
- 绝不因远端删除或断连删除本地任务、纪要。
- 游标可丢弃并重新拉取。

交付标准：外部会议能够安全、只读地影响日历显示和可用时间计算。

---

### 阶段 5：自动排程、专注与周复盘（P0/P1）

依赖：阶段 3；接入阶段 4 后价值完整。

目标：建立 Todo 与日历真正的执行闭环。

任务：

- 依据预计时长、截止时间、优先级、工作时间和 BusyBlock 生成候选。
- 首版只安排单个连续时间段，不拆分。
- 候选以预览层呈现，用户确认后复用 `task.reschedule`。
- 无法排入时返回明确原因。
- 日历时间盒直接启动现有专注会话。
- 周复盘增加计划分钟、实际专注、完成率、移动次数和未排入原因。

接口约定：

- 建议查询不写入状态。
- 执行命令带 availability fingerprint。
- 不移动会议和手工锁定时间盒。
- 时间盒结束不自动把任务标为完成。
- 周复盘只聚合事实，不推断完成。

最小验证：

- 结果确定、无重叠、不越 deadline、不越工作时间。
- locked interval 永远不移动。
- DST 和容量不足场景。
- 预览后 Workspace revision 变化必须拒绝提交。
- 专注中断恢复及周界聚合测试。

侵入性：中。

风险：建议不可解释、频繁重排、计划时间被误认为实际完成。

回滚：关闭建议器即可；未确认候选不持久化，已确认修改使用现有 undo。

交付标准：用户可将待办转成一周时间计划，并在周末看到计划与实际偏差。

---

### 阶段 6：参与者、RSVP 与外部写回（P1）

依赖：阶段 4。

目标：补齐协作日历能力和受控双向同步。

任务：

- 必选/可选参与者、组织者、RSVP。
- busy-only 找时间。
- 外部事件创建、更新、取消。
- 单次/以后/整组重复事件修改。
- 邀请和变更通知开关。
- ETag/version 冲突处理。
- 外部操作 outbox 与补偿操作。

接口约定：

- `pending → applying → applied | conflict | failed`。
- 冲突默认停止写入，不自动覆盖远端。
- 删除和取消必须是不同命令。
- 断网重试不得重复邀请。
- 提供方不支持的能力明确降级为只读。

最小验证：

- Mock adapter 的幂等、冲突和重试测试。
- 两个隔离测试账号验证邀请、接受、拒绝、待定和时区。
- 系列单次修改、权限不足和离线恢复。
- 本阶段不运行全量回归。

侵入性：高，且存在真实外部副作用。

风险：重复通知、误删系列、覆盖他人修改，是整个链路风险最高的阶段。

回滚：

- 写 adapter 单独灰度和 kill switch。
- 冲突时保留本地草稿及远端版本。
- provider event id、操作幂等键必须记录。
- 测试数据通过补偿取消/删除回收；数据库回滚不能撤回已发送邀请。

交付标准：协作写入失败时不丢本地数据、不重复发邀请、不覆盖未知远端修改。

---

### 阶段 7：多时间盒与会后自动化（P1/P2）

依赖：阶段 5；外部会议自动化依赖阶段 6。

只有实际使用证明“一个任务需要拆成多个时段”后，才新增 `TaskTimebox`：

- 一个任务分拆成多个时间盒。
- 批量重排和部分接受。
- 规则化生成纪要或跟进任务。
- 精力曲线、任务切换成本和缓冲时间。
- 可解释的计划优化。

侵入性：中—高。

风险：模型复杂度和统计口径显著增加。

回滚：`TaskTimebox` 必须是可解除的计划记录；删除时间盒不删除 Task；关闭自动规则不影响已产生的任务或纪要。

交付标准：由真实用户数据证明多段规划优于单段模型，否则阶段保持不实施。

## 四、阶段测试原则

阶段 0–7 遵守以下规则：

- 每阶段只运行被修改模块的纯逻辑测试、接口联调和一条代表性烟测。
- 不在每个阶段运行 `npm test`、`npm run verify`、性能基准或完整安全审查。
- 领域接口变化时运行 `npm run typecheck`，它是静态接口检查，不视为全量回归。
- Provider 先过 Fake adapter，再接隔离测试账号。
- 每个阶段至少留下一个会因核心业务规则改变而失败的行为测试。
- 测试只跨该阶段定义的 seam，不测试内部实现细节。

当前 `npm test` 会运行所有 `*.test.ts`，所以阶段测试应直接使用：

```powershell
node --experimental-strip-types --test tests/<本阶段相关测试>.test.ts
```

## 五、集中全量验证节点

**阶段 0–7 全部完成后，才进入阶段 8。**

### 阶段 8：全量测试、性能、安全与恢复审查

全量门禁：

```powershell
npm run verify
npm run smoke:calendar
npm run smoke:web-persistence
npm run benchmark:task-query
npm run rust:verify
```

若包含 Windows 安装包变更，再执行：

```powershell
npm run package:windows:audit
npm run smoke:windows-package
```

性能检查：

- 保持当前日历范围投影基线。
- 新增 1 万事件月视图、日历显隐切换、搜索和增量同步基准。
- 与阶段 8 开始时基线相比，核心操作不得退化超过 20%。
- 记录 UI 交互 p95，而不只记录纯函数耗时。

安全检查：

- OAuth 最小授权范围。
- token 不进入 Workspace、导出包、日志或 localStorage。
- 事件描述安全渲染，外链只允许受控协议。
- free/busy 缓存不含标题等隐私信息。
- disconnect/revoke、权限降级和日志脱敏。
- CSP 与原生权限合同。

故障恢复演练：

- 断网启动。
- token 过期。
- sync cursor 失效。
- provider 429/5xx。
- 外部写入冲突。
- 数据迁移中断。
- V3 备份恢复和 V4 导入。
- 重试不重复邀请、不重复创建跟进任务。

最终发布门槛不是“成功同步过一次”，而是失败时仍然不会丢任务、覆盖远端或泄露日程详情。

这份方案使用了 codebase-design 确定 deep module、interface 和 adapter 的接缝，并按 Ponytail 控制增量：首版不复制 Task、不拆 SQLite 多表、不另造同步/提醒/搜索框架。
