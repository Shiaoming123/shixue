# 阶段6：协作日历工作检查点

日期：2026-09-09。用户确认暂时没有 Google Desktop OAuth 测试项目，本轮本地实现与 fake 验证已完成，包括受限的重复日程单次、整组和“本次及以后”写回合同。真实账号验收未运行，没有发送邀请、RSVP、重复日程修改或删除远端日程；阶段6真实外部协作尚未完成。

## 本地实现

- 本地日程详情编辑组织者、必选/可选参与者与本地响应，默认折叠，明确标注不会发送邀请或 RSVP。外部来源只读。复用 `parseCalendarEvent` 校验；Google 普通事件和系列事件共享参与者映射，名单截断、额外访客和资源参与者明确拒绝。
- 独立设备 outbox 保存确认后的冻结预览、固定 operationId/eventId、通知策略及摘要，使用版本 CAS、租约和同事件串行。未知结果即使租约过期仍阻止后续写入，只允许只读核对；权限、配额或冲突不能把 unknown 改为“未执行”。
- 原生 backend 冻结并重新验证请求，通过原生对话框展示确认内容。keyring 锚定记录摘要、版本、状态与 grantEpoch；SQLite 展示镜像不构成发送授权。保留上一份已锚定 payload，处理 HTTP 成功后 keyring 写入失败的恢复；不匹配时停止。
- 原生 HTTP 写入前持久化 applying，不重试 mutation；GET 核对固定事件 ID、操作标记与目标字段。创建使用稳定 ID，修改/删除使用 If-Match，412 停写，取消与删除分开。self RSVP 不替换其他参与者。删除丢响应后的404不证明删除成功。
- 写后回读最新远端事实，形成独立、原生锚定的 incremental batch；不修改普通同步游标。通过 Workspace hash、CAS 和 receipt 落盘，再由原生核对实际投影后 ack。恢复、过期回执或基线变化重新回读，只重试本地应用；不重新执行发送器。权限降级按现有同步规则清理私密字段。
- 跨语言 Workspace hash 复用一个可选 `serde_json_canonicalizer` 依赖；数值、UTF-16键序及真实V4 fixture校验对应JS规范化摘要。

## 已有验证证据

- Google请求级fake与outbox 12/12：稳定创建ID、排他结束日期、If-Match、取消/删除差异、self RSVP、sendUpdates、丢响应核对及未知结果阻塞。
- 原生设备存储使用实际临时SQLite验证重开恢复、多连接竞争、旧版本拒绝、过期未知租约阻塞和Workspace表不变。
- 参与者/时间表单行为4/4；Google普通事件与重复事件映射18/18。原生过滤器额外访客数量丢失的回归先红后绿。
- `npm run build:web` 与 `node scripts/smoke-calendar.mjs --participants-only --skip-build` 通过：820新建组织者及两类参与者，320重开与移除保留身份；320/820外部字段只读且Workspace不变。无横向溢出，外部HTTP请求0，console/page errors均0。截图在 `artifacts/visual-qa/calendar/calendar-participants*.png`。
- 最终原生定向命令 `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features calendar-writes calendar_connections:: --lib` 36/36通过，包含投影4项、跨语言hash2项、实际SQLite ack六组TS fixture、keyring提交失败后恢复仅发送1次、完整写scope保留详情、权限降级、最新远端编辑、TTL及restore。
- `cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --features calendar-connections` 通过，确认关闭写feature的只读构建仍可用。TS原生桥接9/9通过，真实能力服务重跑六组共享投影样本并比较完整Workspace；最终typecheck、模块、协议、CSP、文档链接及diff检查通过。

## 明确边界

- `calendar-writes` feature 默认关闭，原生运行开关为 false，产品没有写入开启或授权入口；条件编译的原生backend已有Write授权模式，界面仍只读连接。真实OAuth、系统keyring、原生确认框人工验收、外部写入和邮件均NOT_RUN。backend源码及fake不能证明这些环节已联调。
- 当前凭据无关实现支持受限的重复日程单次、整组和“本次及以后”标题写回：绑定 provider instance/originalStart/ETag，拆分父子状态、固定子ID、补偿和原子本地投影。复杂 RRULE、RDATE/EXDATE、例外或附着 link/outcome/reminder 的“此后”拆分、参与者批量修改仍明确拒绝。固定时间写入仅支持已验证的保守时区与规范时间表示。这些是实现边界，不是 Google 不支持。
- 真实阶段还需Google桌面OAuth公开clientId、两个隔离测试账号和明确的邀请/撤销测试授权；当前工作树及进程未配置clientId。飞书confidential broker尚未实现，不能把client_secret放入桌面分发物。
- 阶段7没有实际多时间盒需求证据，保持不实施；按批准方案，阶段8集中全量、性能和发布门禁尚未进入。

开发工作树分支为 `feat/calendar-recurrence-write`；本轮变更已在该分支提交，尚未合并或推送，并保留未跟踪研究文档。协议依据：[条件修改](https://developers.google.com/workspace/calendar/api/guides/version-resources)、[PATCH语义](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)、[扩展属性](https://developers.google.com/workspace/calendar/api/guides/extended-properties)。真实通知次数、服务端标记保留、重复日程拆分与 RSVP 行为仍需账号验收。

## 2026-09-09 Task 4B2b1：future stage/read（补充报告）

本次仅完成原生 `recurring.future` 的批次构造与回读；future ack 和投影 verifier 留给 4B2b2，仍返回 `WRITE_UNSUPPORTED`。上文阶段6初始限制属于历史检查点，不代表当前重复写入源码进度。

- 仅接受 keyring 锚定的 applied、outcomeUnknown=false root，parent/successor 均 proved，compensation pending，且 `result.future` 精确等于 markerHash 与两份证明。
- 复用 future step GET/response 校验，回读两份当前远端证明并要求字节事实对应的 JSON 完全相等；两次读取 calendar 权限，非 details 或权限变化拒绝暴露。
- 单个 LocalBinding 持久化两项证明事件及 TS future plan（hash、parent/pivot/固定 successor ID、originalStart、markerHash、proved steps），绑定当前 Workspace hash 与 observedAt。复用前重验基线及锚定 ledger；过期基线拒绝，不重发远端 mutation。
- 普通 sync 的过滤器会删除 ETag/marker，故 future 使用 TS 合同字段白名单保留已严格证明的原始字段。普通单次/整组路径保留。
- RED：新增 SQLite/keyring-double 集成测试首次在 stage 返回 `WRITE_UNSUPPORTED`。GREEN：成功、重复读取、部分 proof、root unknown、补偿已执行、结果/证明篡改、权限降级、当前远端 ETag 变化、stale Workspace、keyring 提交失败恢复、TS fixture plan 字段结构、ack 仍拒绝。实际 TS fixture 的双事件投影 verifier/receipt 验证尚未实现。
- 验证：doctor、`npm run rust:verify`（fmt、clippy、93 个 Rust 测试、all-features/no-default-features check）通过；文档与 diff 检查通过。未改 TS 或 fixture，未运行 Node/typecheck；无 UI、Stage 7、真实 Google、系统 keyring 或运行开关变更。

4B2b1 覆盖补充：SQLite 集成测试在 TS fixture 固定字段结构之外，逐值核对完整 plan（preview hash、parent/pivot/successor ID、originalStart、markerHash、两份 exact proved steps）及 operationId、sourceId、stage 前实际 Workspace 摘要。定向测试 1/1 与完整 rust:verify 93/93 通过；仅测试与报告更新，future ack 继续关闭。

## 2026-09-09 Task 4B2b2：future 原子投影 verifier 与 ack

已完成原生双事件 verifier/ack，取代 4B2b1 的临时 ack 禁令；真实运行开关、UI 和 Stage 7 未变化。

- verifier 复用现有 recurrence/source/event 映射，一次核对 parent 与固定 successor 的完整事实、规则、revision、source、proof/marker/plan 绑定和原始 Workspace hash；仅 details 批次可通过。无关任务、关联、outcome、提醒事实和旧回执必须保持。
- ack 继续要求 keyring 锚定的 applied、非 unknown root，双 proved 与 compensation pending，result.future 完全对应 proof；LocalBinding 必须匹配被冻结的 root plan。唯一未过期 capability 回执须绑定 ID、幂等键、root/batch、plan、hash、observedAt 及当前 Workspace revision，且实际 Workspace 必须包含一次原子应用后的双事件。
- keyring 提交失败保持旧锚定状态；恢复只重试同一回执。成功后持久化 receipt_id；同一已确认回执重试不再增加 ledger version、不重写 Workspace。沿用现有 TS localApplied 确认流程；不新增镜像状态机。
- 修正 4B2b1 的 pivot 映射：冻结身份位于 intent.plan.pivot，旧代码及旧测试误读 intent.pivot，可能输出 null。新合同检查会拒绝该缺失身份。
- RED：真实 TS future fixture 在旧 verifier 上失败。GREEN：原始 TS fixture 校验、partial parent/successor、事件身份/标题/规则/source、plan/hash/marker/steps、回执身份/重复/错绑定/过期/revision、stale/restore/permission 拒绝；真实 SQLite 与 keyring-double 覆盖同组无效 Workspace、持久化失败恢复及幂等 ack。SQLite 集成仅将 fixture 的占位 preview hash 替换为本地冻结预览 hash，其余事件事实保持 TS 输出。
- 最终验证：future 定向 26/26，完整 rust:verify 95/95（fmt/clippy/all-features/no-default-features 通过）；Node recurrence projection 7/7，包含重新运行真实 TS capability generator 并比对已批准 fixture；docs/diff 检查通过。TS 与 fixture 未修改，typecheck 未重复运行。真实 Google、系统 keyring、通知与邮件、UI/Stage 7 均 NOT_RUN。

## 2026-09-09 4B2b2 回执保留修正

修复 verifier 对旧回执数组过度严格的问题：按能力服务移除相同幂等键，按执行时刻保留 expiresAt 严格大于 now 的条目，依 createdAt 毫秒、ID、原索引稳定排序，保留末尾 499 条，最后追加新回执。保留项按原值比较；篡改仍拒绝。

可验证子集：日期必须是四位年、UTC `Z`、整秒或三位毫秒；相同 createdAt 下，不同 ID 仅接受等宽 ASCII 数字，完全相同 ID 保持原顺序。其余日期表示或需要一般 localeCompare 的并列 ID 均保守拒绝，不以 Rust 字节排序猜测 JavaScript locale 行为。

实际 TS 能力服务生成[保留探针](../../tests/fixtures/calendar-receipt-retention.json)，覆盖到期边界清理、503 条输入裁剪至 499 条旧回执、相同时间逆序数字 ID 排序。Rust 重建输入与输出并核对完整 Workspace hash，随后验证合法 ack 投影及保留项篡改拒绝。RED 先复现 expired 样本被拒绝，GREEN 通过。生成器支持 `node --experimental-strip-types scripts/generate-calendar-receipt-retention.ts --check`，现有 TS 测试也重新执行生成器比较 fixture。

最终：rust:verify 97/97；TS 定向 8/8；npm test 970/970；typecheck、desktop/Web build、docs/diff 检查通过。变更仅限 verifier、探针和报告；其他阶段、UI、真实 Google 与运行开关不变。

## 2026-09-09 最终收口

- `npm run verify` 通过：Node 970/970，并覆盖 typecheck、模块、协议、CSP、desktop/Web build、布局与文档检查。
- `npm run rust:verify` 通过：Rust 97/97，以及 fmt、clippy、all-features 与 no-default-features 检查；默认 `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- 本地与 fake 范围已完成。真实 Google OAuth、系统 keyring、原生确认框人工操作、实际通知/邮件与真实重复日程拆分均为 `NOT_RUN`，等待测试项目与隔离账号。
- 运行开关保持关闭，产品没有写权限入口；阶段7因缺少实际多时间盒证据继续不实现。
