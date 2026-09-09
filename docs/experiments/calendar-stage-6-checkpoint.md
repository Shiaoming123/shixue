# 阶段6：协作日历工作检查点

日期：2026-09-09。用户确认暂时没有 Google Desktop OAuth 测试项目，本轮本地实现与 fake 验证已完成。真实账号验收未运行，没有发送邀请、RSVP 或删除远端日程；阶段6真实外部协作尚未完成。

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
- 当前写请求只支持单事件创建、标题/时间修改、取消/删除及self RSVP；拒绝全部重复master/instance范围、以后/整组操作和已有事件的整个参与者列表更新。固定时间写入仅支持UTC/Etc UTC及1992年后的Asia/Shanghai。这些是实现边界，不是Google不支持。
- 后续重复写回需要实例ID/原始开始时间绑定、ETag、拆分子操作状态与补偿，以及本地关联身份规则。只读重复映射对扩展属性的处理也须先与写标记对齐。本轮不增加该能力。
- 真实阶段还需Google桌面OAuth公开clientId、两个隔离测试账号和明确的邀请/撤销测试授权；当前工作树及进程未配置clientId。飞书confidential broker尚未实现，不能把client_secret放入桌面分发物。
- 阶段7没有实际多时间盒需求证据，保持不实施；按批准方案，阶段8集中全量、性能和发布门禁尚未进入。

开发工作树为 `exp/soft-surface-ui`；开发阶段未提交、合并或推送，后续仅按用户明确授权集成，并保留原始研究文档。协议依据：[条件修改](https://developers.google.com/workspace/calendar/api/guides/version-resources)、[PATCH语义](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)、[扩展属性](https://developers.google.com/workspace/calendar/api/guides/extended-properties)。真实通知次数、服务端标记保留和RSVP行为仍需账号验收。
