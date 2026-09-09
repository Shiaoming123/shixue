# Task 4 checkpoint — 4A1 only

2026-09-09; base `f6e7fb6`; branch `feat/calendar-recurrence-write`.

## Completed: immutable fake prepare contract (4A1)

- `future-plan.ts` defines JSON-serializable `FuturePlan`, `FutureStep`, `FutureState`, and authoritative `FutureSnapshot` interfaces.
- `CalendarWriter.readFuture` is an optional fake reader contract. Intent cannot supply attachment clearance: the reader must provide complete remote exception enumeration, local attached-fact scan and workspace hash. No Google or native implementation of this reader exists yet.
- Outbox prepare freezes the original parent, pivot provider ID/ETag, original start, empty supported exception set, original/truncated/successor recurrence, fixed successor ID, step bodies, parent ETag and root notification policy. Root preview hash binds the complete plan; confirmation stores a clone with three pending step states and parent/pivot/successor lock keys.
- Plan bodies carry a stable marker hash of the pre-marker root request. The final preview hash additionally binds every snapshot/body; these two hashes are deliberately distinct. Future sender must compare against `plan.markerHash` when proving these frozen bodies.
- Parent truncation uses COUNT equal to the proven number of occurrences before the pivot. Successor COUNT is decremented; UNTIL/never ending rules remain unchanged. Existing strict RRULE validation, Google recurrence normalization and occurrence expansion prove boundaries; expansion remains bounded at 10,000 candidates.
- Current minimum accepted edit is title-only. First occurrence pivots, moved pivots, any modeled exceptions, attached facts, unsupported provider metadata, incomplete evidence and lossy rules reject before mutation. Unknown local/remote evidence must fail closed in any reader implementation.
- Successor is a step within the root and has no independent preview/enqueue entry. Future run/reconcile rejects `WRITE_UNSUPPORTED` before claiming anything.

## Evidence

- RED: new success-contract test failed with `WRITE_UNSUPPORTED`; rejection test passed (1/2).
- GREEN: focused Node tests (`calendar-future-plan`, `google-write`, `calendar-write-outbox`, `google-recurrence`) 26/26.
- `npm run doctor`, `npm run typecheck`, `git diff --check`: passed (doctor filesystem probe unavailable on Windows as documented).
- Full `npm test`: 941/941; log `task-4a1-test.log` in this checkpoint directory.
- `npm run build`, `npm run build:web`: passed; existing chunk-size advisory; logs `task-4a1-build.log` and `task-4a1-build-web.log`.
- `npm run check:docs`: passed.
- Protected `docs/experiments/calendar-competitor-research.md` remains untouched and unstaged.

## Pending: 4A2 and 4B (Task 4 is NOT complete)

- 4A2 must implement the fake Google readFuture adapter with complete enumeration and a trusted local attachment scanner; revalidate workspaceHash before mutation. Current tests inject the snapshot at the writer boundary, not HTTP reads.
- 4A2 must implement root-only CAS/lease execution, persist applying/unknown/proof before every mutation, exact GET-only unknown reconciliation, parent proof before child creation, deterministic failure compensation with latest read ETag, and divergence conflicts. Compensation ETag is null in the immutable plan because it must be obtained only after proving the current truncation; persist the chosen ETag in step state before the restore request.
- 4A2 must cover response loss, restart, serialization recovery, compensation conflicts and no duplicate notification requests. Current serialization assertion covers preview round-trip and cloned enqueue state, not crash recovery.
- 4B native schema/keyring persistence, sender, atomic parent+successor local projection and bound receipt remain pending. This checkpoint does not claim native persistence support for the new fields.
- No Rust/native/local projection/UI/Stage 7 changes; real Google sending and product write switch remain disabled.

Next action: implement 4A2 against these interfaces, review the complete saga, then start 4B. No accurate task token usage counter was available; this checkpoint does not invent a count.

## 4A1 review correction: pivot status parity

- Confirmed parent plus tentative pivot now rejects before preview creation. Both statuses use the existing Google event normalizer, matching recurrence exception normalization semantics; frozen plan interfaces are unchanged.
- RED: added tentative-pivot rejection case failed with `Missing expected rejection` (1/2).
- GREEN: focused `calendar-future-plan`, `google-write`, `calendar-write-outbox`, `google-recurrence` tests 26/26; `npm run typecheck` and `git diff --check` passed.
- Per scoped review request, full Node/build gates were not repeated for this correction; the preceding 4A1 baseline evidence remains distinct.

## 4A2a checkpoint: authoritative fake reader and local evidence

2026-09-09; base `758f63b`. Scope narrowed with coordinating parent approval to the independent reader/scanner slice; 4A2 is NOT complete.

- Added fake-host-only `createGoogleCalendarWriter(transport, loadWorkspace)` injection. `readFuture` verifies calendar write permission, exact parent identity/ETag, enumerates the entire unexpanded calendar with deleted exceptions included, resolves the exact original-start pivot via instances, then rereads the parent. Missing parent/pivot, exceptional series, non-200/malformed pages, duplicate IDs, token loops, and the 100-page/25,000-item ceiling reject.
- Trusted loader returns raw WorkspaceStateV4, which is cloned, parsed and recursively checked for unknown fields. Scanner derives the provider event identity, gathers calendarEventLinks, eventOutcomes, event reminderRules (including disabled rules), and reminderDeliveries through rule linkage (including cancelled deliveries). Orphan rules/deliveries and unknown evidence fail parsing. SHA-256 is derived from the complete parsed workspace, never accepted from the intent.
- Prepare freezes the resulting workspaceHash using unchanged 4A1 interfaces. Execution/reconciliation remain WRITE_UNSUPPORTED; no sender, saga, native persistence, local projection, product UI, Stage 7, or protected research changes.

Evidence:
- RED: new authoritative success test failed WRITE_UNSUPPORTED (1/2); GREEN focused future-reader/future-plan/google-write/outbox/google-recurrence 29/29.
- `npm run doctor`, `npm run typecheck`, `npm run check:docs`, `git diff --check`: passed; doctor filesystem probe unavailable on Windows.
- Full `npm test`: 944/944, log `task-4a2a-test.log`.
- `npm run build`, `npm run build:web`: passed, existing chunk-size advisory; logs `task-4a2a-build.log`, `task-4a2a-build-web.log`.

Remaining 4A2b interface/work:
- Reuse frozen FuturePlan/FutureState plus root WriteOutboxStore.claim/cas. Add fake-only step mutation/read-proof operations; persist applying/outcomeUnknown/proof and lease ownership before/after every mutation. No independent successor enqueue.
- Immediately before first parent mutation, rerun readFuture and compare workspaceHash, empty attachedFacts/exceptions, original parent and pivot identity/ETag with frozen evidence. Google pagination is not a transaction: reread consistency reduces observed races but does not prove an immutable remote snapshot; this remains fake contract evidence, not real Google readiness.
- Prove parent markerHash and exact truncated recurrence before fixed-ID successor POST. Unknown outcomes only GET-reconcile, never resend; restart only from persisted state/proof.
- Deterministic child rejection must prove parent still belongs to this root, freeze latest ETag in compensation state, then restore original recurrence. Divergence is compensation conflict; lost compensation response reconciles only.
- Add success/loss/compensation/restart/series-lock/fixed-ID/no-duplicate notification tests. Revalidation, saga and full result proof are not yet implemented. Workspace hashing is deliberately conservative: any parsed workspace change invalidates prepare; larger calendars remain unsupported.
- Accurate token accounting unavailable; this checkpoint does not invent usage counts.

## 4A2a review correction: recurrence linkage evidence

- Fixed the shared full-page reader before classification: any row containing recurringEventId or Google instance originalStartTime must have a valid nonempty string recurringEventId. Arrays, objects, null, empty strings, explicit undefined and missing instance linkage now reject instead of being silently treated as unrelated rows.
- Added direct readFuture regression cases so the assertion verifies the authoritative reader itself cannot return false complete/no-exception evidence. Added parent reread ETag divergence and session generation change coverage; all remain GET-only.
- RED: malformed/missing-linkage test failed Missing expected rejection (3/4 passed). GREEN: focused future-reader/future-plan/google-write/outbox/google-recurrence 30/30; npm run typecheck and git diff --check passed.
- Scoped review checks only: full npm test and builds were not rerun for this one-line validation correction; the earlier 944/944 and build evidence belongs to the preceding checkpoint. The existing page ceiling remains tested; no separate item ceiling test was added.
- Execute/reconcile remain disabled. 4A2b/4B and the documented remote snapshot limitations remain pending; protected research was not modified or staged.

## 4A2b1 checkpoint: fake root execution and read-only recovery

2026-09-09; base `70c5cd2`. Coordinating parent split 4A2b at the compensation boundary; 4A2b2 and Task 4 remain incomplete.

- Added root-only CAS/lease saga with persisted per-step applying/outcomeUnknown/proof. Before the first mutation, authoritative readFuture reconstructs the frozen plan and compares parent/pivot evidence, workspace hash, recurrence and empty exception/attachment evidence. A mismatch terminates before mutation.
- Fake step adapter PATCHes the parent with frozen If-Match/sendUpdates and POSTs the fixed successor ID only after parent GET proof. Every mutation is preceded by root CAS recording that exact step as applying/unknown. Successful responses also require exact GET proof of identity, markerHash and frozen desired content.
- Applying/unknown steps use GET only on restart. JSON-serialized unknown roots recover without repeated PATCH/POST or notification requests. Complete result includes parent and successor remote proofs plus markerHash for Task 4B; no local projection callback is invoked and localApplied remains false.
- Deterministic successor rejection is deliberately fail-closed: rejected/conflict step is persisted, root remains outcomeUnknown with COMPENSATION_REQUIRED and retains the same-series lock. No compensation is sent in this slice. 4A2b2 must implement exact parent reread, freeze latest compensation ETag, restore and GET-only compensation reconciliation/conflict tests.
- No Rust/native persistence, real Google sender, local projection, UI, product write switch, Task 5 or Stage 7 changes. Protected research remains untouched.

Evidence:
- RED: four initial saga tests failed WRITE_UNSUPPORTED (0/4).
- GREEN: focused future-saga/future-plan/future-reader/google-write/outbox/google-recurrence tests 36/36; includes success, both response-loss paths, JSON restart, fixed ID/notification count, workspace drift, parent lock and wrong-marker refusal.
- Doctor, typecheck and git diff --check passed (doctor filesystem probe unavailable on Windows).
- Full npm test 951/951: task-4a2b1-test.log. Desktop/Web builds passed with existing chunk-size advisory: task-4a2b1-build.log and task-4a2b1-build-web.log.
- Remaining concerns: fake memory-store/JSON recovery is not native durable persistence evidence. No remote transactional snapshot guarantee; Task 4A2a limits still apply. Compensation and local atomic projection/receipt are unimplemented and must not be inferred from this successful fake two-step result.
- Token usage reporting unavailable; no exact count claimed. Next action: implement 4A2b2 compensation against persisted rejected successor and per-step proof interfaces.

## 4A2b1 review correction: complete semantic proof and rejected-step restart

- GET proof now compares the union of actual and frozen semantic keys; added attendees, attachments, description, unsupported eventType or tentative status cannot produce a proved parent/successor. Only explicitly enumerated provider metadata (etag, created, updated, sequence, kind, htmlLink, iCalUID) is excluded; absent status/eventType normalize to confirmed/default. Nested values remain exact.
- Recovery from a persisted deterministic parent rejection now returns terminal conflict with outcomeUnknown false and WRITE_REJECTED, matching the non-crash path. Only a rejected successor reached after parent proof retains COMPENSATION_REQUIRED and the unresolved-root lock. No compensation mutation was added.
- RED: three regression tests failed (7/10); parent and successor accepted added attendees, and parent rejection restart incorrectly returned failed. GREEN: focused future/outbox/google tests 42/42, including both rejection crash boundaries, both semantic proof regressions and allowed metadata/defaults. Existing lost-response tests continue proving GET-only recovery and no repeated mutation/notification requests.
- Typecheck passed after using the existing target-compatible hasOwnProperty API. Full npm test 957/957 (task-4a2b1-review-test.log); desktop/Web builds passed with existing chunk advisory (task-4a2b1-review-build.log and task-4a2b1-review-build-web.log). Docs/diff checks passed.
- Native persistence/projection, UI, real sending, product write switch and protected research remain unchanged. 4A2b2 compensation and Task 4B remain pending.

## 4A2b2 checkpoint: fake compensation and conflict recovery

2026-09-09; base `c35295c`. TypeScript Task 4A compensation is implemented; Task 4B and Task 4 remain pending.

- Deterministically rejected successor enters parent exact-GET preflight. Identity, root markerHash and complete truncated semantic content must match. Divergence/missing parent is terminal COMPENSATION_CONFLICT with no restore request. Transient read failure retains COMPENSATION_REQUIRED for read recovery.
- The latest observed ETag is persisted in compensation step applying/outcomeUnknown before PATCH, and sent as If-Match with frozen body/sendUpdates. Restore proof compares original parent semantics plus the frozen root marker; original recurrence is restored without producing a complete split result.
- Applying/unknown compensation uses exact GET only after response loss or JSON restart. Proof is persisted before terminal failed/COMPENSATED with outcomeUnknown=false; result remains null and localApplied=false. Only proven compensation releases the unresolved root lock. Compensation rejection/divergence remains terminal conflict with outcomeUnknown=true, preserving the partial-state lock and forbidding local acknowledgement.
- Successor conflict (e.g. occupied fixed ID/409) cannot establish absence and therefore enters COMPENSATION_CONFLICT without restore. A deterministically rejected creation is the supported compensation path. Unknown successor outcome remains read-only recovery, never compensation.

Evidence:
- RED: saga 11/20 passed, 9 failed (new compensation cases and updated successor rejection restart expectation).
- GREEN: focused future saga/plan/reader, Google write/recurrence and outbox 52/52, including latest-ETag assertion inside the transport, fixed notification counts, successful restore, parent divergence, 412/403, response loss + JSON restart, restored-content divergence, lock retention/release, and null result/localApplied=false.
- Doctor and typecheck passed; doctor filesystem probe remains unavailable on Windows.
- Full npm test 967/967 (`task-4a2b2-test.log`). Desktop/Web builds passed (`task-4a2b2-build.log`, `task-4a2b2-build-web.log`) with existing dynamic-import/chunk-size advisories.
- Docs and diff checks passed. Protected research remains untouched/unstaged. No native/Rust persistence, local projection, real Google sending, UI, Task 5 or Stage 7 changes.
- Remaining limitations: fake in-memory CAS plus JSON restart is not native durability evidence; remote snapshot limitations from 4A2a persist. Terminal compensation conflicts intentionally retain locks and require a future explicit resolution path. Accurate token usage reporting unavailable; no count invented.

## 4B1a checkpoint: native frozen-record persistence only

2026-09-09; base `73aa578`. Coordinating parent split 4B1 into persistence (4B1a), authoritative prepare (4B1b), and sender/recovery (4B1c). Task 4B and Task 4 remain incomplete.

- Native untrusted mirror now accepts and preserves the exact TS-generated FuturePlan/FutureState JSON, including omitted optional step fields, all lockKeys, result proof shape, and compensation error codes. Shape validation rejects unknown structural fields, wrong phase/types, stale immutable compensation ETag, and altered/missing fixed-child identity or locks. Reads validate stored records too.
- Ledger stores the untouched future step JSON; existing keyring digest binds the entire ledger, root preview hash, full plan and every phase/outcomeUnknown/proof/compensation ETag. Anchor lock keys derive from the frozen parent/pivot/successor and are checked on load. SQL rollback cannot replace the anchored version.
- Added a fixture generated by the approved TS prepare/enqueue path. Rust roundtrip preserves its exact JSON value and validates its TS root hash through native anchored persistence. Plan bodies/provider proof records remain JSON objects per the TS Record contract; this slice does not reconstruct recurrence or certify arbitrary supplied semantic bodies. Native prepare remains responsible for that in 4B1b.
- Native future prepare/confirmation/run/reconciliation remain WRITE_UNSUPPORTED. Local stage/apply explicitly reject future and the ledger rejects future local bindings. No independent child command, sender, local receipt/ack, UI, real Google write, or product/feature-default change.

Evidence:
- RED: Rust TS-fixture roundtrip failed on unknown field future (0/1).
- GREEN: three focused Rust future tests passed: TS fixture roundtrip; malformed/extra fields; keyring-bound locks and durable compensation phase/ETag/proof, rollback rejection, and disabled confirm/reconcile with zero writes.
- Doctor passed (Windows filesystem probe unavailable); rust:verify passed fmt, clippy all-targets/all-features, 61 Rust tests, all-features check and no-default-features check. Log: task-4b1a-rust-verify.log.
- TS writePreviewHash recalculation matched the fixture; no TS source changed. Docs/diff checks passed. Protected research remains untouched/unstaged.
- Pending 4B1b: authoritative native snapshot/attachment reader and byte-compatible prepare; 4B1c: durable root saga, mutation authorization/lease checks, response-loss and compensation recovery tests. 4B2: atomic parent+successor local projection and receipt/ack. Existing native mirror claim/CAS remain single-step-only, and this checkpoint makes no future sender readiness claim.
- Accurate token accounting unavailable; no exact count claimed. Next action: review this persistence slice before native prepare.

## 4B1a review correction: ECMAScript preview-hash parity

- Future preview validation now reuses `calendar_workspace_hash::fingerprint`, the existing ECMAScript number/UTF-16 canonical encoder. The native-only keyring ledger digest is unchanged; no future execution boundary was enabled.
- Added deterministic actual TS prepare/enqueue fixtures for originalParent.sequence=1e21 and 1e20. Reproduce with `node scripts/generate-calendar-future-boundary.mjs`; `--check` verifies exact generated bytes and recalculates TS writePreviewHash without modifying files.
- Evidence correction: 1e21 already passed with this installed serde version. 1e20 reproduced the real defect: unchanged TS record rejected with WRITE_PREVIEW_CHANGED. RED log task-4b1a-hash-red.log records that failure. GREEN verifies both fixtures persist/load unchanged through the keyring anchor and changed content still fails the frozen hash.
- Focused native future tests 4/4; generator --check passed. rust:verify passed fmt, all-target/all-feature clippy, 62 Rust tests, all-features and no-default-features checks (task-4b1a-hash-rust-verify.log). The Windows linker still emits linker stdout warnings when creating import libraries; these are present in focused/full Rust logs and were not hidden or treated as absent.
- Doctor passed with the existing unavailable Windows filesystem probe. Full Node 967/967, typecheck, desktop/Web builds, docs and diff checks passed; existing build chunk-size advisories remain. No protected research changes. Native future prepare/sender and 4B2 local projection remain pending.

## 4B1b1a checkpoint: native remote evidence reader only

2026-09-09; base `2826650`. Coordinating parent narrowed this slice after source inspection: native has no WorkspaceStateV4 parser equivalent to the TS parser. 4B1b prepare remains incomplete.

- Added an internal, unwired GET-only remote reader: exact calendar access, parent ID/ETag, complete unexpanded list with deleted exceptions, original-start instances pagination, parent reread and calendar access reread. Empty/malformed pages, invalid recurrence linkage, duplicate IDs/tokens, absent or divergent parent, exceptional series, nonunique/wrong/cancelled pivot, non-200 responses and 100-page/25,000-item bounds fail closed.
- Future session hook defaults to rejection. Google implementation checks configured owner, current generation, grant presence, write and calendar-list scopes; reader checks before/after each request and before returning. Existing native transport still checks generation around authorization/network reads. Event-list GET scope routing now supports the exact events collection path with query parameters.
- Result is explicitly RemoteEvidence, not a complete FutureSnapshot. It certifies observed read consistency only; Google pagination has no transactional snapshot guarantee. Prepare/confirmation/run/reconcile/local projection remain disabled for future, with existing disabled-sender tests passing. No TS/UI/real network send/Stage 7/protected research changes.

Evidence:
- RED: new remote success check failed WRITE_UNSUPPORTED (1/2), log task-4b1b1a-red.log. GREEN: three reader tests cover success, pagination/malformed/identity/access/ETag/generation boundaries and both resource ceilings; every fake request asserts GET and absent mutation body/If-Match/sendUpdates.
- Doctor passed (Windows filesystem probe unavailable). rust:verify passed fmt, all-target/all-feature clippy, 65 tests, all-features and no-default-features checks; task-4b1b1a-rust-verify.log. Existing Windows linker import-library stdout warnings remain visible.
- No TS/generator changes, so Node/typecheck/build were not rerun for this Rust-only slice. Documentation and diff checks passed.

Pending:
- 4B1b1b must implement trusted workspace parsing/unknown-field/reference validation and TS reader workspaceHash parity. Current TS reader hashes JSON.stringify(parseWorkspaceStateV4(raw)); native canonical fingerprint is a different contract. A shallow native scan or hashing raw SQLite JSON would not prove parity. No workspace snapshot/hash fixture was added here.
- 4B1b2 must normalize the approved conservative recurrence/time/status subset, reject moved/status-divergent and first pivots, establish lossless recurrence boundaries, generate byte/hash-compatible immutable plans, anchor full previews and enable explicit native confirmation. This reader deliberately does not perform those semantic checks.
- 4B1c sender/recovery and 4B2 atomic projection remain pending. Accurate token usage unavailable; no exact count claimed. Next action: review this remote-only checkpoint, then settle the cross-language trusted workspace contract before enabling prepare.

## 4B1b1b checkpoint: parsed workspace hash contract groundwork only

2026-09-09; base `e3afea0`. The authorized fallback slice was taken after inspecting the full TS parser and native local/projection/hash code. 4B1b1b is NOT complete: no native WorkspaceStateV4 parser, trusted local scanner or LocalEvidence API has been delivered.

- Added `scripts/generate-calendar-future-workspace-hash.mjs`, which executes the real parseWorkspaceStateV4 on a cloned synthetic workspace and records raw input, exact JSON.stringify(parsed) bytes and SHA-256. `--check` reproduces the checked-in fixture without writes.
- Two fixtures bind omitted requestFingerprint defaulting, unrelated command-receipt facts, ECMAScript numeric formatting (-0, exponent thresholds, rounded fraction), Unicode/control characters and integer-property ordering. Existing sorted canonical workspace fingerprint is explicitly demonstrated to differ from the approved future hash.
- Added an isolated test-only ordered JSON codec using existing serde/canonicalizer dependencies. It retains ordinary property insertion order, sorts integer-index keys, uses ECMAScript number formatting, verifies exact TS bytes/hash, detects tampering and rejects duplicate JSON keys. This codec is NOT a native workspace validator and MUST NOT hash unvalidated SQLite input as authoritative clearance. No production hash API or enabled execution boundary was added.

Evidence: fixture generator and --check passed; focused native hash contract test passed; rust:verify passed formatting, all-target/all-feature clippy, 66 tests, all-features/no-default-features checks (task-4b1b1b-hash-rust-verify.log). Existing Windows linker import-library stdout warnings remain. Docs and diff checks passed. Node suite/typecheck/build were not repeated because no production TS/Rust behavior changed; the new TS generator ran directly. Protected research remains untouched and unstaged.

Precise remaining work: native trusted-store snapshot read; full V4 shape/default/order/reference/recurrence validation equivalent to TS parseWorkspaceStateV4 with recursive unknown-field rejection; attachments (links, outcomes, disabled rules and cancelled deliveries through rule linkage); orphan/unmodeled evidence rejection; clean/each-attachment/unrelated-fact tests. Only then promote/use the ordered encoding with parser-produced values and return LocalEvidence plus workspaceHash. Current fixture input order alone does not prove native parser construction order or native defaulting. Future prepare/confirmation/sender remain disabled; 4B1b2 plan construction, 4B1c sender and 4B2 atomic projection remain pending. Exact token usage unavailable; no count claimed.
## 4B parser foundation checkpoint: trusted raw bytes and empty-root normalization

2026-09-09; base `df18a75`. Durable prerequisite only; 4B1b1b and Task 4 remain incomplete.

- Added unwired `workspace_payload_v4_bytes`: one SQLite statement reads the original payload as bytes for id=1/version=4, requires TEXT and 1..16 MiB byte length before transfer, rejects missing/wrong-version rows, and supports an exact previous-byte precondition to reject a changed row. This is a read-time optimistic check, not an anchored snapshot or a guarantee against a later concurrent update. Existing `workspace_payload` callers are unchanged.
- Added production ordered AST using the existing serde tokenizer; object insertion order survives decoding, every object rejects duplicate decoded keys, and ECMAScript number formatting/string escaping and array-index enumeration determine encoding. Malformed, non-finite, invalid UTF-8, excessive nesting and oversized input fail closed. No dependency added. serde rejects lone UTF-16 surrogates, including otherwise JS-valid isolated surrogate strings; this conservative unsupported boundary is explicit, not full JavaScript string acceptance.
- Root normalization constructs the exact TS V4 field order, validates version/positive integer revision/timestamp, requires every current collection, rejects unknown/missing/wrong-type fields, and accepts only empty collections. Absent optional reminderMigration stays omitted; empty legacy previewReceipts is validated and omitted. Present reminderMigration and populated collections fail with WORKSPACE_COLLECTION_UNSUPPORTED. Timestamp support is a conservative RFC3339 subset with seconds, 1..9 fraction digits, valid dates and years >=0100; valid TS minute-only or 24:00 forms remain unsupported. No unchecked collection is copied into normalized output.
- Extended the real TS parser generator with clean empty-root fixtures and numeric revision boundaries (1e20/1e21), deliberately reordered raw roots. Root tests prove exact parsed bytes/hash; existing actual TS defaulted-receipt/numeric/Unicode fixtures separately prove AST encoding parity and remain rejected by the partial root normalizer. This does not claim native receipt defaulting or populated workspace parsing.

Evidence: root and raw-store RED failures captured in `task-4b-parser-red.log` and `task-4b-store-red.log`; focused workspace tests 9/9. Generator --check passed. rust:verify passed fmt, all-target/all-feature clippy, 70 Rust tests, all-features and no-default-features checks (`task-4b-parser-rust-verify.log`); initial clippy test-allocation warning was corrected. Existing Windows linker stdout warnings remain visible. Doctor passed with its Windows filesystem probe unavailable. Node application suite/typecheck/build were not rerun because application TS behavior is unchanged; generator executed the real TS parser. Exact token usage unavailable.

Remaining: all nonempty entity collection parsers/defaults/construction order (including receipts, migration and legacy preview receipts); recursive unknown-field checks inside modeled entities; full TS scalar/date/string acceptance decisions; uniqueness, all task/event/reference/status/recurrence graphs; trusted reader attachment checks for links, outcomes, disabled reminder rules and cancelled deliveries through linkage; orphan/unmodeled-evidence rejection and attachment/unrelated-fact fixtures. Only after these may parser output supply a workspace hash and LocalEvidence. No LocalEvidence, prepare, confirmation, sending, local projection, UI, Stage 7 or protected research was enabled or modified.

## 4B calendar source/event parser checkpoint

2026-09-09; base `2df22ac`. Coordinating parent narrowed this implementation to calendarSources/calendarEvents. Task 4 and 4B1b1b remain incomplete.

- Added ordered source/event parsing with recursive unknown-field rejection, required types/enums/text bounds, source access flags, color/URL/person/attendee validation, all-day/floating/fixed time ordering, optional sourceUrl omission, source references and global IDs within the accepted subset. Raw nested property order is deliberately reversed in fixtures; parser construction restores actual TS order and canonicalizes fixed exception originalStart to UTC milliseconds.
- Added daily/weekly/monthly/yearly cadence, never/on/after ends, preserved/cancelled/moved exceptions, duplicate canonical exception rejection and original series membership, including monthly/yearly clamping and count/end boundaries. Reuses the existing native projection wall helper; only UTC/Etc UTC/GMT aliases, Asia/Shanghai and existing valid Etc/GMT offsets are supported. Historical Shanghai fixed exception checks before 1992 fail closed because the shared helper assumes UTC+8. Other source/fixed-time zones remain unsupported, including otherwise TS-valid IANA zones.
- Native rejection of unknown fields is deliberately stricter than the TS parser, which drops them. The inherited seconds-bearing RFC3339/year >=0100 and no lone-surrogate ceilings remain. This is exact normalized bytes/hash parity for the accepted subset, not full TS acceptance. The function name normalize_empty_root is retained for the foundation entry point but now accepts source/event populated roots.
- No attachment scanner, LocalEvidence, native future prepare/confirmation/send, local projection behavior, UI, Stage 7, dependencies, or protected research change. Other nonempty collections and reminderMigration remain unsupported. Only helper visibility changed in the projection module.

Evidence:
- Source/event RED rejected the all-day fixture with WORKSPACE_COLLECTION_UNSUPPORTED (`task-4b-calendar-red.log`). Separate scalar RED reproduced JS BOM whitespace acceptance mismatch; historical-zone RED reproduced unsupported historical acceptance; weekly-overflow RED reproduced arithmetic panic. All were corrected before green.
- 36 deterministic real-TS fixtures (10 accepted with exact bytes and SHA-256, 26 rejected native cases; TS-valid but native-unsupported cases retain TS output). Includes unrelated cancelled/deleted event facts, all time variants, four cadence families, canonical fixed exception starts, moved floating exceptions, malformed/unknown/enums/duplicate IDs/attendees/exception and reference/count/end boundaries. Reproduce: `node scripts/generate-calendar-future-workspace-hash.mjs --check`.
- rust:verify passed fmt, all-target/all-feature clippy, 71 Rust tests, all-features and no-default-features checks (`task-4b-calendar-rust-verify.log`). Existing Windows linker stdout warnings remain. Doctor passed; filesystem probe remains unavailable on Windows. Docs and diff checks passed. No application TS logic changed, so Node application suite/typecheck/build were not repeated; generator directly invokes the actual TS parser.
- Accurate token usage unavailable. This is a bounded checkpoint, not a completed workspace parser.

Next parser groups: calendarEventLinks/eventOutcomes plus task references; current/legacy task-target and event-target reminderRules, reminderDeliveries and original-start/default/key/ownership validation; listGroups/lists/sections/tags/tasks/recurrenceSeries/occurrences; studySessions/taskEvents/completionRecords/reviewTaskLinks and all status/event chains; commandReceipts, reminderMigration and nonempty legacy previewReceipts. Only after complete root/reference validation may the trusted reader scan links/outcomes/disabled rules/cancelled deliveries and return authoritative LocalEvidence/hash. Recurrence exception checking currently scans at most 10,000 candidates per exception; shared traversal remains a performance follow-up if large series matter. Wider timezone/date/string parity, 4B1b2 plan construction, 4B1c sender/recovery and 4B2 atomic projection remain pending.

## 4B calendar review correction: negative epoch recurrence boundary

2026-09-09; base `bf6dccc`. Fixed the reviewed signed-epoch-remainder parity gap within the calendar parser only.

- Fixed recurrence anchors with epoch milliseconds < 0 and a nonzero remainder modulo 60,000 now fail closed with WORKSPACE_RECURRENCE_UNSUPPORTED, including an empty exception list. Minute-aligned negative anchors remain supported. This is the explicitly authorized conservative boundary; it does not claim full pre-1970 TS recurrence parity.
- Added real-TS fixtures for anchor `1969-09-09T10:00:30Z`: next-day `10:00:30Z` is TS-invalid (previously native accepted), while `09:59:30Z` is TS-valid but intentionally native-unsupported. Generator assertions freeze both TS outcomes. Additional same-boundary fixtures cover millisecond remainder, an empty exception list, and accepted minute-aligned recurrence.
- RED reproduced native accepting `negative-epoch-wall-clock` (`task-4b-calendar-negative-epoch-red.log`). GREEN: focused workspace parser tests 4/4; fixture generator --check passes with 41 cases (11 accepted exact bytes/hash, 30 native rejected). rust:verify passed fmt, all-target/all-feature clippy, 71 tests, all-features and no-default-features checks (`task-4b-calendar-negative-epoch-rust-verify.log`). Existing Windows linker stdout warnings remain. Docs and diff checks passed. Application TS logic did not change, so Node application tests/typecheck/build were not repeated.
- Prior remaining parser groups, attachment/LocalEvidence boundary and all disabled future execution boundaries are unchanged. Protected research remains untouched/unstaged. Accurate token usage unavailable.

## 4B list organization parser checkpoint

2026-09-09; base `2559b4c`. Bounded split: listGroups/lists/sections/tags only. Task 4 and 4B1b1b remain incomplete.

- Read the TS parser and found a required dependency: assertReferences calls assertStudyEventInvariants for every task, which requires a nonempty taskEvents chain starting from null and ending at task.status. Accepting tasks while keeping nonempty taskEvents fail-closed cannot preserve TS validity. Tasks, recurrenceSeries and occurrences therefore remain unsupported; their next slice must include event-chain parsing/validation or remain rejected.
- Added ordered list organization normalization using existing scalar/schema helpers. Validates required/null fields, numeric positions/targets, timestamps, string/collection limits, unknown fields, group/list references, global entity IDs across organization/calendar entities and exact active-tag trim/title uniqueness. These entities have no TS omitted-field defaults; absent required fields reject. Archived duplicate tag titles remain valid.
- Added 21 real-TS fixtures: four accepted exact JSON.stringify bytes/SHA-256 cases (Unicode/control characters, negative zero, 1e20/1e21, archived facts and calendar coexistence), and 17 native rejections for types, ranges, unknown/missing fields, dates, orphan references, duplicate IDs/titles and unmodeled tasks/recurrence. Unknown-field rejection remains intentionally stricter than TS. Existing conservative timestamp/string boundaries remain unchanged.
- No LocalEvidence/prepare/confirmation/send/projection/UI/Stage 7 changes. All other nonempty collections and migration remain fail-closed. Protected research remains untouched and unstaged.

Evidence: RED failed list-core with WORKSPACE_COLLECTION_UNSUPPORTED (`task-4b-lists-red.log`); focused GREEN passed. Generator --check passed. Doctor passed with Windows filesystem probe unavailable. rust:verify passed fmt, all-target/all-feature clippy, 72 tests and both feature checks (`task-4b-lists-rust-verify.log`); existing Windows linker stdout warnings remain. Node 967/967, typecheck, desktop/Web builds passed; existing chunk-size warnings remain. Docs and diff checks passed. Exact token usage unavailable; this checkpoint does not claim the full assigned task/recurrence group complete.

Next action: implement task entities together with required taskEvents status-chain validation, then recurrence core and remaining attachment/activity/receipt/reminder parsers. LocalEvidence and future execution stay disabled until the complete parser/reference and attachment contracts are proven.

## 4B task and event-chain parser checkpoint

2026-09-09; base `2fcaf20`. Tasks and taskEvents accepted subset complete; Task 4 and 4B1b1b remain incomplete.

- Added ordered task normalization using existing scalar/schema helpers: task mode/status/priority, schedule/deadline exclusivity, learning-mode consistency, checklist uniqueness/types and required/null fields. Task fields have no omitted defaults in the TS authority; only taskEvent.occurrenceId is optional, and omission remains omitted while explicit null is preserved. Unknown fields reject recursively, intentionally stricter than TS dropping them.
- Validates task list/section ownership/tag references and duplicate tags; extends global IDs across supported entities to tasks/events. Task events require globally continuous ascending sequence, existing task IDs, initial null fromStatus, an unbroken per-task from/to chain with non-null toStatus, and final status equal to the current task. Validation is a single event pass with per-task status storage. No invented type-to-status transition policy: TS asserts chain continuity only.
- Non-null task recurrenceSeriesId and event occurrenceId/completionRecordId fail closed until their referenced collection parsers exist. Other nonempty collections and migration remain unsupported. Inherited timestamp/year/lone-surrogate boundaries remain; accepted cases have exact TS normalized bytes/hash parity, not full TS acceptance.
- Added 43 deterministic actual TS parser fixtures (7 accepted, 36 rejected): omitted/explicit-null occurrence field, planned learning task, all task status/event type chain examples including completion/reopen/delete, interleaved tasks, schedule/deadline/checklist, Unicode/control/numeric boundaries; malformed/unknown/type/range/date/reference/duplicate/sequence/chain/current-state mismatch rejections. Raw nested fields are deliberately reversed to verify normalized order.

Evidence: first focused invocation accidentally omitted all-features and ran zero tests (not counted as evidence). After correcting the command/test insertion, RED with task collection dispatch disabled failed created-omitted-occurrence with WORKSPACE_COLLECTION_UNSUPPORTED (`task-4b-tasks-red.log`); enabling dispatch passed all 6 parser tests (`task-4b-tasks-green.log`). Generator and --check passed. rust:verify passed fmt, all-target/all-feature clippy, 73 Rust tests and both feature checks (`task-4b-tasks-rust-verify.log`); an initial type-complexity lint was simplified before passing. Existing Windows linker stdout warnings remain visible. Doctor passed with Windows filesystem probe unavailable; docs and diff checks passed. Application TS logic did not change, so Node application tests/typecheck/build were not repeated; the fixture generator executes the actual TS parser directly.

No LocalEvidence, prepare, confirmation, sending, projection behavior, UI or Stage 7 change. Protected research remains untouched and unstaged. Precise remaining groups: recurrenceSeries/occurrences, studySessions/completionRecords/reviewTaskLinks, calendarEventLinks/eventOutcomes, reminders/deliveries/migration, command/legacy preview receipts, then complete reference/attachment validation and trusted LocalEvidence/hash. Accurate token usage unavailable; no exact count claimed.

### 4B1b1 native task recurrence parser slice (2026-09-09)

Completed recurrenceSeries and occurrences normalization using the existing cadence/end/date/time/timezone validators, ordered schemas, omitted schedule-to-null defaults, mandatory exclusive series/occurrence schedule values, and nullable overrides permitting neither schedule field. Task recurrence and task-event occurrence references are now validated for ownership; global IDs include series/occurrences. Completion-record references and studySessions/completionRecords/reviewTaskLinks remain fail-closed.

Validation: TS fixture generator supplies 60 recurrence cases (10 valid) within 103 task fixtures, including cadence/end variants, timestamps/defaults/overrides, unrelated calendar facts, null/missing/range/date failures, orphan/wrong-owner and duplicate IDs. Valid cases compare normalized bytes and SHA-256 exactly. TDD red: recurring-defaults failed WORKSPACE_COLLECTION_UNSUPPORTED; separate duplicate-series regression failed before adding collections to the shared global-ID validator. Final generator --check and rust:verify passed (73 Rust tests; fmt, clippy, all-features/no-default-features checks).

TS task recurrence parsing has no generated-window/originalStart/exception validation; those concepts belong to calendar recurrence and its existing parser. No additional task-occurrence invariants were invented. Existing native timestamp/year/lone-surrogate and timezone allowlist limits remain; accepted fixtures prove exact normalization parity, not complete TS acceptance. LocalEvidence/prepare remain disabled. Protected research untouched and unstaged. Remaining activity/reminder/receipt/calendar-link groups stay pending; precise token usage unavailable.

## 4B study session parser checkpoint

2026-09-09; base `dc4ce92`. Bounded split under the task budget: studySessions only. CompletionRecords/reviewTaskLinks and Task 4 remain incomplete.

- Added ordered studySessions parsing via the existing field validator. All fields are required, explicit nullable activeSince/deletedAt are preserved, and no omitted-field default is invented. Validates state, nonnegative integer elapsedSeconds, text/timestamps and running iff activeSince is non-null. Unknown fields reject, intentionally stricter than TS dropping them; inherited conservative timestamp/string/size boundaries remain.
- Includes session IDs in global uniqueness checks. Every session requires an existing task. At most one undeleted running/paused session may exist, and its task must be in_progress. Finished/deleted unrelated facts remain accepted; no extra timestamp ordering policy is imposed because the TS authority has none.
- Added 20 actual TS fixtures (4 accepted exact normalized bytes/SHA-256, 16 rejected) covering running/paused/finished/deleted facts, numeric/Unicode/control characters, omission/null, malformed fields/times, duplicate/global IDs, orphan tasks, activity count and task/state mismatches. Raw nested field order is reversed before native normalization.
- CompletionRecords/reviewTaskLinks remain unsupported, and non-null taskEvent.completionRecordId remains fail-closed. Reminders, receipts, calendar links/outcomes and migration remain unsupported. No LocalEvidence/prepare/send/projection/UI/Stage 7 changes; protected research remains untouched/unstaged.

Evidence: `task-4b-sessions-red.log` reproduces session-running rejection with WORKSPACE_COLLECTION_UNSUPPORTED. Focused all-features parser test passed; generator --check passed. First rust:verify passed fmt/clippy but failed an unrelated existing outbox cleanup test with Windows OS error 32 (file in use), preserved in `task-4b-sessions-rust-verify.log`; unchanged retry passed fmt, all-target/all-feature clippy, 73 tests and both feature checks (`task-4b-sessions-rust-verify-retry.log`). Existing linker warnings remain. Doctor passed with filesystem probe unavailable on Windows. Node tests 967/967, typecheck, desktop/Web builds passed with existing chunk-size warnings. Docs and diff checks passed. Exact token usage unavailable.

Next action: implement completionRecords together with reviewTaskLinks/completion parsing, default tagIdsSnapshot/completion, session/record/review/taskEvent ownership references and pending review invariants; then remaining attachment/receipt/reminder groups. The complete native workspace parser and LocalEvidence remain pending.

## 4B completion record parser checkpoint

2026-09-09; base `0230b02`. Bounded split: completionRecords and taskEvent completionRecordId references only. ReviewTaskLinks/completion and Task 4 remain incomplete.

- Ordered record fields, omitted tagIdsSnapshot default to [], explicit null rejection, nullable fields, enum/date/timestamp/text validation, mastery 1..5 and reviewStage 0..3 integers. Global IDs include records. Task/tag/session references, snapshot uniqueness and session/task ownership are checked. Session ID duplicates and unrelated topic snapshots remain allowed by TS.
- Task events may reference only existing same-task records. TS imposes no event-type-to-record constraint; actual captured-event fixture freezes this behavior. Live records with nextReviewOn require pending review links and remain fail-closed until review links are supported; deleted scheduled records are accepted. Nonempty reviewTaskLinks, reminders, receipts, calendar links/outcomes and migration remain unsupported. LocalEvidence/prepare remain disabled.
- 25 added actual TS fixtures: 2 accepted with exact normalized bytes/SHA-256, 23 rejected for missing/null/unknown fields, enum/numeric/date/reference/ownership/global-ID/snapshot errors and missing pending obligation. Unknown-field rejection stays intentionally stricter than TS. Inherited timestamp/timezone/string ceilings remain unchanged.

Evidence: focused RED fails record-defaults-captured-event with WORKSPACE_COLLECTION_UNSUPPORTED (`task-4b-completion-red.log`). Focused GREEN passes; generator --check and rust:verify passed fmt, clippy, all 73 tests and both feature checks (`task-4b-completion-rust-verify.log`). Existing Windows linker warnings remain. No application TS changes; Node application tests/typecheck/build were not rerun, while the fixture generator executes the actual TS parser. Protected research remains untouched/unstaged. Exact usage unavailable.

Next: implement reviewTaskLinks/completion defaulting and all pending/completed occurrence/target/deleted/stage/date/uniqueness invariants; remove the live scheduled record fail-closed guard only after matching pending obligations are validated. Continue remaining collection/attachment parser groups before LocalEvidence or prepare.

## 4B review task links and completion parser checkpoint

2026-09-09; base `0997582`. ReviewTaskLinks/completion and completion-review reference obligations implemented; Task 4 and the complete workspace parser remain incomplete.

- Ordered required fields and nested result/reviewedOn validation reuse the scalar/schema validators. Omitted or explicit-null completion normalizes to null; occurrenceId remains required nullable. Stage 0..3, enums, dates and timestamps are validated. Unknown fields reject recursively, deliberately stricter than TS dropping them; inherited timestamp/string/timezone ceilings remain.
- Global IDs now include review links. Links require existing evidence and a different learning review task; occurrence references require matching series task ownership and pending/completed status according to completedAt. Targets are unique across all links. Pending links prohibit outcomes/deleted evidence or review tasks and must match record due date/stage, with one pending link per record. Every live scheduled record requires that pending obligation, replacing the prior fail-closed guard. Completed links retain TS permissiveness for null completion, deleted history, task status, stage/date differences and occurrence completedAt; no extra policy was invented.
- Added 45 actual TS fixtures: 8 accepted with exact normalized JSON.stringify bytes/SHA-256 and 37 native rejections covering defaults, missing/null/enum/date/stage/nested shape, unknown fields, source/general/deleted task, missing/foreign occurrence, target/pending-record duplication and live obligations. TS-accepted unknown-field fixtures intentionally reject natively.

Evidence: focused RED failed review-pending-default with WORKSPACE_COLLECTION_UNSUPPORTED (`task-4b-review-red.log`); focused GREEN passed (`task-4b-review-green.log`). Final generator --check passed. rust:verify passed fmt, all-target/all-feature clippy, 73 Rust tests and all-features/no-default-features checks (`task-4b-review-rust-verify.log`); existing Windows linker stdout warnings remain. Diff check passed. Application TS logic unchanged, so Node application tests/typecheck/build were not rerun; generator invokes actual TS parser. The initial fixture-edit attempt hit Python Windows encoding before writing and its passing preexisting test was not counted as RED.

Reminders/deliveries/migration, receipts and calendar links/outcomes remain fail-closed. LocalEvidence/prepare/send, projection, UI and Stage 7 unchanged; protected research untouched/unstaged. Exact token usage unavailable. Remaining parser/attachment contracts must complete before trusted LocalEvidence/hash or future preparation is enabled.
