# 拾学通用待办与时间规划基础规格

- 状态：已确认，进入分阶段实现
- 日期：2026-09-04
- 产品阶段：A——时间规划
- 实现方式：六个相互独立、按顺序合并的 PR

## 1. 目标与成功标准

把拾学从学习任务工作区演进为本地优先的通用待办应用，同时把学习能力保留为统一任务模型上的专业模式。Windows 桌面为本阶段完整交付目标，Web 与窄窗口保持数据和核心交互兼容。

本阶段完成时，用户可以：

- 新建、编辑、删除、完成、重开任务，并设置独立的计划时间、预计时长和截止时间。
- 使用固定或“完成后”重复规则，安全编辑本次、本次及以后或整个系列。
- 用中文/英文离线自然语言快速录入，并在提交前编辑识别出的字段。
- 为任务配置多个提醒，在托盘后台收到提醒并直接完成、稍后提醒或打开任务。
- 在日、周、月、议程视图规划任务，从未计划托盘拖入日历。
- 从收件箱、今天、最近七天、日历、清单、已完成和学习工作区进入同一份任务数据。

质量成功标准：原有 v2 数据零丢失迁移；所有业务写入走统一能力服务；所有可见控件使用主题组件；195 项现有测试不回退，各 PR 新增针对性测试；Windows 安装包完成真实提醒/托盘烟测后才发布。

## 2. 明确不做

- 不实现“小拾”的模型接入、聊天 UI、工具注册/选择、联网检索、任务编排、执行卡片和长期记忆。
- 不实现外部日历同步、多人协作、习惯、看板、时间线、倒数日或云端后台执行。
- 不在本阶段承诺 Web 通知、移动原生通知、商店分发、签名或自动更新。
- 不复制 Todofy 源码；只使用固定提交的实现事实帮助判断，按拾学技术栈和模型独立实现。

## 3. 现状与参考证据

### 拾学基线

- Vue 3 + TypeScript + Vite + Tauri 2。
- 桌面 SQLite 与 Web IndexedDB 保存同一个经校验的 `StudyState v2` 快照，写入使用快照级 CAS。
- `StudyTask` 已有状态、计划日、截止日、单提醒、优先级、预计时长、检查项和 revision；学习闭环由 `StudySession`、`TaskEvent`、`CompletionRecord` 表达。
- 查询、批量、提醒、同步适配器已有纯函数和测试，但领域命令集中在 `src/lib/study.ts`，UI 仍存在可见原生 `<select>` 与重复的 scoped 控件样式。

### Todofy 固定源码审计

审计提交：[`ff736f53`](https://github.com/salarzeidanlou/todofy/tree/ff736f53eda116ce22a3d933d35f3054899c95d7)。本地临时 clone 放在非系统盘并在审计后清理。

| 源码事实 | 采用方式 |
| --- | --- |
| `QuickAdd.tsx` 调用 `parseQuickAdd()`，实时显示日期、时间、优先级、重复和标签 chips | 借鉴“边输入边可见”的反馈，但拾学默认保留原题文字，chip 可编辑/撤销，避免静默误解析 |
| `nlp.ts` 使用 chrono-node 和正则剥离英文 token | 按现有零新增依赖原则重写为确定性中英文解析器；输出候选与置信规则，不直接保存 |
| `RepeatPicker.tsx` 明确因原生 select 无法统一样式而自绘菜单 | 采纳为全局 UI 合同，不让每个业务模块自行实现外点关闭和键盘逻辑 |
| `DatePicker.tsx` 提供快捷日期和日/月/年层级，但时间仍显示原生 `input[type=time]` | 借鉴快捷路径；时间也改为拾学主题化控件，原生 input 只可作隐藏语义层 |
| `recur.rs` 只支持 daily/weekdays/weekly/monthly/yearly | 以系列 + 独立发生项重写，增加间隔、选定星期、结束日期/次数、完成后重复和单次例外 |
| `toggle_task` 完成重复任务时直接推进同一行日期与提醒 | 明确拒绝：会抹去发生历史，无法编辑“本次及以后” |
| `scheduler.rs` 每 20 秒查找到期任务并去重，窗口隐藏仍投递 | 借鉴后台调度与非阻塞失败；拾学改为每个提醒投递记录和动作回调 |
| `ReminderToasts.tsx` 提供打开与稍后 10 分钟 | 扩展为完成、稍后提醒、打开，且系统通知和应用内卡片调用同一能力命令 |

### TickTick 当前官方产品基准

TickTick 官方功能页当前列出快速捕捉/NLP、清单/筛选/标签、多提醒与自定义重复、日历年/月/周/议程视图、拖动时间规划、快捷键等能力。本阶段选取与时间规划直接相关的成熟交互，不扩入协作、习惯、矩阵和统计。证据：[TickTick Features](https://ticktick.com/features)、[TickTick Help Center](https://help.ticktick.com/)。

## 4. 信息架构

一级导航固定为：

1. 收件箱
2. 今天
3. 最近七天
4. 日历
5. 清单（按分组展开）
6. 已完成
7. 学习

“今天”查询合并四种来源：计划在今天、今天截止、未完成且已逾期、今天的重复发生项。投影层按任务/发生项稳定 ID 去重，一行可同时显示“计划”“截止”“逾期”等标记。默认分组顺序是逾期、今天计划、今天截止、今天重复；组内按计划开始、优先级、手动顺序排序。

桌面保持左导航—中列表/日历—右详情三栏；中等窗口把详情改为覆盖抽屉；窄屏改为单栏和底部导航。视觉细节以根目录 `DESIGN.md` 和 `VISUAL_QA.md` 为准。

## 5. v3 数据模型

### 5.1 根状态

```ts
interface WorkspaceStateV3 {
  version: 3
  revision: number
  listGroups: ListGroup[]
  lists: TaskList[]
  sections: ListSection[]
  tags: Tag[]
  tasks: Task[]
  recurrenceSeries: RecurrenceSeries[]
  occurrences: TaskOccurrence[]
  reminderRules: ReminderRule[]
  reminderDeliveries: ReminderDelivery[]
  studySessions: StudySession[]
  taskEvents: TaskEvent[]
  completionRecords: CompletionRecord[]
  reviewTaskLinks: ReviewTaskLink[]
  commandReceipts: CommandReceipt[]
  updatedAt: string
}
```

存储端继续保存完整快照并以 `revision` + `updatedAt` CAS。`commandReceipts` 只保留最近 500 条或 30 天，用于本地幂等；审计事实仍写入 `TaskEvent`，不会随 receipt 清理。

### 5.2 任务与时间

```ts
type TaskMode = 'general' | 'learning'
type TaskStatus = 'inbox' | 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'

interface TaskSchedule {
  startAt: string | null       // 含时区偏移的 ISO；仅日期时使用 startOn
  startOn: string | null       // YYYY-MM-DD
  estimateMinutes: number | null
}

interface TaskDeadline {
  dueAt: string | null
  dueOn: string | null
}

interface Task {
  id: string
  revision: number
  mode: TaskMode
  listId: string
  sectionId: string | null
  tagIds: string[]
  title: string
  notes: string
  status: TaskStatus
  schedule: TaskSchedule
  deadline: TaskDeadline
  priority: 'none' | 'low' | 'medium' | 'high'
  checklist: TaskChecklistItem[]
  learning: LearningTaskFields | null
  recurrenceSeriesId: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
```

`startAt` 与 `startOn` 互斥，`dueAt` 与 `dueOn` 互斥。计划可晚于截止，系统显示冲突但不偷偷改值；用户确认后允许保存，以覆盖真实世界的补救安排。

### 5.3 重复系列与发生项

```ts
type RecurrenceCadence =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: number[] }
  | { kind: 'monthly'; interval: number; dayOfMonth: number }
  | { kind: 'yearly'; interval: number; month: number; dayOfMonth: number }

interface RecurrenceSeries {
  id: string
  taskId: string
  revision: number
  cadence: RecurrenceCadence
  basis: 'fixed_schedule' | 'after_completion'
  anchorAt: string | null
  anchorOn: string | null
  end: { kind: 'never' } | { kind: 'on'; date: string } | { kind: 'after'; count: number }
  timezone: string
  createdThrough: string | null
  createdCount: number
}

interface OccurrenceOverride {
  scheduledAt: string | null
  scheduledOn: string | null
  estimateMinutes: number | null
}

interface TaskOccurrence {
  id: string
  seriesId: string
  ordinal: number
  scheduledAt: string | null
  scheduledOn: string | null
  status: 'pending' | 'completed' | 'skipped' | 'cancelled'
  override: OccurrenceOverride | null
  completedAt: string | null
  revision: number
}
```

系列的 `anchorAt` / `anchorOn`、发生项及其 override 的 `scheduledAt` / `scheduledOn` 均互斥：精确时间必须带时区，全天日期只保存 `YYYY-MM-DD`，不得编码为任意时区的午夜时间戳。旧 v3 timestamp 记录读取时无损保留并为新增 date-only 字段补 `null`；新增字段属于 v3 的向后兼容扩展，但不理解 `scheduledOn` 的旧 reader 必须拒绝该记录，不能静默转换或丢失。

固定规则由锚点推导；“完成后”规则仅在前一发生项完成时创建下一项，下一日期/时间以实际完成瞬间的系列本地日期和墙钟为新基准，再应用 cadence interval，不回到原始锚点网格。周规则先加 `interval` 周，再从该日向后选择第一个允许的 `weekdays`；月/年规则保留完成日的月日语义并在短月夹到月末。date-only 规则只做平台无关的日历运算，时区只用于把当前/完成瞬间映射为规则的本地日期。精确时间落入 DST 不存在的墙上时间时向前平移该缺口（02:30 → 03:30），重叠时间选择第一个匹配瞬间；非法 IANA 时区在读取和命令校验阶段拒绝。每次补齐最多到当前时间 + 90 天且最多保留 50 个待处理项。月末规则采用“夹到当月最后一天”，并把这一行为写入规则摘要。

### 5.4 多提醒

```ts
interface ReminderRule {
  id: string
  taskId: string
  occurrenceId: string | null
  trigger:
    | { kind: 'at_start' }
    | { kind: 'before_start'; minutes: number }
    | { kind: 'before_due'; minutes: number }
    | { kind: 'absolute'; at: string }
  enabled: boolean
  revision: number
}

interface ReminderDelivery {
  id: string
  reminderRuleId: string
  occurrenceId: string | null
  scheduledFor: string
  status: 'pending' | 'delivered' | 'snoozed' | 'acted' | 'dismissed' | 'failed'
  snoozedUntil: string | null
  action: 'complete' | 'open' | null
}
```

同一 `(rule, occurrence, scheduledFor)` 只投递一次。稍后提醒创建/更新投递，不改任务计划或截止时间。

## 6. v2 → v3 迁移

迁移必须是纯函数、幂等且先完整校验后替换：

1. 创建系统清单“学习”，把每个 `StudyTopic` 映射为学习清单；已有 `StudyListGroup` 保留 ID。
2. 全部 `StudyTask` 保留 ID，设为 `mode: 'learning'`；`topicId` 映射为 `listId`，无 topic 的任务进入“学习”清单。
3. `plannedOn` → `schedule.startOn`，`estimateMinutes` 保留；`dueOn` → `deadline.dueOn`。
4. 非空 `reminderAt` 转为一条 absolute `ReminderRule`，ID 由任务 ID 确定生成。
5. `acceptanceCriteria` 等学习字段移入 `learning`；会话、事件、完成记录保留 ID 和 taskId。
6. 为待复习记录创建 `ReviewTaskLink` 与可见复习任务；已完成历史不重复生成。
7. 写入迁移事件但不重排旧事件 sequence；新事件从最后 sequence + 1 开始。
8. 导入仍识别 v1/v2，统一迁移到 v3 后再保存；失败时旧快照保持原样。

兼容期保留 `parseStudyStateOrMigrate` 包装入口，但内部返回 `WorkspaceStateV3`；导出格式升级到 `meow-study/workspace-export` v3，导入器继续接受旧的 `meow-study/study-export` v1/v2。

## 7. 应用能力协议

```ts
type CommandRisk = 'low' | 'medium' | 'high'
type CommandScope = 'single' | 'batch' | 'series' | 'workspace' | 'external'
type Reversibility = 'reversible' | 'compensating' | 'irreversible'

interface CommandEnvelope<C extends CapabilityCommand> {
  protocolVersion: 1
  idempotencyKey: string
  source: 'human-ui' | 'keyboard' | 'notification' | 'agent'
  expectedWorkspaceRevision: number
  command: C
}

interface CommandDescriptor {
  type: CapabilityCommand['type']
  risk: CommandRisk
  scope: CommandScope
  reversibility: Reversibility
  requiresPreview: boolean
}

interface CommandPreview {
  accepted: boolean
  descriptor: CommandDescriptor
  affected: EntityRef[]
  changes: ChangeSummary[]
  validationErrors: DomainError[]
  confirmation: 'none' | 'review' | 'explicit'
}

interface CommandResult {
  receiptId: string
  workspaceRevision: number
  affected: EntityRef[]
  events: TaskEvent[]
  undoToken: UndoToken | null
  data: unknown
}
```

首批命令：`task.create/update/delete/complete/reopen/reschedule`、`task.batch_reschedule/batch_cancel/batch_delete`、`recurrence.create/update/skip/complete`、`reminder.set/snooze/dismiss`、`calendar.move/resize`、`workspace.import`、`undo.apply`。查询：`workspace.snapshot`、`task.get/search/list`、`view.today/upcoming/completed`、`calendar.range`、`command.describe`、`audit.list`。

执行不变量：先解析并校验全部目标，再复制快照执行全部变化，最后一次 CAS 保存；任何一步失败都不保存。重复 idempotency key 返回原 receipt，不二次执行。revision 冲突返回结构化错误，不自动覆盖。

权限元数据预留三种未来策略：谨慎、标准、自主。标准策略下读取自动；可逆单项写入自动并提供撤销；高风险、批量、导入覆盖、整个系列和外部写入必须预演确认。任何策略都不能绕过红线动作。

## 8. 自然语言快速新增

解析完全离线、确定性、可测试，不依赖模型或网络。支持：

- 中文：今天/明天/后天、周一至周日、下周、上午/下午/晚上、具体时分、截止、优先级、每天/工作日/每周/每月/每年。
- 英文：today/tomorrow/weekday、weekday names、am/pm、due、p1–p4、daily/weekly/monthly/yearly。
- `#标签` 与 `@清单` 仅在精确匹配现有实体时转为字段，未知 token 保留在标题。

解析器返回原始范围与候选字段；UI 将候选渲染为可编辑 chips。默认标题保留原文字；设置项 `quickAdd.removeRecognizedText` 开启后才生成去除已确认 token 的标题。冲突或模糊日期不自动选择，chip 显示待确认。

## 9. 提醒、托盘与窗口生命周期

- 首次创建提醒时即时请求通知权限；拒绝不会阻止任务保存，并提供设置入口。
- Rust 调度器在应用处于托盘时运行；完全退出后明确不保证提醒。
- 首次关闭窗口弹出轻量选择：最小化到托盘 / 退出，并可记住；托盘菜单始终有打开、快速新增、退出。
- 通知动作调用能力协议：完成、稍后提醒、打开任务。系统动作不可用时，点击通知打开应用内同等卡片。
- 设置提供开机启动、关闭行为、默认稍后时长、通知测试和权限状态；开机启动默认关闭。

## 10. 日历与拖动

- 视图：日、周、月、议程；桌面记住最后视图，窄屏默认日视图。
- 只有 `schedule.startAt + estimateMinutes` 形成有高度的时间块；日期任务位于全天区；只有 deadline 的任务显示截止标记但不占时间槽。
- 未计划任务托盘显示无 schedule 的活动任务，可拖到日期/时间槽。拖动、改变时长和跨日移动在释放前仅更新预览，释放后执行 `calendar.move/resize`。
- 重复发生项拖动默认作用于本次；用户选择系列范围时才改规则。
- 键盘替代：任务菜单提供移动到日期、设置开始时间、调整时长；选中日历块后 Alt+方向键移动，Shift+Alt+上下调整时长。

## 11. 视觉与统一控件

根 `DESIGN.md` 是视觉真源，`VISUAL_QA.md` 是验收真源。首个 UI PR 先建立统一控件层和 OverlayManager，再允许业务界面使用。

以下可见默认外观一律禁止：`select`、checkbox、radio、switch、date/time input、context menu、alert/confirm、未主题化 scrollbar。原生元素可作为隐藏语义层，但必须同步值、焦点、disabled、validation 与可访问名。

业务文案最小化：不用“点击这里添加任务”“此按钮用于删除”等说明；使用标准图标、占位符、tooltip、选择状态、空状态插画和短错误信息。危险操作的确认文案只说明对象、影响数量和不可逆后果。

## 12. 设置与默认值

```ts
interface PlanningPreferences {
  weekStartsOn: 0 | 1
  defaultCalendarView: 'day' | 'week' | 'month' | 'agenda'
  defaultEstimateMinutes: number | null
  quickAddRemoveRecognizedText: boolean
  closeBehavior: 'ask' | 'tray' | 'quit'
  launchAtLogin: boolean
  defaultSnoozeMinutes: number
  reducedGlassOverride: 'system' | 'on' | 'off'
}
```

设置使用现有配置/模块边界，不能混入业务快照中的任务数据；影响查询结果的用户偏好必须显式传入查询函数，避免隐式全局状态。

## 13. 可观测性、错误与性能

- 所有存储、迁移、调度、通知和命令错误使用稳定错误码；UI 显示简短可操作信息，调试详情只写不含用户内容的本地日志。
- 10,000 个任务、1,000 个活动重复系列、未来 50,000 个发生项下，Today/7 天查询目标小于 100ms，日历范围投影小于 150ms（发布构建、本机基准）。
- 发生项按范围索引；提醒按 `status + scheduledFor` 索引；搜索首阶段仍为规范化子串，不引入全文检索依赖。
- 存储失败、通知拒绝、无效导入、CAS 冲突都必须 fail loud，不显示伪成功状态。

## 14. 六阶段交付与总验收

| PR | 目标 | 独立验收 |
| --- | --- | --- |
| 1 | v3 模型、迁移、能力协议、统一控件基础 | v1/v2 迁移保留关系；命令预演/幂等/CAS/原子批次通过；可见控件审计有机器检查 |
| 2 | 重复系列与发生项 | 两种 basis、结束条件、窗口、三种编辑范围、完成/跳过历史通过属性与例表测试 |
| 3 | 离线 NLP 与快速新增 | 中英文固定用例、冲突提示、可编辑 chips、标题保留设置、全局快捷新增通过 |
| 4 | 多提醒、通知动作、托盘 | 多提醒去重、snooze 不改日期、权限按需、托盘生命周期、Windows 实机烟测通过 |
| 5 | 日历与拖动 | 四视图、未计划托盘、移动/调整、重复本次默认、键盘替代、五视口视觉验收通过 |
| 6 | 导航、学习连接、集成与发布 | 七入口共享状态；Today 去重；旧学习数据可追溯；完整门禁与 Windows 安装包烟测通过 |

每个 PR 的逐文件 TDD 步骤见 `docs/superpowers/plans/2026-09-04-*.md`。PR 必须按顺序合并；后续 PR 只可依赖已合并契约，不得在分支间复制未合并实现。
