# Offline Quick Add and Date Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic Chinese/English quick-add parsing with editable chips and no model or network dependency.

**Architecture:** A pure tokenizer produces candidates with source ranges and ambiguity state. The composer owns candidate confirmation and sends only explicit structured fields through `task.create`; global capture reuses the same component.

**Tech Stack:** Vue 3, TypeScript 5.6, native `Intl`, Tauri global shortcut module, existing capability service.

**Spec:** `docs/superpowers/specs/2026-09-04-shixue-time-planning-foundation.md`

## Global Constraints

- Depend on merged PRs 1–2.
- No NLP, date, or AI runtime dependency; parser output must be deterministic for a supplied clock/timezone.
- Recognized text remains in the title unless the user preference explicitly removes confirmed tokens.
- Unknown tags/lists and ambiguous dates remain visible text.
- Chips and pickers use shared themed controls; no visible native date/time/select control.

---

### Task 1: Implement token-range parser

**Files:**
- Create: `src/domain/quick-add/types.ts`
- Create: `src/domain/quick-add/tokenize.ts`
- Create: `src/domain/quick-add/parse.ts`
- Test: `tests/quick-add-parser.test.ts`

**Interfaces:**
- Produces: `parseQuickAdd(input, context): QuickAddParse`; `QuickAddCandidate { id, kind, value, source: { start, end, text }, status: 'resolved' | 'ambiguous' }`.

- [ ] **Step 1: Write bilingual, DST-safe, unknown-token, and ambiguity table tests**

```ts
test('parses without mutating the submitted title', () => {
  const result = parseQuickAdd('周五下午3点 复习线代 #数学 p1', context('2026-09-04T09:00:00+08:00'))
  assert.equal(result.originalTitle, '周五下午3点 复习线代 #数学 p1')
  assert.deepEqual(result.candidates.map(x => x.kind), ['schedule', 'tag', 'priority'])
  assert.equal(result.candidates.find(x => x.kind === 'schedule')?.value, '2026-09-04T15:00:00+08:00')
})
```

- [ ] **Step 2: Run and verify the parser module is absent**

Run: `node --test --experimental-strip-types tests/quick-add-parser.test.ts`

- [ ] **Step 3: Implement ordered token passes and explicit context**

```ts
export interface QuickAddContext {
  now: string
  timezone: string
  lists: readonly { id: string; title: string }[]
  tags: readonly { id: string; title: string }[]
}

export function parseQuickAdd(input: string, context: QuickAddContext): QuickAddParse {
  return resolveTokens(input, context, [priorityRule, recurrenceRule, entityRule, dateTimeRule, deadlineRule])
}
```

Use range collision checks so a substring is consumed by at most one candidate. Weekday without “this/next” uses the next occurrence including today only when its time is still future.

- [ ] **Step 4: Run focused tests twice with different machine timezones**

Run: `$env:TZ='Asia/Shanghai'; node --test --experimental-strip-types tests/quick-add-parser.test.ts`

Run: `$env:TZ='America/Los_Angeles'; node --test --experimental-strip-types tests/quick-add-parser.test.ts`

Expected: identical results because tests supply timezone and clock.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/quick-add tests/quick-add-parser.test.ts
git commit -m "feat: parse quick add text offline"
```

### Task 2: Build editable quick-add chips and themed date/time picker

**Files:**
- Create: `src/components/study/QuickAddComposer.vue`
- Create: `src/components/study/QuickAddChip.vue`
- Create: `src/components/ui/DatePicker.vue`
- Create: `src/components/ui/TimePicker.vue`
- Test: `tests/quick-add-ui-contract.test.ts`
- Modify: `src/components/study/TasksView.vue`
- Modify: `src/components/study/TodayView.vue`

**Interfaces:**
- Consumes: `parseQuickAdd`, `Listbox`, `Popover`, `task.create`.
- Produces: `QuickAddComposer` props `{ destinationListId, defaultStartOn }`, emits `{ created: EntityRef }`.

- [ ] **Step 1: Write source and interaction contract tests**

```ts
assert.doesNotMatch(source('DatePicker.vue'), /type=["']date["']/)
assert.doesNotMatch(source('TimePicker.vue'), /type=["']time["']/)
assert.match(source('QuickAddComposer.vue'), /parseQuickAdd/)
assert.match(source('QuickAddChip.vue'), /aria-label/)
```

- [ ] **Step 2: Run and verify missing components fail**

Run: `node --test --experimental-strip-types tests/quick-add-ui-contract.test.ts`

- [ ] **Step 3: Implement candidate editing and submission mapping**

```ts
const command = computed(() => ({
  type: 'task.create' as const,
  title: buildTitle(input.value, accepted.value, preferences.quickAddRemoveRecognizedText),
  ...fieldsFromAcceptedCandidates(accepted.value),
}))
```

Each chip opens the corresponding themed picker, has a remove button and exposes ambiguous state. Press Enter submits only when title and candidates are valid; Escape closes the active picker first.

- [ ] **Step 4: Run UI contract and navigation tests**

Run: `node --test --experimental-strip-types tests/quick-add-ui-contract.test.ts tests/web-navigation.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/components/study/QuickAddComposer.vue src/components/study/QuickAddChip.vue src/components/ui/DatePicker.vue src/components/ui/TimePicker.vue src/components/study/TasksView.vue src/components/study/TodayView.vue tests/quick-add-ui-contract.test.ts
git commit -m "feat: add editable quick add composer"
```

### Task 3: Add global capture and preferences

**Files:**
- Create: `src/lib/planning-preferences.ts`
- Test: `tests/planning-preferences.test.ts`
- Modify: `src/components/study/SettingsSheet.vue`
- Modify: `src/App.vue`
- Modify: `src/modules/shortcut/index.ts`
- Test: `tests/quick-add-shortcut.test.ts`

**Interfaces:**
- Produces: `loadPlanningPreferences()`, `savePlanningPreferences(patch)`; custom event `shixue:quick-add` emitted by the shortcut module.

- [ ] **Step 1: Write default/preference and shortcut de-duplication tests**

```ts
assert.equal(loadDefaults().quickAddRemoveRecognizedText, false)
assert.equal(loadDefaults().defaultEstimateMinutes, null)
assert.equal(countRegistered('Ctrl+Alt+A'), 1)
```

- [ ] **Step 2: Run tests and confirm missing preference module**

Run: `node --test --experimental-strip-types tests/planning-preferences.test.ts tests/quick-add-shortcut.test.ts`

- [ ] **Step 3: Implement one shortcut path and minimal settings rows**

The shortcut shows/restores the main window, navigates to Inbox and focuses the composer. In-app `N` focuses the current view’s composer; both ignore active text fields except the explicit global OS shortcut.

- [ ] **Step 4: Run module and web navigation tests**

Run: `npm run check:modules; node --test --experimental-strip-types tests/quick-add-shortcut.test.ts tests/web-navigation.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/lib/planning-preferences.ts src/components/study/SettingsSheet.vue src/App.vue src/modules/shortcut/index.ts tests/planning-preferences.test.ts tests/quick-add-shortcut.test.ts
git commit -m "feat: add quick capture preferences and shortcut"
```

### Task 4: Browser smoke, visual check, and PR completion

**Files:**
- Modify: `scripts/smoke-web-persistence.mjs`
- Modify: `docs/todofy-benchmark.md`
- Test artifact: `artifacts/visual-qa/quick-add/` (not committed)

**Interfaces:**
- Consumes: built Web app and fixed viewport list from `VISUAL_QA.md`.

- [ ] **Step 1: Extend smoke steps with typed bilingual examples**

Use the real UI to type `明天下午3点 复习线代 #数学 p1`, edit the time chip, create, reload, and assert title plus structured schedule/priority/tag.

- [ ] **Step 2: Run the smoke before implementation completion**

Run: `npm run build:web; npm run smoke:web-persistence`

Expected before final wiring: FAIL at the chip assertion.

- [ ] **Step 3: Complete wiring until the smoke passes without console/page errors**

Capture desktop 1440×960 and mobile 390×844 with one picker open. Verify no default platform control is visible.

- [ ] **Step 4: Run full gates**

Run: `npm test; npm run typecheck; npm run build; npm run build:web; npm run check:docs; npm run check:modules; git diff --check`

- [ ] **Step 5: Commit and push PR 3**

```powershell
git add scripts/smoke-web-persistence.mjs docs/todofy-benchmark.md
git commit -m "test: cover natural language quick capture"
git push -u origin feat/offline-quick-add
```
