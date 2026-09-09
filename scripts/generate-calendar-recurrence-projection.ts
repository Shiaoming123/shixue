import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stableId } from '../src/calendar-connections/types.ts'
import { normalizeNativeCalendarBatch } from '../src/calendar-connections/runtime.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createTaskCapabilityService, fingerprintWorkspace } from '../src/domain/capabilities/service.ts'

export const recurringBatch = () => ({ batchId: 'recurrence:move', operationId: 'op', provider: 'google', connectionId: 'connection', calendarId: 'calendar', sourceId: stableId('google', 'connection', 'calendar'), mode: 'incremental', access: 'details', title: 'Remote', timezone: 'UTC', observedAt: '2026-09-09T00:00:00.000Z', expectedWorkspaceHash: `sha256:${'a'.repeat(64)}`, plan: { hash: `sha256:${'b'.repeat(64)}`, kind: 'recurring.single', parentEventId: 'parent', instanceEventId: 'instance', originalStart: '2026-09-10' }, items: [{ id: 'parent', summary: 'Series', recurrence: ['RRULE:FREQ=DAILY;COUNT=5'], start: { date: '2026-09-09' }, end: { date: '2026-09-10' } }, { id: 'instance', recurringEventId: 'parent', originalStartTime: { date: '2026-09-10' }, summary: 'Series', start: { date: '2026-09-11' }, end: { date: '2026-09-12' } }] })

export function futureBatch() {
  const batch: any = recurringBatch()
  const markerHash = `sha256:${'c'.repeat(64)}`
  const marker = { private: { meowOperationId: batch.operationId, meowOperationHash: markerHash } }
  const parent = { ...batch.items[0], etag: 'parent-proved', recurrence: ['RRULE:FREQ=DAILY;COUNT=1'], extendedProperties: marker }
  const successor = { id: 'mop', etag: 'successor-proved', summary: 'After', recurrence: ['RRULE:FREQ=DAILY;COUNT=4'], start: { date: '2026-09-10' }, end: { date: '2026-09-11' }, extendedProperties: marker }
  batch.plan = { hash: batch.plan.hash, kind: 'recurring.future', parentEventId: 'parent', pivotEventId: 'instance', successorEventId: 'mop', originalStart: '2026-09-10', markerHash, steps: { parent: { state: 'proved', proof: parent }, successor: { state: 'proved', proof: successor } } }
  batch.items = [parent, successor]
  return batch
}

export async function generateRecurrenceProjectionFixtures(includeFuture = false) {
  const ordinary = JSON.parse(readFileSync(new URL('../tests/fixtures/calendar-write-projection.json', import.meta.url), 'utf8'))
  let base = ordinary.cases[0].base
  const cases = []
  for (const name of ['series-create', 'single-move', 'single-cancel', 'single-restore', 'series-change', 'series-weekly-until', 'permission-downgrade', ...(includeFuture ? ['future-split'] : [])]) {
    if (name === 'single-move') {
      const parent = base.calendarEvents.find((event: any) => event.sourceId === stableId('google', 'connection', 'calendar'))!
      base = structuredClone(base)
      base.calendarEvents.push({ ...parent, id: stableId('google', 'connection', 'calendar', 'unrelated'), title: 'Unrelated', recurrence: null })
    }
    if (name === 'future-split') base = cases[1]!.base
    const batch: any = name === 'future-split' ? futureBatch() : recurringBatch()
    batch.batchId = `recurrence:${name}`
    batch.expectedWorkspaceHash = await fingerprintWorkspace(base)
    if (name === 'series-create' || name === 'series-change' || name === 'series-weekly-until') {
      batch.plan = { hash: batch.plan.hash, kind: 'recurring.series', parentEventId: 'parent' }
      batch.items = [batch.items[0]]
      if (name === 'series-change') batch.items[0].recurrence = ['RRULE:FREQ=DAILY;COUNT=10']
      if (name === 'series-weekly-until') batch.items[0].recurrence = ['RRULE:FREQ=WEEKLY;BYDAY=WE,TH;UNTIL=20261014']
    }
    if (name === 'single-cancel') batch.items[1] = { id: 'instance', recurringEventId: 'parent', originalStartTime: { date: '2026-09-10' }, status: 'cancelled' }
    if (name === 'single-restore') { batch.items[1].start.date = '2026-09-10'; batch.items[1].end.date = '2026-09-11' }
    if (name === 'permission-downgrade') { batch.access = 'none'; batch.items = [] }
    const expectedWrite = { operationId: batch.operationId, plan: structuredClone(batch.plan) }
    const store = createInMemoryWorkspaceStore(base)
    const service = createTaskCapabilityService(store, () => '2026-09-09T00:01:00.000Z', () => `receipt:${name}`, {
      loadExternalBatch: async (_id, state) => normalizeNativeCalendarBatch(batch, batch.connectionId, batch.calendarId, batch.observedAt, state.calendarEvents, expectedWrite),
    })
    await service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: batch.batchId, expectedWorkspaceRevision: base.revision, command: { type: 'calendar_external.apply', batchId: batch.batchId } })
    const current = await store.load()
    cases.push({ name, base, current, batch }); base = current
  }
  return { cases }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { cases } = await generateRecurrenceProjectionFixtures(true)
  for (const future of [false, true]) writeFileSync(new URL(`../tests/fixtures/calendar-${future ? 'future' : 'recurrence'}-projection.json`, import.meta.url), `${JSON.stringify({ cases: cases.filter((entry) => (entry.name === 'future-split') === future) }, null, 2)}\n`)
}
