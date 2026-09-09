# 阶段4：设备连接器检查点

日期：2026-09-09。凭据无关实现与 fake/浏览器接缝已通过；真实账号验收未完成，因此本阶段不标为真实连接完成。未提交、合并或推送。

## 已实现

- 默认关闭的 `calendarConnections` 模块及桌面 Cargo feature；Web/关闭状态不发原生请求。连接管理复用现有日历管理面板，授权由用户明确选择忙闲或只读详情。
- Google 原生 PKCE/state/loopback、系统浏览器、keyring、单飞刷新、撤销/断开、受限重试及安全错误。token/cursor 留在设备边界，Workspace 只保存只读事件事实与来源偏好。
- 目录、忙闲、分页暂存 → Workspace capability CAS/幂等 receipt → 原生核验 receipt 后推进 cursor。恢复旧工作区、未确认批次、权限降级均先复查，不能凭旧 pending 批次跳过权限或基线证明。
- Google 普通事件及可无损表达的基本重复规则；父系列加 originalStart 例外，移动、取消、恢复不会复制 Task。复杂规则、无法保证语义的 DST 系列明确拒绝，busy 查询独立可用。
- 飞书目录、分页事件与 user/room 忙闲的类型化 fake adapter；飞书 confidential OAuth/broker 和原生 transport 尚未实现。
- 来源偏好与只读详情、来源链接；断开保留已导入缓存，权限降级清除敏感详情。busy 缓存仅有时间范围、覆盖与到期，局部错误为 unknown。

## 已运行验证

- Provider fake 9/9；Google recurrence 6/6；原生批次/Workspace runtime 接缝 8/8。上述独立批次不与先前测试总数累加。
- 后续修复实际保存竞争 `WORKSPACE_SAVE_CONFLICT` 的有界重试；runtime单文件最后12/12，含并发无关事实保留、同batch已写回执收敛、持续竞争停止且不ack。它替代上面的8项runtime记录，不累加重复测试。
- Rust feature 开启的 `calendar_connections::sync_store::tests` 最后一次 7/7；原生连接器早先 13/13。Cargo feature 开/关检查均有通过记录，后续原生改动仍需对应检查。
- `node scripts/smoke-calendar-connections.mjs`：真实 Panel/controller/runtime 加合成 IPC，820/320 视口通过，外部请求 0、console/page errors 0；证明权限选择、只读同步、unknown 忙闲和断开保留缓存。见 `artifacts/visual-qa/calendar-connections/summary.json`。
- `npm run typecheck`、协议与文档链接检查通过。按阶段约定未运行全量回归。

## 未验证与限制

真实 Google OAuth、系统 keyring 后端、账号 refresh/revoke、原生 API 增量与断网恢复均未使用隔离账号验证；没有飞书 broker 或账号凭据。fake 与编译通过不替代这些验收。

Google 实例 coverage 缓存尚未实现，复杂 RRULE 不声称同步完整；全来源原子替换不能接受一个月实例作为全量。原生全局同步锁是有意的吞吐上限，当前不引入额外调度框架。

回滚关闭模块/feature 可阻止连接器执行；不删除 Workspace 本地任务或其他来源，不清理研究文件与凭据目录。
