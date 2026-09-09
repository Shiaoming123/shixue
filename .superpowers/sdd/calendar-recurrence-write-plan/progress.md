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
