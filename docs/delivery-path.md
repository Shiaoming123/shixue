# 从脚手架到服务与发布

这份文档记录 `meow-starter` 当前能提供的最大通用底座，以及把它变成具体产品时必须由项目所有者作出的决定。它把“已验证”“可配置”和“需要外部权限”分开，避免把模板能力当成已上线服务。

## 当前证据链

| 链路 | 当前状态 | 已验证证据 | 仍不代表 |
| --- | --- | --- | --- |
| 默认 Web | Beta | `npm run build:web`、本地浏览器 IndexedDB smoke | 已部署站点、账号服务 |
| 默认桌面 | Stable baseline | `npm run verify`、`npm run rust:verify`、Windows 无签名安装 smoke | 签名、公证、在线更新 |
| Android | Beta / local-debug | `42cc204` 的 x86_64 debug APK 已在隔离 API 36 模拟器通过身份校验、显式 Activity 启动、五阶段 readiness、前台与稳定 PID smoke；同一 APK 通过能力服务写入唯一任务，并在进程终止后从 SQLite 恢复任务、创建回执和事件。`20000be` 的 `android-debug` run [34182148062](https://github.com/Shiaoming123/shixue/actions/runs/34182148062) 进一步在 API 35 x86_64 模拟器通过整机重启恢复，且内核 boot ID 确实变化 | 真机、原生通知、签名、Google Play、更新通道 |
| iOS | Source-ready | iOS 源码、生成/编译/启动 smoke 命令与历史 Simulator 快照 | 当前树 Simulator、V3 SQLite 写入和重启恢复、真机、TestFlight、App Store |
| 同步服务 | Preview foundation | 本地优先 outbox、IndexedDB 状态、allowlist、HTTPS/loopback HTTP transport 测试 | 账号、冲突产品规则、托管 API、多设备运行 |
| 桌面更新 | Template only | 端点/公钥/CI 模板与严格 release gate | 自有端点、私钥签名、安装端更新 |

## 脚手架的服务上限

在不选择云厂商、不创建账号、不提交任何密钥的前提下，脚手架已经提供：本地领域存储、版本化数据导出边界、默认关闭的同步 outbox、持久化 Web 同步状态、collection allowlist，以及只允许 HTTPS（或 loopback 开发地址）的 HTTP transport。

这是通用代码可以安全做到的上限。一个真正的服务还必须定义数据所有者、身份来源、授权规则、删除与冲突语义、保留期限、地区与成本；这些是产品决定，不能由模板替项目猜测。同步模块因此保持关闭，也不会自行联网。实现细节和接入契约见 [sync.md](./sync.md)。

## 采用顺序

1. **固定产品身份。** 替换名称、identifier、图标、仓库元数据与版本，并执行 `npm run release:check`。identifier 一旦发布不可更改。
2. **先完成本地用户旅程。** 为领域定义小型 store 接口和迁移；用 `npm run verify`、`npm run rust:verify` 与目标平台 smoke 固定行为。
3. **选择服务模型。** 在“用户账号 + HTTPS API”“受控局域网配对”“独立协作文档”中选一个。不要把 SQLite 文件、钥匙串、token、日志或更新密钥放进通用同步层。
4. **把领域映射到同步契约。** 为每个可同步记录设计全局 id、owner/device、revision、tombstone、schema version 与幂等 operation id；先在隔离环境验证断网写入、重复上传、远端失败和冲突。
5. **配置受控交付。** 给桌面更新器配置自有 HTTPS endpoint 与匹配的签名密钥，再让 `npm run release:check -- --mode=release` 通过；仅随后才创建 tag release。
6. **完成平台发布。** Android 需要 upload keystore、别名/密码、真实设备和 Play Console；iOS 需要 macOS、Xcode、签名身份、TestFlight/App Store 权限。它们都不能写入仓库或 CI 日志。

## Android 本地链路

在配置好 JDK 21、Android SDK/NDK 和 Rust Android targets 的终端中：

```powershell
npm run mobile:doctor
npm run tauri -- android init --ci
npm run tauri -- android build --debug --target x86_64 --apk
npm run check:android-artifact -- --apk src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
npm run smoke:android-launch -- --device emulator-5554 --apk <absolute-apk-path>
npm run smoke:android-persistence -- --device emulator-5554 --launch-report <absolute-launch-report-path>
npm run smoke:android-persistence -- --device emulator-5554 --launch-report <absolute-launch-report-path> --restart emulator-reboot
```

构建会在忽略的 `src-tauri/gen/android/` 树中生成 debug APK。启动 smoke 只接受绝对 APK 路径和显式 ADB serial，并先验证包名、版本、SDK 与 ABI；随后在模拟器中清理旧安装，以唯一 run id 收集 WebView、原生宿主、Vue、工作区与前端五阶段标记，最后要求 Activity 在前台且 PID 稳定存活。持久化 smoke 复用这份成功启动报告，不重新安装 APK；它通过能力服务写入唯一任务，确认 `force-stop` 后 PID 消失，再要求新进程从 SQLite 恢复同一任务、创建回执和事件。Windows 还需要 Developer Mode（或创建符号链接的等效权限）。
GitHub 上的手动 `android-debug` workflow 会在干净 runner 中生成工程、冷启动隔离 API 35 x86_64 模拟器、构建和核验 APK，依次执行启动、进程重启持久化以及模拟器整机重启持久化 smoke，并保存 APK、JSON 证据与有限诊断日志。整机重启门禁必须观察 ADB 离线、重新完成 boot 和不同的内核 boot ID，之后才接受同一 SQLite 容器的恢复结果。`20000be` 的 run [34182148062](https://github.com/Shiaoming123/shixue/actions/runs/34182148062) 的启动、进程重启恢复和整机重启恢复均通过；其中 reboot run `1ff745f1-a869-4ed9-8cca-705150f0047d` 的 boot ID 从 `bada7845-fc5d-463f-8c5e-ee58dc856a3e` 变为 `7b84cf0e-5e16-4493-ba24-905de840664c`，并恢复同一任务、创建回执和事件。它不是签名、真机或商店发布工作流。

## 发布前的人工输入

下表是刻意不能自动完成的部分；提供这些输入前，任何自动化都应停在对应 gate，而非伪造成功。

| 目标 | 必需输入 |
| --- | --- |
| 桌面更新 | 自有 HTTPS 发布地址、匹配私钥、CI secret 所有权、安装端更新验收 |
| Android 上架 | 已拥有的 application id、versionCode 规则、upload keystore 与安全存储、Play Console 账号、真机验收 |
| iOS 上架 | Apple Developer 团队、证书/provisioning、macOS/Xcode、TestFlight/设备验收 |
| 云端同步 | 身份提供方、数据模型/RLS 或等价授权、数据区域/保留、审计和成本边界 |

每次改变上述边界时，同时更新 `app.protocol.json`、相应实现文档和验证命令；协议中的交付状态只记录已有证据，不记录愿望。

iOS 不必等待全部桌面功能 PR 完成后再启动：应在时间规划领域基础合并后建立独立原生基础 PR，再随共享路线逐步接入功能。详细顺序、平台边界和每个 PR 的证据模板见 [iOS 开发规划与执行指引](./ios-development.md)。
