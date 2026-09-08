# Release Kit

## Current boundary

The Release Kit makes a checkout diagnosable and validates release configuration. It does not publish an artifact, obtain credentials, sign a binary, notarize an app, submit to a store, initialize mobile projects, or deploy a Web host.

| Stage | Current maturity | What is available now | Still required |
| --- | --- | --- | --- |
| Local checks | Available | `npm run doctor`, `npm run verify`, and `npm run release:check` | Project-specific platform validation |
| Desktop build/package | v0.3.0 published unsigned | `npm run package:windows` built and audited an unsigned x64 NSIS installer, zh-CN MSI, and portable EXE; package smoke and baseline installed-app acceptance verified the manifest-selected NSIS; the assets were published on 2026-09-07 | Final-SHA review/reminder/tray interaction, MSI installation, and code signing remain separate |
| Desktop code signing | Deferred | Workflow accepts optional signing inputs | Certificate ownership, secret provisioning, signed-artifact verification |
| macOS notarization | Deferred | Workflow accepts optional Apple signing/notarization inputs | Apple account, certificates, notarization submission, and installed-artifact validation |
| Updater signing/delivery | Configured for GitHub Releases | Real HTTPS endpoint and application-specific public key are committed; the private key remains outside Git | Hosted signed updater artifacts and update-path validation |
| Windows distribution | v0.3.0 unsigned Release | The published Release contains NSIS, zh-CN MSI, portable EXE, hashes, updater metadata, and signatures; the candidate also has automated package lifecycle evidence and baseline installed-app acceptance | Installed review/reminder/tray actions, no-delivery-after-quit observation, 200% scaling, Narrator, Authenticode certificate, and SmartScreen reputation |
| Android package | Local debug evidence | The x86_64 debug APK from `42cc204` passed identity metadata, explicit Activity launch, five readiness markers, foreground inspection, and stable PID smoke on an isolated API 36 emulator; the same APK created a unique task through the capability service and recovered the task, receipt, and event from SQLite after confirmed process termination | Physical-device smoke, emulator-reboot recovery, native notifications, signing, Play Console, and store submission |
| iOS package and store | Source-ready | Native source, preparation commands, and historical Simulator evidence | Exact-current Simulator run, accounts, certificates, device testing, and store submission |
| Web deployment | Deferred | `npm run build:web` creates a static build | Select/configure a provider and validate a deployed site |

An unsigned desktop artifact is not evidence of a signed, notarized, store-ready, or auto-updatable release. Likewise, a responsive mobile interface is not an APK, AAB, IPA, TestFlight build, or store submission.

The v0.3.0 candidate evidence and remaining gaps are tracked in the
[v0.3.0 acceptance ledger](./releases/v0.3.0-acceptance.md). Post-release
changes on `main`, including the Android emulator work recorded here, are not
part of the published v0.3.0 assets.

`src-tauri/gen/` is intentionally ignored. The Android Gradle project and its
debug APK/AAB are local build outputs, so a clean checkout must regenerate it
with `npm run tauri -- android init --ci` before rebuilding. The verified local
debug artifacts do not carry an upload keystore or prove Google Play acceptance.
After a debug build, run `npm run check:android-artifact -- --apk <path>` to
check its package identity, version, SDK metadata, and included ABI list. Then
run `npm run smoke:android-launch -- --device <adb-serial> --apk <absolute-path>`
against a dedicated emulator. The smoke clears the old installation, uses a
unique run id, launches the resolved Activity, and requires all five native
readiness phases plus foreground and stable process evidence. Then run
`npm run smoke:android-persistence -- --device <adb-serial> --launch-report
<absolute-launch-report-path>` without reinstalling the APK. It creates a
run-scoped task through the capability service, confirms process death, and
requires a new process to recover the exact task, receipt, and event from
SQLite. The manual `android-debug` workflow performs both sequences and uploads
the debug APK, both JSON reports, and bounded diagnostics; it deliberately does
not sign or publish anything.

## Local release preparation

Run these before proposing a release configuration change:

```bash
npm run doctor
npm run release:check
npm run verify
```

`npm run release:check` defaults to template mode. The check inspects the non-secret `plugins.updater.pubkey` and `bundle.createUpdaterArtifacts` fields; it never reads a private signing key or secret. This project uses its GitHub Releases endpoint and application-specific updater public key, so release preparation must also pass the stricter check:

```bash
npm run release:check -- --mode=release
```

Keep `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` versions aligned. A valid identifier, bundle icons, and HTTPS updater endpoint are configuration checks, not a substitute for a signed end-to-end release.

The Windows application identity is `com.shiaoming123.shixue`. The MSI uses a
fixed WiX upgrade code (`bccd6d9c-6ba9-56d2-9f8d-4c35f1ab89a5`) so later
versions replace the same installed product. Its locale is `zh-CN`, which is
also required for the Chinese product name to be represented in the MSI
database. NSIS uses Simplified Chinese and installs for the current user.

Only `template` and `release` are valid mode values. Unknown values fail instead of falling back to template mode.

Tag releases run that strict mode before the Windows-only `tauri-action` starts. Successful
`v*.*.*` builds publish NSIS and MSI assets, updater metadata, and the stable-name
`Shixue_<version>_x64_Portable.exe` plus its `.sha256` proof to a non-draft GitHub Release.
Release assets use the stable `Shixue_<version>_<arch>` ASCII prefix so GitHub does not
sanitize the Chinese product name and break updater-signature matching.
After `tauri-action` creates the draft and attaches installer assets, the workflow stages the release
binary under `release-artifacts/github-release/windows/<version>/`, uploads both files
with `gh release upload --clobber`, and
queries the created Release to fail the job if the portable EXE is absent. Strict
`npm run release:check -- --mode=release` also rejects a workflow that removes the
stage, upload, or post-upload verification steps.
The Release stays a draft through those steps and is published only after both the
portable EXE and checksum are confirmed, so a failed upload cannot leave an incomplete
formal Release visible to users.
The real v0.2.1-v0.2.3 failures, fixes, and the next-release checklist are recorded in
[Windows v0.2.3 release retrospective](./windows-v0.2.3-release-retrospective.md).
They also run:

```bash
npm run release:provenance
```

The command emits a non-secret JSON record containing the checked package
version, source commit, clean-tree status, and (for a tag build) tag name. It
fails if Git cannot resolve the commit, the source tree has changes, or a tag
does not equal `v<package version>`. This is reproducibility provenance for the
source input; it does not prove byte-for-byte reproducible binaries, signing,
notarization, hosted updater availability, or a successful user installation.

## Optional local runtime smoke

On Windows, `npm run smoke:windows-package` reads the current version's
`release-artifacts/windows/<version>/manifest.json`, selects its single NSIS
artifact, and verifies the exact file size and SHA-256 before installation. It
refuses to continue when the real product registry identity already exists. It
also refuses to launch when either real Windows product-data directory already
exists. Tauri resolves those directories through Windows Known Folders, so
overriding child-process `APPDATA` and `LOCALAPPDATA` is not an isolation
boundary. After the preflight passes, the command silently installs beneath a
fresh `src-tauri/target/meow-windows-package-smoke-*` directory, probes the
installed process, stops and relaunches the same executable, runs the
uninstaller, and removes the exact temporary, product-data, and registry state
owned by that smoke run.

The command does not rebuild or substitute the candidate selected by the
manifest and does not need a signing private key for an `unsigned-local`
candidate. It is deliberately not signed-release, updater-delivery,
double-click UI, successful workspace-load UI, tray graceful-exit,
notification UI, store, or macOS/Linux package evidence. Use a clean Windows
user or VM for this smoke when the real application already has local data.

`npm run smoke:windows-msi` applies the same manifest SHA-256 and Windows Known
Folder data preflights to the single MSI artifact. It also refuses to replace an
installed product with the same display identity, requests a quiet per-user
Windows Installer lifecycle in an owned target directory, launches and
relaunches that installed executable, and uninstalls it in `finally` if a later
stage fails. Its separate report is
`src-tauri/target/windows-msi-smoke-report.json`. Existing product data or an
existing installation is a deliberate `BLOCKED` result, never permission to
remove or overwrite it.

The manual `public Windows MSI lifecycle` workflow runs the same MSI smoke in a
fresh GitHub-hosted Windows VM. It accepts no inputs and stages only the pinned
public v0.3.0 MSI: release identity, annotated tag/source, asset id, size, and
SHA-256 must match before a temporary single-MSI manifest is created. No build,
signing credentials, or local user data are used. It uploads only the download
verification, manifest, and lifecycle report, even after failure. The same
fixed workflow steps passed all automated MSI lifecycle stages in the
temporary branch-push [run 34209120590](https://github.com/Shiaoming123/shixue/actions/runs/34209120590)
on Windows `10.0.26100`. The final default-branch-only manual trigger remains
`NOT_RUN` until this workflow is on `main` and dispatched there. Neither result proves successful WebView rendering, Windows 11 interaction, notifications,
tray actions, native scaling, Narrator, or signing.

## Windows delivery package

Use the Tauri-generated icon set derived from the committed master artwork:

```bash
npm run tauri -- icon docs/design/shixue-app-icon-master.png
```

Create the complete local x64 delivery directory with:

```bash
npm run release:check -- --mode=release
npm run verify
npm run rust:verify
npm run package:windows
npm run smoke:windows-package
```

`npm run package:windows` invokes the local Tauri CLI with updater artifacts
disabled for this unsigned local build. It emits the following ignored output
under `release-artifacts/windows/<version>/`:

- `Shixue_<version>_x64_Setup.exe`: NSIS current-user installer.
- `Shixue_<version>_x64_Installer.msi`: zh-CN Windows Installer package.
- `Shixue_<version>_x64_Portable.exe`: standalone application executable.
- `SHA256SUMS.txt`: SHA-256 checksums for all three binaries.
- `manifest.json`: product identity, architecture, signing status, sizes, and checksums.
- `README.txt`: end-user description and unsigned-package warning.

The packager checks the PE/MSI binary headers, declared sizes, SHA-256 values,
and checksum-file consistency before reporting success. Re-run the same audit
without rebuilding using `npm run package:windows:audit`.

`release-artifacts/` is ignored because installers are release outputs, not
source. Upload them as release assets only after the source commit and release
tag are fixed. The current local package is explicitly marked
`unsigned-local`; Windows SmartScreen may warn and this package must not be
described as a signed public release.

The portable EXE is “no installer required”, not “self-contained data”. It uses the
same Tauri application identity as the installed editions, so SQLite and application
preferences remain under the current Windows user's AppData-managed application
directory rather than beside the EXE. Moving or deleting the EXE does not move or
delete that learning data. The raw executable also depends on the Microsoft Edge
WebView2 Runtime already being available on the computer; unlike the installers, it
does not bootstrap that runtime for the user.

Tauri updater signatures and Authenticode are separate trust mechanisms. The release
workflow can sign updater payloads with `TAURI_SIGNING_PRIVATE_KEY`, but no Windows
code-signing certificate is configured here. Therefore the portable EXE, NSIS, and MSI
must be described as not Authenticode-signed until a certificate-backed verification
proves otherwise, and Windows SmartScreen may warn on download or first launch.

## Credentials and handoff

Never commit or print private signing keys, certificates, passwords, Apple credentials, or provider tokens. Store them in the platform's secret manager, record only the owning team and setup procedure in private operational documentation, and verify release artifacts in the target platform after the authorized release process runs.
