# Navigation Integration and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the seven-entry navigation, Today semantics, learning-review links, responsive shell, documentation, and a verified Windows release candidate.

**Architecture:** A typed route/view model selects pure projections over one workspace state. Learning remains a specialized workspace over shared tasks; review scheduling produces linked visible tasks. Release claims are promoted only after full gates and packaged-app smoke evidence.

**Tech Stack:** Vue 3, TypeScript 5.6, Tauri 2, existing storage/capability/design systems and release scripts.

**Spec:** `docs/superpowers/specs/2026-09-04-shixue-time-planning-foundation.md`

## Global Constraints

- Depend on merged PRs 1–5; do not copy code between unmerged branches.
- Navigation entries are Inbox, Today, Upcoming, Calendar, Lists, Completed, Learning.
- Today includes planned today, due today, overdue, and today occurrences, with stable de-duplication.
- Existing learning evidence and review records remain reachable after migration.
- Desktop release requires real installed-app smoke; signing/updater/store claims remain unverified without evidence.

---

### Task 1: Replace implicit navigation with a typed view model

**Files:**
- Modify: `src/lib/navigation.ts`
- Create: `src/lib/workspace-view.ts`
- Test: `tests/workspace-navigation.test.ts`
- Modify: `src/components/study/AppSidebar.vue`
- Modify: `src/components/study/BottomTabs.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Produces: `WorkspaceView = { kind: 'inbox'|'today'|'upcoming'|'calendar'|'list'|'completed'|'learning'; ... }`; `resolveWorkspaceView(route): WorkspaceView`.

- [ ] **Step 1: Write route round-trip and narrow-navigation tests**

```ts
for (const view of coreViews) {
  assert.deepEqual(resolveWorkspaceView(serializeWorkspaceView(view)), view)
}
assert.deepEqual(bottomTabs.map(x => x.kind), ['inbox', 'today', 'calendar', 'lists', 'learning'])
```

- [ ] **Step 2: Run and confirm the new view type is missing**

Run: `node --test --experimental-strip-types tests/workspace-navigation.test.ts`

- [ ] **Step 3: Implement one source of navigation truth**

Desktop sidebar and bottom tabs consume the same descriptor list. Completed and Upcoming remain reachable on mobile through the Lists/more sheet without hiding functionality.

- [ ] **Step 4: Run navigation and module tests**

Run: `node --test --experimental-strip-types tests/workspace-navigation.test.ts tests/web-navigation.test.ts; npm run check:modules`

- [ ] **Step 5: Commit**

```powershell
git add src/lib/navigation.ts src/lib/workspace-view.ts src/components/study/AppSidebar.vue src/components/study/BottomTabs.vue src/App.vue tests/workspace-navigation.test.ts
git commit -m "feat: unify workspace navigation"
```

### Task 2: Finalize Today/Upcoming/search/filter projections

**Files:**
- Create: `src/domain/views/today.ts`
- Create: `src/domain/views/upcoming.ts`
- Modify: `src/lib/study-task-query.ts`
- Modify: `src/components/study/TodayView.vue`
- Modify: `src/components/study/TasksView.vue`
- Test: `tests/workspace-projections.test.ts`

**Interfaces:**
- Produces: `selectToday(state, now): TodayGroup[]`; `selectUpcoming(state, start, days): DayGroup[]`; `TaskProjection.reasons`.

- [ ] **Step 1: Write exhaustive Today source/de-duplication and overdue batch tests**

```ts
assert.deepEqual(selectToday(fixture(), now).map(x => x.kind), ['overdue', 'planned', 'due', 'recurring'])
assert.equal(flatten(selectToday(duplicateReasonFixture(), now)).length, 1)
assert.deepEqual(flatten(selectToday(duplicateReasonFixture(), now))[0].reasons, ['planned', 'due', 'recurring'])
```

- [ ] **Step 2: Run and confirm the current smart view cannot represent reason sets**

- [ ] **Step 3: Implement pure projection and overdue command bar**

Actions are move to today, defer, skip recurring, cancel. The command bar previews a batch before high-risk actions and never changes original deadlines when merely planning today.

- [ ] **Step 4: Run projection/query/capability tests**

Run: `node --test --experimental-strip-types tests/workspace-projections.test.ts tests/study-task-query.test.ts tests/capability-service.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/domain/views src/lib/study-task-query.ts src/components/study/TodayView.vue src/components/study/TasksView.vue tests/workspace-projections.test.ts
git commit -m "feat: finalize today and upcoming projections"
```

### Task 3: Link learning reviews to visible tasks

**Files:**
- Create: `src/domain/learning/review-task-link.ts`
- Create: `src/domain/capabilities/review-commands.ts`
- Modify: `src/components/study/ReviewView.vue`
- Modify: `src/components/study/FocusView.vue`
- Test: `tests/review-task-link.test.ts`

**Interfaces:**
- Produces: `ensureReviewTask(state, completionRecordId, dueOn)`, `completeReviewFromTask(state, linkId, result)`; commands `review.schedule`, `review.complete`.

- [ ] **Step 1: Write bidirectional link and idempotency tests**

```ts
test('completing a generated review task updates its completion record once', async () => {
  await completeTask('task:review:1')
  assert.equal((await completion('completion:1')).lastReviewedAt, now)
  await completeTask('task:review:1')
  assert.equal(countReviewEvents('completion:1'), 1)
})
```

- [ ] **Step 2: Verify the missing bidirectional review commands fail while migrated review tasks remain visible**

- [ ] **Step 3: Implement stable links without duplicating the task model**

Generated review tasks use `mode: 'learning'`, appear in Today/calendar and link to exactly one completion record. Closing learning mode preserves links and past records.

PR1 migration already creates visible pending review tasks, and `completion.review` retires their existing pending links/tasks. Reuse those links rather than generating duplicates. Before adding later stages or occurrence-linked reviews, route both evidence-screen and task completion through the same command and match the exact stage/link/occurrence; reviewing one stage must not close another pending stage. Verify migrated-task reuse, repeated completion from either entry point, and no recursive evidence/review chain.

- [ ] **Step 4: Run learning and migration suites**

Run: `node --test --experimental-strip-types tests/review-task-link.test.ts tests/workspace-migration.test.ts tests/study-domain.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/domain/learning src/domain/capabilities/review-commands.ts src/components/study/ReviewView.vue src/components/study/FocusView.vue tests/review-task-link.test.ts
git commit -m "feat: connect learning reviews to task planning"
```

### Task 4: Complete responsive shell and unified-control audit

This task is also the design-system convergence point. Move remaining business-owned backdrops/sheets onto `Dialog` or a shared `Sheet` built on `use-overlay.ts`; do not leave parallel Escape, focus-restoration, or stacking implementations. Consume platform intent tokens for hit targets, type roles and window classes, while keeping Windows, iOS/iPadOS and Android navigation/material mappings platform-native rather than pixel-identical.

**Files:**
- Modify: `src/App.vue`
- Modify: `src/assets/themes/global.css`
- Modify: `src/components/study/ContextRail.vue`
- Modify: `src/components/study/TaskDetailDrawer.vue`
- Modify: `tests/ui-control-contract.test.ts`
- Create: `tests/responsive-shell.test.ts`

**Interfaces:**
- Consumes: `DESIGN.md` breakpoint/layout contract and all shared controls.

- [ ] **Step 1: Add 1440/1280/820/390/320 layout assertions**

```ts
assert.equal(resolveShell(1440), 'three-column')
assert.equal(resolveShell(820), 'rail-with-overlay-detail')
assert.equal(resolveShell(390), 'single-column-bottom-tabs')
assert.equal(resolveShell(320).horizontalOverflow, false)
```

- [ ] **Step 2: Run source and responsive tests to expose remaining defaults**

Run: `node --test --experimental-strip-types tests/ui-control-contract.test.ts tests/responsive-shell.test.ts`

- [ ] **Step 3: Replace every remaining local control implementation**

Use shared Listbox, Checkbox, Switch, Menu, Popover, Dialog, Sheet, Tooltip, DatePicker, TimePicker and ToastRegion. Keep business composition local but delete duplicate overlay/focus/outside-click code after callers migrate.

- [ ] **Step 4: Run keyboard-only and reduced-preference smoke**

Verify 200% zoom, reduced motion, reduced transparency, high contrast, dark mode and all five widths. Record zero console/page errors.

- [ ] **Step 5: Commit**

```powershell
git add src/App.vue src/assets/themes/global.css src/components/study tests/ui-control-contract.test.ts tests/responsive-shell.test.ts
git commit -m "feat: complete responsive unified workspace shell"
```

### Task 5: Update public documentation and release claims

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/README.md`
- Modify: `docs/todofy-benchmark.md`
- Modify: `docs/design-system.md`
- Modify: `docs/application-protocol.md`
- Modify: `app.protocol.json`

**Interfaces:**
- Produces: bilingual product scope and accurate maturity labels matching implemented evidence.

- [ ] **Step 1: Write a documentation-link/protocol failure expectation**

Run current `npm run check:docs; npm run check:protocol` before edits and retain the output in PR notes if the new feature links are absent.

- [ ] **Step 2: Update both READMEs in the same commit**

Describe general todo + optional learning, time planning, recurrence, offline quick add, multi-reminder/tray, calendar views and limitations. Do not claim external calendar, cloud Agent, native mobile notification, signing or hosted updater.

- [ ] **Step 3: Mark visual contract locked only after user approval**

Change `DESIGN.md` to `LOCKED` and record approved screenshot names in `VISUAL_QA.md`. If approval is not present, leave status as candidate and block release rather than self-approve.

- [ ] **Step 4: Run docs/protocol gates**

Run: `npm run check:docs; npm run check:protocol; git diff --check`

- [ ] **Step 5: Commit**

```powershell
git add README.md README.en.md docs DESIGN.md VISUAL_QA.md app.protocol.json
git commit -m "docs: publish the time planning workspace"
```

### Task 6: Verify installed application and publish release PR

**Files:**
- Modify: `scripts/release-check.mjs`
- Modify: `scripts/smoke-windows-package.mjs`
- Create: `docs/releases/v0.3.0-acceptance.md`

**Interfaces:**
- Produces: machine-readable gate report and human acceptance ledger for the installed package.

- [ ] **Step 1: Extend release check with required feature suites**

Require migration, capability, recurrence, quick-add, reminder, calendar, navigation, UI-control and responsive-shell test files to execute with zero skipped tests.

- [ ] **Step 2: Run full repository verification**

Run: `npm run doctor; npm run verify; npm run rust:verify; npm run smoke:web-persistence; npm run smoke:calendar; npm run release:check`

Expected: all applicable commands exit 0; any environment-only block remains explicit.

- [ ] **Step 3: Build, install, and smoke the Windows artifact**

Run: `npm run package:windows; npm run smoke:windows-package`

Manually verify double-click launch, retained data, tray hide/reopen, multi-reminder actions, quick-add shortcut, all calendar views, dark mode and uninstall. Record signing/updater state separately.

- [ ] **Step 4: Review the diff and acceptance ledger**

Run: `git status --short; git diff --check; git diff --stat origin/main...HEAD`

Expected: only phase-A files, no generated screenshots/installers, no secrets, no unrelated refactor.

- [ ] **Step 5: Commit, push, and open PR 6**

```powershell
git add scripts/release-check.mjs scripts/smoke-windows-package.mjs docs/releases/v0.3.0-acceptance.md
git commit -m "test: verify time planning release candidate"
git push -u origin feat/time-planning-integration
```

Merge only after the first five PRs are present in the base branch, required checks are green, the visual contract is approved/locked, and the installed-app acceptance ledger contains no hidden `NOT_RUN` for core Windows behavior.
