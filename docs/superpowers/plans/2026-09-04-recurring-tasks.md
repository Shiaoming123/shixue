# Recurring Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add history-preserving recurrence series and independently actionable occurrences with fixed and after-completion schedules.

**Architecture:** Recurrence math is pure and timezone-aware; a materializer fills a bounded future window. Commands mutate occurrences by default and split/update the series only after an explicit edit-scope choice.

**Tech Stack:** Vue 3, TypeScript 5.6, native `Intl`, existing capability service and snapshot stores.

**Spec:** `docs/superpowers/specs/2026-09-04-shixue-time-planning-foundation.md`

## Global Constraints

- Depend on merged PR 1; do not bypass `TaskCapabilityService`.
- Add no recurrence library; use pure date helpers with explicit IANA timezone input.
- Materialize at most 90 future days and 50 pending occurrences per series.
- Completing/skipping an occurrence never overwrites prior occurrences.
- All recurrence controls use shared Listbox/Popover/Dialog/Sheet components.

---

### Task 1: Implement recurrence calculation and bounded materialization

**Files:**
- Create: `src/domain/recurrence/calculate.ts`
- Create: `src/domain/recurrence/materialize.ts`
- Test: `tests/recurrence-calculate.test.ts`
- Test: `tests/recurrence-materialize.test.ts`

**Interfaces:**
- Produces: `nextFixedOccurrence(series, after): string | null`; `nextAfterCompletion(series, completedAt): string | null`; `materializeOccurrenceWindow(state, seriesId, now): MaterializeResult`.

- [ ] **Step 1: Write table tests for cadence, month end, DST, ends, and caps**

```ts
for (const row of [
  ['weekday Friday', weekly([1,2,3,4,5]), '2026-09-04T09:00:00+08:00', '2026-09-07T09:00:00+08:00'],
  ['month clamp', monthly(31), '2026-01-31T09:00:00+08:00', '2026-02-28T09:00:00+08:00'],
] as const) test(row[0], () => assert.equal(nextFixedOccurrence(row[1], row[2]), row[3]))
```

- [ ] **Step 2: Run both files and confirm missing exports fail**

Run: `node --test --experimental-strip-types tests/recurrence-calculate.test.ts tests/recurrence-materialize.test.ts`

- [ ] **Step 3: Implement calendar arithmetic without millisecond-day shortcuts**

```ts
export const OCCURRENCE_HORIZON_DAYS = 90
export const MAX_PENDING_OCCURRENCES = 50

export function materializeOccurrenceWindow(state: WorkspaceStateV3, seriesId: string, now: string): MaterializeResult {
  const series = requireSeries(state, seriesId)
  if (series.basis === 'after_completion') return materializeFirstIfEmpty(state, series)
  return fillFixedWindow(state, series, now, OCCURRENCE_HORIZON_DAYS, MAX_PENDING_OCCURRENCES)
}
```

- [ ] **Step 4: Run focused tests and verify deterministic IDs**

Expected: PASS; calling materialize twice returns no new items the second time.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/recurrence tests/recurrence-calculate.test.ts tests/recurrence-materialize.test.ts
git commit -m "feat: calculate bounded recurrence occurrences"
```

### Task 2: Add recurrence commands and edit scopes

**Files:**
- Create: `src/domain/capabilities/recurrence-commands.ts`
- Modify: `src/domain/capabilities/catalog.ts`
- Modify: `src/domain/capabilities/service.ts`
- Test: `tests/recurrence-commands.test.ts`

**Interfaces:**
- Produces commands: `recurrence.create`, `recurrence.update`, `recurrence.complete`, `recurrence.skip`; `scope: 'occurrence' | 'future' | 'series'` for update.

- [ ] **Step 1: Write tests for completion, skip, occurrence override, future split, and whole-series preview**

```ts
test('future edit closes the old series and creates a deterministic successor', async () => {
  const preview = await service.preview(envelope({ type: 'recurrence.update', occurrenceId: 'occ:4', scope: 'future', cadence: weekly([2,4]) }))
  assert.equal(preview.confirmation, 'explicit')
  const result = await service.execute(confirm(preview))
  assert.deepEqual(result.affected.map(x => x.kind), ['occurrence', 'recurrenceSeries'])
  assert.equal(await occurrenceStatus('occ:1'), 'completed')
})
```

- [ ] **Step 2: Run and verify unregistered command failures**

Run: `node --test --experimental-strip-types tests/recurrence-commands.test.ts`

- [ ] **Step 3: Implement occurrence-first mutation and series splitting**

Whole-series and future updates require preview; complete/skip current are reversible single-item operations. After-completion creates the next occurrence only after completion and uses the completion instant as its basis.

- [ ] **Step 4: Run recurrence and capability suites**

Run: `node --test --experimental-strip-types tests/recurrence-commands.test.ts tests/capability-service.test.ts tests/recurrence-materialize.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/domain/capabilities tests/recurrence-commands.test.ts
git commit -m "feat: add scoped recurrence commands"
```

### Task 3: Build recurrence editor and occurrence rows

**Files:**
- Create: `src/components/study/RecurrenceEditor.vue`
- Create: `src/components/study/RecurrenceScopeDialog.vue`
- Create: `src/components/study/OccurrenceRow.vue`
- Test: `tests/recurrence-ui-contract.test.ts`
- Modify: `src/components/study/TaskEditSheet.vue`
- Modify: `src/components/study/TasksView.vue`

**Interfaces:**
- Consumes: shared `Listbox`, `Popover`, `Dialog`, capability preview/execute.
- Produces: `RecurrenceEditor` emitting `save(rule)`; scope dialog showing affected count from `CommandPreview`.

- [ ] **Step 1: Write UI contract tests for all choices and no native select**

```ts
assert.match(source('RecurrenceScopeDialog.vue'), /本次及以后/)
assert.doesNotMatch(source('RecurrenceEditor.vue'), /<select\b/)
assert.match(source('RecurrenceEditor.vue'), /fixed_schedule|after_completion/)
```

- [ ] **Step 2: Run test and confirm components are missing**

Run: `node --test --experimental-strip-types tests/recurrence-ui-contract.test.ts`

- [ ] **Step 3: Implement concise editor and preview-driven scope dialog**

Use presets for daily, weekdays, weekly, monthly, yearly; “自定义” reveals interval, weekdays, basis and end condition. The dialog displays entity count and examples, not implementation prose.

- [ ] **Step 4: Run UI and navigation tests**

Run: `node --test --experimental-strip-types tests/recurrence-ui-contract.test.ts tests/web-navigation.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/components/study tests/recurrence-ui-contract.test.ts
git commit -m "feat: add recurring task editor"
```

### Task 4: Integrate recurrence projections and complete PR gates

**Files:**
- Modify: `src/lib/study-task-query.ts`
- Modify: `src/components/study/TodayView.vue`
- Modify: `src/components/study/TaskDetailDrawer.vue`
- Test: `tests/recurrence-projection.test.ts`
- Modify: `docs/todofy-benchmark.md`

**Interfaces:**
- Produces: `projectTaskItems(state, range): TaskProjection[]` with stable key `task:<id>` or `occurrence:<id>`.

- [ ] **Step 1: Write a Today deduplication test**

```ts
test('one occurrence with planned and due-today reasons renders once', () => {
  const rows = projectTaskItems(fixture(), todayRange)
  assert.equal(rows.filter(x => x.occurrenceId === 'occ:today').length, 1)
  assert.deepEqual(rows.find(x => x.occurrenceId === 'occ:today')?.reasons, ['planned', 'due'])
})
```

- [ ] **Step 2: Run and confirm the projection lacks occurrences**

- [ ] **Step 3: Implement projection and wire rows/detail actions**

Never synthesize completion by advancing task dates. Display the occurrence schedule and the task deadline independently.

- [ ] **Step 4: Run full gates**

Run: `npm test; npm run typecheck; npm run build; npm run build:web; npm run check:docs; git diff --check`

Expected: all exit 0; recurrence tests include no skipped cases.

- [ ] **Step 5: Commit and push PR 2**

```powershell
git add src/lib/study-task-query.ts src/components/study docs/todofy-benchmark.md tests/recurrence-projection.test.ts
git commit -m "feat: project recurring tasks across views"
git push -u origin feat/recurring-task-occurrences
```
