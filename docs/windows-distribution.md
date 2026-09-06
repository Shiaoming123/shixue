# Windows 使用与发布指南

这份文档面向希望先把应用交给自己或少量用户使用、之后再完善商业签名的个人开发者。它把“能运行”“便于分发”和“获得 Windows 发布者信任”分成三个阶段，避免因为暂时没有证书而阻塞产品试用。

## 最快开始使用

打开 [GitHub Releases](https://github.com/Shiaoming123/shixue/releases/latest)，按需求选择：

| 文件 | 适合谁 | 是否安装 | 数据位置 |
| --- | --- | --- | --- |
| `Shixue_*_x64_Portable.exe` | 个人试用、U 盘携带、快速验证 | 否，下载后直接运行 | Windows 用户 AppData |
| `Shixue_*_x64-setup.exe` | 日常长期使用 | NSIS 当前用户安装，不需要管理员权限 | Windows 用户 AppData |
| `Shixue_*_x64.msi` | 企业部署或偏好 Windows Installer 的用户 | MSI 安装 | Windows 用户 AppData |

Portable 表示“应用本体是一个 EXE，不需要安装”，不表示数据写在 EXE 旁边。拾学仍把 SQLite、设置和日志放在系统用户数据目录，因此覆盖 Portable EXE 不会主动删除学习数据。

启动新 Portable 前，应先从托盘退出仍在运行的旧版本。拾学采用单实例运行；旧进程尚未退出时，双击新 EXE 只会唤回旧窗口。可在任务管理器的“命令行”列或 PowerShell `Get-CimInstance Win32_Process` 输出中核对实际可执行文件路径。

Windows 10/11 通常已经包含 WebView2 Runtime；精简系统或旧环境若无法启动，需要先安装 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。

## 为什么 Windows 会提示风险

新版本 Release 会为 Portable EXE 附带同名 `.sha256` 文件；NSIS/MSI updater 产物还使用 Tauri updater 签名，但尚未使用 Authenticode 证书。这三者用途不同：

- updater 签名让已安装的拾学校验 NSIS/MSI 更新文件是否来自项目维护者，它不覆盖 Portable EXE；
- Authenticode 让 Windows 验证 EXE/MSI 的发布者法定身份，并在文件属性和安全提示中显示发布者名称。

在 Authenticode 尚未接入时，Windows 可能显示“发布者：未知”或 SmartScreen 提示。只应从本仓库 Release 下载，并核对 Portable 旁的同名 `.sha256`；本地完整交付包则核对 `SHA256SUMS.txt`。不要关闭系统安全功能，也不要把自签名证书当成公开信任证书。

## 个人开发者的选择

| 路径 | 成本与门槛 | 适用阶段 | 结论 |
| --- | --- | --- | --- |
| 未签名 Portable + SHA-256 | 最低 | 自用、可信小范围测试 | 当前即可使用；会有安全提示 |
| 公共 CA 的 OV/EV Code Signing | 需要实名/企业验证及费用；现代证书通常使用 USB Token 或云 HSM | GitHub 等站外公开分发 | 中国大陆开发者较现实的公开签名路径 |
| Microsoft Artifact Signing Public Trust | Azure 托管、适合 CI | 支持地区内的个人或组织 | 当前公开身份验证地区不包含中国大陆；不要先按此方案投入 |
| Microsoft Store | 需要开发者账号和商店审核 | 面向普通 Windows 用户 | 最稳定地避免浏览器下载后的 SmartScreen 打断 |
| 自签名证书 | 免费但用户设备不信任 | 企业内网自行下发根证书 | 不适合公开分发，体验接近未签名 |

不要仅为了 SmartScreen 购买更贵的 EV。微软当前说明 EV 不再自动获得即时信誉；新的合法证书和新文件仍可能在一段时间内显示“无法识别的应用”。持续使用同一发布者身份、稳定下载来源和干净发布记录，才能逐步积累信誉。

官方参考：

- [Microsoft：SmartScreen reputation for Windows app developers](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
- [Tauri：Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
- [Microsoft：Artifact Signing prerequisites](https://learn.microsoft.com/azure/artifact-signing/quickstart)

## 以后接入 Authenticode 时

证书采购属于身份与财务流程，脚手架不能替开发者完成。拿到证书后，根据私钥形态选择一条路径：

1. **云 HSM / 远程签名（优先）**：在 `bundle.windows.signCommand` 中调用供应商 CLI；GitHub Actions 使用 OIDC 或供应商凭据，私钥不进入仓库和 runner 文件系统。
2. **USB Token**：使用插有 Token 的自托管 Windows runner，按 CA 文档调用 SignTool/KSP。GitHub 托管 runner 无法访问本机 USB Token。
3. **可导出 PFX**：只在证书供应商明确允许时，把 Base64 PFX 与密码分别放入 GitHub Secrets，临时导入 runner 证书库；不要提交 PFX、密码或编码文本。

所有路径都必须使用供应商给出的 RFC 3161 时间戳服务，并对应用 EXE、Portable EXE、NSIS 与 MSI 全部验证：

```powershell
Get-AuthenticodeSignature .\Shixue_*_Portable.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
signtool verify /pa /all /v .\Shixue_*_Portable.exe
signtool verify /pa /all /v .\Shixue_*-setup.exe
signtool verify /pa /all /v .\Shixue_*.msi
```

正式发布门禁应检查：状态为 `Valid`、证书 Subject 是预期个人/公司、包含 Code Signing EKU、证书链可信、时间戳存在、tag 与版本匹配。缺少证书或验证失败时，正式 Release 必须失败；本地开发构建仍可保持未签名。

## 当前边界

- Portable、NSIS、MSI、SHA-256 与安装启动 smoke：已实现；updater 签名用于安装包更新产物，不覆盖 Portable EXE。
- `npm run smoke:windows-package` 只消费 `release-artifacts/windows/<version>/manifest.json` 精确指向的单一 NSIS，并在安装前核对大小和 SHA-256；真实产品注册表身份已存在时拒绝覆盖。报告位于 `src-tauri/target/windows-package-smoke-report.json`，自动阶段分别记录 manifest audit、隔离静默安装、首次启动、重启、卸载和清理。首次提醒权限、单任务双提醒、稍后提醒、完成、隐藏/恢复/退出托盘、退出后不再投递及 Windows 200% 显示缩放仍需人工实机观察，脚本保持为 `NOT_RUN`，不会把进程存活当作可用 UI 证明。
- 当前原生通知只提交通知正文，Windows 原生通知操作按钮为 `UNSUPPORTED`；Complete / Snooze / Open 由应用内提醒卡承接。只有实机观察到系统通知后，才可把“接受提交”升级为“观察到投递”。
- Authenticode 证书采购、CI 代码签名和干净设备上的签名验证：尚未实现。
- SmartScreen 信誉不是单次构建可以证明的结果；即使签名有效，也需要真实分发积累。

早先 PR4 本地工作树曾生成 Portable、NSIS、MSI 三种未签名制品，并留下自动 package smoke 的历史证据；这些结果不能作为当前 v0.3.0 候选的验收结果。当前工作树已生成并审计 v0.3.0 `unsigned-local` 制品，精确 NSIS 的静默安装、进程启动、重启、静默卸载和隔离清理为 `PASS`；可用窗口、交互与系统集成仍按 [v0.3.0 验收账本](./releases/v0.3.0-acceptance.md)中的 `NOT_RUN` 边界处理。
