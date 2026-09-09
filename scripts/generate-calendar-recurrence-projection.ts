import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stableId } from '../src/calendar-connections/types.ts'
import { normalizeNativeCalendarBatch } from '../src/calendar-connections/runtime.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createTaskCapabilityService, fingerprintWorkspace } from '../src/domain/capabilities/service.ts'

export const recurringBatch = () => ({ batchId: 'recurrence:move', operationId: 'op', provider: 'google', connectionId: 'connection', calendarId: 'calendar', sourceId: stableId('google', 'connection', 'calendar'), mode: 'incremental', access: 'details', title: 'Remote', timezone: 'UTC', observedAt: '2026-09-09T00:00:00.000Z', expectedWorkspaceHash: `sha256:${'a'.repeat(64)}`, plan: { hash: `sha256:${'b'.repeat(64)}`, kind: 'recurring.single', parentEventId: 'parent', instanceEventId: 'instance', originalStart: '2026-09-10' }, items: [{ id: 'parent', summary: 'Series', recurrence: ['RRULE:FREQ=DAILY;COUNT=5'], start: { date: '2026-09-09' }, end: { date: '2026-09-10' } }, { id: 'instance', recurringEventId: 'parent', originalStartTime: { date: '2026-09-10' }, summary: 'Series', start: { date: '2026-09-11' }, end: { date: '2026-09-12' } }] })

export async function generateRecurrenceProjectionFixtures() {
  const ordinary = JSON.parse(readFileSync(new URL('../tests/fixtures/calendar-write-projection.json', import.meta.url), 'utf8'))
  let base = ordinary.cases[0].base
  const cases = []
  for (const name of ['series-create', 'single-move', 'single-cancel', 'single-restore', 'series-change', 'permission-downgrade']) {
    const batch: any = recurringBatch()
    batch.batchId = `recurrence:${name}`
    batch.expectedWorkspaceHash = await fingerprintWorkspace(base)
    if (name === 'series-create' || name === 'series-change') {
      batch.plan = { hash: batch.plan.hash, kind: 'recurring.series', parentEventId: 'parent' }
      batch.items = [batch.items[0]]
      if (name === 'series-change') batch.items[0].recurrence = ['RRULE:FREQ=DAILY;COUNT=10']
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
if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(new URL('../tests/fixtures/calendar-recurrence-projection.json', import.meta.url), `${JSON.stringify(await generateRecurrenceProjectionFixtures(), null, 2)}\n`)
