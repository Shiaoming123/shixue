import { prepareFuturePlan, type FutureStepResponse } from './future-plan.ts'
import { writePreviewHash, type CalendarWriter, type WriteOperation, type WriteOutboxStore } from './write-outbox.ts'

/** Root-only fake saga. Partial results remain locked; native projection belongs to Task 4B. */
export async function processFuture(operation: WriteOperation, reconcile: boolean, store: WriteOutboxStore, writer: CalendarWriter, now: () => number, active: (epoch?: number) => number): Promise<WriteOperation> {
  const preview = operation.preview, intent = preview.intent
  if (intent.kind !== 'recurring.future' || !intent.plan || !operation.future) throw Error('WRITE_UNSUPPORTED')
  if (operation.state === 'applied' || operation.state === 'conflict') return operation
  if (!reconcile && (operation.outcomeUnknown || operation.state !== 'pending')) throw Error('RECONCILE_REQUIRED')
  if (reconcile && !operation.outcomeUnknown && operation.state !== 'applying') throw Error('RECONCILE_NOT_REQUIRED')
  const { hash, ...content } = preview
  if (await writePreviewHash(content) !== hash) throw Error('WRITE_PREVIEW_CHANGED')
  const epoch = active(), id = preview.operationId, time = now()
  operation = await store.claim(id, operation.version, crypto.randomUUID(), time, time + 30_000, preview.lockKeys) ?? (() => { throw Error('WRITE_BUSY') })()
  const save = async (patch: Partial<WriteOperation>) => {
    const next = { ...operation, ...patch, version: operation.version + 1 }
    if (!await store.cas(id, operation.version, next)) throw Error('WRITE_LEASE_LOST')
    operation = next
  }
  const finish = async (patch: Partial<WriteOperation>) => { await save({ leaseId: null, leaseUntil: 0, ...patch }); return operation }
  const plan = intent.plan
  for (const step of ['parent', 'successor'] as const) {
    let state = operation.future![step]
    if (state.state === 'proved') continue
    if (state.state === 'rejected' || state.state === 'conflict') return finish({ state: 'failed', outcomeUnknown: true, error: 'COMPENSATION_REQUIRED' })
    if (state.state === 'pending' && step === 'parent') {
      try {
        active(epoch)
        const snapshot = await writer.readFuture!(preview.connectionId, preview.calendarId, intent.parent, intent.originalStart)
        const { plan: _plan, ...originalIntent } = intent
        const fresh = await prepareFuturePlan({ ...content, lockKeys: [], intent: originalIntent }, snapshot)
        active(epoch)
        if (JSON.stringify(fresh) !== JSON.stringify(plan)) throw Error('WRITE_SNAPSHOT_CHANGED')
      } catch { return finish({ state: 'conflict', outcomeUnknown: false, error: 'WRITE_SNAPSHOT_CHANGED' }) }
    }
    let response: FutureStepResponse = { kind: 'unknown' }
    if (state.state === 'pending') {
      active(epoch)
      if (now() >= operation.leaseUntil) throw Error('WRITE_LEASE_LOST')
      await save({ future: { ...operation.future!, [step]: { state: 'applying', outcomeUnknown: true } }, outcomeUnknown: true })
      try { active(epoch); response = await writer.futureStep!(preview, step, 'mutate'); active(epoch) } catch { response = { kind: 'unknown' } }
      if (response.kind === 'rejected' || response.kind === 'conflict') {
        await save({ future: { ...operation.future!, [step]: { state: response.kind, outcomeUnknown: false } } })
        return finish({ state: step === 'parent' ? 'conflict' : 'failed', outcomeUnknown: step === 'successor', error: step === 'successor' ? 'COMPENSATION_REQUIRED' : 'WRITE_REJECTED' })
      }
    }
    // Even a successful mutation response needs an exact GET proof. Unknown steps never resend.
    try { active(epoch); response = await writer.futureStep!(preview, step, 'read'); active(epoch) } catch { response = { kind: 'unknown' } }
    if (response.kind !== 'proved') {
      await save({ future: { ...operation.future!, [step]: { state: 'unknown', outcomeUnknown: true } } })
      return finish({ state: 'failed', outcomeUnknown: true, error: 'OUTCOME_UNKNOWN' })
    }
    state = { state: 'proved', outcomeUnknown: false, etag: String(response.proof.etag), proof: structuredClone(response.proof) }
    await save({ future: { ...operation.future!, [step]: state } })
  }
  return finish({ state: 'applied', outcomeUnknown: false, error: null, result: { operationId: id, connectionId: preview.connectionId, calendarId: preview.calendarId, eventId: plan.parent.eventId, etag: operation.future!.parent.etag!, future: { markerHash: plan.markerHash, parent: operation.future!.parent.proof!, successor: operation.future!.successor.proof! } } })
}
