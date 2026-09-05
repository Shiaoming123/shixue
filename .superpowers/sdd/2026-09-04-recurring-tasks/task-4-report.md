# Task 4 Report

## Status
- DONE

## Files Changed
- `src/lib/study-task-query.ts`
- `src/components/study/TodayView.vue`
- `src/components/study/TaskDetailDrawer.vue`
- `tests/recurrence-projection.test.ts`
- `docs/todofy-benchmark.md`
- Gate-clearing only: `src/components/study/RecurrenceEditor.vue`
- Gate-clearing only: `src/domain/capabilities/recurrence-commands.ts`
- Gate-clearing only: `src/domain/capabilities/service.ts`
- Gate-clearing only: `src/domain/recurrence/calculate.ts`

## Decisions
- Added pure `projectTaskItems(state, { from, to })` with inclusive local-date bounds and stable `task:<id>` / `occurrence:<id>` keys.
- Recurring task definitions project through their independent occurrences, so one occurrence with planned and due-today sources produces one row and retains both reasons in stable order.
- Occurrence schedule and parent task deadline remain separate projection and UI fields. Completing or skipping never advances task dates.
- Today and detail components emit the Task 3 intent names `occurrenceComplete`, `occurrenceSkip`, and `occurrenceReschedule`; they do not write workspace state.
- Added visible Today reason markers using the locked semantic tokens and no native visible controls.
- Cleared four pre-existing Task 1–3 TypeScript errors with no behavior expansion so Task 4's requested typecheck/build gates could run.

## Verification
- RED: `node --test --experimental-strip-types tests/recurrence-projection.test.ts`
  - Missing `projectTaskItems` export: 1 failed as expected.
- RED range guard: same command after adding a future occurrence fixture
  - Future occurrence leaked through parent dates: 1 failed as expected.
- Focused: `node --test --experimental-strip-types tests/recurrence-projection.test.ts tests/recurrence-ui-contract.test.ts tests/study-task-query.test.ts`
  - 15 passed, 0 failed, 0 skipped.
- `npm run typecheck`
  - Exit 0.
- `npm run build`
  - Exit 0; Vite transformed 2063 modules.
- `git diff --check`
  - Exit 0; only line-ending conversion warnings.
- Dependency preparation: `npm ci`
  - Exit 0; 87 packages installed, 0 vulnerabilities reported.

## Earlier Checks Before Verification Scope Was Narrowed
- `node --test --experimental-strip-types tests/recurrence-projection.test.ts tests/recurrence-ui-contract.test.ts tests/study-task-query.test.ts tests/recurrence-commands.test.ts tests/capability-service.test.ts`
  - 62 passed, 0 failed, 0 skipped.
- `npm run build:web`
  - Exit 0.
- `npm run check:docs`
  - Exit 0.

## NOT_RUN
- Full `npm test`: NOT_RUN per the latest verification boundary; no full-suite claim is made.
- Visual screenshot/state-matrix run: NOT_RUN because Task 4 reused the locked visual mode and the latest boundary limited verification to focused tests/typecheck/build.
- Push/PR creation: NOT_RUN; this task requested a focused local commit only.

## Hard-boundary follow-up
- Added the mutually exclusive recurrence schedule pairs `anchorAt` / `anchorOn` and `scheduledAt` / `scheduledOn`; date-only values remain calendar dates and are never serialized as synthetic midnight timestamps.
- Kept legacy timestamp exports lossless while normalizing omitted date-only fields to `null`. The parser rejects series, occurrences, or overrides that contain both schedule representations.
- Fixed-schedule and after-completion calculations now resolve date-only values against the series' explicit IANA timezone, including across different host timezones.
- Materialization, capability commands, updates/splits, workspace parsing, serialization, and task projection use the same resolved timed/date-only schedule contract.
- Wired the mounted `App.vue` Today route to `projectTaskItems`; recurring rows retain occurrence identity, remain visible when there are no ordinary task rows, and open occurrence-aware detail actions.
- Updated `app.protocol.json`, its checker, and only the related protocol/spec/boundary documentation. No iOS delivery claim was changed.
- RED: `node --test --experimental-strip-types tests/recurrence-schedule-contract.test.ts`
  - 0 passed, 4 failed before the schema and scheduling implementation existed.
- Focused final: `node --test --experimental-strip-types tests/recurrence-schedule-contract.test.ts tests/recurrence-projection.test.ts tests/recurrence-calculate.test.ts tests/recurrence-materialize.test.ts tests/recurrence-commands.test.ts tests/workspace-state-v3.test.ts tests/app-protocol.test.ts`
  - 48 passed, 0 failed, 0 skipped.
- `npm run check:protocol`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; Vite transformed 2063 modules.
- `git diff --check`: exit 0; only line-ending conversion warnings.

## Remaining concerns
- Pre-existing untracked `.superpowers/sdd/2026-09-04-recurring-tasks/{progress,task-1-brief,task-2-brief,task-3-brief,task-4-brief}.md` files were left untouched and excluded from the commit.

## Whole-PR review fixes
- After-completion cadence now advances from the actual completion instant in the series timezone instead of returning to the original anchor grid.
- Fixed-schedule materialization honors both `end.after` and `end.on`, counts existing pending occurrences once, and keeps the total pending window at or below 50.
- `task.create`, `recurrence.create`, fixed occurrence completion, and recurrence updates invoke bounded materialization inside the same capability transaction.
- Invalid IANA timezones fail closed. Nonexistent DST wall times use a documented shift-forward policy; overlaps choose the first matching instant.
- Preview confirmation handles are ephemeral and bound to the service instance, idempotency key, canonical request fingerprint, workspace revision, command type, and expiry. Legacy persisted `previewReceipts` are validated and discarded as a transitional no-op.
- Recurrence complete, skip, and update commands append durable task audit events carrying the occurrence id.
- The mounted UI can create a first recurrence, follows the task's active series after a split, preserves monthly/yearly cadence fields, and executes an occurrence-scoped reschedule command.
- Today projection keeps one occurrence row when the parent deadline is in range even if the occurrence schedule is outside it, while retaining separate schedule and deadline fields.

## Whole-PR review verification
- RED recurrence calculation/materialization: 11 passed, 5 failed before the fixes.
- RED recurrence commands: 9 passed, 5 failed before the fixes.
- RED Today projection: 5 passed, 1 failed before the fix.
- RED reachable recurrence UI: 3 passed, 2 failed before the fixes.
- Focused final: `node --test --experimental-strip-types tests/recurrence-calculate.test.ts tests/recurrence-materialize.test.ts tests/recurrence-commands.test.ts tests/capability-service.test.ts tests/recurrence-schedule-contract.test.ts tests/recurrence-projection.test.ts tests/recurrence-ui-contract.test.ts tests/workspace-state-v3.test.ts tests/app-protocol.test.ts`
  - 100 passed, 0 failed, 0 skipped.
- `npm run check:protocol`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; Vite transformed 2068 modules.
- `git diff --check`: exit 0; only line-ending conversion warnings.
- Full `npm test`: NOT_RUN per the requested verification boundary.
- Visual screenshot/state-matrix run: NOT_RUN; no new visual claim is made.
- Push/PR creation: NOT_RUN; this work remains a focused local commit.

## Scoped review follow-up
- After-completion weekly cadence is defined as completion-local date plus `interval` weeks, followed by the first allowed `weekdays` on or after that date. Monthly and yearly cadence preserve the completion-local day/month rather than the series anchor fields, with short-month and leap-day clamping.
- Today deadline fallback now checks for a visible pending occurrence projection. A completed occurrence in range no longer suppresses the future pending row that carries the independent parent deadline into Today.
- RED: `node --test --experimental-strip-types tests/recurrence-calculate.test.ts tests/recurrence-projection.test.ts`
  - 16 passed, 3 failed before the fixes: monthly completion basis, yearly completion basis, and completed-history Today fallback.
- RED no-pending guard: `node --test --experimental-strip-types tests/recurrence-projection.test.ts`
  - 7 passed, 1 failed before adding the parent-task deadline fallback.
- Focused final: `node --test --experimental-strip-types tests/recurrence-calculate.test.ts tests/recurrence-projection.test.ts tests/recurrence-commands.test.ts`
  - 35 passed, 0 failed, 0 skipped.
- `npm run check:protocol`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; Vite transformed 2068 modules.
- Full `npm test`, visual verification, push, and PR creation remain NOT_RUN per the scoped review boundary.
