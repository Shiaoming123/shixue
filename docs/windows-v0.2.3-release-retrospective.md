# 拾学 Windows v0.2.3 交付复盘

这份复盘面向后续维护 Windows Release 的开发者。它记录 2026-09-04 从 v0.2.1 到 v0.2.3 的真实交付问题，以及已经落地或仍需跟进的防复发措施。日常构建命令以 [Release Kit](./release-kit.md) 为准；面向用户的 Portable、SmartScreen 与证书说明以 [Windows 使用与发布指南](./windows-distribution.md) 为准。

## 结果与证据边界

[v0.2.3 Release](https://github.com/Shiaoming123/shixue/releases/tag/v0.2.3) 已由 tag 触发的 [release 工作流](https://github.com/Shiaoming123/shixue/actions/runs/33841346559) 发布。工作流先创建草稿，再上传并核验 Portable，最后于 2026-09-04 公开 Release。

| 已验证结果 | 证据 | 不代表 |
| --- | --- | --- |
| Windows x64 NSIS、MSI、updater 元数据与 Portable 已上传 | Release 中存在 `latest.json`、安装包、`.sig`、Portable 和 Portable `.sha256` | macOS、Linux、移动端已经交付 |
| Portable GitHub asset digest 为 `sha256:003661ac1ccc57b12f1382bc6a114cf9cacf91e364863ada3a0e73269db9bb97` | 工作流将 GitHub 返回的 digest 与暂存文件 SHA-256 比较，并下载 `.sha256` 再核对内容 | 二进制经过 Authenticode 签名 |
| updater 的 NSIS/MSI 资产带 `.sig` | Tauri updater 可用公钥校验更新载荷 | Windows 能识别发布者身份，或 SmartScreen 不再提示 |

本次公开的 Windows 二进制仍未做 Authenticode 签名。v0.2.3 证明的是交付链与校验链跑通，不是证书身份或 SmartScreen 信誉已经建立。

## 事故时间线

### v0.2.1：action 输入名与实际 schema 不一致

v0.2.1 将 `tauri-action@v0` 的输入写成 `uploadUpdaterJson` 和 `releaseAssetNamePattern`。当前 action 实际接受的是 `includeUpdaterJson` 和 `assetNamePattern`，因此这次改动不能作为完整 updater 发布已经正确配置的证据；v0.2.2 才改正字段名。

直接教训是：YAML 能被解析，不等于 action 会按预期消费输入。发布前必须让 `npm run release:check -- --mode=release` 检查命名步骤、关键输入和顺序，并对照当前 action schema。不要为每一次字段修正立即创建公开版本；先在未打 tag 的提交上跑静态检查和普通 CI，全部通过后再创建不可移动的版本 tag。

### v0.2.1：中文产品名不能直接承担资产协议

Tauri 的 `productName` 是“拾学”，但 GitHub 资产上传过程中可能清洗中文文件名。updater 的 `latest.json`、安装包名称和对应 `.sig` 必须精确匹配，依赖被清洗后的名称会让更新元数据与真实资产脱节。

修复是将发布资产协议固定为 ASCII：`Shixue_[version]_[arch][setup][ext]`。用户可见产品名继续使用“拾学”，机器间传递的资产名保持稳定。防复发检查应同时验证 `assetNamePattern`、`latest.json` 引用及 Release 中的实际资产名，不能只检查本地产物名称。

### v0.2.3 候选提交：Linux CI 暴露 Windows 绝对路径假设

Windows 交付测试曾把 `D:/shared/cargo` 硬编码为“绝对路径”样例。在 Linux runner 上，它不是 POSIX 绝对路径，会被 Node 当作相对片段继续拼接。失败日志因此出现类似 `.../D:/repo/D:/shared/cargo` 的实际值，而不是测试期待的 `.../D:/shared/cargo`。

修复是由测试使用当前宿主的 `resolve(...)` 生成绝对路径，再验证共享的 `CARGO_TARGET_DIR` 解析器。预防规则是：跨平台单元测试只表达“绝对或相对”的语义，不把某一操作系统的盘符或根目录写进跨平台断言。Windows 专属行为放在 Windows job 验证。

### CI 等待：`npm ci` 的安静期不是失败

本次运行中，Linux 与 Windows 普通 CI 的 `npm ci` 分别约 7 分 1 秒和 7 分 5 秒后成功，tag 发布中的依赖安装约 2 分 7 秒后成功。安装依赖期间可能长时间没有新日志，但 GitHub job 仍在运行。

判断标准应是步骤最终的退出码、job 状态和 GitHub 超时，而不是控制台是否持续刷新。遇到安静期先查看 job 仍是 `in_progress` 还是已经 `failure`；不要并发重跑或提前创建新 tag。只有明确退出非零、超时或 runner 终止后，才按失败处理。

### 发布门禁：上传成功不等于可以公开

早期流程直接创建公开 Release，会在后续 Portable 上传或校验失败时留下不完整版本。v0.2.3 将发布改成以下不可调换的顺序：

1. 只允许现有 `v<package version>` tag 触发，并校验 tag、应用版本和源码状态。
2. `tauri-action` 创建 draft Release，上传安装包、updater 签名和 `latest.json`。
3. 从同一 Cargo target 暂存 Portable 单 EXE，并生成同名 `.sha256`。
4. 上传两项 Portable 资产；比较 GitHub 返回的 asset digest 与暂存文件 SHA-256。
5. 从 GitHub 下载 `.sha256`，核对其内容确实指向同一个 Portable 文件及摘要。
6. 所有检查通过后才执行 `--draft=false`。

这套门禁解决的是“公开资产与本次构建是否一致”。它不能替代 Authenticode、干净设备启动测试或 updater 端到端升级测试。

## 三个容易混淆的 Windows 边界

### Portable 是单 EXE，不是零依赖或随身数据

Portable 表示应用本体无需安装，可以直接运行一个 EXE。SQLite、设置和日志仍由相同的 Tauri 应用身份写入当前用户的 AppData；把 EXE 放在 U 盘不会让数据自动跟随。界面仍依赖 Microsoft Edge WebView2 Runtime，Portable 不负责引导安装该运行时。

### updater `.sig` 不是 Authenticode

Tauri updater `.sig` 由应用内 updater 使用，用来验证下载的更新载荷；本次 `.sig` 对应 NSIS/MSI updater 资产，不覆盖 Portable。Authenticode 则由 Windows 验证 EXE/MSI 的发布者、证书链和时间戳。二者解决不同的信任问题，任何文档和 Release 文案都不能把“有 `.sig`”写成“Windows 已签名”。

### Authenticode 方案不是可互换的同一条路

当前状态是未签名。后续选择应保持这些边界：

| 方案 | 私钥与运行位置 | 适用边界 |
| --- | --- | --- |
| 公共 CA 的 OV/EV 代码签名 | 现代证书通常要求 USB Token 或云 HSM；EV 不保证立即获得 SmartScreen 信誉 | 直接分发 EXE/MSI 时证明发布者身份 |
| USB Token | 只能交给可访问实体设备的自托管 Windows runner | GitHub 托管 runner 无法读取开发者本机 USB |
| 云 HSM / 远程签名 | 由供应商托管密钥，CI 通过 OIDC 或受控凭据调用 | 更适合自动化，但仍需核验供应商、地区、费用与 Tauri `signCommand` 接入 |
| 可导出 PFX | 仅在 CA 明确允许导出时使用；PFX 与密码必须分开存入 Secrets 并临时导入 | 不能假设所有 OV/EV 证书都能导出 PFX，更不能提交到仓库 |
| Microsoft Artifact Signing | Azure 托管的签名服务，有身份与地区准入要求 | 不是无条件可用的 PFX 替代品；当前公开身份验证地区不包含中国大陆 |
| Microsoft Store | 商店账号、打包与审核是独立发布路径 | 不等同于给 GitHub 上的原始 Portable 自动加签 |

无论使用哪条 Authenticode 路径，都必须对应用 EXE、Portable、NSIS 与 MSI 分别验证签名状态、预期 Subject、Code Signing EKU、可信证书链和 RFC 3161 时间戳。完整命令与选择依据见 [Windows 使用与发布指南](./windows-distribution.md)。

## 遗留告警：actions v4 的 Node runtime

v0.2.3 运行成功，但 GitHub 日志明确警告 `actions/checkout@v4` 和 `actions/setup-node@v4` 仍以 Node 20 为目标，并被 runner 强制使用 Node 24。这个告警来自 action 自身运行时，不是项目通过 `setup-node` 选择的 Node.js 22，也不是本次发布失败。

该问题尚未在 v0.2.3 中消除。后续应升级到支持新 runtime 的 action 主版本，并让 Dependabot PR 完整跑过 Linux、Windows 与 release 静态检查后再合并。不要通过 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` 长期压制告警；这会保留已弃用 runtime，而不是完成迁移。

## 下次发布检查清单

创建 tag 前：

1. 确认 `package.json`、Cargo 与 Tauri 版本一致，CHANGELOG 已落地。
2. 运行 `npm ci`、`npm run release:check -- --mode=release`、`npm run verify` 和 `npm run rust:verify`，等待命令明确结束。
3. 确认 action 输入名仍符合当前 schema，稳定 ASCII 资产模板未变，Portable stage/upload/verify/publish 步骤顺序未变。
4. 让普通 CI 在目标提交上通过；不要用公开 tag 代替预检，也不要移动已发布 tag。

tag 工作流中：

1. 只接受 tag 事件，Release 保持 draft，直到 Portable digest 与下载回来的 `.sha256` 同时通过。
2. 任何上传、摘要或元数据检查失败都保持 draft，不手工绕过后续公开步骤。
3. 把 Node runtime 弃用等 warning 记录为维护项，但只用退出码与 job conclusion 判断本次是否失败。

公开后：

1. 核对 Release 的 NSIS、MSI、`.sig`、`latest.json`、Portable 与 Portable `.sha256` 均可下载且名称一致。
2. 明确标注当前 Authenticode 状态，不把 updater 签名、SHA-256 或 SmartScreen 信誉互相替代。
3. 在干净 Windows 环境验证下载、摘要、启动和 WebView2 缺失时的指引；这一步的结果应单独记录，不能从 CI 构建成功推断。
