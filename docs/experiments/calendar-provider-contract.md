# Calendar provider：阶段 4 实现合同

核对日期：2026-09-09。状态：**规格 / credential-independent fake 待实现**。本次只读取公开官方文档和本地源码；未创建 OAuth 应用、获取令牌、连接个人日历或执行 provider 写入。真实凭据、系统浏览器回调、系统 keyring 和真账号增量同步均为 **NOT_RUN**。

本合同落实[阶段 4](./calendar-development-plan.md)的 Google 先行只读连接器。下文标明的策略、函数和限额是本项目的实现选择，不代表 provider 的保证。不得将阶段 4 完成等同于双向同步或发邀请已实现。

## 1. 原生与存储边界

现有参考：[Rust study_cloud](../../src-tauri/src/study_cloud.rs)、[Tauri transport](../../src/lib/study-cloud-supabase-tauri.ts)。现有实现将 access/refresh token 保存在 keyring，IPC 只回传会话摘要；请求在 Rust 内带 Bearer，设置超时、响应大小上限、禁重定向和脱敏错误。`Cargo.toml` 的 `sync` feature 才启用 keyring/reqwest。可以复用这些边界，不能复用 Supabase password grant、项目 URL 验证、整包 snapshot push/pull 或它的 keyring account 命名。

建议新增可选 `calendarConnections` 模块与独立 Rust feature；关闭模块时不注册连接命令，不借开启 study-cloud 来隐式启用日历。keyring service 单独命名，account key 为 provider/clientId/本地 connectionId 的稳定组合，支持多个账号。Web 真连接返回 unavailable；fake 可用于 Web 测试。所有 secrets、OAuth state/verifier 留原生；不得进入 Workspace、导出、云快照、localStorage、Vue 状态或日志。cursor、provider id 映射、同步批次和连接状态在设备 connector store；Workspace 仅持有规范化事件、来源和非敏感连接引用。

建议边界接口：

```ts
type ConnectionState = 'disconnected' | 'connecting' | 'ready' | 'reauthorize' | 'offline' | 'error'
type ReadAccess = 'details' | 'freebusy' | 'none'
// IPC 不接收 URL、Bearer、refresh token 或任意请求头。
connectGoogle({ clientId, mode: 'details' | 'freebusy' }): Promise<ConnectionSummary>
disconnect({ connectionId, revoke: boolean }): Promise<ConnectionSummary>
listCalendars({ connectionId }): Promise<CalendarDescriptor[]>
syncCalendar({ connectionId, sourceId }): Promise<AppliedBatchSummary>
queryFreeBusy({ connectionId, calendarIds, startAt, endAt }): Promise<BusyResult[]>
```

将 OAuth transport、Clock、Random、CredentialStore、ConnectorStore 注入 fake 测试；生产实现只允许固定 provider endpoint。原生连通后只通过有界 provider-ingest capability 更新 Workspace：认证来源必须来自原生已验证连接，不能由 UI 传 `provider:'google'` 自行获取写权限。该入口只更新对应外部源/事件；保持 Task、TaskEvent、完成记录不变。现有 `event.update` 对外部源仍拒绝。

## 2. Google endpoints 与最小授权

基础 URL 为 `https://www.googleapis.com/calendar/v3`。

| 能力 | HTTP / path | scope（均以 `https://www.googleapis.com/auth/` 为前缀） |
| --- | --- | --- |
| 日历目录 | GET `/users/me/calendarList` | `calendar.calendarlist.readonly` |
| 事件读取 | GET `/calendars/{encodedCalendarId}/events` | `calendar.events.readonly` |
| 只看占用 | POST `/freeBusy` | `calendar.events.freebusy` |

以上窄 scope 分别见官方 [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)、[Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)、[Freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)。详情模式请求目录+事件；独立忙闲模式请求目录+忙闲，绝不为读取忙闲强行要求事件详情。首版不请求 calendar 写 scope、联系人或邮件。

OAuth：系统浏览器打开 `https://accounts.google.com/o/oauth2/v2/auth`；`response_type=code`，Desktop app client，随机 state、PKCE S256。Rust 先 bind `127.0.0.1:0`，使用实际端口的 loopback redirect；以同一 redirect URI、code、verifier、client_id 和 `grant_type=authorization_code` POST form 到 `https://oauth2.googleapis.com/token`。不使用 WebView、OOB 手工粘贴或自定义 scheme。官方 native 文档明确 installed apps 不支持 incremental authorization；以后加 scope 必须重新走明确授权，不能承诺 Web 的 incremental-consent 机制。[Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[loopback 平台限制](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)。

项目策略：state/verifier 仅内存、单次消费，登录超时 5 分钟；仅接受既定 path 的 GET，验证 state，错误/取消后关闭 listener。verifier 32 随机字节的无填充 base64url，S256 challenge。返回固定成功页，不回显 code/token。仅监听 loopback；Android/iOS 不继承此回调方案。[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)。

令牌寿命读取响应 `expires_in`，提前 60 秒刷新；每连接 single-flight 刷新。Google refresh 响应缺 refresh token 时保留旧值，有新值则原子替换后才使用。首次无可用 refresh token 时标记 session-only，不谎报持久连接。`invalid_grant` 转 reauthorize，清除不可用凭据；离线不清有效凭据。最多一次刷新后重试 API 401。只根据实际授予 scope 启用功能，缺 scope 不循环弹登录。[OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)。

Disconnect 先停止本地轮询、删除本地凭据并令未完成批次失效；保留或删除只读缓存由明确参数决定。revoke 通过原生 POST `https://oauth2.googleapis.com/revoke`，使用 form body，不把 token 放日志 URL。远端 revoke 失败必须单独报告，不能把本地断开称为远端撤销成功。Google 文档提示撤销可能影响同项目其他 client 的授权；真连接 UI 必须准确表达范围。[官方撤销说明](https://developers.google.com/identity/protocols/oauth2/native-app#tokenrevoke)。

## 3. 同步与批次提交

Google 主同步固定 `singleEvents=false, showDeleted=true, maxResults=2500`，不带时间窗、不展开无限系列；目录同步固定 `showDeleted=true, showHidden=true`。每次页请求保持初始参数 profile；增量沿用同一旧 syncToken，追加 pageToken，直到最后一页获得 nextSyncToken。不能因为 items 为空就结束。events 增量不能混 `timeMin/timeMax/updatedMin/q/orderBy/iCalUID` 或 extended-property 过滤；目录增量不能混 minAccessRole。仅最后完整批次推进 cursor。[官方同步指南](https://developers.google.com/workspace/calendar/api/guides/sync)。

设备记录最少字段：

```ts
interface SyncCheckpoint {
  connectionId: string; sourceId: string; profileHash: string
  generation: number; syncToken: string | null
  pendingBatchId: string | null; lastSuccessAt: string | null
}
interface ProviderIdentity {
  provider: 'google' | 'feishu'; connectionId: string
  calendarId: string; eventId: string; originalStart: string | null
}
```

项目提交协议：先在 connector store 暂存全部 page 的规范化 delta、base cursor/generation、候选 next cursor 与 batchId；验证完整性后，单个 capability 以 workspace CAS 原子应用 delta；receipt 用 batchId 幂等；最后仅在 Workspace receipt 已确认时推进 connector cursor。崩溃发生在两次存储提交之间时，以同 batchId 重放取得原 receipt，再提交 cursor。禁止先推进 cursor 后改 Workspace。Workspace CAS 失败重新读取后重试有界 apply，不重抓已验证分页。

单批上限建议 100 页/50,000 items/32 MiB 规范化数据；触限返回 incomplete 保留旧 checkpoint，不静默提交部分集合。每连接最多 2 个日历同步并发，同源串行；不需要 HTTP multipart batch。重试按连接调度，429 与 rateLimitExceeded 403/5xx 使用有抖动指数退避及 Retry-After；权限 403 与配额 403 必须按 reason 区分。未知错误不当成删除。[Google 错误语义](https://developers.google.com/workspace/calendar/api/guides/errors)。

HTTP 410：立即废弃受影响 collection 的 cursor 和未完成批次，启动新的 full generation。旧事件缓存不再参与新代增量，可标注过期离线展示；直到新全量成功才替换该源的 provider-owned 集合。不能清整个 Workspace，不能删其他连接或本地任务。若 410 来自 ACL 变化，应先复查权限；已确认降级到 freebusy/none 时立即移除该源敏感详情，不能以 stale cache 为由继续暴露。

## 4. 事件、权限与 busy 表达

Google event identity 用 `(connectionId, calendarId, event.id)`，不用跨日历 iCalUID 去重。date→全天排他 end；dateTime→fixed，保留有效 IANA zone 和真实 instant。Google 导入不创造 floating。`recurringEventId + originalStartTime` 标识例外；取消实例必须保留父系列关系，普通 cancelled tombstone 可只有 id，不能要求 title/start 完整。外部 source 的本地 permission 始终 read，即使 Google accessRole 为 writer/owner。[官方 event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)。

现有 CalendarEvent recurrence 不能表达任意 RRULE/RDATE/EXDATE。禁止把 BYSETPOS、多个 RRULE 等静默转成“每天”。建议设备 provider store 留经过字段白名单的系列 envelope；能无损映射的规则才写现有 recurrence；其他规则通过 provider instances 分页生成明确 coverage 范围的只读实例缓存，UI 标注覆盖范围。没有实例适配实现时返回 unsupported-recurrence，busy 查询仍可使用；该来源不能显示“同步完整”。实例 endpoint 为 GET `/calendars/{calendarId}/events/{eventId}/instances`，需实现前核对其独立分页与范围合同，不复用主 sync cursor。

目录和 events 响应 accessRole 共同判断 details/freebusy/none。`freeBusyReader` 或详情拒绝时独立 queryFreeBusy；降级原子清除先前标题、地点、参与人、备注、会议链接和相应搜索索引。删除/失去日历权限只影响对应外部源，保留本地 source 显隐偏好；离线与权限撤销区分。

BusyResult 只含 calendar/source 引用、start/end、coverage、fetchedAt 以及 per-calendar error。一次最多 50 calendars，不自动展开 group；分块后保留局部错误，HTTP 200 的单日历 error 绝不是“空闲”。缓存不含会议标题；超出 coverage 或已过期时返回 unknown 而非 free。TTL 首版 5 分钟是项目策略。[Freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)。

## 5. 飞书差异与真实授权限制

公开官方页已通过浏览器实际渲染核对（web 文本抓取为空不代表协议缺失）：

- OAuth authorize 为 `https://accounts.feishu.cn/open-apis/authen/v1/authorize`，需注册允许的 redirect_uri，验证 state，支持 PKCE S256；offline_access 才授 refresh token。[获取授权码](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code)。
- v2 token 文档现标历史版本；新 endpoint 为 `https://accounts.feishu.cn/oauth/v3/token`。**开放平台注册应用均为 Confidential Client，需要 client_secret；Public Client 不开放注册，仅官方 MCP 应用使用。** 因此不能把 Google 无密钥桌面授权直接套给飞书。真实飞书连接需要另行设计 confidential broker 或受控自有应用凭据方案；不得随桌面分发开发者 secret。refresh token 单次使用，必须串行刷新与持久替换，使用返回 expires_in/refresh_token_expires_in，不硬编码。[当前 token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)。
- 读取授权候选为 `calendar:calendar:read`、`calendar:calendar.event:read`；忙闲独立 `calendar:calendar.free_busy:read`，加 offline_access；这些 scope 见[飞书官方权限说明](https://www.feishu.cn/content/article/7615520954977881029)。应用开通与用户同意缺一不可。API 文档仍接受部分旧合并权限，fake 不应要求旧大 scope。
- GET `https://open.feishu.cn/open-apis/calendar/v4/calendars/{calendar_id}/events` 以 user_access_token 读用户身份。详情限 reader/writer/owner，支持 primary/shared/resource，不支持 google/exchange 日历。首抓固定 anchor_time，page_size 500，随后按 page_token/has_more 拉完并保存末页 sync_token；start_time/end_time 模式单次截断、无法分页，不用于完整镜像。sync_token 禁与 start/end 混用，anchor 不随时钟滚动。[官方事件列表](https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/list)。
- 飞书 HTTP 400 + code 190008 表示 page/sync token 过期，清受影响 token 重拉；190009 是参数冲突，不能无限 full reset；191002 权限丢失，191003 日历删除；190004/190005/190010 限流。检查 HTTP 与 JSON code，不复制 Google 410 分支。[同一官方错误表](https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/list)。

飞书 fake 可以先证明上述协议归一与存储 seam。真实 refresh v3、日历目录与 freebusy transport 仍须逐 endpoint 核对并在隔离账号验收，当前文档不将其标为已实现。

## 6. 必需 fake fixtures 与完成证据

| Fixture | 必須失败的反例 |
| --- | --- |
| OAuth state、PKCE、取消、超时、重复回调 | 错 state/重复 code 仍写 keyring；listener 暴露非 loopback |
| 两个账号、同一远端 calendar/event id | 凭据、cursor 或事件串号 |
| Google refresh 缺新 refresh token；飞书轮换；keyring 写失败 | 覆盖旧凭据为空、重复消费飞书 token、先报 ready 后丢 refresh |
| 页 1 数据、页 2 空但有 nextPage、页 3 tombstone+nextSync | 提前退出或每页推进 syncToken |
| page 2 网络失败、循环 pageToken、大小上限 | 部分集合覆盖正式镜像或无限循环 |
| apply CAS 失败；apply 成功/cursor 未写崩溃 | 丢事件、双重 apply、跳过尚未应用分页 |
| 410 / 飞书 190008 与独立正常来源并存 | 全 Workspace 清空，或错误地重用失效 cursor |
| details→freebusy→none；普通 offline | 缓存泄露敏感字段；把离线误当授权撤销 |
| 全天跨月、DST fixed、移动/取消例外、稀疏 tombstone | end 当包含日、按修改后时间去重、丢例外 |
| 不支持 RRULE；busy 单日历 error/50 个分块 | 假称完整同步，或 unknown 显示为空闲 |
| connector batch 重放；任务事实快照前后比对 | 外部事件复制成 Task/改变完成或复习统计 |
| export、cloud payload、IPC、错误、日志哨兵扫描 | secret/state/verifier/cursor 越过设备存储边界 |

阶段内先跑对应 adapter/ingest/token fake 测试与 typecheck。新增 Rust 后才做相关 cargo check/test（包含 feature 关闭/开启），不以文档核对替代 keyring 原生验收。本次只有文档变更，运行 `npm run check:docs`；真实 Google 测试账号 OAuth/refresh/revoke、断网重启、增量删改与 410 恢复、飞书 broker 及系统凭据后端验收均保留 NOT_RUN。

## 7. 飞书目录与忙闲 adapter 补充核对（2026-09-09）

本轮以官方 [larksuite/node-sdk 固定提交 af41737d 的 calendar.ts](https://github.com/larksuite/node-sdk/blob/af41737d1e9d0fdb08bdbbbe3019a7c64b3d9513/code-gen/projects/calendar.ts) 为字段证据；源码分别实现 `calendar.list` 与 `freebusy.list`。没有连接真实账号或读取凭据。官方文档文本抽取未成功，不以空页面推断接口缺失。

- 目录：GET `/open-apis/calendar/v4/calendars`，query 为 `page_size/page_token/sync_token`；响应 `data.calendar_list`、`has_more/page_token/sync_token`。目录项为 `calendar_id/summary/summary_alias/color/type/is_deleted/role` 等；`permissions` 表示公开范围，不能替代当前身份 `role`。SDK 未提供目录 timezone 字段。
- 实现 `listCalendars` 每次完整分页目录，固定项目 page_size 500、最多 100 页/50,000 项，检测循环 page token；结果不暴露 sync cursor。numeric color 转六位 RGB；`role=free_busy_reader` 为 busy-only，已删除项 access=none。Google/Exchange 等不支持飞书事件镜像的目录项带 `eventsSupported:false`。调用目录前必须显式配置 `fallbackTimezone`，结果标 `timezoneSource:'fallback'`，不得称作飞书提供的时区；事件自身 start_time.timezone 继续优先。
- 忙闲：POST `/open-apis/calendar/v4/freebusy/list`，body 为 `time_min/time_max` 与 `user_id` 或 `room_id`；query `user_id_type` 可为 `open_id/union_id/user_id`。SDK 另列 `include_external_calendar/only_busy/need_rsvp_status`，本项目后续原生 transport 应固定为 false/true/false，只请求忙碌时间、不取响应状态或外部会议详情。此 endpoint 针对用户主日历/会议室，不接受 calendar_id。
- 最小端口调整：`CalendarProviderPort<TTarget=string,TResult=BusyResult>` 保持 Google 原签名；飞书使用 `FeishuBusyTarget = {kind:'user',userId,userIdType} | {kind:'room',roomId}` 与带 target 的 `FeishuBusyResult`。注入 transport 的 `feishu.freebusy` 传 `busyTarget`，由后续原生 adapter 显式映射上面字段，绝不将 calendarId 重命名为 userId。
- 单个用户/会议室请求失败只将该 target 标为 unknown/error，不报告为空闲；错误正文不回传。成功仅保留 start_time/end_time 归一为 ISO intervals，丢弃任意标题和身份附加字段；5 分钟 TTL 延续项目策略。输入互斥验证在请求前完成。

验证：`node --experimental-strip-types --test tests/calendar-providers.test.ts` 9/9，`npm run typecheck` 通过。新 fake 覆盖目录分页/颜色/角色/显式时区、循环分页、user/room 互斥、calendar ID 错投不请求、局部忙闲权限失败及私密字段剥离。飞书 OAuth broker、原生 transport、真实账号目录与忙闲验收仍为 NOT_RUN；端口的可执行 fake 不代表原生联调完成。

Google recurrence 当前实现：batch normalizer 已支持可无损映射的单 RRULE（日/周、无月末歧义的月/年规则）和 originalStart 对应的移动、取消、恢复例外；定时系列限制在可证明无 DST 歧义的支持范围。复杂规则与单次非时间字段变化明确 unsupported-recurrence。父规则变动使旧例外失效时，仅允许一次受控 full reset，不无限重试。

后续 instances coverage 尚未实现：需要独立分页及明确 coverage，不复用主 sync cursor；按 series + originalStart 生成稳定身份，仅在所有页完成后替换范围缓存。现有 external.apply 的 full 是整来源替换，不能拿一个月的 instances 当整来源全量。该闭环落地前复杂 RRULE 继续拒绝，busy-only 独立可用。实际阶段4证据及账号验收缺口见 [阶段4检查点](calendar-stage-4-checkpoint.md)。
