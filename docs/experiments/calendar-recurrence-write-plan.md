# 重复日程写回实施计划

日期：2026-09-09。基线：`main` / `1f62fd1`。工作分支：`feat/calendar-recurrence-write`。

## 全局约束

- 真实 Google 发送、产品写权限入口和运行开关保持关闭；本计划只交付本地与 fake 证据。
- 远端身份始终使用 provider event id。单次实例以 `(parentId, originalStartTime)` 定位，prepare 后冻结实际 instance id 与 instance ETag；不得用移动后的 start 或本地 occurrence id 定位。
- 每个 mutation 前持久化 `outcomeUnknown=true`；丢响应后只读核对，不盲目重发。412 停止并保留冲突，不覆盖第三方修改。
- 幂等 marker 合并既有 `extendedProperties.private`，不能覆盖其他键；`sendUpdates` 固化在确认预览中。
- 只支持当前 reader 可无损往返的单 RRULE 与默认事件。复杂 RRULE、RDATE/EXDATE、附件、会议资源、非默认 event type、参与者批量修改继续明确拒绝。
- 删除无法从 404 证明作者身份；重复事件首版使用可回读 marker 的取消语义。真实删除继续拒绝。
- “此后”拆分在存在 link、outcome、reminder 或未建模例外时拒绝，除非该任务同时交付明确迁移规则和覆盖测试。
- 所有变更留在独立工作树；不合并、不推送，除非用户再次明确授权。保留未跟踪的 `docs/experiments/calendar-competitor-research.md`。

## Task 1: TypeScript 重复写入合同与 fake adapter

在现有 `WriteIntent`、preview hash、outbox 和 Google fake writer 上增加有限重复写入合同：

- `recurring.single`：冻结 parent ref、originalStart、实际 instance ref，只允许时间修改或取消。
- `recurring.series`：冻结 parent ref，只允许标题、时间或可无损 recurrence 修改，以及取消整组。
- preview/hash、inspect、execute、reconcile 全程验证 scope 身份、ETag、marker、`sendUpdates` 和期望字段。
- instance lookup 必须通过 instances endpoint 精确匹配 `recurringEventId + originalStartTime`，分页完整且检测循环；使用 instance ETag 修改。
- 整组使用 parent ETag。写后 reader 必须接受本应用自己的受限 marker，同时仍拒绝未知扩展属性。
- outbox 锁键覆盖 parent 与 instance；同系列未知操作阻塞后续操作。
- `recurring.future` 在本任务仍返回 `WRITE_UNSUPPORTED`，保留一条不会发请求的回归。

验证：`google-write.test.ts`、`google-recurrence.test.ts`、`calendar-write-outbox.test.ts` 定向通过，typecheck通过。

## Task 2: 原生单次与整组可信状态机

扩展 keyring 锚定的 immutable preview 和 native sender：

- prepare 原生读取 parent/instance并冻结远端ID、ETag和期望事实；确认框清楚显示单次或整组范围。
- 单次PATCH/取消使用 instance ETag；整组PATCH/取消使用 parent ETag。
- 发送前检查 grantEpoch、权限、generation、所有锁键和锚定摘要；写后用 exact GET 证明 marker、范围和期望事实。
- 丢响应、重启、权限变化、keyring提交失败只进入只读reconcile；不得重复mutation。
- 默认feature与运行开关状态不变，不增加产品入口。

验证：原生定向测试覆盖成功、412、错实例、错originalStart、丢响应、重启和同系列锁；关闭write feature仍可编译。

## Task 3: 重复写后本地投影与回执

让原生写后回读形成可验证的 parent + exception 批次：

- batch绑定 root operation、plan hash、parent/instance身份、expectedWorkspaceHash和observedAt。
- TypeScript使用现有 recurrence normalizer应用批次；不得创建Task或改动无关完成、复习、link、outcome、reminder事实。
- Rust verifier精确核对parent规则、originalStart例外、取消/恢复、source和事件字段；receipt缺失、过期、篡改或恢复旧Workspace不得ack。
- 常规同步游标保持不变。

验证：由真实TS capability service生成跨语言fixture，覆盖单次移动、单次取消、整组修改、权限降级和篡改拒绝；SQLite ack集成通过。

## Task 4: “此后”拆分恢复状态机

在Task 1–3的身份和投影合同稳定后增加一个root operation plan：

- prepare读取parent、pivot instance、完整受支持recurrence和例外；预先生成固定successor ID。
- 仅支持可无损RRULE、pivot前后边界可证明且无须迁移的附着事实；其他情况在mutation前拒绝。
- step 1以parent ETag截断旧系列；证明后step 2创建固定ID successor。每一步独立持久化 applying/unknown/proof，child不可独立执行。
- child确定失败时，仅在回读证明parent仍是本操作产生的截断状态后，以最新ETag恢复原规则；补偿丢响应同样只读核对，第三方变化进入compensation conflict。
- 本地一次应用parent + successor的完整已证明结果；receipt绑定step summary。任何部分投影均不得ack。

验证：成功拆分、parent丢响应、child丢响应、child确定失败补偿、补偿冲突、重启恢复、固定child ID和零重复通知fake测试。

## Task 5: 收口验证与检查点

- 运行相关浏览器/Node/Rust定向验证、typecheck、模块/协议/CSP/docs检查与diff检查。
- 全部任务完成后运行仓库级 `npm run verify`、`npm run rust:verify` 和默认 `cargo check`。
- 更新阶段6与持续开发检查点，分别列出completed、blocked和NOT_RUN；不能把fake或编译称为真实联调。
- 阶段7继续保持未实现，直到出现实际多时间盒需求证据。
