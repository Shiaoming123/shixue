# Release Kit

## Current boundary

The Release Kit makes a checkout diagnosable and validates release configuration. It does not publish an artifact, obtain credentials, sign a binary, notarize an app, submit to a store, initialize mobile projects, or deploy a Web host.

| Stage | Current maturity | What is available now | Still required |
| --- | --- | --- | --- |
| Local checks | Available | `npm run doctor`, `npm run verify`, and `npm run release:check` | Project-specific platform validation |
| Desktop build/package | Local Windows delivery available, not signed release proof | `npm run package:windows` builds and audits an unsigned x64 NSIS installer, zh-CN MSI, and portable EXE; `npm run smoke:windows-package` installs and launches the NSIS package in an isolated temporary profile | Code signing and public distribution remain separate |
| Desktop code signing | Deferred | Workflow accepts optional signing inputs | Certificate ownership, secret provisioning, signed-artifact verification |
| macOS notarization | Deferred | Workflow accepts optional Apple signing/notarization inputs | Apple account, certificates, notarization submission, and installed-artifact validation |
| Updater signing/delivery | Configured for GitHub Releases | Real HTTPS endpoint and application-specific public key are committed; the private key remains outside Git | Hosted signed updater artifacts and update-path validation |
| Windows distribution | Local delivery verified | NSIS, zh-CN MSI and portable EXE are packaged, hashed, audited and smoke-tested | Authenticode certificate and SmartScreen reputation |
| Android package | Local debug evidence | Android emulator `tauri android dev` and local universal debug APK/AAB build have completed | Recreate the ignored generated project on a clean checkout; real-device smoke, signing, Play Console, and store submission |
| iOS package and store | Deferred | Responsive UI and desktop-capability degradation only | Native project initialization, Xcode/CocoaPods, accounts, certificates, device testing, and store submission |
| Web deployment | Deferred | `npm run build:web` creates a static build | Select/configure a provider and validate a deployed site |

An unsigned desktop artifact is not evidence of a signed, notarized, store-ready, or auto-updatable release. Likewise, a responsive mobile interface is not an APK, AAB, IPA, TestFlight build, or store submission.

`src-tauri/gen/` is intentionally ignored. The Android Gradle project and its
debug APK/AAB are local build outputs, so a clean checkout must regenerate it
with `npm run tauri -- android init --ci` before rebuilding. The verified local
debug artifacts do not carry an upload keystore or prove Google Play acceptance.
After a debug build, run `npm run check:android-artifact -- --apk <path>` to
check its package identity, version, SDK metadata, and included ABI list. The
manual `android-debug` workflow runs the same check and uploads its debug APK;
it deliberately does not sign or publish anything. Its clean-runner path has
been executed successfully once for the current Android debug baseline.

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
`v*.*.*` builds publish NSIS and MSI assets plus updater metadata to a non-draft GitHub Release.
Release assets use the stable `Shixue_<version>_<arch>` ASCII prefix so GitHub does not
sanitize the Chinese product name and break updater-signature matching.
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

On Windows, `npm run smoke:windows-package` performs an explicit local package lifecycle check: it builds an unsigned NSIS installer with a transient `bundle.createUpdaterArtifacts=false` overlay, silently installs beneath a fresh `src-tauri/target/meow-windows-package-smoke-*` directory, redirects `APPDATA` and `LOCALAPPDATA` there, confirms the installed process remains alive briefly, then force-stops that child process and removes only the validated temporary directory.

The command leaves the generated NSIS bundle under the ignored Tauri target directory and does not need a signing private key. It is deliberately not a signed release, updater-delivery, offline-installation, tray graceful-exit, store, or macOS/Linux package test.

## Windows delivery package

Use the Tauri-generated icon set derived from the committed master artwork:

```bash
npm run tauri -- icon docs/design/shixue-app-icon-master.png
```

Create the complete local x64 delivery directory with:

```bash
npm run release:check
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

## Credentials and handoff

Never commit or print private signing keys, certificates, passwords, Apple credentials, or provider tokens. Store them in the platform's secret manager, record only the owning team and setup procedure in private operational documentation, and verify release artifacts in the target platform after the authorized release process runs.
