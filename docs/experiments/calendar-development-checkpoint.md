# 日历持续开发检查点

日期：2026-09-09。状态：阶段0/1/2/3/5本地实现与验收完成；阶段4/6凭据无关实现与fake验收完成，真实账号及复杂重复写回尚未完成。用户确认当前没有Google OAuth测试项目，先完成本地与fake验证，本轮范围已收尾。续行消息已明确预算不限额。各阶段证据与限制见同目录 calendar-stage-N-checkpoint.md。

## 已核对

- 工作树：`D:\Project\Github\Meow\.worktrees\shixue-soft-surface-ui`。
- 分支：`exp/soft-surface-ui`；HEAD：`f840258bd82358b53c6176304e533ac818de8a52`。
- 开始时唯一未跟踪文件：`docs/experiments/calendar-competitor-research.md`。必须保留，不覆盖或删除。
- 原方案来自任务 `01a07edc-02cc-7911-8620-39116e31c3a8` 的 `01a081bc-3f5c-78e3-b898-ec88ff0cf2c8` 回合（最终技术方案，阶段0–8）；不要使用此前竞品研究回合的阶段编号。
- 已读取根 AGENTS、README 双语、docs 入口、开发/发布及视觉合同；应用 codebase-design 与 simplify。
- `npm run doctor` 退出0；报告 Windows 环境的 Filesystem 检查 unavailable（requires macOS），不据此声称原生验证通过。
- 已查看 CalendarWorkspace → TimeGrid → CalendarItem 调用关系；App 的 openTask 会跳出日历，Quick Add 入口同样依赖现有任务视图。阶段1须调整装配并复用动作，不能直接复用跳转行为冒充日历内闭环。

## 顺序与验收

1. 阶段0已完成：契约文档、合成V3 fixture、71项现有定向测试及1项新增往返/哈希校验通过；日历烟测6任务/1实例/5视口，console/page errors均0（含build:web与vue-tsc通过）。结果见同目录 calendar-contract-baseline.md。
2. 阶段1：定位当前/工作时间、未安排分组、Quick Add、详情/完成/重开/专注、视觉元数据、筛选；不改业务持久化模型。模块定向Node检查与一条必要烟测，不运行全量 npm test/verify。
3. 阶段1通过后记录checkpoint，方可进入阶段2 V4。V3迁移先备份并校验，失败不替换；所有写入继续走能力服务、命令信封、CAS、幂等、undo。
4. 后续按原技术方案推进；外部凭据缺失时先完成独立本地实现及fake contract，不伪造联调。

## 剩余与回滚

- 本轮本地/fake目标完成。按分阶段checkpoint界定回滚文件，不覆盖研究文档；开发阶段未提交、合并或推送，后续仅按用户明确授权集成。真实发送保持关闭。
- 最终阶段6原生定向36/36、TS桥接9/9、写feature关闭的只读编译及typecheck通过；投影使用六组真实TS能力服务样本核验SQLite ack。恢复重试不会重新调用发送器。
- 后续需要Google测试项目与隔离账号后再验收真实连接和协作；飞书confidential broker、重复写回仍是实现缺口。不要把fake或编译通过称为真实联调成功；阶段7条件不满足，阶段8集中全量节点尚未进入。

## 2026-09-09 Task 4B2b1 续行进度

已完成：原生 future stage/read 从已锚定的双 proved root 构造一个完整 LocalBinding，重新读取权限与两份远端证明，绑定 TS plan 结构及当前 Workspace 基线；重复读取重验并复用，partial/tamper/stale/permission 拒绝。SQLite/keyring-double RED/GREEN 与完整 rust:verify 93 项通过；研究文件保留。

待办：4B2b2 的双事件原子投影 verifier、精确 capability receipt 及 lost-ack/expiry/restore 验收。future ack 仍关闭；本检查点不声称完整 Task 4B2b 完成。真实 Google、系统 keyring、UI 与 Stage 7 均未进入。

## 2026-09-09 Task 4B2b2 续行进度

已完成：future 原生双事件投影 verifier、精确唯一 capability receipt 验证及 ack；修复 intent.plan.pivot 身份映射。keyring-double/SQLite 证明 partial/tamper/stale/restore/expiry 拒绝、提交失败可恢复、重复确认不重写 Workspace。future 定向 26/26、完整 rust:verify 95/95、TS fixture 重生成比对 7/7 与 docs/diff 检查通过。

4B2b1 的“ack 仍关闭”是历史状态，现由本次严格 verifier/ack 取代。运行开关仍关闭，真实账号/系统 keyring 未验收；无 UI、Stage 7 或真实 Google 变更。研究文件保持未跟踪并保留。
