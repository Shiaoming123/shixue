import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { prepareFuturePlan } from '../src/calendar-connections/future-plan.ts'
import { writePreviewHash } from '../src/calendar-connections/write-outbox.ts'

const base = { operationId: '00000000-0000-4000-8000-000000000001', connectionId: 'c', calendarId: 'cal', eventId: 'parent', lockKeys: [], sendUpdates: 'all', intent: { kind: 'recurring.future', parent: { eventId: 'parent', etag: 'p1' }, originalStart: '2026-09-04', fields: { title: 'After' } } }
const snapshot = { parent: { id: 'parent', etag: 'p1', summary: 'Before', start: { date: '2026-09-01' }, end: { date: '2026-09-02' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=10'] }, pivot: { id: 'pivot', etag: 'i1', recurringEventId: 'parent', originalStartTime: { date: '2026-09-04' }, start: { date: '2026-09-04' }, end: { date: '2026-09-05' } }, complete: true, exceptions: [], attachedFacts: [], workspaceHash: 'snapshot1' }
const rows = []
async function add(name, edit = () => {}) {
  const input = { base: structuredClone(base), snapshot: structuredClone(snapshot) }
  edit(input.base, input.snapshot)
  let expected = null
  try {
    const plan = await prepareFuturePlan(input.base, input.snapshot)
    const preview = { ...input.base, intent: { ...input.base.intent, plan }, lockKeys: [plan.parent.eventId, plan.pivot.eventId, plan.successor.eventId].sort() }
    preview.hash = await writePreviewHash(preview)
    expected = { preview, future: { parent: { state: 'pending' }, successor: { state: 'pending' }, compensation: { state: 'pending' } } }
  } catch (error) { assert.equal(error.message, 'WRITE_UNSUPPORTED') }
  rows.push({ name, ...input, expected })
}
await add('daily-count')
for (const number of [1e20, 1e21, 0.0000001, 9007199254740992]) await add(`number-${number}`, (_, s) => { s.parent.sequence = number })
await add('private-marker', (_, s) => { s.parent.extendedProperties = { private: { existing: '保留', '10': 'ten', '2': 'two' } } })
await add('never', (_, s) => { s.parent.recurrence = ['RRULE:FREQ=DAILY'] })
await add('until', (_, s) => { s.parent.recurrence = ['RRULE:FREQ=DAILY;UNTIL=20260910'] })
await add('first', (b, s) => { b.intent.originalStart = '2026-09-01'; s.pivot.originalStartTime.date = '2026-09-01'; s.pivot.start.date = '2026-09-01'; s.pivot.end.date = '2026-09-02' })
await add('moved', (_, s) => { s.pivot.start.date = '2026-09-05' })
await add('status', (_, s) => { s.pivot.status = 'tentative' })
await add('attachment', (_, s) => { s.attachedFacts = ['link'] })
await add('provider-field', (_, s) => { s.parent.attachments = [] })
await add('unsupported-rule', (_, s) => { s.parent.recurrence = ['RRULE:FREQ=DAILY;BYHOUR=9'] })
await add('title-only', b => { b.intent.fields.attendees = [] })
await add('parent-drift', (_, s) => { s.parent.etag = 'changed' })
await add('existing-marker', (_, s) => { s.parent.extendedProperties = { private: { meowOperationId: 'old', meowOperationHash: `sha256:${'a'.repeat(64)}` } } })
for (const [rule, date, end] of [['FREQ=WEEKLY;BYDAY=TU,FR;COUNT=10', '2026-09-04', '2026-09-05'], ['FREQ=MONTHLY;COUNT=10', '2026-10-01', '2026-10-02'], ['FREQ=YEARLY;COUNT=10', '2027-09-01', '2027-09-02']]) await add(rule, (b, s) => {
  s.parent.recurrence = [`RRULE:${rule}`]; b.intent.originalStart = date; s.pivot.originalStartTime.date = date; s.pivot.start.date = date; s.pivot.end.date = end
})
for (const zone of ['UTC', 'Asia/Shanghai', 'Etc/GMT+2', 'America/New_York']) await add(`fixed-${zone}`, (b, s) => {
  s.parent.start = { dateTime: '2026-09-01T09:00:00.000Z', timeZone: zone }; s.parent.end = { dateTime: '2026-09-01T10:00:00.000Z', timeZone: zone }
  b.intent.originalStart = '2026-09-04T09:00:00.000Z'; s.pivot.originalStartTime = { dateTime: b.intent.originalStart }; s.pivot.start = { dateTime: b.intent.originalStart, timeZone: zone }; s.pivot.end = { dateTime: '2026-09-04T10:00:00.000Z', timeZone: zone }
})
for (const rule of ['FREQ=DAILY;COUNT=01', 'FREQ=DAILY;COUNT=0', 'FREQ=DAILY;COUNT=2', 'FREQ=DAILY;COUNT=10;COUNT=11', 'FREQ=DAILY;UNTIL=20260903']) await add(rule, (_, s) => { s.parent.recurrence = [`RRULE:${rule}`] })
await add('cancelled', (_, s) => { s.pivot.status = 'cancelled' })
await add('foreign-pivot', (_, s) => { s.pivot.recurringEventId = 'elsewhere' })
await add('intent-plan', b => { b.intent.plan = {} })
const path = new URL('../tests/fixtures/calendar-future-plan.json', import.meta.url)
const bytes = `${JSON.stringify(rows, null, 2)}\n`
if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'), bytes)
else writeFileSync(path, bytes)
console.log(`${rows.length} actual TS future-plan fixtures verified`)
