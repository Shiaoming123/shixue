# Task 3 Report

## Status
- DONE

## Files Changed
- `src/components/study/RecurrenceEditor.vue`
- `src/components/study/RecurrenceScopeDialog.vue`
- `src/components/study/OccurrenceRow.vue`
- `src/components/study/TaskEditSheet.vue`
- `src/components/study/TasksView.vue`
- `tests/recurrence-ui-contract.test.ts`

## Decisions
- The recurrence editor is a thin UI adapter: it emits a typed `save(rule)` payload and uses shared `Listbox`, `Input`, and `Button` controls instead of visible native select or browser-default fields.
- Presets cover daily, weekdays, weekly, monthly, and yearly. Custom mode exposes interval, weekday selection, fixed-schedule versus after-completion basis, and never/date/count end conditions.
- The scope dialog consumes `CommandPreview`, presents 本次 / 本次及以后 / 整个系列, reports the affected entity count, and blocks execution until an accepted preview exists.
- `OccurrenceRow` emits only complete, skip, and reschedule intent keyed by occurrence id. It does not receive or mutate task planned/due dates.
- `TaskEditSheet` exposes the recurrence editor through an explicit `recurrenceSave` event. `TasksView` accepts optional occurrence projections and delegates their actions through occurrence-specific events; current task projections are intentionally unchanged for Task 4.

## Tests
- `node --test --experimental-strip-types tests/recurrence-ui-contract.test.ts tests/web-navigation.test.ts`
- Result: 4 passed, 0 failed.
- `node --test --experimental-strip-types tests/recurrence-commands.test.ts`
- Result: 11 passed, 0 failed.
- `git diff --check`
- Result: passed.

## Concerns
- The isolated worktree has no `node_modules`, so `npm run typecheck` and Vue compilation were not run; Task 3's requested focused source-contract checks passed.
- App-level recurrence projection and capability-service wiring remain deliberately deferred to Task 4, which owns the occurrence projection boundary.

## Review Fix
- Wired the editor through `App.vue` into the existing `TaskCapabilityService`: scoped recurrence edits now preview first and execute only through the capability service; complete and skip occurrence actions use their corresponding capability commands.
- Loaded an existing task's current recurrence series into `TaskEditSheet` and selected its matching preset (or custom mode), so opening the editor does not silently reset an existing rule to daily.
- Replaced the optional occurrence field and non-null assertion in `TasksView` with a typed `OccurrenceViewItem` input, which keeps occurrence rows type-safe.
- Scope changes clear the in-memory preview envelope and increment a request version; late results from an earlier scope cannot restore a stale preview/confirmation handle.
- Kept the recurrence snapshot read-only in the UI. All mutations remain in `TaskCapabilityService`; no workspace snapshot is written directly.

## Review Fix Tests
- `node --test --experimental-strip-types tests/recurrence-ui-contract.test.ts tests/web-navigation.test.ts`
- Result: 5 passed, 0 failed.
- `node --test --experimental-strip-types tests/recurrence-commands.test.ts tests/capability-service.test.ts`
- Result: 47 passed, 0 failed.
- `git diff --check`
- Result: passed.

## Review Fix Concerns
- Reschedule remains an explicitly surfaced occurrence intent; choosing a replacement timestamp needs the occurrence-specific picker/projection work assigned to Task 4, so this repair does not invent a date or mutate a task date.
- The isolated worktree still has no `node_modules`, so Vue typecheck/build could not run.
