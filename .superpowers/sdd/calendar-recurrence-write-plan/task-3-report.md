# Task 3 report — blocked checkpoint

## Completed

- Native local staging now emits a keyring-anchored recurrence plan containing the immutable preview hash, parent identity, and for a single exception the instance identity and original start.
- A single-exception local batch reads the parent and the verified instance together, so TypeScript's existing `normalizeGoogleBatch` is the only intended projection path.
- The native-batch boundary rejects recurring resources without that frozen plan before capability-service projection.

## Evidence

- RED: `npm test -- --test-name-pattern "native write batches require" tests/calendar-native-write-runtime.test.ts` failed before the guard with `Missing expected exception`.
- GREEN: the same command passed after the guard (934/934 test process assertions).
- `npm run typecheck` passed.
- `npm run rust:verify` passed: 53/53 Rust tests, including SQLite local-ack and restored-workspace checks.
- `git diff --check` passed.

## Blocking concern

`src-tauri/src/calendar_write_projection.rs` still rejects any `recurrence` or `recurringEventId` in its independent verifier. A real staged repeating parent + exception therefore cannot be acknowledged, even though TypeScript can normalize it. Task 3 requires the Rust verifier to independently reconstruct and compare the parent RRULE, `originalStartTime` exception, cancellation/restoration, and all affected source/event facts. That work and its TS-generated cross-language recurrence fixtures remain required; this checkpoint deliberately does not claim Task 3 complete.

The protected `docs/experiments/calendar-competitor-research.md` remains unmodified and unstaged. Real sending and the UI switch remain disabled.
