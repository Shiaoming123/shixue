import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseWorkspaceStateV4 } from '../src/domain/workspace/parse.ts'

const seed = JSON.parse(readFileSync(new URL('../tests/fixtures/calendar-workspace-hash-v4.json', import.meta.url))).state
const cases = []
for (const boundary of [false, true]) {
  const raw = structuredClone(seed)
  raw.commandReceipts = [{ id: 'hash-contract', idempotencyKey: 'hash-contract', commandType: 'test', source: 'agent', workspaceRevision: 1,
    result: boundary ? { z: [-0, 1e-7, 1e-6, 1e20, 1e21, 333333333.33333329], '😀': '中文\n\u000f', '\ue000': true, '10': null, '2': false, a: '/' } : {},
    createdAt: '2026-09-09T00:00:00Z', expiresAt: '2026-09-10T00:00:00Z' }]
  const parsed = parseWorkspaceStateV4(structuredClone(raw))
  assert.equal(parsed.commandReceipts[0].requestFingerprint, null)
  const parsedJson = JSON.stringify(parsed)
  cases.push({ name: boundary ? 'numbers-unicode-index-keys' : 'defaulted-receipt', raw, parsedJson, hash: `sha256:${createHash('sha256').update(parsedJson).digest('hex')}` })
}
const output = new URL('../tests/fixtures/calendar-future-workspace-hash.json', import.meta.url)
const bytes = `${JSON.stringify(cases, null, 2)}\n`
if (process.argv.includes('--check')) assert.equal(readFileSync(output, 'utf8').replaceAll('\r\n', '\n'), bytes)
else writeFileSync(output, bytes)
console.log('Future workspace parsed JSON hash fixtures verified')

// Empty-root contract remains the foundation for populated collection fixtures.
const rootCases = []
for (const revision of [1, 1e20, 1e21]) {
  const raw = { version: 4, revision, updatedAt: '2026-09-09T00:00:00Z' }
  for (const [key, value] of Object.entries(seed)) if (Array.isArray(value)) raw[key] = []
  const parsedJson = JSON.stringify(parseWorkspaceStateV4(structuredClone(raw)))
  rootCases.push({ name: `empty-${revision}`, rawJson: JSON.stringify(raw), parsedJson,
    hash: `sha256:${createHash('sha256').update(parsedJson).digest('hex')}` })
}
const rootOutput = new URL('../tests/fixtures/calendar-future-workspace-root.json', import.meta.url)
const rootBytes = `${JSON.stringify(rootCases, null, 2)}\n`
if (process.argv.includes('--check')) assert.equal(readFileSync(rootOutput, 'utf8').replaceAll('\r\n', '\n'), rootBytes)
else writeFileSync(rootOutput, rootBytes)
// Source/event-only parser fixtures; all other collections stay empty.
const calendarCases = []
const stamp = '2026-09-09T00:00:00Z'
const source = { id: 'source', revision: 1, provider: 'local', title: 'Calendar', color: '#Aa1234', group: null, permission: 'write', selected: true, hidden: false, timezone: 'Asia/Shanghai', createdAt: stamp, updatedAt: stamp, archivedAt: null }
const event = { id: 'event', revision: 1, sourceId: 'source', title: 'Meeting', notes: '', location: '', meetingUrl: null, organizer: { name: '', email: 'a@example.com' }, attendees: [{ name: 'B', email: 'b@example.com', role: 'optional', response: 'accepted' }], availability: 'busy', status: 'confirmed', time: { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-10' }, recurrence: null, createdAt: stamp, updatedAt: stamp, deletedAt: null }
function calendarCase(name, change, accepted = true) {
  const raw = JSON.parse(rootCases[0].rawJson)
  raw.calendarSources = [structuredClone(source)]
  raw.calendarEvents = [structuredClone(event)]
  change(raw)
  let parsedJson = null
  try { parsedJson = JSON.stringify(parseWorkspaceStateV4(structuredClone(raw))) } catch { assert.equal(accepted, false, name) }
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value
  calendarCases.push({ name, rawJson: JSON.stringify(reorder(raw)), accepted, parsedJson, hash: parsedJson === null ? null : `sha256:${createHash('sha256').update(parsedJson).digest('hex')}` })
}
calendarCase('all-day', () => {})
calendarCase('floating', r => { r.calendarEvents[0].time = { kind: 'floating', startLocal: '2026-09-09T10:00', endLocal: '2026-09-09T11:00' } })
calendarCase('fixed', r => { r.calendarEvents[0].time = { kind: 'fixed', startAt: '2026-09-09T10:00:00+08:00', endAt: '2026-09-09T11:00:00+08:00', timezone: 'Asia/Shanghai' }; r.calendarEvents[0].sourceUrl = 'https://example.com/item' })
calendarCase('orphan', r => { r.calendarEvents[0].sourceId = 'missing' }, false)
calendarCase('duplicate-id', r => { r.calendarEvents[0].id = 'source' }, false)
calendarCase('invalid-time', r => { r.calendarEvents[0].time.startOn = '2026-02-30' }, false)
calendarCase('unknown', r => { r.calendarEvents[0].unknown = true }, false)
for (const cadence of [{ kind: 'daily', interval: 2 }, { kind: 'weekly', interval: 2, weekdays: [5, 3] }, { kind: 'monthly', interval: 1, dayOfMonth: 31 }, { kind: 'yearly', interval: 1, month: 2, dayOfMonth: 29 }]) {
  const starts = { daily: '2026-09-11', weekly: '2026-09-11', monthly: '2026-09-30', yearly: '2027-02-28' }
  calendarCase(`recurrence-${cadence.kind}`, r => { r.calendarEvents[0].recurrence = { cadence, end: { kind: 'after', count: 3 }, exceptions: [{ originalStart: starts[cadence.kind], time: null }] } })
}
calendarCase('fixed-exception-canonical', r => {
  r.calendarEvents[0].time = { kind: 'fixed', startAt: '2026-09-09T23:00:00+08:00', endAt: '2026-09-10T00:00:00+08:00', timezone: 'Asia/Shanghai' }
  r.calendarEvents[0].recurrence = { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'on', date: '2026-09-10' }, exceptions: [{ originalStart: '2026-09-10T23:00:00+08:00', time: null }] }
})
calendarCase('floating-moved', r => {
  r.calendarEvents[0].time = { kind: 'floating', startLocal: '2026-09-09T10:00', endLocal: '2026-09-09T11:00' }
  r.calendarEvents[0].recurrence = { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' }, exceptions: [{ originalStart: '2026-09-10T10:00', time: { kind: 'floating', startLocal: '2026-09-12T10:00', endLocal: '2026-09-12T11:00' } }] }
})
calendarCase('unrelated-cancelled-event', r => { r.calendarEvents.push({ ...structuredClone(event), id: 'unrelated', status: 'cancelled', deletedAt: stamp }) })
for (const [name, start, next, accepted] of [
  ['negative-epoch-wall-clock', '10:00:30Z', '10:00:30Z', false],
  ['negative-epoch-ts-remainder', '10:00:30Z', '09:59:30Z', false],
  ['negative-epoch-milliseconds', '10:00:00.001Z', '09:59:00.001Z', false],
  ['negative-epoch-minute-aligned', '10:00:00Z', '10:00:00Z', true],
  ['negative-epoch-empty-exceptions', '10:00:30Z', null, false],
]) {
  calendarCase(name, r => {
    r.calendarEvents[0].time = { kind: 'fixed', startAt: `1969-09-09T${start}`, endAt: '1969-09-09T11:00:00Z', timezone: 'UTC' }
    r.calendarEvents[0].recurrence = { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' }, exceptions: next === null ? [] : [{ originalStart: `1969-09-10T${next}`, time: null }] }
  }, accepted)
}
assert.equal(calendarCases.find(item => item.name === 'negative-epoch-wall-clock').parsedJson, null)
assert.notEqual(calendarCases.find(item => item.name === 'negative-epoch-ts-remainder').parsedJson, null)
calendarCase('historical-shanghai-unsupported', r => {
  r.calendarEvents[0].time = { kind: 'fixed', startAt: '1988-09-09T10:00:00Z', endAt: '1988-09-09T11:00:00Z', timezone: 'Asia/Shanghai' }
  r.calendarEvents[0].recurrence = { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' }, exceptions: [{ originalStart: '1988-09-09T10:00:00Z', time: null }] }
}, false)
for (const [name, recurrence] of [
  ['duplicate-exception', { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' }, exceptions: [{ originalStart: '2026-09-09', time: null }, { originalStart: '2026-09-09', time: null }] }],
  ['weekly-overflow', { cadence: { kind: 'weekly', interval: 1e30, weekdays: [4] }, end: { kind: 'never' }, exceptions: [{ originalStart: '2026-09-11', time: null }] }],
  ['wrong-exception-kind', { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'never' }, exceptions: [{ originalStart: '2026-09-09', time: { kind: 'floating', startLocal: '2026-09-09T10:00', endLocal: '2026-09-09T11:00' } }] }],
  ['duplicate-weekdays', { cadence: { kind: 'weekly', interval: 1, weekdays: [3, 3] }, end: { kind: 'never' }, exceptions: [] }],
  ['empty-weekdays', { cadence: { kind: 'weekly', interval: 1, weekdays: [] }, end: { kind: 'never' }, exceptions: [] }],
  ['after-end-date', { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'on', date: '2026-09-09' }, exceptions: [{ originalStart: '2026-09-10', time: null }] }],
]) calendarCase(name, r => { r.calendarEvents[0].recurrence = recurrence }, false)
for (const [name, change] of [
  ['enum', r => { r.calendarEvents[0].status = 'done' }],
  ['blank-bom-title', r => { r.calendarEvents[0].title = '\uFEFF' }],
  ['email-bom', r => { r.calendarEvents[0].organizer.email = '\uFEFFa@example.com' }],
  ['boolean', r => { r.calendarSources[0].hidden = 1 }],
  ['color', r => { r.calendarSources[0].color = 'red' }],
  ['zone', r => { r.calendarSources[0].timezone = 'Bad/Zone' }],
  ['unsupported-zone', r => { r.calendarSources[0].timezone = 'America/New_York' }],
  ['url-credentials', r => { r.calendarEvents[0].meetingUrl = 'https://user@example.com/' }],
  ['duplicate-attendee', r => { r.calendarEvents[0].attendees.push({ ...r.calendarEvents[0].attendees[0], email: 'B@EXAMPLE.COM' }) }],
  ['unknown-time', r => { r.calendarEvents[0].time.extra = 1 }],
  ['unknown-person', r => { r.calendarEvents[0].organizer.extra = 1 }],
  ['unknown-source', r => { r.calendarSources[0].extra = 1 }],
  ['invalid-exception', r => { r.calendarEvents[0].recurrence = { cadence: { kind: 'daily', interval: 2 }, end: { kind: 'never' }, exceptions: [{ originalStart: '2026-09-10', time: null }] } }],
  ['past-count', r => { r.calendarEvents[0].recurrence = { cadence: { kind: 'daily', interval: 1 }, end: { kind: 'after', count: 1 }, exceptions: [{ originalStart: '2026-09-10', time: null }] } }],
  ['unknown-recurrence', r => { r.calendarEvents[0].recurrence = { cadence: { kind: 'daily', interval: 1, extra: true }, end: { kind: 'never' }, exceptions: [] } }],
]) calendarCase(name, change, false)
const calendarOutput = new URL('../tests/fixtures/calendar-future-workspace-calendar.json', import.meta.url)
const calendarBytes = `${JSON.stringify(calendarCases, null, 2)}\n`
if (process.argv.includes('--check')) assert.equal(readFileSync(calendarOutput, 'utf8').replaceAll('\r\n', '\n'), calendarBytes)
else writeFileSync(calendarOutput, calendarBytes)

const listCases = []
function listCase(name, change, accepted = true) {
  const raw = JSON.parse(rootCases[0].rawJson)
  const common = { title: '学习😀', position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: null }
  raw.listGroups = [{ id: 'group', ...common }]
  raw.lists = [{ id: 'list', groupId: 'group', ...common, goal: '', successCriteria: ['完成'], weeklyTargetMinutes: null }]
  raw.sections = [{ id: 'section', listId: 'list', ...common }]
  raw.tags = [{ id: 'tag', ...common }]
  change(raw)
  let parsedJson = null
  try { parsedJson = JSON.stringify(parseWorkspaceStateV4(structuredClone(raw))) } catch { assert.equal(accepted, false, name) }
  const reverse = v => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v
  listCases.push({ name, rawJson: JSON.stringify(reverse(raw)), accepted, parsedJson, hash: parsedJson === null ? null : `sha256:${createHash('sha256').update(parsedJson).digest('hex')}` })
}
listCase('list-core', () => {})
listCase('numeric-unicode', r => { r.lists[0].position = -0; r.lists[0].weeklyTargetMinutes = 1e21; r.listGroups[0].position = 1e20; r.tags[0].title = '中文\n😀'; r.lists[0].goal = '\uFEFF\u000f'; })
listCase('archived-duplicate-titles', r => { r.tags.push({ ...r.tags[0], id: 'archived', archivedAt: stamp }); r.lists[0].groupId = null })
listCase('calendar-coexistence', r => { r.calendarSources = [source]; r.calendarEvents = [event] })
for (const [name, change] of [
  ['group-orphan', r => { r.lists[0].groupId = 'missing' }],
  ['section-orphan', r => { r.sections[0].listId = 'missing' }],
  ['duplicate-id', r => { r.tags[0].id = 'group' }],
  ['calendar-duplicate-id', r => { r.calendarSources = [{ ...source, id: 'tag' }] }],
  ['duplicate-tag-title', r => { r.tags.push({ ...r.tags[0], id: 'other' }) }],
  ['untrimmed-tag', r => { r.tags[0].title = '\uFEFFtag' }],
  ['blank-title', r => { r.listGroups[0].title = '\uFEFF' }],
  ['negative-position', r => { r.lists[0].position = -1 }],
  ['fraction-position', r => { r.sections[0].position = 0.5 }],
  ['zero-target', r => { r.lists[0].weeklyTargetMinutes = 0 }],
  ['target-type', r => { r.lists[0].weeklyTargetMinutes = '2' }],
  ['criteria-type', r => { r.lists[0].successCriteria = [false] }],
  ['bad-date', r => { r.tags[0].createdAt = '2026-02-30T00:00:00Z' }],
  ['missing-required', r => { delete r.lists[0].goal }],
  ['unknown-field', r => { r.sections[0].extra = 1 }],
  ['tasks-unmodeled', r => { r.tasks = [{}] }],
  ['recurrence-unmodeled', r => { r.recurrenceSeries = [{}] }],
]) listCase(name, change, false)
const listOutput = new URL('../tests/fixtures/calendar-future-workspace-lists.json', import.meta.url)
const listBytes = `${JSON.stringify(listCases, null, 2)}\n`
if (process.argv.includes('--check')) assert.equal(readFileSync(listOutput, 'utf8').replaceAll('\r\n', '\n'), listBytes)
else writeFileSync(listOutput, listBytes)
const taskCases = []
function taskCase(name, change, accepted = true) {
  const raw = JSON.parse(listCases[0].rawJson)
  raw.tasks = [{ id: 'task', revision: 1, mode: 'general', listId: 'list', sectionId: 'section', tagIds: ['tag'], title: '任务😀', notes: '', status: 'inbox', schedule: { startAt: null, startOn: null, estimateMinutes: null }, deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [], learning: null, recurrenceSeriesId: null, createdAt: stamp, updatedAt: stamp, deletedAt: null }]
  raw.taskEvents = [{ id: 'event', sequence: 1, taskId: 'task', type: 'captured', occurredAt: stamp, fromStatus: null, toStatus: 'inbox', reason: null, completionRecordId: null }]
  change(raw)
  let parsedJson = null
  try { parsedJson = JSON.stringify(parseWorkspaceStateV4(structuredClone(raw))) } catch { assert.equal(accepted, false, name) }
  const reverse = v => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v
  taskCases.push({ name, rawJson: JSON.stringify(reverse(raw)), accepted, parsedJson, hash: parsedJson === null ? null : `sha256:${createHash('sha256').update(parsedJson).digest('hex')}` })
}
taskCase('created-omitted-occurrence', () => {})
taskCase('explicit-null-occurrence', r => { r.taskEvents[0].occurrenceId = null })
taskCase('learning-planned', r => { Object.assign(r.tasks[0], { mode: 'learning', learning: { acceptanceCriteria: ['理解'], blockedReason: null }, status: 'planned', sectionId: null }); Object.assign(r.taskEvents[0], { type: 'planned', toStatus: 'planned' }) })
taskCase('schedule-deadline-checklist-numbers', r => { Object.assign(r.tasks[0], { revision: 1e21, priority: 'high', notes: '\u000f\n中文', schedule: { startOn: '2026-09-09', startAt: null, estimateMinutes: 1e20 }, deadline: { dueAt: stamp, dueOn: null }, checklist: [{ id: 'item', text: '检查😀', checked: true, checkedAt: stamp, position: -0 }] }) })
taskCase('timestamp-schedule-date-deadline', r => { r.tasks[0].schedule.startAt = stamp; r.tasks[0].deadline.dueOn = '2026-09-10' })
taskCase('full-chain-completed', r => {
  for (const [type, status] of [['planned', 'planned'], ['started', 'in_progress'], ['blocked', 'blocked'], ['resumed', 'in_progress'], ['completed', 'completed'], ['reopened', 'inbox'], ['cancelled', 'cancelled'], ['reopened', 'planned'], ['paused', 'planned'], ['rescheduled', 'planned'], ['completed', 'completed'], ['deleted', 'completed']]) {
    r.taskEvents.push({ ...r.taskEvents[0], id: `event-${r.taskEvents.length}`, sequence: r.taskEvents.length + 1, type, fromStatus: r.taskEvents.at(-1).toStatus, toStatus: status, reason: '原因' })
  }
  r.tasks[0].status = 'completed'; r.tasks[0].deletedAt = stamp
})
taskCase('interleaved-tasks', r => { r.tasks.push({ ...r.tasks[0], id: 'other' }); r.taskEvents.push({ ...r.taskEvents[0], id: 'other-event', sequence: 2, taskId: 'other', type: 'migrated' }) })
for (const [name, change] of [
  ['missing-field', r => { delete r.tasks[0].notes }],
  ['unknown-task', r => { r.tasks[0].extra = 1 }],
  ['unknown-schedule', r => { r.tasks[0].schedule.extra = 1 }],
  ['unknown-deadline', r => { r.tasks[0].deadline.extra = 1 }],
  ['unknown-event', r => { r.taskEvents[0].extra = 1 }],
  ['unknown-learning', r => { r.tasks[0].mode = 'learning'; r.tasks[0].learning = { acceptanceCriteria: [], blockedReason: null, extra: 1 } }],
  ['unknown-checklist', r => { r.tasks[0].checklist = [{ id: 'i', text: 'x', checked: false, checkedAt: null, position: 0, extra: 1 }] }],
  ['bad-status', r => { r.tasks[0].status = 'open' }],
  ['bad-priority', r => { r.tasks[0].priority = 'urgent' }],
  ['bad-event-type', r => { r.taskEvents[0].type = 'created' }],
  ['bad-revision', r => { r.tasks[0].revision = 0 }],
  ['bad-estimate', r => { r.tasks[0].schedule.estimateMinutes = 0.5 }],
  ['bad-date', r => { r.tasks[0].deadline.dueOn = '2026-02-30' }],
  ['both-starts', r => { r.tasks[0].schedule.startAt = stamp; r.tasks[0].schedule.startOn = '2026-09-09' }],
  ['both-dues', r => { r.tasks[0].deadline.dueAt = stamp; r.tasks[0].deadline.dueOn = '2026-09-09' }],
  ['learning-mode-mismatch', r => { r.tasks[0].mode = 'learning' }],
  ['list-orphan', r => { r.tasks[0].listId = 'missing' }],
  ['section-orphan', r => { r.tasks[0].sectionId = 'missing' }],
  ['section-wrong-list', r => { r.lists.push({ ...r.lists[0], id: 'other' }); r.tasks[0].listId = 'other' }],
  ['tag-orphan', r => { r.tasks[0].tagIds = ['missing'] }],
  ['duplicate-tag', r => { r.tasks[0].tagIds.push('tag') }],
  ['duplicate-checklist', r => { r.tasks[0].checklist = Array(2).fill({ id: 'i', text: 'x', checked: false, checkedAt: null, position: 0 }) }],
  ['checklist-type', r => { r.tasks[0].checklist = [{ id: 'i', text: 'x', checked: 1, checkedAt: null, position: 0 }] }],
  ['duplicate-global-id', r => { r.tasks[0].id = 'tag' }],
  ['event-global-id', r => { r.taskEvents[0].id = 'list' }],
  ['event-task-orphan', r => { r.taskEvents[0].taskId = 'missing' }],
  ['missing-chain', r => { r.taskEvents = [] }],
  ['bad-first-status', r => { r.taskEvents[0].fromStatus = 'inbox' }],
  ['null-to-status', r => { r.taskEvents[0].toStatus = null }],
  ['current-state-mismatch', r => { r.tasks[0].status = 'completed' }],
  ['sequence-gap', r => { r.taskEvents[0].sequence = 2 }],
  ['duplicate-sequence', r => { r.taskEvents.push({ ...r.taskEvents[0], id: 'second', fromStatus: 'inbox' }) }],
  ['broken-chain', r => { r.taskEvents.push({ ...r.taskEvents[0], id: 'second', sequence: 2, fromStatus: 'completed' }) }],
  ['recurrence-ref', r => { r.tasks[0].recurrenceSeriesId = 'series' }],
  ['completion-ref', r => { r.taskEvents[0].completionRecordId = 'record' }],
  ['occurrence-ref', r => { r.taskEvents[0].occurrenceId = 'occurrence' }],
]) taskCase(name, change, false)
function recurring(r) {
 r.tasks[0].recurrenceSeriesId = 'series'
 r.recurrenceSeries = [{id:'series',taskId:'task',revision:1,cadence:{kind:'weekly',interval:1,weekdays:[1,3]},basis:'fixed_schedule',anchorOn:'2026-09-09',end:{kind:'never'},timezone:'Asia/Shanghai',createdThrough:null,createdCount:1}]
 r.occurrences = [{id:'occurrence',seriesId:'series',ordinal:1,scheduledOn:'2026-09-09',status:'pending',override:null,completedAt:null,revision:1}]
 r.taskEvents[0].occurrenceId = 'occurrence'
}
taskCase('recurring-defaults', recurring)
for (const override of [{estimateMinutes:null},{scheduledAt:stamp,estimateMinutes:20},{scheduledOn:'2026-09-10',estimateMinutes:1}]) taskCase('recurring-override', r => {recurring(r); r.occurrences[0].override=override})
for (const cadence of [{kind:'daily',interval:2},{kind:'monthly',interval:1,dayOfMonth:31},{kind:'yearly',interval:1,month:2,dayOfMonth:31}]) taskCase(`recurring-${cadence.kind}`, r => {recurring(r);r.recurrenceSeries[0].cadence=cadence})
for (const [name,change] of [
 ['anchor-none',r=>{delete r.recurrenceSeries[0].anchorOn}],
 ['anchor-both',r=>{r.recurrenceSeries[0].anchorAt=stamp}],
 ['schedule-none',r=>{delete r.occurrences[0].scheduledOn}],
 ['schedule-both',r=>{r.occurrences[0].scheduledAt=stamp}],
 ['duplicate-days',r=>{r.recurrenceSeries[0].cadence.weekdays=[1,1]}],
 ['orphan-series',r=>{r.occurrences[0].seriesId='missing'}],
 ['orphan-task',r=>{r.recurrenceSeries[0].taskId='missing'}],
 ['unlinked-never',r=>{r.tasks[0].recurrenceSeriesId=null}],
 ['duplicate-id',r=>{r.occurrences[0].id='series'}],
]) taskCase(`recurring-${name}`,r=>{recurring(r);change(r)},false)
for (const end of [{kind:'on',date:'2026-09-10'},{kind:'after',count:2}]) taskCase('recurring-ended-unlinked',r=>{recurring(r);r.recurrenceSeries[0].end=end;r.tasks[0].recurrenceSeriesId=null})
taskCase('recurring-timestamps',r=>{recurring(r);delete r.recurrenceSeries[0].anchorOn;r.recurrenceSeries[0].anchorAt=stamp;delete r.occurrences[0].scheduledOn;r.occurrences[0].scheduledAt=stamp;r.recurrenceSeries[0].createdThrough=stamp;r.recurrenceSeries[0].basis='after_completion';r.calendarSources=[source];r.calendarEvents=[{...event,id:'calendar-fact'}]})
for (const [key,values] of Object.entries({revision:[0,1.5,null],basis:['unknown',null],anchorOn:['2026-02-30',null],createdThrough:['bad','2026-02-30'],createdCount:[-1,0.5,null],timezone:['invalid',null],cadence:[null,{kind:'weekly',interval:1,weekdays:[]},{kind:'weekly',interval:1,weekdays:[7]},{kind:'monthly',interval:1,dayOfMonth:32},{kind:'yearly',interval:1,month:13,dayOfMonth:1}],end:[null,{kind:'after',count:0},{kind:'on',date:'2026-02-30'}]})) for (const value of values) taskCase(`recurring-invalid-series-${key}`,r=>{recurring(r);r.recurrenceSeries[0][key]=value},false)
for (const [key,values] of Object.entries({ordinal:[0,1.5,null],status:['unknown',null],override:[{scheduledAt:stamp,scheduledOn:'2026-09-09',estimateMinutes:null},{estimateMinutes:0},{}],completedAt:['bad']})) for (const value of values) taskCase(`recurring-invalid-occurrence-${key}`,r=>{recurring(r);r.occurrences[0][key]=value},false)
for (const group of ['recurrenceSeries','occurrences']) for (const key of group==='recurrenceSeries'?['cadence','end','createdThrough','createdCount']:['override','completedAt']) taskCase(`recurring-missing-${key}`,r=>{recurring(r);delete r[group][0][key]},false)
taskCase('recurring-wrong-task',r=>{recurring(r);r.tasks.push({...r.tasks[0],id:'other',recurrenceSeriesId:null});r.taskEvents.push({...r.taskEvents[0],id:'other-event',sequence:2,taskId:'other'});r.recurrenceSeries[0].taskId='other'},false)
taskCase('recurring-event-wrong-task',r=>{recurring(r);r.tasks.push({...r.tasks[0],id:'other',recurrenceSeriesId:null});r.taskEvents.push({...r.taskEvents[0],id:'other-event',sequence:2,taskId:'other'})},false)
taskCase('recurring-duplicate-series',r=>{recurring(r);r.recurrenceSeries.push({...r.recurrenceSeries[0]})},false)
taskCase('recurring-global-id',r=>{recurring(r);r.occurrences[0].id='tag';r.taskEvents[0].occurrenceId='tag'},false)
function session(r) {
  r.tasks[0].status = 'in_progress'
  r.taskEvents[0].toStatus = 'in_progress'
  r.studySessions = [{ id: 'session', taskId: 'task', state: 'running', startedAt: stamp, activeSince: stamp, elapsedSeconds: 0, scratchpad: '', createdAt: stamp, updatedAt: stamp, deletedAt: null }]
}
taskCase('session-running', session)
taskCase('session-paused', r => { session(r); Object.assign(r.studySessions[0], { state: 'paused', activeSince: null, elapsedSeconds: 1e21, scratchpad: '笔记😀\n\u000f' }) })
taskCase('session-finished-unrelated', r => { session(r); r.studySessions.push({ ...r.studySessions[0], id: 'finished', state: 'finished', activeSince: null }); r.studySessions.push({ ...r.studySessions[0], id: 'deleted', deletedAt: stamp }) })
taskCase('session-no-time-order-policy', r => { session(r); r.studySessions[0].activeSince = '2020-01-01T00:00:00Z' })
for (const [name, change] of [
 ['orphan', r => { r.studySessions[0].taskId = 'missing' }],
 ['duplicate', r => { r.studySessions.push({ ...r.studySessions[0] }) }],
 ['global-id', r => { r.studySessions[0].id = 'event' }],
 ['two-active', r => { r.studySessions.push({ ...r.studySessions[0], id: 'second', state: 'paused', activeSince: null }) }],
 ['wrong-task-status', r => { r.tasks[0].status = r.taskEvents[0].toStatus = 'inbox' }],
 ['running-null', r => { r.studySessions[0].activeSince = null }],
 ['paused-time', r => { r.studySessions[0].state = 'paused' }],
 ['finished-time', r => { r.studySessions[0].state = 'finished' }],
 ['state', r => { r.studySessions[0].state = 'unknown' }],
 ['negative', r => { r.studySessions[0].elapsedSeconds = -1 }],
 ['fraction', r => { r.studySessions[0].elapsedSeconds = 0.1 }],
 ['number-type', r => { r.studySessions[0].elapsedSeconds = '0' }],
 ['missing', r => { delete r.studySessions[0].activeSince }],
 ['null-text', r => { r.studySessions[0].scratchpad = null }],
 ['invalid-time', r => { r.studySessions[0].startedAt = 'invalid' }],
 ['unknown-field', r => { r.studySessions[0].extra = true }],
]) taskCase(`session-${name}`, r => { session(r); change(r) }, false)
function evidence(r) {
  r.completionRecords = [{ id: 'record', taskId: 'task', topicId: null, sessionIds: [], taskTitleSnapshot: 'Evidence', learned: 'learned', evidence: 'proof', blocker: '', nextAction: 'next', mastery: null, completedAt: stamp, reviewStage: 0, nextReviewOn: null, lastReviewResult: null, lastReviewedAt: null, createdAt: stamp, updatedAt: stamp, deletedAt: null }]
  r.taskEvents[0].completionRecordId = 'record'
}
taskCase('record-defaults-captured-event', evidence)
for (const [name, field, value] of [['unknown-task', 'taskId', 'missing'], ['unknown-session', 'sessionIds', ['missing']], ['unknown-tag', 'tagIdsSnapshot', ['missing']], ['duplicate-tag', 'tagIdsSnapshot', ['tag', 'tag']], ['null-tags', 'tagIdsSnapshot', null], ['mastery-range', 'mastery', 6], ['stage-range', 'reviewStage', 4], ['bad-date', 'nextReviewOn', 'bad'], ['bad-stamp', 'completedAt', 'bad'], ['missing-obligation', 'nextReviewOn', '2026-09-10']]) {
 taskCase(`record-${name}`, r => { evidence(r); r.completionRecords[0][field] = value }, false)
 assert.equal(taskCases.at(-1).parsedJson, null, name)
}
taskCase('record-full-deleted-snapshot', r => { session(r); evidence(r); r.studySessions[0].state = 'finished'; r.studySessions[0].activeSince = null; Object.assign(r.completionRecords[0], { topicId: 'historical-topic', sessionIds: ['session', 'session'], tagIdsSnapshot: ['tag'], taskTitleSnapshot: '证据😀\n', blocker: '', mastery: 5, reviewStage: 3, nextReviewOn: '2026-09-10', lastReviewResult: 'fuzzy', lastReviewedAt: stamp, deletedAt: stamp }) })
for (const [name, change] of [
 ['wrong-session-owner', r => { r.tasks.push({ ...r.tasks[0], id: 'other' }); r.taskEvents.push({ ...r.taskEvents[0], id: 'other-event', taskId: 'other', sequence: 2, completionRecordId: null }); r.studySessions = [{ id: 'session', taskId: 'other', state: 'finished', startedAt: stamp, activeSince: null, elapsedSeconds: 0, scratchpad: '', createdAt: stamp, updatedAt: stamp, deletedAt: null }]; r.completionRecords[0].sessionIds = ['session'] }],
 ['wrong-event-owner', r => { r.tasks.push({ ...r.tasks[0], id: 'other' }); r.taskEvents.push({ ...r.taskEvents[0], id: 'other-event', taskId: 'other', sequence: 2 }) }],
 ['orphan-event-record', r => { r.taskEvents[0].completionRecordId = 'missing' }],
 ['global-duplicate', r => { r.completionRecords[0].id = 'tag'; r.taskEvents[0].completionRecordId = 'tag' }],
 ['record-duplicate', r => { r.completionRecords.push({ ...r.completionRecords[0] }) }],
 ['missing-topic', r => { delete r.completionRecords[0].topicId }],
 ['invalid-enum', r => { r.completionRecords[0].lastReviewResult = 'wrong' }],
 ['mastery-fraction', r => { r.completionRecords[0].mastery = 1.5 }],
 ['mastery-zero', r => { r.completionRecords[0].mastery = 0 }],
 ['stage-negative', r => { r.completionRecords[0].reviewStage = -1 }],
 ['stage-fraction', r => { r.completionRecords[0].reviewStage = 1.5 }],
 ['empty-evidence', r => { r.completionRecords[0].evidence = ' ' }],
]) { taskCase(`record-${name}`, r => { evidence(r); change(r) }, false); assert.equal(taskCases.at(-1).parsedJson, null, name) }
taskCase('record-unknown-field', r => { evidence(r); r.completionRecords[0].extra = 1 }, false)
function review(r) {
 evidence(r); r.completionRecords[0].nextReviewOn = '2026-09-10'
 r.tasks.push({ ...structuredClone(r.tasks[0]), id: 'review-task', mode: 'learning', learning: { acceptanceCriteria: [], blockedReason: null } })
 r.taskEvents.push({ ...r.taskEvents[0], id: 'review-event', taskId: 'review-task', sequence: 2, completionRecordId: null })
 r.reviewTaskLinks = [{ id: 'link', completionRecordId: 'record', reviewTaskId: 'review-task', occurrenceId: null, reviewStage: 0, dueOn: '2026-09-10', completedAt: null, createdAt: stamp, updatedAt: stamp }]
}
taskCase('review-pending-default', review)
taskCase('review-pending-null', r => { review(r); r.reviewTaskLinks[0].completion = null })
for (const result of ['clear', 'fuzzy', 'relearn', null]) taskCase(`review-completed-${result}`, r => { review(r); r.completionRecords[0].nextReviewOn = null; r.completionRecords[0].deletedAt = stamp; r.tasks[1].deletedAt = stamp; Object.assign(r.reviewTaskLinks[0], { completedAt: stamp, completion: result === null ? null : { result, reviewedOn: '2026-09-11' } }) })
for (const [field, value] of [['id', 'tag'], ['completionRecordId', 'missing'], ['reviewTaskId', 'missing'], ['reviewTaskId', 'task'], ['occurrenceId', 'missing'], ['reviewStage', 4], ['reviewStage', 0.5], ['reviewStage', 1], ['dueOn', 'bad'], ['dueOn', '2026-09-11'], ['completedAt', 'bad'], ['completion', {}], ['completion', { result: 'clear', reviewedOn: '2026-09-11' }]]) {
 taskCase(`review-invalid-${field}-${JSON.stringify(value)}`, r => { review(r); r.reviewTaskLinks[0][field] = value }, false); assert.equal(taskCases.at(-1).parsedJson, null)
}
for (const field of ['id', 'completionRecordId', 'reviewTaskId', 'occurrenceId', 'reviewStage', 'dueOn', 'completedAt', 'createdAt', 'updatedAt']) taskCase(`review-missing-${field}`, r => { review(r); delete r.reviewTaskLinks[0][field] }, false)
for (const target of ['record', 'task']) taskCase(`review-deleted-${target}`, r => { review(r); (target === 'record' ? r.completionRecords[0] : r.tasks[1]).deletedAt = stamp }, false)
taskCase('review-general', r => { review(r); r.tasks[1].mode = 'general'; r.tasks[1].learning = null }, false)
taskCase('review-duplicate-target', r => { review(r); r.reviewTaskLinks.push({ ...r.reviewTaskLinks[0], id: 'link2' }) }, false)
function recurringReview(r) {
 review(r); recurring(r); r.tasks[0].recurrenceSeriesId = null; r.tasks[1].recurrenceSeriesId = 'series'; r.recurrenceSeries[0].taskId = 'review-task'; delete r.taskEvents[0].occurrenceId; r.reviewTaskLinks[0].occurrenceId = 'occurrence'
}
taskCase('review-occurrence-pending', recurringReview)
taskCase('review-occurrence-completed', r => { recurringReview(r); r.completionRecords[0].nextReviewOn = null; r.reviewTaskLinks[0].completedAt = stamp; r.occurrences[0].status = 'completed' })
for (const [name, change] of [
 ['wrong-owner', r => { r.tasks[0].recurrenceSeriesId = 'series'; r.tasks[1].recurrenceSeriesId = null; r.recurrenceSeries[0].taskId = 'task' }],
 ['pending-status', r => { r.occurrences[0].status = 'completed' }],
 ['completed-status', r => { r.reviewTaskLinks[0].completedAt = stamp; r.completionRecords[0].nextReviewOn = null }],
 ['duplicate-pending-record', r => { r.reviewTaskLinks.push({ ...r.reviewTaskLinks[0], id: 'link2', occurrenceId: null }) }],
 ['completed-obligation', r => { r.reviewTaskLinks[0].completedAt = stamp; r.occurrences[0].status = 'completed' }],
]) { taskCase(`review-occurrence-${name}`, r => { recurringReview(r); change(r) }, false); assert.equal(taskCases.at(-1).parsedJson, null) }
for (const completion of [{ result: 'bad', reviewedOn: '2026-09-11' }, { result: 'clear', reviewedOn: null }, { result: 'clear' }, []]) {
 taskCase(`review-bad-completion-${JSON.stringify(completion)}`, r => { review(r); r.reviewTaskLinks[0].completion = completion }, false); assert.equal(taskCases.at(-1).parsedJson, null)
}
for (const nested of [false, true]) taskCase(`review-unknown-${nested}`, r => { review(r); if (nested) { r.completionRecords[0].nextReviewOn = null; r.reviewTaskLinks[0].completedAt = stamp; r.reviewTaskLinks[0].completion = { result: 'clear', reviewedOn: '2026-09-11', extra: true } } else r.reviewTaskLinks[0].extra = true }, false)
const reminder = r => { r.reminderRules = [{ id: 'rule', target: { kind: 'task', taskId: 'task', occurrenceId: null }, trigger: { kind: 'at_start' }, enabled: true, revision: 1 }] }
for (const trigger of [{ kind: 'at_start' }, { kind: 'before_start', minutes: 5 }, { kind: 'before_due', minutes: 1e21 }, { kind: 'absolute', at: stamp }]) taskCase(`rule-${trigger.kind}`, r => { reminder(r); r.reminderRules[0].trigger = trigger })
taskCase('rule-legacy-order', r => { reminder(r); const x = r.reminderRules[0]; delete x.target; Object.assign(x, { taskId: 'task', occurrenceId: null, owner: 'legacy', enabled: false }) })
taskCase('rule-current-legacy-consistent', r => { reminder(r); Object.assign(r.reminderRules[0], { taskId: 'task', occurrenceId: null, owner: 'user' }) })
for (const start of [null, '2026-09-09', '2026-09-09T10:00', '2026-09-09T10:00:00+08:00']) taskCase(`rule-event-${start}`, r => { reminder(r); r.calendarSources = [structuredClone(source)]; r.calendarEvents = [{ ...structuredClone(event), id: 'reminder-event' }]; r.reminderRules[0].target = { kind: 'event', eventId: 'reminder-event', originalStart: start }; r.reminderRules[0].enabled = false })
for (const [name, change] of [
 ['orphan-task', x => x.target.taskId = 'missing'], ['orphan-occurrence', x => x.target.occurrenceId = 'missing'],
 ['null-target', x => x.target = null], ['bad-kind', x => x.target.kind = 'other'], ['missing-occurrence', x => delete x.target.occurrenceId],
 ['bad-enabled', x => x.enabled = 1], ['bad-owner', x => x.owner = null], ['bad-revision', x => x.revision = 0],
 ['bad-minutes', x => x.trigger = { kind: 'before_start', minutes: 0 }], ['bad-stamp', x => x.trigger = { kind: 'absolute', at: 'bad' }],
 ['legacy-conflict', x => x.taskId = 'other'], ['global-id', x => x.id = 'task'],
 ['unknown', x => x.extra = true], ['nested-unknown', x => x.trigger.extra = true],
]) taskCase(`rule-invalid-${name}`, r => { reminder(r); change(r.reminderRules[0]) }, false)
taskCase('rule-duplicate', r => { reminder(r); r.reminderRules.push(structuredClone(r.reminderRules[0])) }, false)
for (const kind of ['before_due', 'at_start']) taskCase(`rule-event-invalid-${kind}`, r => { reminder(r); r.reminderRules[0].target = { kind: 'event', eventId: 'missing', originalStart: null }; r.reminderRules[0].trigger = kind === 'before_due' ? { kind, minutes: 1 } : { kind } }, false)
taskCase('rule-occurrence', r => { recurring(r); reminder(r); r.reminderRules[0].target.occurrenceId = 'occurrence' })
taskCase('rule-occurrence-foreign', r => { recurring(r); reminder(r); r.tasks.push({ ...r.tasks[0], id: 'other', recurrenceSeriesId: null }); r.taskEvents.push({ ...r.taskEvents[0], id: 'other-event', taskId: 'other', occurrenceId: null, sequence: 2 }); r.reminderRules[0].target = { kind: 'task', taskId: 'other', occurrenceId: 'occurrence' } }, false)
for (const field of ['id', 'trigger', 'enabled', 'revision']) taskCase(`rule-missing-${field}`, r => { reminder(r); delete r.reminderRules[0][field] }, false)
taskCase('rule-event-before-due-existing', r => { reminder(r); r.calendarSources = [structuredClone(source)]; r.calendarEvents = [{ ...structuredClone(event), id: 'reminder-event' }]; r.reminderRules[0].target = { kind: 'event', eventId: 'reminder-event', originalStart: null }; r.reminderRules[0].trigger = { kind: 'before_due', minutes: 5 } }, false)
for (const [name, start, expected, accepted] of [
 ['expanded-utc-year', '9999-12-31T23:30:00-01:00', '+010000-01-01T00:30:00.000Z', false],
 ['upper-utc-year-boundary', '9999-12-31T23:30:00-00:29', '9999-12-31T23:59:00.000Z', true],
 ['lower-utc-year-boundary', '0100-01-01T00:30:00+00:30', '0100-01-01T00:00:00.000Z', true],
 ['below-native-utc-year', '0100-01-01T00:30:00+01:00', '0099-12-31T23:30:00.000Z', false],
]) {
 taskCase(`rule-event-${name}`, r => { reminder(r); r.calendarSources = [structuredClone(source)]; r.calendarEvents = [{ ...structuredClone(event), id: 'reminder-event' }]; r.reminderRules[0].target = { kind: 'event', eventId: 'reminder-event', originalStart: start } }, accepted)
 assert.equal(JSON.parse(taskCases.at(-1).parsedJson).reminderRules[0].target.originalStart, expected)
}
const delivery = r => { reminder(r); r.reminderDeliveries = [{ id: 'delivery', reminderRuleId: 'rule', occurrenceId: null, scheduledFor: stamp, status: 'pending', snoozedUntil: null, action: null }] }
const eventDelivery = r => { delivery(r); r.calendarSources = [structuredClone(source)]; r.calendarEvents = [{ ...structuredClone(event), id: 'reminder-event' }]; r.reminderRules[0].target = { kind: 'event', eventId: 'reminder-event', originalStart: null }; r.reminderRules[0].enabled = false }
for (const status of ['pending', 'delivered', 'snoozed', 'acted', 'dismissed', 'failed', 'cancelled', 'armed', 'ambiguous']) taskCase(`delivery-${status}`, r => { delivery(r); Object.assign(r.reminderDeliveries[0], { status, ...(status === 'armed' ? { revision: 1, claim: { token: 'claim😀', armedAt: stamp } } : {}) }) })
taskCase('delivery-optional-order', r => { delivery(r); Object.assign(r.reminderDeliveries[0], { revision: 1e21, claim: { token: 'claim', armedAt: stamp }, acknowledgedAt: stamp, snoozedUntil: stamp, action: 'complete', originalStart: null }) })
taskCase('delivery-occurrence', r => { recurring(r); delivery(r); r.reminderDeliveries[0].occurrenceId = 'occurrence' })
taskCase('delivery-rule-occurrence', r => { recurring(r); delivery(r); r.reminderRules[0].target.occurrenceId = 'occurrence'; r.reminderDeliveries[0].occurrenceId = 'occurrence' })
taskCase('delivery-same-target-distinct-times', r => { delivery(r); r.reminderDeliveries.push({ ...r.reminderDeliveries[0], id: 'second', scheduledFor: '2026-09-10T00:00:00Z' }) })
for (const start of [undefined, null, '2026-09-09', '2026-09-09T10:00', '2026-09-09T10:00:00.123456+08:00']) taskCase(`delivery-event-${start}`, r => { eventDelivery(r); Object.assign(r.reminderDeliveries[0], { originalStart: start, status: 'cancelled', action: 'open' }) })
taskCase('delivery-event-specific-normalized', r => { eventDelivery(r); r.reminderRules[0].target.originalStart = '2026-09-09T10:00:00+08:00'; r.reminderDeliveries[0].originalStart = '2026-09-09T02:00:00Z' })
for (const field of ['id', 'reminderRuleId', 'occurrenceId', 'scheduledFor', 'status', 'snoozedUntil', 'action']) taskCase(`delivery-missing-${field}`, r => { delivery(r); delete r.reminderDeliveries[0][field] }, false)
for (const [field, value] of [['revision', null], ['revision', 0], ['revision', 0.5], ['claim', null], ['claim', {}], ['claim', { token: '', armedAt: stamp }], ['claim', { token: 't', armedAt: 'bad' }], ['acknowledgedAt', null], ['acknowledgedAt', 'bad'], ['scheduledFor', 'bad'], ['snoozedUntil', 'bad'], ['status', null], ['status', 'retry'], ['action', 'dismiss'], ['originalStart', '2026-09-09'], ['reminderRuleId', 'missing'], ['occurrenceId', 'missing'], ['id', 'task'], ['extra', 1], ['claim', { token: 't', armedAt: stamp, extra: 1 }]]) taskCase(`delivery-invalid-${field}-${JSON.stringify(value)}`, r => { delivery(r); r.reminderDeliveries[0][field] = value }, false)
for (const field of ['claim', 'revision']) taskCase(`delivery-armed-missing-${field}`, r => { delivery(r); Object.assign(r.reminderDeliveries[0], { status: 'armed', revision: 1, claim: { token: 't', armedAt: stamp } }); delete r.reminderDeliveries[0][field] }, false)
taskCase('delivery-duplicate-id', r => { delivery(r); r.reminderDeliveries.push({ ...r.reminderDeliveries[0], scheduledFor: '2026-09-10T00:00:00Z' }) }, false)
taskCase('delivery-duplicate-key-offset', r => { delivery(r); r.reminderDeliveries[0].scheduledFor = '2026-09-09T10:00:00.123456+08:00'; r.reminderDeliveries.push({ ...r.reminderDeliveries[0], id: 'second', scheduledFor: '2026-09-09T02:00:00.123Z', status: 'cancelled' }) }, false)
taskCase('delivery-rule-occurrence-mismatch', r => { recurring(r); delivery(r); r.reminderRules[0].target.occurrenceId = 'occurrence' }, false)
taskCase('delivery-foreign-occurrence', r => { recurring(r); delivery(r); r.tasks.push({ ...r.tasks[0], id: 'other', recurrenceSeriesId: null }); r.taskEvents.push({ ...r.taskEvents[0], id: 'other-event', taskId: 'other', occurrenceId: null, sequence: 2 }); r.reminderRules[0].target.taskId = 'other'; r.reminderDeliveries[0].occurrenceId = 'occurrence' }, false)
for (const [field, value] of [['action', 'complete'], ['occurrenceId', 'missing'], ['originalStart', 'bad'], ['originalStart', 1]]) taskCase(`delivery-event-invalid-${field}`, r => { eventDelivery(r); r.reminderDeliveries[0][field] = value }, false)
taskCase('delivery-event-start-mismatch', r => { eventDelivery(r); r.reminderRules[0].target.originalStart = '2026-09-09' }, false)
taskCase('delivery-event-duplicate-normalized-start', r => { eventDelivery(r); r.reminderDeliveries[0].originalStart = '2026-09-09T10:00:00+08:00'; r.reminderDeliveries.push({ ...r.reminderDeliveries[0], id: 'second', originalStart: '2026-09-09T02:00:00Z' }) }, false)
const taskOutput = new URL('../tests/fixtures/calendar-future-workspace-tasks.json', import.meta.url)
const taskBytes = `${JSON.stringify(taskCases, null, 2)}\n`
if (process.argv.includes('--check')) assert.equal(readFileSync(taskOutput, 'utf8').replaceAll('\r\n', '\n'), taskBytes)
else writeFileSync(taskOutput, taskBytes)
