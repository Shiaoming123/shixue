import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createTaskCapabilityService, fingerprintWorkspace } from '../src/domain/capabilities/service.ts'
import { normalizeNativeCalendarBatch } from '../src/calendar-connections/runtime.ts'

export async function generateReceiptRetentionProbes() {
  const original = JSON.parse(readFileSync(new URL('../tests/fixtures/calendar-future-projection.json', import.meta.url), 'utf8')).cases[0]
  const cases = []
  for (const [name, count, expireFirst] of [['expired', 3, true], ['capacity', 503, false]] as const) {
    const base = structuredClone(original.base), batch = structuredClone(original.batch)
    const template = base.commandReceipts[0]
    base.commandReceipts = Array.from({ length: count }, (_, index) => {
      const receipt = structuredClone(template), id = String(count - index).padStart(4, '0')
      return { ...receipt, id, idempotencyKey: id, result: { ...receipt.result, receiptId: id },
        createdAt: '2026-09-09T00:00:00Z', expiresAt: expireFirst && index === 0 ? '2026-09-09T00:01:00Z' : '2999-01-01T00:00:00Z' }
    })
    batch.expectedWorkspaceHash = await fingerprintWorkspace(base)
    const store = createInMemoryWorkspaceStore(base)
    const service = createTaskCapabilityService(store, () => '2026-09-09T00:01:00.000Z', () => 'receipt:future-split', {
      loadExternalBatch: async (_id, state) => normalizeNativeCalendarBatch(batch, batch.connectionId, batch.calendarId, batch.observedAt, state.calendarEvents, { operationId: batch.operationId, plan: batch.plan }),
    })
    await service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: batch.batchId, expectedWorkspaceRevision: base.revision, command: { type: 'calendar_external.apply', batchId: batch.batchId } })
    const current = await store.load()
    cases.push({ name, count, expireFirst, expectedWorkspaceHash: batch.expectedWorkspaceHash,
      retainedIds: current.commandReceipts.slice(0, -1).map((receipt) => receipt.id), currentHash: await fingerprintWorkspace(current) })
  }
  return { cases }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const value = `${JSON.stringify(await generateReceiptRetentionProbes(), null, 2)}\n`
  const file = new URL('../tests/fixtures/calendar-receipt-retention.json', import.meta.url)
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== value) throw new Error('Receipt retention fixture drift')
  } else writeFileSync(file, value)
}
