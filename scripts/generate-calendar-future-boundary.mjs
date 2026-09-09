import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { CalendarWriteOutbox, writePreviewHash } from '../src/calendar-connections/write-outbox.ts'

const originalRandomUUID = crypto.randomUUID
try {
  crypto.randomUUID = () => '00000000-0000-4000-8000-000000000001'
  for (const sequence of [1e21, 1e20]) {
    const path = new URL(`../tests/fixtures/calendar-future-numeric-${sequence === 1e21 ? "boundary" : "integer"}.json`, import.meta.url)
    let operation
    const core = new CalendarWriteOutbox({ insert: async (value) => { operation = value; return true } }, {
      mode: 'fake',
      readFuture: async () => ({
        parent: { id: 'parent', etag: 'p1', summary: 'Before', sequence, start: { date: '2026-09-01' }, end: { date: '2026-09-02' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=10'] },
        pivot: { id: 'pivot', etag: 'i1', recurringEventId: 'parent', originalStartTime: { date: '2026-09-04' }, start: { date: '2026-09-04' }, end: { date: '2026-09-05' } },
        exceptions: [], complete: true, attachedFacts: [], workspaceHash: 'snapshot1',
      }),
    }, async () => {})
    const preview = await core.prepare('c', 'cal', { kind: 'recurring.future', parent: { eventId: 'parent', etag: 'p1' }, originalStart: '2026-09-04', fields: { title: 'After' } }, 'all')
    await core.enqueue(preview.operationId, preview.hash, true)
    const { hash, ...content } = operation.preview
    assert.equal(await writePreviewHash(content), hash)
    assert.equal(operation.preview.intent.plan.originalParent.sequence, sequence)
    const bytes = `${JSON.stringify(operation, null, 2)}\n`
    if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'), bytes)
    else writeFileSync(path, bytes)
  }
  console.log('Future numeric-boundary fixtures and TS hashes verified')
} finally {
  crypto.randomUUID = originalRandomUUID
}
