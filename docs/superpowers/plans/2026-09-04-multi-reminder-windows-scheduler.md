# Multi Reminder and Windows Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver multiple reminder rules, actionable notifications, snooze, tray lifecycle, and just-in-time notification permission on Windows.

**Architecture:** TypeScript resolves rules into due deliveries and persists idempotent records; Rust polls the snapshot and emits actionable notifications while the app remains in tray. Every action returns through the capability service so UI and OS notifications share behavior.

**Tech Stack:** Vue 3, TypeScript, Tauri 2 notification/tray/autostart plugins, Rust, SQLite snapshot storage.

**Spec:** `docs/superpowers/specs/2026-09-04-shixue-time-planning-foundation.md`

## Global Constraints

- Merge requires PRs 1–3. Development may proceed on the explicitly recorded PR3-dependent worktree; PR3 #14 was OPEN when this PR4 worktree was created. Do not claim merge eligibility before rechecking.
- Multiple reminders are independent; snooze never changes task schedule or deadline.
- Request notification permission only when the user first enables a reminder or explicitly tests notifications.
- Background delivery is promised only while the app or tray process is running.
- Complete, snooze, and open actions call capability commands and remain idempotent.
- Before enabling the new scheduler, define and verify one authoritative delivery state and one write path. PR1's Rust scheduler writes `study_reminder_deliveries` keyed by task, while this plan introduces workspace `reminderDeliveries` keyed by rule/occurrence/time. Specify how the legacy rows map to known absolute-rule deliveries, how unmappable rows are retained or retired, and when the old scheduler stops writing; an upgrade/restart must not silently replay already acknowledged reminders or run both ledgers as independent authorities. Workspace delivery changes must use the capability transaction boundary, never a native snapshot overwrite.

---

### Task 1: Resolve reminder rules and deliveries

**Files:**
- Create: `src/domain/reminders/resolve.ts`
- Create: `src/domain/capabilities/reminder-commands.ts`
- Test: `tests/reminder-rules.test.ts`
- Modify: `src/domain/capabilities/catalog.ts`

**Interfaces:**
- Produces: `resolveReminderInstant(rule, task, occurrence): string | null`; commands `reminder.set`, `reminder.snooze`, `reminder.dismiss`; unique key `deliveryKey(ruleId, occurrenceId, scheduledFor)`.

- [x] **Step 1: Write tests for start/due offsets, absolute reminders, dedupe, and snooze isolation**

```ts
test('snooze changes only the delivery', async () => {
  const before = await task('task:1')
  await service.execute(envelope({ type: 'reminder.snooze', deliveryId: 'delivery:1', until: '2026-09-04T10:10:00+08:00' }))
  assert.deepEqual(await task('task:1'), before)
  assert.equal((await delivery('delivery:1')).snoozedUntil, '2026-09-04T10:10:00+08:00')
})
```

- [x] **Step 2: Run and verify missing reminder commands fail**

Run: `node --test --experimental-strip-types tests/reminder-rules.test.ts`

- [x] **Step 3: Implement rule resolution and idempotent delivery creation**

```ts
export function deliveryKey(ruleId: string, occurrenceId: string | null, scheduledFor: string): string {
  return `${ruleId}\u0000${occurrenceId ?? '-'}\u0000${scheduledFor}`
}
```

Disabled rules produce no pending delivery. Completed/cancelled tasks and completed/skipped occurrences cancel future pending deliveries without deleting audit rows.

- [x] **Step 4: Run reminder and capability tests**

Run: `node --test --experimental-strip-types tests/reminder-rules.test.ts tests/capability-service.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src/domain/reminders src/domain/capabilities tests/reminder-rules.test.ts
git commit -m "feat: add multiple reminder rules"
```

### Task 2: Add actionable Tauri notification bridge

**Files:**
- Create: `src-tauri/src/reminder_actions.rs`
- Modify: `src-tauri/src/reminder_scheduler.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/modules/notification/index.ts`
- Test: `src-tauri/src/reminder_scheduler_tests.rs`
- Test: `tests/notification-action-bridge.test.ts`

**Interfaces:**
- Rust emits `shixue://reminder-action` payload `{ deliveryId, action: 'complete' | 'snooze' | 'open' }`.
- TypeScript exports `registerReminderActionBridge(service): Promise<() => void>`.
- Before implementation, specify the claim/ack DTOs and their owner, including delivery identity, revision/conflict handling, send failure, abandoned claims, retry and acknowledgement persistence. Platform adapters consume this shared contract; any native bookkeeping must have an explicit reconciliation boundary with the authoritative ledger. Do not assume a process-local set or the illustrative `claim_due` test below proves persisted deduplication.

- [x] **Step 1: Write Rust due-selection and TS action-mapping tests**

```rust
#[test]
fn same_delivery_is_claimed_once() {
    let first = claim_due(&fixture(), now());
    let second = claim_due(&fixture(), now());
    assert_eq!(first.len(), 1);
    assert!(second.is_empty());
}
```

- [x] **Step 2: Run red tests**

Run: `npm run rust:verify; node --test --experimental-strip-types tests/notification-action-bridge.test.ts`

Expected: FAIL because action registration and claim logic are absent.

- [x] **Step 3: Implement registered action types and event bridge**

Register one action type with Complete, Snooze and Open buttons. If Windows does not expose action buttons for the current packaging path, clicking the notification opens an in-app reminder card with the same three actions; do not claim native actions until smoke-verified.

Exercise two competing claim attempts and restarts before send, after send but before ack, and after persisted ack; include repeated action callbacks and legacy-ledger upgrade. Document the chosen retry/recovery outcome for each window. OS notification submission and database acknowledgement are not one atomic transaction, so an ambiguous send/ack crash may cause a duplicate or a missed delivery depending on policy; do not promise exactly-once notification delivery. Distinguish accepted submission, observed delivery and user action in recorded evidence.

- [x] **Step 4: Run Rust, module, and TS tests**

Run: `npm run rust:verify; npm run check:modules; node --test --experimental-strip-types tests/notification-action-bridge.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src src-tauri/capabilities/default.json src/modules/notification/index.ts tests/notification-action-bridge.test.ts
git commit -m "feat: bridge actionable reminder notifications"
```

### Task 3: Implement reminder editor, permission timing, and in-app card

**Files:**
- Create: `src/components/study/ReminderEditor.vue`
- Create: `src/components/study/ReminderCard.vue`
- Test: `tests/reminder-ui-contract.test.ts`
- Modify: `src/components/study/TaskEditSheet.vue`
- Modify: `src/components/study/SettingsView.vue`
- Modify: `src/lib/study-reminders.ts`

**Interfaces:**
- Consumes: DatePicker/TimePicker/Listbox, notification module, reminder commands.
- Produces: multiple ordered rules and action card; `ensureNotificationPermission(reason: 'first-reminder' | 'test'): Promise<PermissionState>`.

- [x] **Step 1: Write tests that startup never requests permission and first reminder does**

```ts
assert.equal(permissionRequestsAfterBoot(), 0)
await addFirstReminder()
assert.equal(permissionRequests(), 1)
assert.doesNotMatch(source('ReminderEditor.vue'), /<select\b|type=["']time["']/)
```

- [x] **Step 2: Run and confirm current eager/single-reminder behavior fails**

Run: `node --test --experimental-strip-types tests/reminder-ui-contract.test.ts tests/study-reminders.test.ts`

- [x] **Step 3: Implement editor and concise denial/retry states**

Provide presets “开始时 / 提前 10 分钟 / 提前 1 小时 / 自定义” plus add/remove. Permission denial preserves the rule and marks delivery unavailable; Settings shows status and a notification test action.

- [x] **Step 4: Run reminder and UI contract tests**

Expected: PASS; three in-app actions produce the same command envelopes as OS events.

- [ ] **Step 5: Commit**

```powershell
git add src/components/study/ReminderEditor.vue src/components/study/ReminderCard.vue src/components/study/TaskEditSheet.vue src/components/study/SettingsView.vue src/lib/study-reminders.ts tests/reminder-ui-contract.test.ts tests/study-reminders.test.ts
git commit -m "feat: add multiple reminder interface"
```

### Task 4: Add tray close behavior and autostart preference

**Files:**
- Create: `src/lib/window-lifecycle.ts`
- Test: `tests/window-lifecycle.test.ts`
- Modify: `src/modules/tray/index.ts`
- Modify: `src/modules/autostart/index.ts`
- Modify: `src/components/study/SettingsView.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Produces: `handleCloseRequested(event, preferences)`; tray actions `open`, `quick-add`, `quit`.

- [x] **Step 1: Write ask/tray/quit and remembered-choice tests**

```ts
assert.equal(await closeWith('tray'), 'prevent-and-hide')
assert.equal(await closeWith('quit'), 'allow-close')
assert.equal(defaultPreferences().launchAtLogin, false)
```

- [x] **Step 2: Run and confirm the lifecycle helper is missing**

- [x] **Step 3: Implement first-close choice with shared Dialog**

Quit must stop the process; hide must leave the scheduler active. Tray “退出” always exits without asking. Autostart changes only after explicit user toggle and surfaces plugin failure.

- [x] **Step 4: Run tests and module checks**

Run: `node --test --experimental-strip-types tests/window-lifecycle.test.ts; npm run check:modules`

- [ ] **Step 5: Commit**

```powershell
git add src/lib/window-lifecycle.ts src/modules/tray/index.ts src/modules/autostart/index.ts src/components/study/SettingsView.vue src/App.vue tests/window-lifecycle.test.ts
git commit -m "feat: manage tray and close lifecycle"
```

### Task 5: Perform Windows package smoke and close PR

**Files:**
- Modify: `scripts/smoke-windows-package.mjs`
- Modify: `docs/windows-distribution.md`
- Modify: `docs/todofy-benchmark.md`

**Interfaces:**
- Consumes: packaged executable and generated smoke report.

- [x] **Step 1: Add machine-readable smoke stages**

Stages: launch, permission prompt on first reminder, deliver two reminders for one task, snooze one, complete one, hide to tray, reopen, quit, verify no delivery after quit.

The script writes `src-tauri/target/windows-package-smoke-report.json`. Automated package/install/process-liveness probes and manual Windows UI stages have separate `verification` fields. Unobserved notification, tray, and 200% Windows display-scaling stages remain `NOT_RUN`; the current native notification action-button path is `UNSUPPORTED` and uses the in-app card fallback.

- [x] **Step 2: Build the unsigned local package**

Run: `npm run package:windows`

Expected: a locally installable artifact; signing remains explicitly unverified.

- [ ] **Step 3: Run the real smoke and record capability outcomes**

Run: `npm run smoke:windows-package`

Expected: PASS for tray/background/in-app actions. Native action buttons are PASS or explicitly `NOT_RUN/UNSUPPORTED`; never silently promoted.

Automated package, isolated install, and process-liveness smoke is `PASS`. The notification, reminder-action, tray, quit-silence, and Windows 200% display stages were not manually observed and remain `NOT_RUN`; native notification action buttons remain `UNSUPPORTED` with the in-app card fallback.

- [x] **Step 4: Run full gates**

Run: `npm test; npm run typecheck; npm run build; npm run build:web; npm run rust:verify; npm run check:docs; npm run release:check; git diff --check`

- [ ] **Step 5: Commit and push PR 4**

```powershell
git add scripts/smoke-windows-package.mjs docs/windows-distribution.md docs/todofy-benchmark.md
git commit -m "test: verify Windows reminder lifecycle"
git push -u origin feat/multi-reminder-windows
```
