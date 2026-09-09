import { CalendarProviderError, type CalendarProvider, type CalendarProviderPort, type PullRequest, type PullResult } from './types.ts'
/** Device/backend store, never Workspace or a WebView persistence adapter. */
export interface ConnectorCheckpoint { generation: number; cursor: string | null; pending: ConnectorBatch | null }
export interface ConnectorBatch { id: string; provider: CalendarProvider; connectionId: string; calendarId: string; generation: number; result: PullResult }
export interface ConnectorStore {
  load(connectionId: string, calendarId: string): Promise<ConnectorCheckpoint>
  stage(batch: ConnectorBatch, expected: ConnectorCheckpoint): Promise<void>
  acknowledge(batchId: string, connectionId: string, calendarId: string, expectedGeneration: number): Promise<void>
  invalidate(connectionId: string, calendarId: string, expectedGeneration: number): Promise<void>
}
export interface ProviderBatchReceipt { batchId: string; applied: true }
/** Same-source calls must be serialized by the device coordinator. CAS is still mandatory. */
export async function reconcileCalendar(input: { provider: CalendarProvider; port: CalendarProviderPort; store: ConnectorStore; request: Omit<PullRequest, 'cursor'>; id(): string; apply(batch: ConnectorBatch): Promise<ProviderBatchReceipt> }): Promise<ProviderBatchReceipt> {
  const { connectionId, calendarId } = input.request
  let checkpoint = await input.store.load(connectionId, calendarId)
  let batch = checkpoint.pending
  if (!batch) {
    let result: PullResult
    try { result = await input.port.pullChanges({ ...input.request, cursor: checkpoint.cursor }) }
    catch (error) {
      if (!(error instanceof CalendarProviderError) || error.code !== 'cursor-expired') throw error
      await input.store.invalidate(connectionId, calendarId, checkpoint.generation)
      checkpoint = await input.store.load(connectionId, calendarId)
      result = await input.port.pullChanges({ ...input.request, cursor: null })
    }
    batch = { id: input.id(), provider: input.provider, connectionId, calendarId, generation: checkpoint.generation, result }
    await input.store.stage(batch, checkpoint)
  }
  if (batch.provider !== input.provider || batch.connectionId !== connectionId || batch.calendarId !== calendarId || batch.generation !== checkpoint.generation) throw new CalendarProviderError('invalid-response')
  const receipt = await input.apply(batch)
  if (receipt.applied !== true || receipt.batchId !== batch.id) throw new CalendarProviderError('invalid-response')
  await input.store.acknowledge(batch.id, connectionId, calendarId, batch.generation)
  return receipt
}
