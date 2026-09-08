# Application protocol

`app.protocol.json` is the lightweight, versioned product declaration for a
starter-derived application. Read it before changing a module, data boundary,
or delivery claim: it states what the application is trying to do, what it
explicitly does not do, its platform priorities, default capabilities, local
data boundary, fallback behaviour, acceptance commands, and compatibility
rules.

It is static metadata. It is not a runtime event bus, a plugin system, a
network manifest, or a replacement for platform configuration.

## Sources of truth

The protocol deliberately summarizes rather than replaces implementation facts:

| Concern | Source of truth | Protocol responsibility |
| --- | --- | --- |
| Enabled modules | `src/modules/config.ts` | Declare the matching product policy |
| Dependencies, platforms, capabilities, native requirements | `src/modules/contract.ts` | Point readers to the compatibility boundary |
| Runtime selection | `src/main.ts`, `src/modules/loader.ts`, and `src/lib/platform.ts` | State target and fallback expectations |
| Workspace import/export | `src/storage/workspace/data-port.ts` | State the current public format/version and legacy Study migration inputs |
| Capability commands | `src/domain/capabilities/types.ts` | State the independent command protocol version and direct-write boundary |
| Sync | `src/sync/` and `docs/sync.md` | State whether a provider is enabled by default |
| Release configuration | `scripts/release-check.mjs` and `docs/release-kit.md` | State evidence, never infer delivery proof |

`npm run check:protocol` reads the JSON and cross-checks the product name,
module policy, Workspace export format/version, legacy Study input format,
capability protocol version, default local-first/sync boundary, acceptance
commands, maturity labels, shipped implementation evidence, current delivery
evidence, and the recorded Android/iOS native evidence boundaries. Data-port and
capability facts are compared with constants exported by the implementation;
they are not inferred by comparing duplicated JSON fields. The checker does not
alter configuration, load modules, contact a network endpoint, or read secrets.

## Evidence vocabulary

`delivery` distinguishes evidence from intent:

- `local-smoke`: an explicit local smoke command exists; it is not signing or
  distribution proof.
- `local-installed-acceptance`: an exact local package hash passed automated
  package smoke and installed-app acceptance. It is not signing, hosted
  distribution, or public-release proof.
- `configured-unverified`: a real endpoint, updater public key, updater artifact
  setting, and release workflow are configured, but an installed-client update
  has not been exercised end to end (`NOT_RUN`).
- `local-debug`: a generated native project has completed a local debug build
  and emulator run; it is not a signed artifact, real-device result, store
  submission, or hosted delivery channel.
- `source-ready`: native source, preparation commands, and bounded smoke tooling
  are committed, but the exact current tree has not completed a native build or
  Simulator run.
- `unverified`: no platform delivery claim has been demonstrated here.

The current protocol marks `desktopPackage` as `local-installed-acceptance`.
The exact unsigned v0.3.0 local candidate passed package smoke and installed-app
acceptance; its versioned acceptance ledger records the artifact hashes, checks,
and remaining `NOT_RUN` rows. This does not raise signing, hosted updates,
deployed Web hosting, real-device execution, or store submission status.
Aggregate native mobile delivery remains `source-ready`: PR #40 run
`34196983972` passed unsigned build, install, launch, process stability, and all
five readiness phases on an iPhone 16 / iOS 26.2 Simulator for merge commit
`22deca1` (`main@d04eb7d` plus PR head `6a09ee6`), but it did not exercise
SQLite restart recovery, a physical device, signing, or distribution. Android has separate `local-debug`
evidence: implementation commit `42cc204` produced an x86_64 debug APK whose
identity passed metadata validation and whose isolated API 36 emulator run
reached all five readiness phases while the resolved Activity stayed foreground
and its PID survived the bounded stability window. The same APK wrote a unique
task through the capability service, confirmed complete process termination,
and recovered that task plus its creation receipt and event from SQLite in a new
process. Android physical-device, emulator-reboot, native-notification, signing,
and store evidence remain `not-run`. The earlier manual iOS Simulator result remains a dated historical snapshot
in `docs/ios-development.md`; the PR #40 workflow run is the current-tree iOS
runtime evidence. Desktop is the primary stable runtime path; Web and mobile are Beta
adaptations with documented capability degradation.

On a Tauri host, `src/main.ts` resolves the native target once and provides the
typed `RuntimeInfo` to both module loading and the Vue shell. User-Agent data
may still select presentation hints, but it never selects native capabilities.
The iOS runtime contract is limited to `native-sql` and
`native-notification`; desktop-only modules, including autostart, remain
excluded by platform and capability checks.

The iOS launch smoke command is `npm run smoke:ios-launch -- --device <UDID>
--app <absolute .app path>`. It is local diagnostic evidence only: it records
install/launch commands, Simulator logs, process termination, and separate
WebView, native-host, Vue, workspace, and frontend markers. It does not prove
signing, device execution, SQLite persistence, or visual acceptance. The
runner keys native marker-file evidence to a unique launch id, checks the host
Simulator process, and succeeds only after all markers are observed and the
process survives the stability window.

The Android launch smoke command is `npm run smoke:android-launch -- --device
<adb-serial> --apk <absolute APK path>`. It first verifies the APK package,
version, SDK, and ABI metadata; requires a fully booted emulator; clears the old
installation and log state; resolves and explicitly launches the real Activity;
then reads run-id-scoped native markers from the debug app cache. It succeeds
only when the WebView, native host, Vue, workspace, and frontend markers are all
present while the Activity is foreground and the app PID remains alive for the
stability window. This does not prove a physical device, restart persistence,
native notifications, signing, or store delivery.

The Android persistence smoke command is `npm run smoke:android-persistence --
--device <adb-serial> --launch-report <absolute launch-report path>`. It accepts
only a successful launch report for the same emulator, package, Activity, and
absolute APK. The first app process creates one run-scoped task through
`TaskCapabilityService`; after `adb force-stop` and observed PID absence, a new
process must recover the exact task, `task.create` receipt, and event from the
native SQLite store. Run-scoped JSON evidence, foreground state, and stable
liveness must all match. This proves application-process restart recovery on
the tested emulator; it does not prove recovery across an emulator reboot, a
physical device, native notifications, signing, or store delivery.

## Workspace data evolution

Restorable backups use `meow-study/workspace-export` version 3. `WorkspaceStateV3`
supports general personal tasks and keeps learning-specific evidence as an
optional specialization on the same task model. The importer continues to
accept `meow-study/study-export` version 1 and version 2 payloads. Legacy input
is validated, migrated in memory, validated again as a complete v3 workspace,
and only then replaces current state. Web IndexedDB and desktop SQLite preserve
a pre-migration snapshot through their documented fail-closed replacement
paths.

The separate Markdown export is a deterministic, human-readable projection of
live completion records. It orders records by completion time and stable id,
keeps completion-time task titles and tag associations, and resolves current
topic and tag labels including archived ones. Deleted completion records are
omitted, while deleting the source task does not remove its historical record.
Markdown is not a restore format; JSON remains the lossless importable backup.

The legacy generic Todo store remains a compatibility boundary for the starter
and is not read, mirrored, or migrated into the Workspace task model.

## Capability and implementation status

Application schema version 5 declares capability protocol version 1. Schema v5
adds separately checked process-restart persistence evidence to the Android and
iOS native records, so a build or launch result cannot be confused with SQLite
recovery evidence. These are
independent version lines: changing the product declaration does not change the
command envelope. Current human UI, keyboard, and notification integrations
must use the versioned capability service, which validates and applies a command
before one compare-and-swap save. Direct workspace storage writes are not an
application capability.

The shipped foundation comprises WorkspaceStateV3 parsing, Study v1/v2
migration and v3 export, capability protocol v1 with transactional command
execution, routing of current live writes through that service, the shared
themed-control foundation, recurrence and occurrences, offline natural-language
quick add, multiple reminders, and `calendar-planning-v1`.
The local data boundary also includes `learning-records-markdown-export-v1`,
which exposes the completion evidence in a readable file without changing the
Workspace schema or import protocol.

`learning-search-tags-v1` adds reversible tag creation, rename, and archive
commands through the same compare-and-swap and audit boundary. Tasks can keep
tag associations, and completion records snapshot their tags so later archive
or rename operations do not erase historical reachability. `workspace.search`
deterministically searches task fields, checklist items, tags, and completion
record learning/evidence/blocker/next-action fields, with combinable result
type, topic, status, date, and all-selected-tags filters.

`derived-learning-rhythm-v1` adds a read-only Learning subview over recurrence
occurrences, task completion events, and live completion records. Weekly
progress and streaks count only one-to-one evidence links; missing evidence is
shown separately and never becomes an empty habit check-in. Completing a
learning occurrence from task surfaces opens the existing evidence form and
uses the recurrence capability with workspace, task, and occurrence revisions.

`explainable-weekly-evidence-v1` replaces the Review page's host-clock summary
with a read-only selector driven by an injected instant, IANA timezone, and week
start preference. It groups live completion evidence, the distinct sessions
linked to those records, and completed review links by the completion record's
topic snapshot. Every metric carries the exact completion-record ids used to
derive it, so the UI can narrow the existing record history and return to the
source task. Linked minutes are evidence-attributed minutes; they are not a
claim that every session in the week has a complete audited end time.

The same selector also exposes the current weekly plan snapshot for learning
tasks. Ordinary tasks contribute their current schedule, while recurring tasks
contribute occurrences without also counting the parent task. Effective
occurrence overrides own the schedule and estimate. Completion, cancellation,
and skip outcomes keep their exact task, occurrence, and event identities and
exclude facts later than the injected instant; an outcome before the week still
describes the current state of a task scheduled in the week. Occurrence status
owns the current result after undo, and the latest canonical event sequence
explains a completed or skipped occurrence. Generated review tasks and
structurally cancelled recurrence occurrences are excluded. Because task events
do not store schedule, estimate, or list snapshots, this is explicitly the
current workspace view of the week rather than a reconstruction of an earlier
plan.

Completed-plan evidence coverage uses those current completed plan facts as its
denominator. A plan is covered only when its selected outcome event points to a
live completion record for the same task; absent or deleted records remain
visible as missing evidence, while dangling, cross-task, or multiply claimed
links fail loudly. The due-review cohort uses review links whose date-only
`dueOn` falls inside the selected week. It classifies each link as completed,
scheduled, due today, or overdue at the injected instant. Future completion
timestamps do not leak into the result, multiple review stages remain distinct,
and source records are deduplicated only for record navigation. Pending links
open their exact review task or occurrence; completed links open their source
completion record. These are derived views and add no persisted statistics.

`calendar-planning-v1` is backed by machine-checkable source and test pointers:

| Evidence id | Implemented boundary | Behavioural evidence |
| --- | --- | --- |
| `navigation` | `src/lib/workspace-view.ts` | `tests/workspace-navigation.test.ts` |
| `today-upcoming` | `src/domain/views/today.ts`, `src/domain/views/upcoming.ts` | `tests/workspace-projections.test.ts` |
| `review-link` | `src/domain/learning/review-task-link.ts` | `tests/review-task-link.test.ts` |
| `responsive-shell` | `src/lib/responsive-shell.ts` | `tests/responsive-shell.test.ts`, `tests/business-sheet-mount.test.ts` |
| `learning-search-tags` | `src/domain/capabilities/tag-commands.ts`, `src/domain/capabilities/task-commands.ts`, `src/domain/capabilities/recurrence-commands.ts`, `src/domain/search/workspace-search.ts` | `tests/tag-commands.test.ts`, `tests/capability-service.test.ts`, `tests/recurrence-learning-completion.test.ts`, `tests/workspace-search.test.ts` |
| `derived-learning-rhythm` | `src/domain/views/learning-rhythm.ts`, `src/components/study/LearningRhythmView.vue` | `tests/learning-rhythm.test.ts`, `tests/learning-rhythm-view.test.ts` |
| `explainable-weekly-evidence` | `src/domain/views/weekly-learning-summary.ts`, `src/components/study/ReviewView.vue` | `tests/weekly-learning-summary.test.ts`, `tests/review-weekly-summary.test.ts` |
| `learning-records-markdown-export` | `src/domain/export/learning-records-markdown.ts`, `src/lib/study.ts`, `src/components/study/SettingsView.vue`, `src/App.vue` | `tests/learning-records-markdown.test.ts`, `tests/sidebar-settings-ui.test.ts`, `tests/settings-behavior.test.ts` |

These entries claim the local application behaviour covered by those sources
and tests. They do not claim an external calendar provider, hosted service,
native-device validation, or any release channel.

The conditional acceptance commands include `smoke:calendar` for the five fixed
Web viewports and `benchmark:task-query` for deterministic Today, Upcoming, and
calendar projection counts. These checks do not change native delivery status.
`smoke:web-persistence` additionally exercises the global search dialog,
reversible tag management, and a recurring learning occurrence from rule
creation through evidence-backed completion, persisted rhythm progress,
completed-plan evidence coverage, due-review source drilldown, and weekly
metric drilldown at the fixed responsive viewports. It remains Web evidence rather than
native-shell or installed-package evidence.

These shared capabilities do not claim reliable iOS background delivery; the
iOS system scheduler adapter remains planned. Web calendar and persistence
evidence does not establish iOS Simulator behaviour.

Agent behaviour remains planned.
The command envelope reserves `source: agent`, but there is no shipped Agent
planner or autonomous execution policy. A future Agent must use the same
query/preview/execute boundary and cannot bypass validation or write storage
directly.

## Changing an application safely

1. Change the implementation source of truth first: module contract/config,
   data-port, capability protocol, or release boundary.
2. Update `app.protocol.json` in the same change, including product goal,
   non-goal, platform fallback, or data/privacy boundary when applicable.
3. Add a focused behavioural test before implementation changes. Keep protocol
   checker tests fixture-based; do not test JSON text with grep.
4. Run the corresponding checks:

```bash
npm run check:protocol
npm run check:modules
npm run check:modules -- web
npm run check:modules -- mobile
npm run verify
npm run smoke:ios-launch -- --device <UDID> --app <absolute .app path>
npm run smoke:android-launch -- --device <adb-serial> --apk <absolute APK path>
```

Run `npm run rust:verify` for Rust/Tauri changes. Web and Windows smoke checks
remain opt-in local evidence; see [web.md](./web.md) and
[release-kit.md](./release-kit.md).

## Compatibility

Application schema version `4` declares the general-planning, Workspace v3, and
capability boundaries above. Additive fields require a checker change that
explicitly understands the application schema version. Renaming or removing a
module, data format, or compatibility promise is breaking: keep the old
consumer boundary working where feasible or document a migration before
raising the schema version. Capability protocol v1 is versioned independently.
A protocol update alone never enables a module, Cargo feature, Tauri permission,
sync provider, feature implementation, or release channel.
