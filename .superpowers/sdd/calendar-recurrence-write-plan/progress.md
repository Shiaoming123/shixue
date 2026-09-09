# SDD ledger — plan: docs/experiments/calendar-recurrence-write-plan.md

## Preflight interface and conflict map

| Producer | Consumer | Contract at risk | Ruling |
| --- | --- | --- | --- |
| Task 1 | Task 2 | TypeScript intent, preview, serialization, and hash | Rust must consume the exact frozen payload and hash; do not reinterpret it. |
| Task 2 | Task 3 | Native plan and result | Local batch and projection bind to the native root operation and verified result. |
| Task 3 | Task 4 | Atomic recurrence projection | A future split may project parent and successor only through one proven local batch. |
| Task 1 | Task 4 | Lock keys and intent shape | Extend the single/series root contract; do not add an independent child operation. |
| Task 4 | Task 5 | Recovery state and evidence | Final validation must cover interruption, reconciliation, and projection. |

## Rulings

- Ordinary `pullChanges` recurrence normalization is outside Task 1 unless the write round trip requires it. Cost if wrong: the read path can still report an otherwise writable recurrence as unsupported; disclose it rather than expanding scope silently.
- Task 4 opens “this and following” only when local links, outcomes, reminders, and unmodeled exceptions are absent. Cost if wrong: attached series stay read-only for that scope until an explicit migration rule exists.
- Recurrence removal uses cancellation markers. Remote `DELETE` remains unsupported because a missing resource cannot prove authorship.
- Real Google sending and the product write switch remain disabled throughout this plan.

## Progress

- [x] Task 1: TypeScript recurrence contract and fake adapter — `93fad43`, `99c582d`, `e1337a7`, `1eebcfc`, `71af421`; task review approved after four focused fix rounds; focused tests/typecheck/full `npm test` 933/933 passed.
- [x] Task 2: Native single/series trusted state machine — `963c4ff`, `19f74d0`; task review approved; exact recurrence regression 1/1 and `npm run rust:verify` 53/53 passed with enabled/disabled feature checks.
- [x] Task 3: Local recurrence projection and receipt — `66ef859`, `4f6e0ef`, `a0fa1d5`, `7330f58`, `0ce2359`, `7d41b0d`, `811f693`, `7c2e283`, `0e3d235`, `f6e7fb6`; TS and Rust scoped reviews approved; Node 939/939 and Rust 58/58 evidence recorded.
- [ ] Task 4: Future-split recovery state machine
- [ ] Task 5: Final validation and checkpoint

## Current checkpoint

- Branch: `feat/calendar-recurrence-write`
- Latest implementation slice: 4B1b2b native future prepare/confirmation/anchoring, based on `d5548e5`; see task-4-report.md for evidence.
- Protected untracked file: `docs/experiments/calendar-competitor-research.md` (untouched and unstaged)
- Next action: review 4B1b2b native prepare/confirmation/anchor integration; then continue separately authorized sender/recovery/local projection work. Task 4 remains incomplete.

### 4B1c1a checkpoint

Internal test-only parent/successor request/proof helper and 150 actual TS adapter fixtures implemented; RED/GREEN and rust:verify (80 tests) pass. Execute/reconcile remain unsupported. Next: resolve duplicate-provider-key parsing before sender wiring, then implement phase persistence/authorization and read-only recovery separately. Full Task 4 remains incomplete; see task-4-report.md. Protected research unchanged.


### 4B1c1b checkpoint

Shared read_body rejects recursive duplicate provider JSON keys while retaining Value scalar semantics and HTTP/size behavior. Actual response-path RED/GREEN, rust:verify (82 tests), standalone calendar-connections feature check, docs and diff checks pass. Next: review this boundary fix, then separately implement the sender phase persistence/authorization and read-only recovery. Full Task 4 remains incomplete; protected research unchanged. See task-4-report.md for evidence.

### 4B1c1c checkpoint

Unwired parent-phase transition now persists applying before its single PATCH, GET-proves the result and uses GET-only unknown/restart recovery. Focused fake/SQLite checks and rust:verify (83 tests) pass. Root lock remains held; successor/compensation/projection are pending. Baseline RED was verified retrospectively against the existing execute rejection. Next: review this slice, then add successor-phase continuation and complete root authorization/lease integration before command wiring. See task-4-report.md for limits; protected research unchanged.

### 4B1c1d checkpoint

Test-only successor continuation now anchors applying before its single POST, GET-proves the fixed child, and persists the exact successful future root result. Unknown/restart is GET-only; deterministic child rejection retains the root lock for compensation. RED/GREEN and rust:verify (84 tests) pass; no command/projection/UI wiring. Next: review the internal phase implementation, then address remaining root authorization/lease/routing and compensation boundaries separately. See task-4-report.md; Task 4 remains incomplete.

### 4B1c2a checkpoint

Internal compensation now anchors latest ETag before one restore PATCH, requires exact GET proof, and recovers applying/unknown phases with GET only. Successor conflict and rejected/divergent restore retain a durable conflict lock; proved compensation releases it with COMPENSATED. RED/GREEN and final rust:verify (85 tests) pass; one unchanged Windows temporary-file cleanup failure passed on full retry. No production/lease/projection wiring. Next: review compensation and shared lock compatibility, then finish the remaining production authorization/routing boundary. See task-4-report.md; protected research unchanged.

### 4B1c3a checkpoint

Production-compilable internal saga now owns Run/Reconcile routing and one injectable invocation deadline. The eventual command caller owns WRITE_GATE; phase helpers never acquire it. Run advances only pending phases; reconcile resolves applying/unknown via GET only and returns before the next pending phase. New routing/deadline/caller-held-gate tests pass alongside prior phase recovery tests. Command wiring, durable cross-process lease, local projection and real provider validation remain outside this slice; Task 4 remains incomplete. See task-4-report.md. Protected research untouched.


### 4B1c3b checkpoint

Production execute/Run/Reconcile now route future records to the reviewed saga under the command-owned WRITE_GATE and one 30-second monotonic invocation deadline. Initial Run still consumes a confirmation ticket; native-anchored applying/unknown future progress may resume after volatile tickets disappear. Reconcile remains GET-only and never starts a pending successor/compensation. Runtime ENABLED remains false with no enable command. RED/GREEN and rust:verify (91 tests) pass; command guard proof is unit/source-level, not native command E2E. No local future projection, UI, real Google or Stage 7. Next: review this slice before separately authorized 4B2. Task 4 remains incomplete; research untouched/unstaged.


#### 4B1c3b P2 transport review checkpoint

Future Run now reuses its exact invocation guard at the GoogleHttp send boundary after token authorization awaits. The new delayed-authorization fake guard test proves zero send on expiry/authority changes; GET and nonfuture paths remain unchanged. RED/GREEN and rust:verify 92/92 pass. Continue review of this slice; Task 4 remains incomplete and 4B2 is not implemented.
