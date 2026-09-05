import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildQuickAddCommand } from '../src/domain/quick-add/command.ts'
import { normalizeQuickAddTime } from '../src/domain/quick-add/time.ts'
import { createTaskCapabilityService } from '../src/domain/capabilities/service.ts'
import { CAPABILITY_PROTOCOL_VERSION } from '../src/domain/capabilities/types.ts'
import type { QuickAddCandidate, QuickAddCandidateKind } from '../src/domain/quick-add/types.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'

const studySource = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')
const uiSource = (name: string) => readFileSync(new URL(`../src/components/ui/${name}`, import.meta.url), 'utf8')
const appSource = () => readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('quick add uses editable chips and themed date and time pickers', () => {
  const datePicker = uiSource('DatePicker.vue')
  const timePicker = uiSource('TimePicker.vue')
  assert.doesNotMatch(datePicker, /type=["']date["']/)
  assert.doesNotMatch(timePicker, /type=["']time["']/)
  assert.match(datePicker, /role="grid"/)
  assert.match(timePicker, /inputmode="numeric"/)
  assert.match(studySource('QuickAddComposer.vue'), /parseQuickAdd/)
  const chip = studySource('QuickAddChip.vue')
  assert.match(chip, /aria-label/)
  assert.match(chip, /@media \(max-width: 819px\)[\s\S]*min-height: 44px/)
})

test('invalid typed time remains visible and blocks candidate resolution', () => {
  assert.equal(normalizeQuickAddTime('9:05'), '09:05')
  assert.equal(normalizeQuickAddTime(''), '')
  assert.equal(normalizeQuickAddTime('99:99'), null)
  assert.equal(normalizeQuickAddTime('later'), null)

  const timePicker = uiSource('TimePicker.vue')
  assert.match(timePicker, /update:valid/)
  assert.match(timePicker, /aria-invalid/)
  assert.match(timePicker, /aria-live="polite"/)
  const composer = studySource('QuickAddComposer.vue')
  assert.match(composer, /v-model:valid="editTimeValid"/)
  assert.match(composer, /!editTimeValid/)
})

test('candidate editor exposes a named adaptive dialog', () => {
  const composer = studySource('QuickAddComposer.vue')
  assert.match(composer, /role="dialog"/)
  assert.match(composer, /:aria-modal="modal \? 'true' : 'false'"/)
  assert.match(composer, /mobile-sheet/)
  assert.match(composer, /:aria-labelledby="`quick-add-editor-title-\$\{candidate\.id\}`"/)
  assert.match(composer, /:id="`quick-add-editor-title-\$\{candidate\.id\}`"/)
})

test('composer renders the shared candidate conflict state', () => {
  const composer = studySource('QuickAddComposer.vue')
  assert.match(composer, /useQuickAddCandidateState\(acceptedCandidates\)/)
  assert.match(composer, /conflictedCandidateIds\.includes\(candidate\.id\)/)
})

test('calendar exposes row-owned grid cells, one tab stop, and month and year navigation', () => {
  const datePicker = uiSource('DatePicker.vue')
  assert.match(datePicker, /role="row"/)
  assert.match(datePicker, /v-for="\(week, weekIndex\) in weeks"/)
  assert.match(datePicker, /:tabindex="day\.key === focusedDateKey \? 0 : -1"/)
  assert.match(datePicker, /aria-label="上一年"/)
  assert.match(datePicker, /aria-label="下一年"/)
  assert.match(datePicker, /event\.shiftKey \? 12 : 1/)
})

test('composer edits parsed candidates and submits one versioned capability envelope', () => {
  const composer = studySource('QuickAddComposer.vue')
  for (const dependency of ['QuickAddChip', 'DatePicker', 'TimePicker', 'Listbox', 'Popover']) {
    assert.match(composer, new RegExp(dependency))
  }
  assert.match(composer, /buildQuickAddCommand/)
  assert.match(composer, /CAPABILITY_PROTOCOL_VERSION/)
  assert.match(composer, /capabilityService\.execute\(envelope\)/)
  assert.match(composer, /candidate\.status === 'ambiguous'/)
  assert.match(composer, /quickAddRemoveRecognizedText: false/)
  assert.match(composer, /aria-live="polite"/)
  assert.doesNotMatch(composer, /type:\s*'recurrence\.create'/)
  assert.doesNotMatch(composer, /getWorkspaceStore\(\)\.save/)
})

test('Tasks and Today expose the same composer while App only handles the created result', () => {
  assert.match(studySource('TasksView.vue'), /<QuickAddComposer\b/)
  assert.match(studySource('TodayView.vue'), /<QuickAddComposer\b/)
  const app = appSource()
  assert.match(app, /@created="quickAddCreated"/)
  assert.match(app, /async function quickAddCreated/)
  assert.doesNotMatch(app, /@capture="captureTask"/)
  assert.doesNotMatch(app, /captureStudyTask/)
})

function candidate(
  kind: QuickAddCandidateKind,
  value: string,
  text = value,
  status: QuickAddCandidate['status'] = 'resolved',
  start = 0,
): QuickAddCandidate {
  return { id: `${kind}:${start}`, kind, value, status, source: { start, end: start + text.length, text } }
}

test('command mapping preserves date-only values and embeds recurrence in task.create', () => {
  const command = buildQuickAddCommand({
    input: '明天 每天 复习线代',
    candidates: [candidate('schedule', '2026-09-06', '明天'), candidate('recurrence', 'daily', '每天', 'resolved', 3)],
    destinationListId: 'list:system:learning',
    defaultStartOn: '2026-09-05',
    timezone: 'Asia/Shanghai',
  })

  assert.equal(command.title, '明天 每天 复习线代')
  assert.equal(command.startOn, '2026-09-06')
  assert.equal(command.startAt, undefined)
  assert.equal(command.recurrence?.anchorOn, '2026-09-06')
  assert.equal(command.recurrence?.anchorAt, undefined)
  assert.deepEqual(command.recurrence?.cadence, { kind: 'daily', interval: 1 })
})

test('timed recurrence derives cadence from the anchor day in its configured timezone', () => {
  const expectations = [
    ['weekly', { kind: 'weekly', interval: 1, weekdays: [0] }],
    ['monthly', { kind: 'monthly', interval: 1, dayOfMonth: 6 }],
    ['yearly', { kind: 'yearly', interval: 1, month: 9, dayOfMonth: 6 }],
  ] as const

  for (const [value, cadence] of expectations) {
    const command = buildQuickAddCommand({
      input: `${value} review`,
      candidates: [
        candidate('schedule', '2026-09-05T16:30:00.000Z', 'at 12:30am'),
        candidate('recurrence', value, value, 'resolved', 12),
      ],
      destinationListId: 'list:system:learning',
      timezone: 'Asia/Shanghai',
    })
    assert.deepEqual(command.recurrence?.cadence, cadence)
  }
})

test('command mapping rejects ambiguous candidates and removing recurrence creates a plain command', () => {
  assert.throws(() => buildQuickAddCommand({
    input: '下周 复习线代',
    candidates: [candidate('schedule', '2026-09-07', '下周', 'ambiguous')],
    destinationListId: 'list:system:learning',
    defaultStartOn: '2026-09-05',
    timezone: 'Asia/Shanghai',
  }), /AMBIGUOUS_QUICK_ADD_CANDIDATE/)

  const command = buildQuickAddCommand({
    input: '每天 复习线代',
    candidates: [],
    destinationListId: 'list:system:learning',
    defaultStartOn: '2026-09-05',
    timezone: 'Asia/Shanghai',
  })
  assert.equal(command.recurrence, undefined)
})

test('recognized text is removed only when the explicit title policy is enabled', () => {
  const candidates = [candidate('schedule', '2026-09-06', '明天'), candidate('priority', 'high', 'p1', 'resolved', 8)]
  assert.equal(buildQuickAddCommand({
    input: '明天 复习线代 p1', candidates, destinationListId: 'list:system:learning',
    defaultStartOn: '2026-09-05', timezone: 'Asia/Shanghai', removeRecognizedText: true,
  }).title, '复习线代')
  assert.equal(buildQuickAddCommand({
    input: '明天 复习线代 p1', candidates, destinationListId: 'list:system:learning',
    defaultStartOn: '2026-09-05', timezone: 'Asia/Shanghai', removeRecognizedText: false,
  }).title, '明天 复习线代 p1')
})

test('a mapped recurring create is atomic and idempotent while an invalid recurrence persists nothing', async () => {
  let nextId = 0
  const store = createInMemoryWorkspaceStore()
  const service = createTaskCapabilityService(store, () => '2026-09-05T10:00:00.000Z', (kind) => `${kind}-${++nextId}`)
  const initial = await service.query({ type: 'workspace.snapshot' })
  const command = buildQuickAddCommand({
    input: '每天 复习线代',
    candidates: [candidate('recurrence', 'daily', '每天')],
    destinationListId: 'list:system:learning',
    defaultStartOn: '2026-09-06',
    timezone: 'UTC',
  })
  const envelope = {
    protocolVersion: CAPABILITY_PROTOCOL_VERSION,
    idempotencyKey: 'quick-add-daily',
    source: 'human-ui' as const,
    expectedWorkspaceRevision: initial.revision,
    command,
  }

  const created = await service.execute(envelope)
  assert.deepEqual(await service.execute(envelope), created)
  const snapshot = await service.query({ type: 'workspace.snapshot' })
  assert.equal(snapshot.tasks.length, initial.tasks.length + 1)
  assert.equal(snapshot.recurrenceSeries.length, initial.recurrenceSeries.length + 1)
  assert.equal(snapshot.occurrences.filter(({ seriesId }) => seriesId === snapshot.recurrenceSeries.at(-1)?.id).length, 50)
  assert.equal(snapshot.commandReceipts.filter(({ idempotencyKey }) => idempotencyKey === 'quick-add-daily').length, 1)

  const beforeInvalid = structuredClone(snapshot)
  await assert.rejects(service.execute({
    ...envelope,
    idempotencyKey: 'quick-add-invalid',
    expectedWorkspaceRevision: snapshot.revision,
    command: {
      ...command,
      recurrence: { ...command.recurrence!, cadence: { kind: 'weekly', interval: 1, weekdays: [1, 1] } },
    },
  }), /VALIDATION_ERROR/)
  assert.deepEqual(await service.query({ type: 'workspace.snapshot' }), beforeInvalid)
})
