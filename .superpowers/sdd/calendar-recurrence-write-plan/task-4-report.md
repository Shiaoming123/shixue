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
