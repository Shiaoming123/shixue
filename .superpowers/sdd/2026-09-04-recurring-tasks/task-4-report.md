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
