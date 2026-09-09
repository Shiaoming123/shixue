import test from 'node:test'
import assert from 'node:assert/strict'
import { createGoogleCalendarWriter, type GoogleWriteRequest } from '../src/calendar-connections/google-write.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { CalendarWriteOutbox, type WriteOutboxStore } from '../src/calendar-connections/write-outbox.ts'
import { normalizeGoogleBatch } from '../src/calendar-connections/google-recurrence.ts'

const parent = { id: 'parent', etag: 'p1', summary: 'Before', start: { date: '2026-09-01' }, end: { date: '2026-09-02' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=10'] }
const pivot = { id: 'pivot', etag: 'i1', recurringEventId: 'parent', originalStartTime: { date: '2026-09-04' }, start: { date: '2026-09-04' }, end: { date: '2026-09-05' } }
const intent = { kind: 'recurring.future' as const, parent: { eventId: 'parent', etag: 'p1' }, originalStart: '2026-09-04', fields: { title: 'After' } }
async function fixture(mode = '') {
  const workspace = await createInMemoryWorkspaceStore().load()
  const calls: GoogleWriteRequest[] = []
  const writer = createGoogleCalendarWriter({ kind: 'fake', session: () => ({ connected: true, canWrite: true, generation: 1 }), async request(_id, request) {
    calls.push(request)
    if (request.path.includes('/calendarList/')) return { status: 200, body: { id: 'cal', accessRole: 'owner' } }
    if (request.path.endsWith('/parent')) return { status: 200, body: parent }
    if (request.path.endsWith('/instances')) return { status: 200, body: { items: mode === 'no-pivot' ? [] : [pivot] } }
    if (mode === 'malformed') return { status: 200, body: {} }
    if (mode === 'denied') return { status: 403 }
    if (mode === 'ceiling') return { status: 200, body: { items: request.query.pageToken ? [] : [parent], nextPageToken: String(Number(request.query.pageToken ?? 0) + 1) } }
    if (!request.query.pageToken) return { status: 200, body: { items: [parent], nextPageToken: 'page2' } }
    return { status: 200, body: { items: mode === 'exception' ? [pivot] : mode === 'duplicate' ? [parent] : [], ...(mode === 'loop' ? { nextPageToken: 'page2' } : {}) } }
  } }, async () => mode === 'unknown' ? { ...workspace, unknownFacts: [] } : workspace)
  const core = new CalendarWriteOutbox({} as WriteOutboxStore, writer, async () => {})
  return { writer, core, calls, workspace }
}
test('authoritative future prepare enumerates every page and derives stable local evidence', async () => {
  const { core, writer, calls, workspace } = await fixture()
  const preview = await core.prepare('c', 'cal', intent, 'all')
  assert.equal(preview.intent.kind, 'recurring.future')
  if (preview.intent.kind !== 'recurring.future') return
  assert.match(preview.intent.plan!.workspaceHash, /^sha256:[a-f0-9]{64}$/)
  const snapshot = await writer.readFuture!('c', 'cal', intent.parent, intent.originalStart)
  assert.equal(snapshot.workspaceHash, preview.intent.plan!.workspaceHash)
  workspace.revision++
  assert.notEqual((await writer.readFuture!('c', 'cal', intent.parent, intent.originalStart)).workspaceHash, snapshot.workspaceHash)
  assert.ok(calls.some((request) => request.query.pageToken === 'page2'))
  assert.ok(calls.every((request) => request.method === 'GET'))
})
test('future evidence fails closed on pagination loops, exceptions and unknown local fields', async () => {
  for (const mode of ['loop', 'exception', 'unknown', 'ceiling', 'malformed', 'denied', 'duplicate', 'no-pivot']) {
    const { core, calls } = await fixture(mode)
    await assert.rejects(core.prepare('c', 'cal', intent, 'all'))
    assert.ok(calls.every((request) => request.method === 'GET'))
  }
})
test('trusted scanner includes links, outcomes, event rules and deliveries linked through rules', async () => {
  const { core, writer, workspace } = await fixture()
  const now = '2026-09-09T00:00:00.000Z'
  const event = normalizeGoogleBatch([parent], { connectionId: 'c', calendarId: 'cal', timezone: 'UTC', now, cursor: null }, [], 'full').upserts[0]!.event
  workspace.calendarSources.push({ id: event.sourceId, revision: 1, provider: 'google', title: 'Calendar', color: '#000000', group: null, permission: 'write', selected: true, hidden: false, timezone: 'UTC', createdAt: now, updatedAt: now, archivedAt: null })
  workspace.calendarEvents.push(event)
  workspace.calendarEventLinks.push({ id: 'attached-link', eventId: event.id, taskId: workspace.tasks[0]!.id })
  workspace.eventOutcomes.push({ id: 'attached-outcome', eventId: event.id, occurrenceId: null, action: 'note', taskId: null, note: 'Keep', createdAt: now })
  workspace.reminderRules.push({ id: 'attached-rule', target: { kind: 'event', eventId: event.id, originalStart: null }, trigger: { kind: 'at_start' }, enabled: false, revision: 1 })
  workspace.reminderDeliveries.push({ id: 'attached-delivery', reminderRuleId: 'attached-rule', occurrenceId: null, originalStart: null, scheduledFor: now, status: 'cancelled', snoozedUntil: null, action: null })
  assert.deepEqual((await writer.readFuture!('c', 'cal', intent.parent, intent.originalStart)).attachedFacts.sort(), ['attached-delivery', 'attached-link', 'attached-outcome', 'attached-rule'])
  await assert.rejects(core.prepare('c', 'cal', intent, 'all'), /WRITE_UNSUPPORTED/)
  workspace.reminderRules.pop()
  await assert.rejects(writer.readFuture!('c', 'cal', intent.parent, intent.originalStart), /unknown reminderRuleId/)
})
