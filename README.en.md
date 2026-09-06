<p align="center">
  <img src="./public/shixue-mark.svg" alt="Shixue app icon, an open book growing a new sprout" width="88" />
</p>

<h1 align="center">Shixue</h1>

<p align="center">
  <strong>Put todos on a timeline, and turn learning into small steps you can finish and review.</strong><br />
  A local-first personal todo and time-planning app for Windows, with an optional learning mode.
</p>

<p align="center">
  <a href="./README.md">中文</a>
  ·
  <a href="https://github.com/Shiaoming123/shixue/releases/latest">Download latest</a>
  ·
  <a href="./docs/README.md">Documentation</a>
</p>

> **Built on MeowStarter:** Shixue is based on the open-source [MeowStarter](https://github.com/Shiaoming123/meow-starter) project. The starter supplies the Tauri 2 and Vue 3 foundation, local storage boundaries, cross-platform capability model, and release tooling. Shixue adds general tasks, an optional learning mode, a complete product workflow, and its own visual system.

![Shixue task center showing the task list and event timeline side by side](./docs/design/shixue-tasks-desktop-implementation.png)

## What Shixue is for

Shixue is first a single-user, local-first todo and time-planning app: capture a task, then decide what belongs today, when it starts, when it is due, and whether it repeats. When the task is for learning, add a topic, focus sessions, completion evidence, and a review schedule.

General tasks and the optional learning mode share one local workflow:

`Capture → clarify → schedule → focus → evidence-backed completion → 1 / 3 / 7-day review`

It is designed for people who want to manage personal todos, schedules, and learning records on a Windows computer without first creating an account or uploading task data. Collaboration, cloud sync, external calendar integration, and AI planning are outside the current scope.

## Interface

The interface combines a warm paper background, deep ink text, and a restrained sage-green accent. Desktop navigation has seven primary destinations: Inbox, Today, Upcoming, Calendar, Lists, Completed, and Learning. At 320–819px, a five-item bottom bar shows Inbox, Today, Calendar, Lists, and Learning; Upcoming and Completed remain available from the More sheet. Layouts at 1280px and wider use three columns, 820–1279px uses a details drawer, and 320–819px uses one column with full-screen details.

| Windows task center | 390px responsive layout |
| --- | --- |
| [![Desktop task center thumbnail](./docs/design/shixue-tasks-desktop-implementation.png)](./docs/design/shixue-tasks-desktop-implementation.png) | [![Mobile-width task list thumbnail](./docs/design/shixue-tasks-mobile-implementation.png)](./docs/design/shixue-tasks-mobile-implementation.png) |

See the [visual fidelity ledger](./docs/design/fidelity-ledger.md) for concepts, implementation captures, and intentional differences.

## Tasks and time planning

- **General todos:** Save an inbox item with only a title, then optionally add a list, tags, priority, planned time, due time, and estimate.
- **Today and Upcoming:** Today combines tasks planned for today, due today, overdue, and today's recurring occurrences with stable de-duplication. Upcoming groups the next seven days by date.
- **Calendar:** Day, week, month, and agenda views support scheduling unplanned tasks. Calendar moves support a task, one occurrence, future occurrences, or the entire series. Duration resizing supports only a task or one occurrence; future/series resize scopes are explicitly rejected.
- **Recurrence:** Generate occurrences daily, weekly, monthly, yearly, or after completion while retaining completion, skip, and exception history.
- **Offline quick add:** Deterministic Chinese and English rules parse dates, times, due markers, priorities, recurrence, `#tags`, and `@lists` locally. Ambiguous or conflicting results require confirmation and do not depend on a model or network.
- **Multiple reminders and tray:** A task can have several reminders. System notification submission is attempted only while the app or tray process is running and permission is available; reminders are not guaranteed after a full exit. In-app cards provide Complete, Snooze, and Open when native actions are unavailable.
- **Optional learning mode:** Add topics, focus sessions, acceptance criteria, outcome evidence, and 1 / 3 / 7-day reviews. General todos do not require learning fields.
- **Local data evolution:** WorkspaceState v3 supports Study v1/v2 migration and import. IndexedDB / SQLite preserve the legacy snapshot before migration; new exports use `meow-study/workspace-export` v3. Older application versions cannot read v3 data. Pre-upgrade backups exclude later records and do not provide automatic downgrade recovery.

## Download for Windows

Open the [latest GitHub Release](https://github.com/Shiaoming123/shixue/releases/latest). This URL resolves to the newest public release. Treat the time-planning source described here as included in an installer only when that Release explicitly lists it.

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
- Task and learning data do not require an account and are not uploaded as synchronization data. Update checks may contact GitHub Releases.
- JSON export provides backup and manual transfer between Web and desktop runtimes. The two runtimes do not synchronize automatically.
- Cancelling a task does not physically delete tasks, sessions, events, or completion records. A failed migration does not replace the previous state.
- Portable and installed builds use the operating-system-managed application data location. Deleting the EXE or uninstalling the application should not be treated as proof that learning data was erased.
- Cloud sync, external calendars, collaboration, AI planning, and authentication are outside the current release boundary; see the native-evidence status below.

See the [application protocol](./docs/application-protocol.md) for the detailed import, export, migration, and persistence contract.

### Development and native acceptance boundary

| Item | Current evidence |
| --- | --- |
| Basic Windows package | The v0.2.4 unsigned NSIS automated install, process-liveness, and cleanup smoke is `PASS`. Manual acceptance of the cumulative time-planning build—double-click launch, retained data, tray, reminder actions, quick add, all four calendar views, dark mode, and uninstall—is `NOT_RUN`. |
| Authenticode | `NOT_RUN`; current Windows packages are unsigned. Tauri updater `.sig` files and SHA-256 hashes do not establish a Windows publisher signature. |
| Updates between published versions | `NOT_RUN`; the repository builds updater metadata and signed payloads, but there is no end-to-end installed-client upgrade evidence across published versions. |
| Native Windows scaling and screen reader | System 200% scaling and Narrator are `NOT_RUN`. Web CSS zoom, equivalent reflow, and Edge screenshots do not substitute for native evidence. |
| Native mobile | Current product acceptance and native notifications on iOS, iPadOS, and Android simulators/devices are `NOT_RUN`. Web screenshots at 320–819px prove responsive layout only. |

Multiple reminders, in-app actions, notification permission, and close lifecycle wiring have source and Web/automated evidence. Unknown legacy reminder records block delivery with an error; a crash between submission and acknowledgement has no exactly-once guarantee. See the itemized [PR4 product audit](./docs/design/2026-09-05-pr4-product-audit.md). The visual contract remains in the user-approved `LOCKED / NAVIGATION AMENDED` state; [VISUAL_QA.md](./VISUAL_QA.md) defines its evidence boundaries.

## Architecture

```text
Vue 3 general-todo and optional-learning interface
          │
          ▼
Domain commands and task state machine
          │
          ▼
Workspace data port
     ┌────┴──────────────┐
     ▼                   ▼
SQLite (Tauri/Windows)   IndexedDB (Web)
```

- **Application shell:** Tauri 2 owns the Windows window, SQLite integration, and optional system capabilities.
- **Interface:** Vue 3, TypeScript, and Vite share one business component system across desktop and mobile widths.
- **Domain layer:** The task model in `WorkspaceState` is the single source of truth. UI code uses application capabilities and domain commands instead of mutating persisted state around the state machine.
- **Storage layer:** IndexedDB and SQLite implement the same data port. Migration, backup, validation, and replacement fail closed.
- **Release layer:** GitHub Actions builds Windows Releases. The local Release Kit additionally assembles and audits a complete delivery directory.

Read more: [application protocol](./docs/application-protocol.md) · [development guide](./docs/development.md) · [design system](./docs/design-system.md) · [modular architecture](./docs/modular-architecture.md)

## Verification

```bash
npm run verify
npm run rust:verify
npm run smoke:web-persistence
```

`verify` covers domain and storage tests, the application protocol, CSP, desktop/Web/mobile module contracts, type checking, desktop and Web builds, the mobile layout contract, and documentation links. Web and calendar smoke tests prove browser paths and responsive behavior; they do not prove the Tauri native shell, Windows installers, system notifications, native scaling, Narrator, or native mobile runtimes.

For the local Windows package, `npm run smoke:windows-package` installs the NSIS build into an isolated directory, launches it, checks process liveness, and cleans only that test directory. This demonstrates a working local package lifecycle; it does not prove Authenticode signing, SmartScreen reputation, or store acceptance.

## Roadmap

- [x] General tasks, Today / Upcoming, seven-destination desktop navigation, and five-destination compact navigation
- [x] Day/week/month/agenda calendar, recurrence, offline bilingual quick add, and the multiple-reminder source path
- [x] Optional learning mode, focus sessions, evidence-backed completion, and review loop
- [x] IndexedDB / SQLite persistence, Study v1/v2 → Workspace v3 migration, and JSON exchange
- [x] Local Windows x64 Portable, NSIS, and MSI packaging plus install/launch smoke
- [x] GitHub Release and Tauri updater-metadata build pipeline (not proof of an end-to-end upgrade)
- [ ] Authenticode signing and post-signing installation verification
- [ ] End-to-end update testing between published versions
- [ ] Native Android/iOS device, signing, and store delivery

External calendar sync, analytics dashboards, boards, Gantt charts, cloud sync, collaboration, and AI planning are outside the current scope. The roadmap describes verification directions, not delivery dates.

## Contributing

Reproducible bug reports, usability feedback, and narrowly scoped improvements are welcome. Before coding, read the [contribution guide](./CONTRIBUTING.md) and [working agreement](./AGENTS.md), then run the checks required for your change.

- [Open an issue](https://github.com/Shiaoming123/shixue/issues)
- [Read the changelog](./CHANGELOG.md)
- [Report a security issue](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)

## License and provenance

Shixue is available under the [MIT License](./LICENSE). Third-party material, starter provenance, and license boundaries are recorded in [PROVENANCE.md](./PROVENANCE.md). The parent project is [MeowStarter](https://github.com/Shiaoming123/meow-starter).
