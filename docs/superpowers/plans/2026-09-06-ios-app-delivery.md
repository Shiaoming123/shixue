# iOS App Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Shixue from a reproducible iOS Simulator compile to a simulator-verified, device-verified, TestFlight-ready application without duplicating the shared TypeScript domain or weakening its capability transaction boundary.

**Architecture:** Keep `WorkspaceStateV3`, migrations, recurrence, quick-add parsing, reminder authority, calendar projection, and every state transition in the shared TypeScript domain. Native iOS code is limited to host lifecycle, system notifications, document/share presentation, platform identity, and Apple packaging. Every native callback becomes an existing capability command; no Swift or Rust code writes workspace state directly.

**Tech Stack:** Vue 3, TypeScript, Tauri 2, Wry/WKWebView, Rust, `tauri-plugin-sql`/SQLite, Xcode, CocoaPods, XCTest/XCUITest where a native lifecycle assertion cannot be expressed by the existing Node test runner.

**Source specifications:** `DESIGN.md`, `VISUAL_QA.md`, `docs/design-system.md`, `docs/mobile.md`, `docs/ios-development.md`, `docs/delivery-path.md`, `docs/application-protocol.md`, `app.protocol.json`, and the PR2-PR6 plans in this directory.

## Verified baseline — 2026-09-06

- Base integrated into `feat/ios-foundation`: `origin/main@140c012`, including PR #13 recurrence, PR #14 quick add, PR #15 multi-reminder/Windows lifecycle, and PR #16 calendar workspace.
- Shared checks: `npm test`, `npm run typecheck`, `npm run build`, `npm run build:web`, protocol/CSP/docs/module checks, and Rust verification pass on the integrated branch.
- Native compile: Xcode 26.6 (17F113), CocoaPods 1.17.0, scheme `meow-study_iOS`, iOS deployment target 14.0, and Apple Silicon `aarch64-sim` debug build pass.
- Simulator used: iPhone 17 Pro, iOS Simulator 26.5. Installation succeeds, launch returns a PID, then the process exits with `SIGTRAP` in Wry 0.55.1 before Vue or SQLite starts.
- Evidence tier remains `Compile-ready`. SQLite restart persistence, safe-area rendering, WKWebView import/export, background reminders, device, archive, TestFlight, and App Store are not verified.
- Generated Apple sources remain under ignored `src-tauri/gen/apple/`; only non-rebuildable native configuration may be versioned after a specific review.

## Non-goals and fixed boundaries

- Do not reimplement PR5 calendar or implement PR6 release/navigation business scope inside the startup-fix or persistence PRs.
- Do not copy TypeScript state machines into Swift or Rust.
- Do not bypass capability `preview`/`execute`, CAS, idempotency, audit, or undo with direct SQLite writes.
- Do not port tray polling, single-instance, updater, global shortcut, autostart, or the Windows reminder scheduler to iOS.
- Do not claim cloud sync on iOS until a Keychain-backed credential boundary and logout/deletion policy are implemented and verified.
- Do not treat a generated project, frontend build, installed bundle, foreground notification, simulator run, device run, archive, TestFlight, and App Store as equivalent evidence.

## Delivery sequence

The work is intentionally split into small pull requests. A later PR may be prepared in parallel only when it does not depend on runtime evidence from an earlier gate. Each PR records the exact base SHA, commands, environment, PASS/FAIL/NOT_RUN results, and residual risks.

### Task 1: Land the synchronized foundation and repair runtime-contract drift

**Files:**

- Modify: `src/lib/platform.ts`
- Modify: `src/main.ts`
- Modify: `src/App.vue`
- Modify: `tests/mobile-capabilities.test.ts`
- Modify: `tests/module-contract.test.ts`
- Modify: `docs/ios-development.md`
- Modify: `docs/application-protocol.md`

**Steps:**

1. Add a failing test proving the native platform result used by module loading is the same runtime object consumed by the application shell. The test must fail if `App.vue` independently falls back to a mobile/desktop UA decision.
2. Add a failing contract test proving the default desktop runtime advertises `autostart` when the default Cargo feature, module configuration, and desktop-only capability all enable it.
3. Expose the resolved `RuntimeInfo` through a typed Vue injection or a small immutable runtime registry initialized in `main.ts`; consume that value in `App.vue`.
4. Add `autostart` only to `DESKTOP_RUNTIME_INFO`. Keep mobile limited to `native-sql` and `native-notification`.
5. Verify iOS capabilities contain no tray, single-instance, updater, global-shortcut, autostart, Windows reminder scheduler, or desktop cloud-sync capability.
6. Run:

```bash
node --test --experimental-strip-types tests/mobile-capabilities.test.ts tests/module-contract.test.ts tests/module-loader.test.ts
npm run check:modules -- mobile
npm run check:modules -- desktop
npm run typecheck
npm run build
```

**Acceptance gate:** The host-selected runtime is the sole permission-routing input; iOS exposes only the two compiled/authorized mobile capabilities; desktop autostart is no longer silently disabled. This PR does not change iOS maturity.

### Task 2: Turn the Wry startup crash into a deterministic compatibility decision

**Files:**

- Create: `scripts/smoke-ios-launch.mjs`
- Create: `tests/ios-launch-smoke-script.test.ts`
- Modify: `package.json`
- Modify only if the matrix proves it necessary: `src-tauri/Cargo.toml`
- Modify only with a resolved dependency set: `src-tauri/Cargo.lock`
- Modify: `docs/ios-development.md`
- Modify: `app.protocol.json` only after evidence changes

**Steps:**

1. Write a script-unit test around injected command execution. It must assert that the smoke runner installs the exact built `.app`, launches `com.shiaoming123.shixue`, polls process state for a bounded interval, captures termination signal and relevant simulator logs, and exits non-zero unless the app reaches an explicit readiness marker and remains alive.
2. Implement `npm run smoke:ios-launch -- --device <UDID> --app <absolute-app-path>`. Store machine-readable output under an ignored build/evidence directory; never write device identifiers or logs into protocol maturity fields.
3. Emit a native-host-ready marker after Tauri setup and a frontend-ready marker only after Vue mounts and the workspace load succeeds. The smoke script must distinguish host creation, WebView creation, frontend mount, and workspace readiness.
4. Reproduce the locked baseline on a clean generated project with Wry 0.55.1. Preserve the crash stack and `SIGTRAP` result.
5. Run a controlled matrix, changing one variable at a time:

   - Current application + locked Tauri/Wry + iOS 26.5 simulator.
   - Minimal Tauri application + the same locked Tauri/Wry + the same simulator.
   - Current application + the newest released Tauri/Wry combination that resolves cleanly under the existing plugin set.
   - If available without deleting runtimes, the current application on one older supported iOS simulator runtime.

6. Prefer an upstream released dependency fix. Do not permanently patch the Cargo registry. A `[patch]` Git revision is allowed only as a short-lived diagnostic branch with an exact upstream commit and a removal condition.
7. If the newest released stack passes, update the smallest compatible Tauri/Wry dependency set and rerun all Rust, plugin, capability, frontend, and iOS compile checks. If it fails, file or update an upstream minimal reproduction and keep Simulator status `fail`.
8. Run:

```bash
npm ci
npm test
npm run typecheck
npm run build
CARGO_TARGET_DIR=/Users/wuling/Library/Caches/shixue-ios-foundation/cargo-target npm run rust:verify
npm run mobile:ios:prepare -- aarch64-sim
CARGO_TARGET_DIR=/Users/wuling/Library/Caches/shixue-ios-foundation/cargo-target npm run tauri -- ios build --debug --target aarch64-sim --no-sign --ci
npm run smoke:ios-launch -- --device <SIMULATOR_UDID> --app <ABSOLUTE_APP_PATH>
```

**Acceptance gate:** The app reaches workspace-ready and stays alive for the bounded smoke window on a named simulator. Only then may `nativeEvidence.ios.simulatorRun` move from `fail` to `pass`; this still does not prove persistence, device, or release readiness.

### Task 3: Prove WorkspaceStateV3 SQLite persistence and migration through the application boundary

**Files:**

- Create: `scripts/smoke-ios-persistence.mjs`
- Create: `tests/ios-persistence-smoke-script.test.ts`
- Modify: `src/main.ts` or a dedicated test-only readiness bridge
- Modify: `docs/ios-development.md`
- Modify: `docs/delivery-path.md`
- Modify: `app.protocol.json`

**Steps:**

1. Unit-test an injected persistence runner before implementation. It must use a fresh simulator app container and a unique fixture title, and it must fail when the second launch returns seed state or stale state.
2. Add a debug-only, non-production test bridge that submits a normal capability command and reads a `workspace.snapshot` query. Do not expose raw SQL and do not compile the bridge into release builds.
3. On first launch, create a uniquely identified task through `TaskCapabilityService.execute`, assert a successful receipt, capture workspace revision and `updatedAt`, then terminate the app with `simctl terminate`.
4. Relaunch the same installed app without reinstalling it. Query through the capability service and assert the same task, a valid V3 snapshot, and a non-regressed revision.
5. Repeat with controlled v1 and v2 fixture databases in fresh containers to prove backup-before-migrate and V3 reload. Fixture setup may seed the database before launch, but acceptance writes must still go through the application capability path.
6. Add a corrupt JSON/version-mismatch case and assert fail-closed behavior: no seed overwrite and a visible storage error.
7. Run focused storage and capability tests, then the native smoke twice:

```bash
node --test --experimental-strip-types tests/workspace-migration.test.ts tests/workspace-state-v3.test.ts tests/study-storage.test.ts tests/capability-service.test.ts tests/ios-persistence-smoke-script.test.ts
npm run typecheck
npm run build
npm run smoke:ios-persistence -- --device <SIMULATOR_UDID> --app <ABSOLUTE_APP_PATH>
```

**Acceptance gate:** V3 write/terminate/relaunch/read passes through capability service and SQLite, with migration and corrupt-state behavior separately proven. Record `persistenceRestart: pass`; do not yet call the complete app Simulator-verified unless navigation and primary workflows also pass.

### Task 4: Verify lifecycle, safe areas, keyboard, adaptive navigation, and accessibility

**Files:**

- Modify as evidence requires: `src/App.vue`
- Modify as evidence requires: `src/assets/themes/global.css`
- Modify as evidence requires: `src/components/study/BottomTabs.vue`
- Modify as evidence requires: `src/components/ui/Dialog.vue`
- Modify as evidence requires: `src/components/ui/Popover.vue`
- Create: `tests/ios-layout-contract.test.ts`
- Create: `docs/visual-evidence/ios/README.md`
- Modify: `VISUAL_QA.md`

**Steps:**

1. Encode the current contracts in a focused test: `viewport-fit=cover`; safe-area use at top, bottom, sheets, toasts, and task detail; iOS system font; Body 17/22; at least 44×44pt hit targets; no more than five iPhone primary tabs.
2. Replace viewport-height assumptions that fail under the software keyboard with a small `visualViewport`-aware CSS variable only if simulator evidence demonstrates overlap. Keep the fallback for browsers without that API.
3. Verify on iPhone portrait and landscape: bottom tabs, task quick add, date/reminder editors, sheet dismissal, focus restoration, and content not hidden under the home indicator or keyboard.
4. Verify on iPad full width and one split-view width. Use width-based adaptation: compact widths use tabs; regular widths use sidebar. Do not infer iPad layout from device model.
5. Validate Dynamic Type up to 200%, VoiceOver reading order and labels, visible alternatives for drag/swipe operations, Reduce Motion, Reduce Transparency, and Increase Contrast.
6. Keep content surfaces near-opaque. Restrict regular Liquid Glass/material effects to navigation, toolbar, sheet, and popover layers; use at most one prominent tinted action per view.
7. Capture named screenshots with device, OS, appearance, text-size, and commit SHA. Visual screenshots supplement, but do not replace, interaction assertions.
8. Run:

```bash
node --test --experimental-strip-types tests/ios-layout-contract.test.ts tests/built-layout-contract.test.ts tests/modal-overlay-lifecycle.test.ts tests/overlay-host-contract.test.ts tests/typography.test.ts
npm run check:layout
npm run typecheck
npm run build
```

**Acceptance gate:** All named iPhone/iPad states are usable with safe areas, keyboard, Dynamic Type, VoiceOver, and reduced-effects settings. No native business logic is introduced.

### Task 5: Validate and adapt import/export/share for WKWebView

**Files:**

- Create: `src/lib/document-transfer.ts`
- Create: `tests/document-transfer.test.ts`
- Modify: `src/App.vue`
- Modify: `src/components/study/SettingsView.vue`
- Modify only if necessary: `src-tauri/Cargo.toml`
- Modify only if necessary: `src-tauri/capabilities/default.json`
- Modify: `docs/ios-development.md`

**Steps:**

1. Write adapter tests for Web Blob download, HTML file input, iOS document import, iOS share/export, cancellation, malformed files, and permission/plugin failures.
2. First test the existing Blob anchor download and hidden file input in the running simulator. Record each as PASS or FAIL independently.
3. If either path fails or produces inaccessible files, route iOS through a Tauri-supported document picker/share API while preserving the existing `exportStudyState` and `importStudyState` validation functions.
4. Keep all imported content untrusted until complete parse, version validation, and migration succeed. Cancellation must not be reported as an error or mutate storage.
5. Verify exported JSON can be shared to Files, imported into a fresh app container, and round-trip to the same V3 state digest.
6. Run:

```bash
node --test --experimental-strip-types tests/document-transfer.test.ts tests/study-data-port.test.ts tests/workspace-migration.test.ts
npm run typecheck
npm run build
npm run mobile:ios:prepare -- aarch64-sim
CARGO_TARGET_DIR=/Users/wuling/Library/Caches/shixue-ios-foundation/cargo-target npm run tauri -- ios build --debug --target aarch64-sim --no-sign --ci
```

**Acceptance gate:** Import and export have WKWebView evidence or a verified native adapter; `URL.createObjectURL` source presence alone is never recorded as support.

### Task 6: Validate and adapt the merged PR5 calendar on iOS

**Files:**

- Reuse without platform forks: `src/domain/calendar/*`
- Modify only for presentation/input evidence: `src/components/calendar/*`
- Modify only as required: `src/App.vue`
- Modify only as required: `src/components/study/BottomTabs.vue`
- Create: `tests/ios-calendar-contract.test.ts`
- Modify: `VISUAL_QA.md`

**Steps:**

1. Treat the merged projection, collision layout, move/resize commands, undo, and capability routing from `2026-09-04-calendar-workspace.md` as the shared source of truth. Do not fork them for iOS.
2. Verify the existing five-item iPhone navigation with Calendar included; do not add another primary tab during adaptation.
3. Verify compact agenda/day behaviour and regular-width week/month density on iPhone and iPad. Preserve terminology and selection state across width changes and background restoration.
4. Confirm pointer drag remains preview-first and every drag/resize action has visible Move, Resize, Previous/Next, Today, and View alternatives usable by touch and VoiceOver.
5. Exercise DST, timezone change, recurrence occurrence projection, overlapping items, Dynamic Type, keyboard appearance, safe areas, and split view with the merged deterministic fixtures.
6. Run the existing calendar tests and the new iOS contract test before native simulator checks:

```bash
node --test --experimental-strip-types tests/calendar-projection.test.ts tests/calendar-layout.test.ts tests/calendar-commands.test.ts tests/calendar-responsive.test.ts tests/calendar-ui-contract.test.ts tests/ios-calendar-contract.test.ts
npm run typecheck
npm run build
```

**Acceptance gate:** Calendar state and mutations are shared TypeScript behavior; iOS contributes only adaptive presentation and input mapping. Calendar does not delay Tasks/Today persistence verification.

### Task 7: Replace foreground polling with an iOS system notification adapter

**Files:**

- Create: `src/lib/ios-notification-scheduler.ts`
- Create: `tests/ios-notification-scheduler.test.ts`
- Modify: `src/lib/reminder-runtime.ts`
- Modify: `src/modules/notification/index.ts`
- Modify: `src/App.vue`
- Modify as required by the chosen Tauri integration: `src-tauri/src/lib.rs`
- Add only rebuild instructions or a narrow native patch script: `scripts/prepare-ios-build.mjs`
- Version only non-rebuildable native files if required: `src-tauri/gen/apple/...`

**Steps:**

1. Define a native scheduling port whose inputs are shared reminder delivery IDs, trigger instants, timezone metadata, and privacy-safe display text. The port cannot accept or return workspace snapshots.
2. Unit-test schedule, replace, cancel, reconcile, permission denial, timezone change, duplicate callback, stale revision, and system-capacity failure before implementing the native adapter.
3. Request notification permission only when the user first enables/creates a reminder or explicitly tests notifications.
4. Map each pending shared delivery ID to one `UNUserNotificationCenter` request identifier. Persist enough adapter metadata to reconcile system requests after launch without becoming a second authority ledger.
5. On create/update/complete/delete/undo/snooze, derive desired requests from a capability-service snapshot, reconcile native requests, then report scheduling outcome through existing reminder commands. System acceptance is not equivalent to delivered.
6. Route notification actions back to `reminder.snooze`, completion, or the visible reminder center through capability envelopes with idempotency keys. Duplicate and stale callbacks must be harmless.
7. Disable the 20-second WebView poller as the iOS background mechanism. A foreground reconciliation pass may remain, but delivery while suspended/terminated must come from the system.
8. Verify permission denied, foreground, background, terminated, reboot/relaunch reconciliation, DST/timezone change, edit, cancel, snooze, completion, and action duplication. Simulator evidence and device evidence are recorded separately.

**Acceptance gate:** Background/terminated notification scheduling has explicit native evidence, and every resulting state change still passes through capability service. Foreground plugin-send success alone is insufficient.

### Task 8: Complete PR6 navigation and full simulator workflow

**Files:**

- Modify per PR6: `src/App.vue`
- Modify: `src/lib/sidebar-navigation.ts`
- Modify: `src/components/study/BottomTabs.vue`
- Modify: `src/components/study/AppSidebar.vue`
- Create: `scripts/smoke-ios-workflows.mjs`
- Create: `tests/ios-workflow-smoke-script.test.ts`
- Modify: `VISUAL_QA.md`
- Modify: `docs/delivery-path.md`
- Modify: `app.protocol.json`

**Steps:**

1. Freeze the primary navigation vocabulary across iPhone tabs and iPad sidebar. Preserve Today, Inbox/Tasks, Calendar, Topics, Review, and Settings access without more than five iPhone tabs; place secondary destinations in a visible More/Settings hierarchy when needed.
2. Restore selected destination, list, open task, and sheet focus safely after background/foreground transitions. Never restore a destructive confirmation or stale preview handle.
3. Automate a representative simulator workflow: create by quick add, schedule, edit recurrence, set multiple reminders, complete with evidence, review, undo, terminate, relaunch, and confirm persistence.
4. Run the workflow on an iPhone and an iPad simulator, light/dark, and one increased-text configuration. Record failures by step rather than treating launch as complete workflow success.

**Acceptance gate:** Only when native build, stable launch, V3 restart persistence, and representative iPhone/iPad workflows pass may the app be called `Simulator-verified`.

### Task 9: Make the generated Apple project reproducible and decide the deployment floor

**Files:**

- Modify: `scripts/prepare-ios-build.mjs`
- Create: `tests/ios-project-generation.test.ts`
- Modify: `docs/ios-development.md`
- Modify as product decision requires: `src-tauri/tauri.conf.json`
- Version only irreducible native configuration: `src-tauri/gen/apple/...`

**Steps:**

1. Generate Apple sources from a clean checkout and capture scheme, bundle identifier, deployment target, orientations, app version/build number, capabilities, and entitlements with deterministic inspection.
2. Add a test that fails when generated identity or required configuration differs from the documented contract.
3. Resolve the current iOS 14.0 floor versus Xcode's iOS 15.0 recommendation using a dependency support matrix and the desired device support policy. Do not raise the floor solely to silence a warning; do not keep it if dependencies or verified behavior require 15+.
4. Prefer a generator option or checked patch script. If notification extensions, entitlements, privacy manifests, or Icon Composer assets cannot be rebuilt, version only those files plus reconstruction instructions.
5. Confirm `.gitignore` still excludes build outputs, DerivedData, `xcuserdata`, certificates, provisioning profiles, and local device identifiers.

**Acceptance gate:** A clean checkout regenerates an equivalent Apple project, and the minimum iOS decision is explicit and tested.

### Task 10: Device, archive, TestFlight, and App Store gates

**Files:**

- Create: `docs/ios-release-checklist.md`
- Modify: `docs/delivery-path.md`
- Modify: `docs/ios-development.md`
- Modify: `app.protocol.json` after each attained gate
- Add approved App Icon layered source and generated assets in the repository's established icon locations

**Steps:**

1. Before using signing, obtain an owned Apple Developer Team, registered `com.shiaoming123.shixue` identifier, managed certificates/profiles, App Store Connect role, privacy answers, and support/marketing metadata. Never commit credentials or profile files.
2. Validate on at least one supported iPhone and one iPad: cold start, upgrade migration, background/terminated reminders, notification actions, file import/export, offline behavior, storage pressure/error presentation, Dynamic Type, VoiceOver, and rotation/window resizing.
3. Create a Release Archive with an exact Xcode version and scheme. Validate bundle identifier, version/build number, icons, launch screen, privacy manifest, usage descriptions, entitlements, architectures, and absence of desktop plugins.
4. Upload one build to TestFlight, install that exact build from TestFlight, rerun the device smoke, and record the App Store Connect build number and commit SHA.
5. Prepare screenshots and metadata from verified builds only. Complete privacy, export-compliance, age-rating, support URL, data-deletion, and review-note requirements.
6. Promote evidence one gate at a time: `Device-verified` after physical-device behavior; `TestFlight` after uploaded-and-installed TestFlight verification; `App Store` only after Apple approval and public availability.

**Acceptance gate:** Each maturity label is backed by its own command/build/device evidence. No earlier gate implies a later one.

## PR dependency map

```text
Task 1 runtime contract
        |
Task 2 stable native startup
        |
Task 3 V3 persistence ---- Task 4 UI/accessibility ---- Task 5 document transfer
        |                         |                         |
        +-------------+-----------+-------------------------+
                      |                          |
       Task 6 PR5 calendar integration    Task 7 native iOS notifications
                      |                          |
                      +------------+-------------+
                                   |
                   Task 8 PR6 simulator workflow
                                  |
                   Task 9 reproducible Apple project
                                  |
                   Task 10 device -> TestFlight -> App Store
```

Task 4 and Task 5 may start after stable startup while Task 3 is being exercised. Task 6 reuses the merged PR5 shared domain, but its iOS acceptance waits for Tasks 2-4. Task 7 depends on the merged PR4 reminder authority and stable persistence. Release work never backfills missing simulator or device evidence.

## Required checkpoint format

After every task, report:

```text
Completed:
Base and resulting SHA:
Commands run:
PASS:
FAIL:
BLOCKED:
NOT_RUN:
Evidence tier before/after:
Next task:
```

When a check fails, keep the last valid evidence tier and diagnose the failure before expanding scope.
