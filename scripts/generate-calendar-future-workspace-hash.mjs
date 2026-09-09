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

// Empty collections are the only root-normalizer subset currently implemented natively.
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
