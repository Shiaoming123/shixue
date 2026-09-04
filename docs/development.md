# Development guide

Use this guide for a credential-free local checkout. Release accounts, signing keys, and platform certificates are not required for ordinary development.

## Normal setup

Install Node.js 22+, Rust 1.77.2+, and the platform prerequisites listed in the [Tauri documentation](https://tauri.app/start/prerequisites/). On Windows, this includes the Visual Studio C++ Build Tools and Microsoft Edge WebView2 Runtime. Then run:

```bash
npm ci
npm run doctor
npm run check:modules
npm run tauri dev
```

The development server uses the fixed port `1420`. The Windows app loads the embedded Tauri SQLite database `sqlite:study.db`; no external database server is required. Core local use also requires no `.env` file. `VITE_STUDY_SUPABASE_URL` and `VITE_STUDY_SUPABASE_PUBLISHABLE_KEY` are optional cloud-sync configuration and must not block startup while sync is disabled.

For the Web-only app, use `npm run dev:web`. It uses IndexedDB and browser fallbacks, so a successful browser render does not validate the desktop SQLite/plugin/ACL path. Before sharing a frontend change, run `npm run verify`; it runs `test`, `check:protocol`, `check:csp`, desktop/Web/mobile `check:modules`, `typecheck`, `build`, `build:web`, `check:layout`, and `check:docs` in that order. Use `npm run release:check` to inspect versions, identifiers, bundle icons, updater configuration, and signing-related configuration in template mode.

`npm run doctor` reports the Node, npm, Rust, Cargo, and local Tauri CLI versions, the official Tauri platform-prerequisite guide, and the locations of `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. Missing tools include installation guidance. The command does not enumerate environment variables, secrets, or keychains.

## Blank native window incident and prevention

The desktop app previously opened a blank window after the shortcut module was enabled. The process and Vite server stayed alive, and the Web app rendered normally, but the native log reported `global-shortcut.register not allowed`. The failure happened before Vue mounted: `src/main.ts` waits for `mountModules(app)` and only then calls `app.mount("#app")`, so the rejected shortcut `setup()` prevented the entire first screen.

The shortcut module invokes both `register` and `unregister`. Its contract and the main-window capability therefore declare the concrete permissions `global-shortcut:allow-register` and `global-shortcut:allow-unregister`. An aggregate name such as `global-shortcut:default` must not be treated as proof that those commands are granted; plugin aggregate permissions can omit the invoked commands or grant nothing relevant. `src/main.ts` also catches module setup failures and mounts the shell from `finally`, preserving the required storage-selection order while preventing another rejected optional module from leaving a blank window.

Use this checklist whenever a native module changes:

1. Align `src/modules/config.ts`, `src/modules/contract.ts`, the Cargo feature and Rust plugin registration, and `src-tauri/capabilities/default.json` with the commands the module actually calls.
2. Run `npm run check:modules`, then `npm run rust:verify` for Rust/Tauri changes.
3. Run `npm run tauri dev` with the terminal visible. Confirm that the Vue interface actually appears and exercise the affected native feature while watching for setup rejections or `not allowed` messages.
4. Keep Web and native evidence separate. Browser rendering, a listening port, a built bundle, or a surviving desktop process does not prove that the native WebView mounted successfully.

If a native window is blank, inspect the first error in the `tauri dev` log and module setup chain before changing layout code. Verify WebView2 only when the WebView itself cannot start; an ACL rejection with a live window is an application configuration failure, not a missing database or Visual Studio dependency.

## exFAT checkouts on macOS

macOS can create AppleDouble sidecars (`._*`) on exFAT volumes. Those sidecars can be mistaken for test files or Tauri capability/configuration files. Run `npm run doctor` after setup and whenever a tool behaves unexpectedly: it warns when it detects this filesystem condition.

The supported cleanup is intentionally narrow:

```bash
npm run clean:appledouble
```

It removes only regular `._*` files under this checkout and does not follow symlinks. Do not delete ordinary dotfiles or configuration files to address this warning.

Rust output should be placed on a native filesystem when the checkout is on exFAT. Choose a local APFS path that is appropriate for your machine; do not commit it:

```bash
CARGO_TARGET_DIR=/absolute/path/on/apfs npm run rust:verify
```

`npm run rust:verify` preserves a caller-provided `CARGO_TARGET_DIR` and cleans known AppleDouble sidecars before its Rust gates. On macOS exFAT only, when no target directory is provided, it uses the operating-system temporary directory as a fallback and warns that the fallback filesystem has not been verified as native. A caller-selected APFS path remains the supported choice for reliable Rust builds.

## Everyday command matrix

| Need | Command |
| --- | --- |
| Diagnose tools, configuration, and filesystem | `npm run doctor` |
| Run the Node test suite | `npm test` |
| Check the product-level application protocol | `npm run check:protocol` |
| Check the production Tauri content-security policy | `npm run check:csp` |
| Verify an existing Android debug APK's identity and ABI metadata | `npm run check:android-artifact -- --apk <path-to-apk>` |
| Check desktop, Web, or mobile module compatibility | `npm run check:modules [-- web|mobile]` |
| Run all frontend quality gates | `npm run verify` |
| Check release configuration in template mode | `npm run release:check` |
| Remove only AppleDouble sidecars | `npm run clean:appledouble` |
| Run the desktop app | `npm run tauri dev` |

The exact commands live in `package.json`; keep documentation synchronized with them rather than inventing aliases.
