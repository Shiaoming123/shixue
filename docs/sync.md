# 账号、云端与局域网同步指南

> **成熟度：Preview。** 仓库提供默认关闭的同步契约、内存/IndexedDB outbox 状态适配器和安全 HTTP transport；账号后端、设备配对与冲突 UI 需要应用按业务接入。

## 设计原则

同步不属于业务数据源。应用始终先写本地存储，再由可替换的同步 Provider 传播变更：

```text
Domain Store -> Outbox -> SyncProvider
                         ├─ HTTP cloud transport
                         ├─ paired LAN transport
                         ├─ PowerSync / Electric provider
                         └─ Automerge / Yjs document provider
```

同步分两层：

- `SyncProvider`：完整同步方案的顶层接口。PowerSync、Electric、Firestore、Automerge 等可以直接实现。
- `SyncTransport`：内置 outbox 引擎的上传/拉取接口。HTTP 云端、配对后的 LAN 服务或文件传输可以复用。

## 最小用法

同步模块在 `src/modules/config.ts` 中默认关闭。启用后仍不会自动联网；应用必须显式提供白名单、状态存储、传输和远端应用器：

```ts
import {
  createAllowlistSyncPolicy,
  createHttpSyncTransport,
  createIndexedDbSyncStateStore,
  createOutboxSyncEngine,
} from './src/sync'

const provider = createOutboxSyncEngine({
  store: createIndexedDbSyncStateStore(),
  policy: createAllowlistSyncPolicy(['notes']),
  transport: createHttpSyncTransport({
    baseUrl: 'https://sync.example.com/v1',
    getAccessToken: async () => session.accessToken,
  }),
  applyRemote: async (change) => noteStore.applyRemote(change),
})

await provider.syncOnce()
```

`createIndexedDbSyncStateStore()` 适用于 Web 的持久化 outbox：同一浏览器 origin 下重开适配器后，待上传操作和 checkpoint 仍会保留。它不启用同步、不选择 collection、不创建网络连接，也不解决跨设备冲突。桌面或移动端应按各自本地数据库实现同一 `SyncStateStore` 契约；`createInMemorySyncStateStore()` 仍只适合演示和测试。

## HTTP 协议

内置 transport 使用两个端点：

```http
POST /push
Authorization: Bearer <short-lived-session>
Content-Type: application/json

{"changes":[SyncMutation]}
```

返回：

```json
{"acceptedOperationIds":["op-1"]}
```

拉取：

```http
GET /pull?checkpoint=cursor-1
Authorization: Bearer <short-lived-session>
```

返回：

```json
{"changes":[],"checkpoint":"cursor-2"}
```

非回环地址必须使用 HTTPS，URL 不允许携带用户名或密码。调用者只能提供短期 access token，不能注入任意鉴权 Header。
同步引擎只会确认本次提交中、且由 transport 明确接受的唯一 operation id；
transport 返回未知或重复 id 不会让上传计数虚高，也不会确认额外 outbox 项。

## 数据分级

| 层级 | 数据 | 默认策略 |
| --- | --- | --- |
| Device local | API Key、Token、本地模型/文件路径、托盘、快捷键、自启动、日志、缓存 | 永不同步 |
| Account preferences | 主题、语言、布局、安全的 Provider/模型选择 | 登录后可默认同步 |
| Domain data | Todo、笔记、会话正文、项目数据 | 用户显式开启 |
| Collaborative documents | 多人富文本、白板、结构化文档 | 独立 CRDT Provider |

永不进入通用同步层：API Key、refresh token、Cookie、MCP 凭据或环境变量、OS 钥匙串内容、本地绝对路径、日志、缓存、向量索引、更新签名私钥。

同步策略使用白名单；`createAllowlistSyncPolicy()` 不传集合时拒绝全部数据。

## 可同步数据模型

新建需要同步的表或对象时至少包含：

- 全局唯一 `id`（UUID/ULID），不要依赖设备内自增 ID。
- `owner_id` 与 `device_id`。
- `created_at`、`updated_at`。
- `deleted_at` 或 tombstone，删除不能直接消失。
- `revision`（服务端版本、HLC 或领域版本向量）。
- `schema_version`。
- 每次变更唯一且可幂等的 `operation_id`。

示例 Todo 仍不进入同步。拾学业务使用独立的 `study_state/current` 单快照协调器：它先验证完整 `StudyState`，以 `updatedAt + SHA-256` 形成确定 revision，上传时携带已观察到的远端 revision，下载时通过本地 `expectedUpdatedAt` 做 CAS。远端拒绝或本地 CAS 竞争都会返回显式 `conflict/failed`，不会报告成功或覆盖更新中的本地记录。

该协调器只定义 `StudyCloudAdapter`，不把供应商 SDK、session token 或网络调用带进领域层。`sync=false`、未配置或未登录时不会读取本地快照，也不会触发 pull/push。Supabase/Tauri 适配器必须另外满足下文的钥匙串、RLS 和真实后端验收门禁后才能启用。

## 拾学的 Supabase 原生适配器

仓库提供一个默认不编译、不联网的桌面参考适配器：

1. 在 Supabase 项目应用 `supabase/migrations/202609040001_study_cloud_snapshots.sql`。
2. 在本地构建环境设置两个公开配置：`VITE_STUDY_SUPABASE_URL=https://<project>.supabase.co` 与 `VITE_STUDY_SUPABASE_PUBLISHABLE_KEY=<publishable-key>`。不要使用 `service_role` key。
3. 以 `sync` Cargo feature 启动或构建 Tauri，例如 `npm run tauri dev -- --features sync`。
4. 设置页只在桌面 Tauri 且两个公开配置都存在时显示账号入口。登录密码只经过一次 IPC；access/refresh token 只保存于系统钥匙串，WebView 只能读取 signed-in/signed-out、user id 和 email。

生产适配器只接受 `https://*.supabase.co:443`，本地开发只额外接受 `localhost`、`127.0.0.1` 或 `::1` 回环地址。任意自托管域名应实现新的受信任适配器或固定域名策略，不能把任意 URL 与钥匙串 token 拼接使用。

同步在本地写入后 1.5 秒防抖触发，登录期间每 30 秒复核一次；失败与 CAS 冲突会保留本地状态并在设置中显式显示。仓库测试覆盖输入验证、命令注册、token 不出原生边界、RLS/CAS migration 结构及 feature 组合编译。由于本次没有真实 Supabase 项目，真实登录、migration 部署、跨用户 RLS 和双设备 E2E 状态为 **NOT_RUN**，不能等同于生产验证。

## 冲突策略

- 主题、语言等标量偏好：可使用服务端时间或 HLC 的 last-write-wins。
- Todo、记录和列表：使用行级 revision 与 tombstone；revision 不匹配时合并、拒绝或进入冲突 UI。
- 富文本与实时协作：按文档领域使用 Automerge/Yjs，不要把整个应用数据库 CRDT 化。
- 不同步 SQLite 数据库文件；同步变更记录或领域对象。

## 方案选择与接入位置

| 方案 | 推荐接入 | 适用场景 | 注意事项 |
| --- | --- | --- | --- |
| [Supabase Auth + Postgres/RLS](https://supabase.com/docs/guides/auth) | 拾学桌面参考适配器；其他领域也可通过 Edge Function/HTTP transport 接入 | 托管 Supabase 或本地 CLI 开发 | 原生适配器不接受任意自托管域名；真实 RLS/双设备验证仍是部署门禁 |
| [Firebase Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline) | 独立 `SyncProvider` | 希望快速获得 Web 离线缓存与账号体系 | 数据模型和冲突语义绑定 Firestore |
| [PowerSync](https://docs.powersync.com/client-sdks/reference/javascript-web) | 替换内置 outbox 的 `SyncProvider` | SQLite/local-first 体验优先 | Web SDK 成熟度与 Rust SDK 状态要分别评估 |
| [Electric](https://electric-sql.com/docs/intro) | 独立 `SyncProvider` | Postgres 下行数据同步 | 写入与冲突链路需应用设计 |
| LAN | 配对发现层 + `SyncTransport` | 同一网络的一次性迁移或按需同步 | 发现不等于认证，第一版不要后台自动组网 |
| [Automerge](https://automerge.org/docs/hello/) / [Yjs](https://docs.yjs.dev/) | 文档领域独立 Provider | 实时多人文档 | 不作为通用数据库同步层 |

核心仓库不默认依赖任何一项。一个适配器应能删除而不影响领域存储和其他传输。

## 局域网同步安全基线

推荐第一版只实现“扫码/短码配对 + 用户触发传输”：

1. mDNS/DNS-SD 只做发现，不能作为设备身份。
2. QR 或短码交换短期配对令牌与公钥指纹。
3. 两端显示设备名称与指纹，要求用户确认。
4. 传输使用 TLS/QUIC/Noise 等经认证加密通道。
5. 配对令牌过期、操作幂等、设备可撤销。
6. Web 端通过桌面伴侣暴露的受限 HTTPS/WebSocket 地址接入；浏览器不承担原始 mDNS/UDP。

iOS 需要本地网络隐私声明，Android 新版本的附近 Wi-Fi 能力需要相应运行时权限。权限、后台服务和防火墙规则都应留在 LAN transport 模块，不进入同步核心。

## 生产验收

- 断网写入后重启应用，outbox 不丢失。
- 重复上传同一 operation 不产生重复记录。
- 上传失败不删除 outbox。
- 远端应用失败不推进 checkpoint。
- 删除使用 tombstone 并能跨设备传播。
- 两台设备同时编辑时执行已声明的冲突策略。
- 越权 collection 在网络发送和远端应用前均被拒绝。
- 日志、错误和遥测不包含 token、密钥或完整敏感 payload。
