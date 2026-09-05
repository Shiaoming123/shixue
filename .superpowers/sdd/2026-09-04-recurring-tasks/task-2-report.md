# Task 2 Report

## Status
- DONE

## Files Changed
- `src/domain/capabilities/recurrence-commands.ts`
- `src/domain/capabilities/catalog.ts`
- `src/domain/capabilities/service.ts`
- `src/domain/capabilities/types.ts`
- `src/domain/workspace/parse.ts`
- `tests/capability-service.test.ts`
- `tests/recurrence-commands.test.ts`

## Decisions
- Added `recurrence.create`, `recurrence.update`, `recurrence.complete`, and `recurrence.skip` as first-class capability commands routed only through `TaskCapabilityService`.
- Kept recurrence command execution inside the existing service preview/execute path, so workspace CAS, idempotency fingerprints, receipts, audit queries, and undo tokens remain centralized.
- Added recurrence-aware undo compensation that restores task recurrence links, series snapshots, occurrence snapshots, and removes successor records created by a command.
- Implemented occurrence-scoped updates as occurrence overrides without mutating the series.
- Implemented future-scoped updates by closing the previous series before the target occurrence and creating a deterministic successor id in the form `<seriesId>:split:<ordinal>`.
- Kept completed occurrence history on the old series during future splits.
- Implemented after-completion successor creation only from `recurrence.complete`, using `nextAfterCompletion(series, completedAt)`.
- Made whole recurrence update metadata explicit-preview by cataloging `recurrence.update` as high-risk series scope.
- Made a minimal parser compatibility adjustment so closed historical series may remain attached to the same task while the task points at the active successor series.

## Tests
- `node --test --experimental-strip-types tests/recurrence-commands.test.ts tests/capability-service.test.ts tests/recurrence-materialize.test.ts`

## Output
- 46 tests passed, 0 failed.

## Additional Check
- `npm run typecheck`
- Result: not run to completion because this isolated worktree has no `node_modules` and `vue-tsc` is not available on PATH: `'vue-tsc' is not recognized as an internal or external command`.

## Concerns
- `recurrence.update` uses a static high-risk catalog descriptor, so occurrence-scoped update previews are also marked explicit even though the strict requirement only names future and series updates.
- Future split support required loosening the workspace parser invariant for closed historical series; this preserves history but should be revisited if the schema later models active versus historical series explicitly.

## Review Fix
- Added a service-level explicit confirmation gate for `recurrence.update` with `future` and `series` scopes. The preview response now returns a request fingerprint, and execute requires `explicitConfirmation.previewFingerprint` plus a valid `confirmedAt` bound to the same canonical request fingerprint.
- Kept occurrence-scoped recurrence updates executable without explicit confirmation and reversible through the existing undo token path.
- Added optional `task.create.recurrence` config so a single task create command can atomically create the task, recurrence series, and first occurrence.
- Extended `task.remove_created` undo compensation so recurrence rows created with a new task are removed with that task.
- Fixed future split successor construction to preserve unspecified original series fields. For `end.after`, the count is interpreted as series-local total occurrences, so a successor receives the remaining count from the split occurrence onward.
- Updated whole-series mutation to recompute materialized pending occurrence dates from the edited series, clear stale occurrence overrides, cancel pending rows outside the new end, and preserve completed/skipped history.
- Kept previous high-risk preview metadata for existing non-recurrence commands without making execute require new confirmation fields.

## Review Fix Tests
- `node --test --experimental-strip-types tests/recurrence-commands.test.ts tests/capability-service.test.ts tests/recurrence-materialize.test.ts`

## Review Fix Output
- 50 tests passed, 0 failed.

## Review Fix Concerns
- `npm run typecheck` remains unavailable in this isolated worktree because `node_modules` is absent and `vue-tsc` is not on PATH.
