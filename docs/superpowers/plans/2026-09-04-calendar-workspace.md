# Calendar Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add day, week, month, and agenda planning views with an unscheduled tray, preview-first drag/resize, and complete keyboard alternatives.

**Architecture:** Pure range/layout functions project tasks and occurrences into calendar items. Pointer interactions maintain ephemeral previews only; release invokes calendar capability commands, allowing CAS failure to roll back without patching UI state.

**Tech Stack:** Vue 3, TypeScript 5.6, Pointer Events, CSS Grid, existing capability and themed overlay systems.

**Spec:** `docs/superpowers/specs/2026-09-04-shixue-time-planning-foundation.md`

## Global Constraints

- Depend on merged PRs 1–4.
- Add no calendar or drag-and-drop library.
- Deadline-only tasks do not occupy time slots; a timed block requires `schedule.startAt` and `estimateMinutes`.
- Dragging a recurring occurrence defaults to occurrence-only scope.
- Every pointer operation has a visible menu/keyboard alternative.
- Fixed viewports and visual states in `VISUAL_QA.md` are release gates.

---

### Task 1: Implement calendar range projection and collision layout

**Files:**
- Create: `src/domain/calendar/range.ts`
- Create: `src/domain/calendar/project.ts`
- Create: `src/domain/calendar/layout.ts`
- Test: `tests/calendar-projection.test.ts`
- Test: `tests/calendar-layout.test.ts`

**Interfaces:**
- Produces: `calendarRange(view, anchor, weekStartsOn)`, `projectCalendarItems(state, range)`, `layoutTimedItems(items)`.

- [ ] **Step 1: Write tests for all-day, timed, deadline-only, overlaps, DST, and occurrence overrides**

```ts
test('deadline-only task is a marker rather than a timed block', () => {
  const items = projectCalendarItems(fixture({ dueAt: '2026-09-04T16:00:00+08:00', startAt: null }), dayRange)
  assert.equal(items[0].kind, 'deadline-marker')
})

test('overlapping blocks receive stable columns', () => {
  assert.deepEqual(layoutTimedItems(overlapFixture()).map(x => [x.column, x.columnCount]), [[0, 2], [1, 2]])
})
```

- [ ] **Step 2: Run and confirm missing projection modules**

Run: `node --test --experimental-strip-types tests/calendar-projection.test.ts tests/calendar-layout.test.ts`

- [ ] **Step 3: Implement pure inclusive/exclusive range math**

```ts
export interface CalendarItem {
  key: string
  taskId: string
  occurrenceId: string | null
  kind: 'timed' | 'all-day' | 'deadline-marker'
  start: string
  end: string | null
}
```

Sort by start, duration descending, then stable key. Never mutate the input arrays.

- [ ] **Step 4: Run focused tests in two timezones**

Run: `$env:TZ='Asia/Shanghai'; node --test --experimental-strip-types tests/calendar-projection.test.ts tests/calendar-layout.test.ts`

Run: `$env:TZ='America/Los_Angeles'; node --test --experimental-strip-types tests/calendar-projection.test.ts tests/calendar-layout.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/domain/calendar tests/calendar-projection.test.ts tests/calendar-layout.test.ts
git commit -m "feat: project tasks into calendar ranges"
```

### Task 2: Add calendar move and resize commands

**Files:**
- Create: `src/domain/capabilities/calendar-commands.ts`
- Modify: `src/domain/capabilities/catalog.ts`
- Test: `tests/calendar-commands.test.ts`

**Interfaces:**
- Produces: `calendar.move { taskId, occurrenceId?, startAt?, startOn?, scope }`; `calendar.resize { taskId, occurrenceId?, estimateMinutes, scope }`.

- [ ] **Step 1: Write move/resize, recurrence default, invalid duration, and CAS rollback tests**

```ts
test('moving an occurrence defaults to an override', async () => {
  await service.execute(envelope({ type: 'calendar.move', taskId: 'task:r', occurrenceId: 'occ:2', startAt: '2026-09-05T10:00:00+08:00', scope: 'occurrence' }))
  assert.equal((await occurrence('occ:2')).override?.scheduledAt, '2026-09-05T10:00:00+08:00')
  assert.equal((await series('series:1')).anchorAt, originalAnchor)
})
```

- [ ] **Step 2: Run and verify commands are unregistered**

Run: `node --test --experimental-strip-types tests/calendar-commands.test.ts`

- [ ] **Step 3: Implement commands using existing recurrence scope functions**

Accept durations from 5 to 1440 minutes in 5-minute steps. Moving to an all-day slot sets `startOn` and clears `startAt`; moving to a time slot does the inverse.

- [ ] **Step 4: Run calendar, recurrence, and capability tests**

Run: `node --test --experimental-strip-types tests/calendar-commands.test.ts tests/recurrence-commands.test.ts tests/capability-service.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/domain/capabilities/calendar-commands.ts src/domain/capabilities/catalog.ts tests/calendar-commands.test.ts
git commit -m "feat: add calendar scheduling commands"
```

### Task 3: Build day/week calendar and unscheduled tray

**Files:**
- Create: `src/components/calendar/CalendarWorkspace.vue`
- Create: `src/components/calendar/CalendarToolbar.vue`
- Create: `src/components/calendar/TimeGrid.vue`
- Create: `src/components/calendar/CalendarItem.vue`
- Create: `src/components/calendar/UnscheduledTray.vue`
- Create: `src/components/calendar/use-calendar-drag.ts`
- Test: `tests/calendar-ui-contract.test.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: projection/layout functions and calendar commands.
- Produces: view state `{ mode, anchor }`; drag preview `{ itemKey, proposedStart, proposedDuration, valid, conflict }`.

- [ ] **Step 1: Write source contracts for Pointer Events, preview-only state, and keyboard commands**

```ts
assert.match(source('use-calendar-drag.ts'), /pointerId|setPointerCapture/)
assert.match(source('CalendarItem.vue'), /Alt\+Arrow|aria-label/)
assert.doesNotMatch(source('CalendarWorkspace.vue'), /draggable=["']true["']/)
```

- [ ] **Step 2: Run and confirm components are missing**

- [ ] **Step 3: Implement day/week grid with one memorable time spine**

Use CSS Grid, a themed current-time line, 15-minute snap and half-hour visual lines. Pointer move updates only preview; pointer up executes once. Failure clears preview, returns the item to its source and emits an undo/error toast.

- [ ] **Step 4: Implement unscheduled tray and keyboard alternative**

The tray queries active tasks without schedule. Its item menu uses DatePicker/TimePicker; selected calendar items support Alt+arrow move and Shift+Alt+up/down duration changes.

- [ ] **Step 5: Run UI contract and navigation tests, then commit**

Run: `node --test --experimental-strip-types tests/calendar-ui-contract.test.ts tests/web-navigation.test.ts`

```powershell
git add src/components/calendar src/App.vue tests/calendar-ui-contract.test.ts
git commit -m "feat: add day and week planning calendar"
```

### Task 4: Add month and agenda views with responsive mode switching

**Files:**
- Create: `src/components/calendar/MonthGrid.vue`
- Create: `src/components/calendar/AgendaView.vue`
- Modify: `src/components/calendar/CalendarWorkspace.vue`
- Modify: `src/lib/planning-preferences.ts`
- Test: `tests/calendar-responsive.test.ts`

**Interfaces:**
- Consumes: same `CalendarItem[]` projection.
- Produces: all four view modes; persisted `defaultCalendarView` and last desktop view.

- [ ] **Step 1: Write tests for view selection and 819px fallback**

```ts
assert.equal(resolveCalendarMode('week', 390), 'day')
assert.equal(resolveCalendarMode('agenda', 390), 'agenda')
assert.equal(resolveCalendarMode('month', 1440), 'month')
```

- [ ] **Step 2: Run and verify resolver is missing**

- [ ] **Step 3: Implement month overflow and agenda grouping**

Month cells show at most three rows then a themed “+N” button; opening it uses Popover on desktop and Sheet on narrow screens. Agenda groups by local day and virtualizes only after measured data exceeds 500 rows.

- [ ] **Step 4: Run responsive and projection tests**

Run: `node --test --experimental-strip-types tests/calendar-responsive.test.ts tests/calendar-projection.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/components/calendar src/lib/planning-preferences.ts tests/calendar-responsive.test.ts
git commit -m "feat: add month and agenda calendar views"
```

### Task 5: Complete visual and performance acceptance

**Files:**
- Create: `scripts/smoke-calendar.mjs`
- Modify: `package.json`
- Modify: `docs/design/fidelity-ledger.md`
- Modify: `docs/todofy-benchmark.md`

**Interfaces:**
- Produces: `npm run smoke:calendar`; uncommitted screenshots under `artifacts/visual-qa/calendar/`.

- [ ] **Step 1: Script the representative journey**

Seed overlapping tasks, deadline-only task, repeating occurrence and unscheduled task; drag the unscheduled task into week view, resize it, switch month/agenda, use keyboard move, reload and assert persistence plus zero console/page errors.

- [ ] **Step 2: Add 10k/50k projection benchmark assertion**

Fail when Today/7-day exceeds 100ms or calendar range exceeds 150ms in a production Node run on the recorded host; print counts and elapsed time only, never task contents.

- [ ] **Step 3: Capture and inspect all five `VISUAL_QA.md` viewports**

Open date Listbox, drag preview and mobile Sheet states. Any visible native control, clipped overlay or horizontal page scroll fails acceptance.

- [ ] **Step 4: Run full gates**

Run: `npm test; npm run typecheck; npm run build; npm run build:web; npm run smoke:calendar; npm run check:docs; git diff --check`

- [ ] **Step 5: Commit and push PR 5**

```powershell
git add scripts/smoke-calendar.mjs package.json docs/design/fidelity-ledger.md docs/todofy-benchmark.md
git commit -m "test: verify calendar planning workflow"
git push -u origin feat/calendar-workspace
```
