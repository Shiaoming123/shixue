<p align="center">
  <img src="./public/shixue-mark.svg" alt="Shixue app icon, an open book growing a new sprout" width="88" />
</p>

<h1 align="center">Shixue</h1>

<p align="center">
  <strong>Turn what you want to learn into small steps you can finish, prove, and review.</strong><br />
  A local-first personal study companion for Windows.
</p>

<p align="center">
  <a href="./README.md">中文</a>
  ·
  <a href="https://github.com/Shiaoming123/shixue/releases/latest">Download latest</a>
  ·
  <a href="./docs/README.md">Documentation</a>
</p>

> **Built on MeowStarter:** Shixue is based on the open-source [MeowStarter](https://github.com/Shiaoming123/meow-starter) project. The starter supplies the Tauri 2 and Vue 3 foundation, local storage boundaries, cross-platform capability model, and release tooling. Shixue adds its own learning-task domain, complete product workflow, and visual system.

![Shixue task center showing the task list and event timeline side by side](./docs/design/shixue-tasks-desktop-implementation.png)

## What Shixue is for

A conventional to-do list answers “what should I do?” Learning also requires answers to three harder questions: what counts as learned, what evidence did I produce, and when should I review it?

Shixue keeps task management and learning evidence in one loop:

`Capture → clarify → schedule → focus → evidence-backed completion → 1 / 3 / 7-day review`

It is designed for people who want to manage personal study on a Windows computer without first creating an account or uploading their learning history. The current release is single-user, local, and desktop-first. It is not a collaboration suite, an AI planner, or a general-purpose project manager.

## Interface

The interface combines a warm paper background, deep ink text, and a restrained sage-green accent. System typography, rounded groups, translucent materials, bottom sheets, and subtle motion create an iOS-inspired interaction feel while retaining the information density expected from a Windows desktop application. At a 390px viewport, details become full-screen and navigation moves to a four-item bottom bar.

| Windows task center | 390px responsive layout |
| --- | --- |
| [![Desktop task center thumbnail](./docs/design/shixue-tasks-desktop-implementation.png)](./docs/design/shixue-tasks-desktop-implementation.png) | [![Mobile-width task list thumbnail](./docs/design/shixue-tasks-mobile-implementation.png)](./docs/design/shixue-tasks-mobile-implementation.png) |

See the [visual fidelity ledger](./docs/design/fidelity-ledger.md) for concepts, implementation captures, and intentional differences.

## The learning loop

- **Today:** Aggregates tasks across topics. The active task stays first, while overdue items require an explicit choice to move, defer, or cancel.
- **Tasks:** Capture an inbox item with only a title, then add a topic, planned date, due date, estimate, acceptance criteria, and executable checklist.
- **Focus:** Only one learning session may be running or paused. Switching tasks pauses the current session, and elapsed time plus scratch notes survive a restart.
- **Traceable state:** Start, pause, resume, block, defer, complete, cancel, and reopen actions are preserved in a high-value event timeline.
- **Evidence-backed completion:** Learning, evidence, and the next action are required. Finishing one focus session does not silently complete the whole task.
- **Topics:** Organize tasks around a goal and success criteria without maintaining a duplicate step model.
- **Review:** Schedule reviews at 1, 3, and 7 days. Search or filter completed records and explicitly turn a recorded next action into a new task.
- **Local data evolution:** StudyState v2 supports legacy migration, pre-upgrade backup, v1/v2 JSON import, and v2 export.

## Download for Windows

Open the [latest GitHub Release](https://github.com/Shiaoming123/shixue/releases/latest). This URL always resolves to the newest release, so the README does not pin a stale version number.

| Choice | Release asset | When to use it |
| --- | --- | --- |
| **Portable (preferred)** | `Shixue_*_x64_Portable.exe` | Run the application without creating a Windows installation record. If the current Release does not include this asset, use Setup instead. |
| **Setup** | `Shixue_*_x64-setup.exe` | Current-user installation for regular daily use. |
| **MSI** | `Shixue_*_x64.msi` | Environments that specifically require Windows Installer. |

Before running a package, note these boundaries:

1. Portable describes the application binary, not the data location. Tasks and preferences are still stored in the Windows AppData application-data directory; they do not travel beside the EXE.
2. Shixue requires Microsoft Edge WebView2 Runtime. Windows 10 and 11 commonly provide it already; if it is missing, install it from the [official Microsoft WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/).
3. The current Windows packages do not have an Authenticode signature. SmartScreen may display an “Unknown publisher” warning. Download only from this repository's Releases and, where available, verify the SHA-256 information supplied with the release or local delivery bundle.

A complete local Windows delivery directory can also contain Portable, NSIS, MSI, `SHA256SUMS.txt`, `manifest.json`, and delivery notes. See the [Release Kit](./docs/release-kit.md) for build and audit details.

## Run from source

### Web development

Requires Node.js 22+:

```bash
npm ci
npm run dev:web
```

### Windows desktop development

In addition to Node.js, install Rust 1.77.2+ and the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/):

```bash
npm ci
npm run doctor
npm run tauri dev
```

### Build the complete local Windows delivery

```bash
npm run release:check
npm run verify
npm run rust:verify
npm run package:windows
npm run smoke:windows-package
```

Outputs are written to `release-artifacts/windows/<version>/`. This directory contains generated artifacts and is not committed to source control.

## Data and privacy

- The Windows desktop application uses SQLite. The Web application uses IndexedDB scoped to the current site origin.
- Learning data does not require an account and is not uploaded as synchronization data. Update checks may contact GitHub Releases.
- JSON export provides backup and manual transfer between Web and desktop runtimes. The two runtimes do not synchronize automatically.
- Cancelling a task does not physically delete tasks, sessions, events, or completion records. A failed migration does not replace the previous state.
- Portable and installed builds use the operating-system-managed application data location. Deleting the EXE or uninstalling the application should not be treated as proof that learning data was erased.
- Cloud sync, collaboration, AI planning, notifications, and authentication are not part of the current release.

See the [application protocol](./docs/application-protocol.md) for the detailed import, export, migration, and persistence contract.

## Architecture

```text
Vue 3 learning interface
          │
          ▼
Domain commands and task state machine
          │
          ▼
Study data port
     ┌────┴──────────────┐
     ▼                   ▼
SQLite (Tauri/Windows)   IndexedDB (Web)
```

- **Application shell:** Tauri 2 owns the Windows window, SQLite integration, and optional system capabilities.
- **Interface:** Vue 3, TypeScript, and Vite share one business component system across desktop and mobile widths.
- **Domain layer:** `StudyTask` is the single task source of truth. UI code uses domain commands instead of mutating persisted state around the state machine.
- **Storage layer:** IndexedDB and SQLite implement the same data port. Migration, backup, validation, and replacement fail closed.
- **Release layer:** GitHub Actions builds Windows Releases. The local Release Kit additionally assembles and audits a complete delivery directory.

Read more: [application protocol](./docs/application-protocol.md) · [development guide](./docs/development.md) · [design system](./docs/design-system.md) · [modular architecture](./docs/modular-architecture.md)

## Verification

```bash
npm run verify
npm run rust:verify
npm run smoke:web-persistence
```

`verify` covers domain and storage tests, the application protocol, CSP, desktop/Web/mobile module contracts, type checking, desktop and Web builds, the mobile layout contract, and documentation links. The Web smoke test exercises capture, clarification, focus start, pause, reload recovery, evidence-backed completion, and completion-record search.

For the local Windows package, `npm run smoke:windows-package` installs the NSIS build into an isolated directory, launches it, checks process liveness, and cleans only that test directory. This demonstrates a working local package lifecycle; it does not prove Authenticode signing, SmartScreen reputation, or store acceptance.

## Roadmap

- [x] Learning-task state machine, focus sessions, evidence-backed completion, and review loop
- [x] IndexedDB / SQLite persistence, v1 → v2 migration, and JSON exchange
- [x] Local Windows x64 Portable, NSIS, and MSI packaging plus install/launch smoke
- [x] GitHub Release and Tauri updater-metadata build pipeline
- [ ] Authenticode signing and post-signing installation verification
- [ ] End-to-end update testing between published versions
- [ ] Native Android/iOS device, signing, and store delivery

Recurring tasks, tags, analytics dashboards, calendars, boards, Gantt charts, cloud sync, collaboration, and AI planning are outside the current release. The roadmap describes verification directions, not delivery dates.

## Contributing

Reproducible bug reports, usability feedback, and narrowly scoped improvements are welcome. Before coding, read the [contribution guide](./CONTRIBUTING.md) and [working agreement](./AGENTS.md), then run the checks required for your change.

- [Open an issue](https://github.com/Shiaoming123/shixue/issues)
- [Read the changelog](./CHANGELOG.md)
- [Report a security issue](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)

## License and provenance

Shixue is available under the [MIT License](./LICENSE). Third-party material, starter provenance, and license boundaries are recorded in [PROVENANCE.md](./PROVENANCE.md). The parent project is [MeowStarter](https://github.com/Shiaoming123/meow-starter).
