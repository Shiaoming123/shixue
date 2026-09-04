# Time Planning Domain Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade persisted data to `WorkspaceStateV3`, expose one transactional capability service, and establish the themed control/overlay foundation used by every later PR.

**Architecture:** Keep the existing snapshot stores but place pure v3 parsing/migration and command execution in focused domain files. UI, keyboard, notification, and future Agent callers receive one service; the first UI primitives share one overlay manager and never expose native control chrome.

**Tech Stack:** Vue 3, TypeScript 5.6, Vite 8, Tauri 2, IndexedDB, SQLite snapshot store, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-04-shixue-time-planning-foundation.md`

## Global Constraints

- Windows desktop is the complete target; Web and 320px responsive behavior must not regress.
- Add no runtime dependency or second state-management library.
- Existing v1/v2 tasks migrate as learning tasks without changing IDs or breaking event/session/completion links.
- Every write is atomic, idempotent, CAS-protected, auditable, and reachable through `TaskCapabilityService`.
- Every visible control uses the shared themed UI layer and follows `DESIGN.md` / `VISUAL_QA.md`.
- Merge or rebase `feat/open-source-typography` before implementing visible UI; do not duplicate font assets.

---

### Task 1: Define and validate `WorkspaceStateV3`

**Files:**
- Create: `src/domain/workspace/types.ts`
- Create: `src/domain/workspace/parse.ts`
- Test: `tests/workspace-state-v3.test.ts`
- Modify: `src/storage/study/types.ts`

**Interfaces:**
- Consumes: existing `StudyState`, `StudySession`, `TaskEvent`, `CompletionRecord` from `src/storage/study/types.ts`.
- Produces: `WorkspaceStateV3`, `Task`, `TaskList`, `ListGroup`, `ListSection`, `Tag`, `TaskSchedule`, `TaskDeadline`; `parseWorkspaceState(value: unknown): WorkspaceStateV3`.

- [ ] **Step 1: Write the failing shape and invariant tests**

```ts
test('rejects two schedule representations and dangling list ids', () => {
  const state = validWorkspaceState()
  state.tasks[0].schedule = { startOn: '2026-09-04', startAt: '2026-09-04T09:00:00+08:00', estimateMinutes: 30 }
  assert.throws(() => parseWorkspaceState(state), /startOn and startAt/)
  state.tasks[0].schedule = { startOn: '2026-09-04', startAt: null, estimateMinutes: 30 }
  state.tasks[0].listId = 'missing'
  assert.throws(() => parseWorkspaceState(state), /unknown listId/)
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `node --test --experimental-strip-types tests/workspace-state-v3.test.ts`

Expected: FAIL because `src/domain/workspace/parse.ts` does not exist.

- [ ] **Step 3: Implement types and parser with explicit invariants**

```ts
export const WORKSPACE_STATE_VERSION = 3 as const

export function parseWorkspaceState(value: unknown): WorkspaceStateV3 {
  const state = requireRecord(value, 'Workspace state')
  if (state.version !== 3) throw new Error('Workspace state must use version 3.')
  const parsed = parseCollections(state)
  assertUniqueIds(parsed)
  assertReferences(parsed)
  assertScheduleRepresentations(parsed.tasks)
  return parsed
}
```

Keep the parser deterministic and side-effect free. Re-export legacy types only for migration compatibility; do not add v3 fields to `StudyTask`.

- [ ] **Step 4: Run focused and baseline domain tests**

Run: `node --test --experimental-strip-types tests/workspace-state-v3.test.ts tests/study-domain.test.ts`

Expected: PASS, including dangling-reference and duplicate-ID rejection.

- [ ] **Step 5: Commit the model boundary**

```powershell
git add src/domain/workspace src/storage/study/types.ts tests/workspace-state-v3.test.ts
git commit -m "feat: define workspace state v3"
```

### Task 2: Implement pure v1/v2 to v3 migration

**Files:**
- Create: `src/domain/workspace/migrate.ts`
- Create: `src/storage/workspace/types.ts`
- Create: `src/storage/workspace/registry.ts`
- Test: `tests/workspace-migration.test.ts`
- Modify: `src/storage/study/data-port.ts`
- Modify: `src/storage/study/in-memory.ts`
- Modify: `src/storage/study/indexeddb.ts`
- Modify: `src/storage/study/tauri-sqlite.ts`
- Modify: `src/storage/study/registry.ts`

**Interfaces:**
- Consumes: `parseStudyStateOrMigrate(value)`, `parseWorkspaceState(value)`.
- Produces: `parseWorkspaceStateOrMigrate(value: unknown, migratedAt?: string): WorkspaceStateV3`; `WorkspaceStore { load(): Promise<WorkspaceStateV3>; save(state, expectedUpdatedAt?): Promise<void> }`; export format `meow-study/workspace-export` version `3`, import support for study-export v1/v2.

- [ ] **Step 1: Write preservation and idempotency tests**

```ts
test('migrates every v2 task to learning mode without changing linked ids', () => {
  const old = createV2FixtureWithSessionCompletionAndReminder()
  const next = parseWorkspaceStateOrMigrate(old, '2026-09-04T00:00:00.000Z')
  assert.equal(next.tasks[0].id, old.tasks[0].id)
  assert.equal(next.tasks[0].mode, 'learning')
  assert.equal(next.studySessions[0].taskId, old.tasks[0].id)
  assert.equal(next.completionRecords[0].taskId, old.tasks[0].id)
  assert.equal(next.reminderRules[0].trigger.kind, 'absolute')
  assert.deepEqual(parseWorkspaceStateOrMigrate(next), next)
})
```

- [ ] **Step 2: Run the migration test and confirm it fails**

Run: `node --test --experimental-strip-types tests/workspace-migration.test.ts`

Expected: FAIL because `parseWorkspaceStateOrMigrate` is missing.

- [ ] **Step 3: Implement deterministic IDs and all-or-nothing import**

```ts
export function parseWorkspaceStateOrMigrate(value: unknown, migratedAt = new Date().toISOString()): WorkspaceStateV3 {
  if (isWorkspaceV3(value)) return parseWorkspaceState(value)
  const v2 = parseStudyStateOrMigrate(value, migratedAt)
  return parseWorkspaceState(migrateStudyV2(v2, migratedAt))
}

const reminderId = (taskId: string) => `reminder:migrated:${taskId}`
```

Create system lists with stable IDs, preserve legacy event sequence, append migration events after the last sequence, and validate the complete v3 value before any store save. Move registry consumers to `WorkspaceStore`; keep `StudyStore` and the old registry exports as deprecated aliases for one release so existing callers migrate without a flag day. The IndexedDB and SQLite adapters retain their current keys/tables and back up the pre-migration payload before replacing it.

- [ ] **Step 4: Run migration, data-port, and storage tests**

Run: `node --test --experimental-strip-types tests/workspace-migration.test.ts tests/study-data-port.test.ts tests/study-storage.test.ts`

Expected: PASS; malformed import leaves the fixture store byte-for-byte unchanged.

- [ ] **Step 5: Commit migration**

```powershell
git add src/domain/workspace/migrate.ts src/storage/workspace src/storage/study tests/workspace-migration.test.ts
git commit -m "feat: migrate study data to workspace v3"
```

### Task 3: Add transactional capability service

**Files:**
- Create: `src/domain/capabilities/types.ts`
- Create: `src/domain/capabilities/catalog.ts`
- Create: `src/domain/capabilities/service.ts`
- Create: `src/domain/capabilities/task-commands.ts`
- Test: `tests/capability-service.test.ts`
- Modify: `src/lib/study.ts`

**Interfaces:**
- Consumes: `WorkspaceStateV3`, existing `StudyStore.save(state, expectedUpdatedAt)` adapter behavior.
- Produces: `createTaskCapabilityService(store, clock, ids): TaskCapabilityService`; methods `query(query)`, `preview(envelope)`, `execute(envelope)`; commands `task.create/update/delete/complete/reopen/reschedule`, batch variants, `undo.apply`.

- [ ] **Step 1: Write atomicity, idempotency, CAS, and metadata tests**

```ts
test('does not save when one target in a batch is invalid', async () => {
  const service = createFixtureService()
  const before = await service.query({ type: 'workspace.snapshot' })
  await assert.rejects(service.execute(envelope({ type: 'task.batch_reschedule', taskIds: ['ok', 'missing'], startOn: '2026-09-05' })), /TASK_NOT_FOUND/)
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), before)
})

test('returns the original receipt for a repeated idempotency key', async () => {
  const first = await service.execute(envelope(createTask(), 'same-key'))
  const second = await service.execute(envelope(createTask(), 'same-key'))
  assert.equal(second.receiptId, first.receiptId)
  assert.equal((await tasks(service)).length, 1)
})
```

- [ ] **Step 2: Run and verify the expected missing-module failure**

Run: `node --test --experimental-strip-types tests/capability-service.test.ts`

Expected: FAIL because the capability modules are missing.

- [ ] **Step 3: Implement preview and execute over a cloned snapshot**

```ts
export interface TaskCapabilityService {
  query<T extends CapabilityQuery>(query: T): Promise<QueryResult<T>>
  preview(command: CommandEnvelope): Promise<CommandPreview>
  execute(command: CommandEnvelope): Promise<CommandResult>
}

async function execute(envelope: CommandEnvelope): Promise<CommandResult> {
  const current = await store.load()
  const cached = findReceipt(current, envelope.idempotencyKey)
  if (cached) return cached.result
  assertWorkspaceRevision(current, envelope.expectedWorkspaceRevision)
  const draft = structuredClone(current)
  const result = applyCommand(draft, envelope, deps)
  await store.save(parseWorkspaceState(draft), current.updatedAt)
  return result
}
```

Catalog every command with fixed risk/scope/reversibility metadata. Keep deprecated functions in `src/lib/study.ts` as thin adapters that construct envelopes; do not let them save directly.

- [ ] **Step 4: Run capability and existing task tests**

Run: `node --test --experimental-strip-types tests/capability-service.test.ts tests/study-task-query.test.ts tests/study-domain.test.ts`

Expected: PASS; every write produces one receipt and one or more ordered events.

- [ ] **Step 5: Commit the command boundary**

```powershell
git add src/domain/capabilities src/lib/study.ts tests/capability-service.test.ts
git commit -m "feat: route task writes through capability service"
```

### Task 4: Build overlay manager and first unified controls

**Files:**
- Create: `src/components/ui/OverlayHost.vue`
- Create: `src/components/ui/use-overlay.ts`
- Create: `src/components/ui/Listbox.vue`
- Create: `src/components/ui/Checkbox.vue`
- Create: `src/components/ui/Switch.vue`
- Create: `src/components/ui/Popover.vue`
- Create: `src/components/ui/Dialog.vue`
- Create: `src/components/ui/ToastRegion.vue`
- Test: `tests/ui-control-contract.test.ts`
- Modify: `src/App.vue`
- Modify: `src/assets/themes/global.css`
- Modify: `docs/design-system.md`
- Modify: `src/components/study/ReviewView.vue`
- Modify: `src/components/study/TaskActionSheet.vue`
- Modify: `src/components/study/TaskEditSheet.vue`
- Modify: `src/components/study/TasksView.vue`
- Modify: `src/agent/ui/ChatPanel.vue`

**Interfaces:**
- Consumes: current theme tokens and `Icon.vue`.
- Produces: controlled Vue components with `modelValue`, semantic labels, keyboard behavior; one `OverlayHost` mounted at application root.

- [ ] **Step 1: Write a source contract test that rejects unapproved visible native controls**

```ts
test('feature components do not render visible native selects or browser dialogs', () => {
  const files = featureVueSources()
  assert.deepEqual(findMatches(files, /<select\b|window\.(alert|confirm)\s*\(/), [])
})
```

Add an allowlist only for hidden native inputs inside `src/components/ui/`; require `aria-hidden="true"` or the `.ui-native-underlay` class there.

- [ ] **Step 2: Run the contract test and record current offenders**

Run: `node --test --experimental-strip-types tests/ui-control-contract.test.ts`

Expected: FAIL with the current feature files that expose native control chrome.

- [ ] **Step 3: Implement overlay focus/escape contract and themed controls**

```ts
export interface OverlayRegistration {
  id: string
  kind: 'popover' | 'menu' | 'dialog' | 'sheet' | 'tooltip'
  trigger: HTMLElement | null
  close(reason: 'escape' | 'outside' | 'select'): void
}

export function useOverlay(registration: OverlayRegistration): { layerId: string; bringToFront(): void }
```

`Listbox` implements ArrowUp/Down, Home/End, Enter/Space and Escape; `Dialog` traps focus and restores it; `Checkbox` and `Switch` retain a real input as the semantic underlay. Style only with existing tokens. Replace the concrete offenders found in `App.vue`, `ReviewView.vue`, `TaskActionSheet.vue`, `TaskEditSheet.vue`, `TasksView.vue`, and the optional `ChatPanel.vue`; the source test then guards future regressions.

- [ ] **Step 4: Replace current visible selects/confirm dialogs and run UI tests**

Run: `node --test --experimental-strip-types tests/ui-control-contract.test.ts tests/web-navigation.test.ts`

Expected: PASS; source scan reports no visible native controls and navigation behavior remains green.

- [ ] **Step 5: Run full PR gates and commit**

Run: `npm test; npm run typecheck; npm run build; npm run build:web; npm run check:protocol; npm run check:modules; npm run check:docs`

Expected: every command exits 0 with no skipped test hidden.

```powershell
git add src/components/ui src/components/study src/agent/ui/ChatPanel.vue src/App.vue src/assets/themes/global.css docs/design-system.md tests/ui-control-contract.test.ts
git commit -m "feat: establish unified control and overlay system"
```

### Task 5: Update protocol and migration documentation

**Files:**
- Modify: `app.protocol.json`
- Modify: `scripts/check-app-protocol.mjs`
- Modify: `docs/application-protocol.md`
- Modify: `docs/todofy-benchmark.md`
- Test: `tests/app-protocol.test.ts`

**Interfaces:**
- Consumes: workspace export v3 and capability protocol v1.
- Produces: machine-checked product goal, data-port version, migration promise, and future-agent boundary.

- [ ] **Step 1: Add a failing protocol expectation**

```ts
assert.equal(protocol.data.ports.find(({ id }) => id === 'workspace')?.version, 3)
assert.equal(protocol.capabilities.protocolVersion, 1)
assert.equal(protocol.capabilities.directStorageWrites, false)
```

- [ ] **Step 2: Run `npm run check:protocol` and confirm it rejects schema v1**

Expected: non-zero with a missing workspace/capabilities field.

- [ ] **Step 3: Update JSON, checker, and prose together**

Set the product goal to general personal planning with optional learning specialization; retain local-first non-goals and maturity claims. Mark recurrence/NLP/calendar/reminders as planned until their PRs land.

- [ ] **Step 4: Verify protocol and docs**

Run: `npm run check:protocol; npm run check:docs; git diff --check`

Expected: all exit 0.

- [ ] **Step 5: Commit and open PR 1**

```powershell
git add app.protocol.json scripts/check-app-protocol.mjs docs/application-protocol.md docs/todofy-benchmark.md tests/app-protocol.test.ts
git commit -m "docs: publish time planning capability contract"
git push -u origin feat/time-planning-domain-foundation
```

PR acceptance comment must list migration fixtures, command atomicity/idempotency tests, native-control source audit, and all executed gates.
