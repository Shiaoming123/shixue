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
| Runtime selection | `src/modules/loader.ts` and `src/lib/platform.ts` | State target and fallback expectations |
| Workspace import/export | `src/storage/workspace/data-port.ts` | State the current public format/version and legacy Study migration inputs |
| Capability commands | `src/domain/capabilities/types.ts` | State the independent command protocol version and direct-write boundary |
| Sync | `src/sync/` and `docs/sync.md` | State whether a provider is enabled by default |
| Release configuration | `scripts/release-check.mjs` and `docs/release-kit.md` | State evidence, never infer delivery proof |

`npm run check:protocol` reads the JSON and cross-checks the product name,
module policy, Workspace export format/version, legacy Study input format,
capability protocol version, default local-first/sync boundary, acceptance
commands, maturity labels, shipped implementation evidence, and current
delivery evidence. Data-port and
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
- `unverified`: no platform delivery claim has been demonstrated here.

The current protocol marks `desktopPackage` as `local-installed-acceptance`.
The exact unsigned v0.3.0 local candidate passed package smoke and installed-app
acceptance; its versioned acceptance ledger records the artifact hashes, checks,
and remaining `NOT_RUN` rows. This does not raise signing, hosted updates,
deployed Web hosting, real-device execution, or store submission status.
Native mobile delivery remains `unverified`. Runtime maturity is a separate
statement: desktop is the primary stable runtime path; Web and mobile are Beta
adaptations with documented capability degradation.

## Workspace data evolution

New exports use `meow-study/workspace-export` version 3. `WorkspaceStateV3`
supports general personal tasks and keeps learning-specific evidence as an
optional specialization on the same task model. The importer continues to
accept `meow-study/study-export` version 1 and version 2 payloads. Legacy input
is validated, migrated in memory, validated again as a complete v3 workspace,
and only then replaces current state. Web IndexedDB and desktop SQLite preserve
a pre-migration snapshot through their documented fail-closed replacement
paths.

The legacy generic Todo store remains a compatibility boundary for the starter
and is not read, mirrored, or migrated into the Workspace task model.

## Capability and implementation status

Application schema version 2 declares capability protocol version 1. These are
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

`calendar-planning-v1` is backed by machine-checkable source and test pointers:

| Evidence id | Implemented boundary | Behavioural evidence |
| --- | --- | --- |
| `navigation` | `src/lib/workspace-view.ts` | `tests/workspace-navigation.test.ts` |
| `today-upcoming` | `src/domain/views/today.ts`, `src/domain/views/upcoming.ts` | `tests/workspace-projections.test.ts` |
| `review-link` | `src/domain/learning/review-task-link.ts` | `tests/review-task-link.test.ts` |
| `responsive-shell` | `src/lib/responsive-shell.ts` | `tests/responsive-shell.test.ts`, `tests/business-sheet-mount.test.ts` |

These entries claim the local application behaviour covered by those sources
and tests. They do not claim an external calendar provider, hosted service,
native-device validation, or any release channel.

The conditional acceptance commands include `smoke:calendar` for the five fixed
Web viewports and `benchmark:task-query` for deterministic Today, Upcoming, and
calendar projection counts. These checks do not change native delivery status.

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
```

Run `npm run rust:verify` for Rust/Tauri changes. Web and Windows smoke checks
remain opt-in local evidence; see [web.md](./web.md) and
[release-kit.md](./release-kit.md).

## Compatibility

Application schema version `2` declares the general-planning, Workspace v3, and
capability boundaries above. Additive fields require a checker change that
explicitly understands the application schema version. Renaming or removing a
module, data format, or compatibility promise is breaking: keep the old
consumer boundary working where feasible or document a migration before
raising the schema version. Capability protocol v1 is versioned independently.
A protocol update alone never enables a module, Cargo feature, Tauri permission,
sync provider, feature implementation, or release channel.
