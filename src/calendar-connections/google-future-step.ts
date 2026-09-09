import { record } from './types.ts'
import { writePreviewHash, type CalendarWriter } from './write-outbox.ts'
import type { GoogleWriteTransport } from './google-write.ts'

/** Only injected fake transport; the root owns persistence and decides whether mutation is allowed. */
export function createGoogleFutureStep(transport: GoogleWriteTransport): NonNullable<CalendarWriter['futureStep']> {
  return async (raw, name, action, etag) => {
    const preview = structuredClone(raw), { hash, ...content } = preview
    if (transport.kind !== 'fake' || preview.intent.kind !== 'recurring.future' || !preview.intent.plan || await writePreviewHash(content) !== hash) throw Error('WRITE_UNSUPPORTED')
    const plan = preview.intent.plan, step = plan[name], epoch = transport.session(preview.connectionId).generation
    const active = () => { const session = transport.session(preview.connectionId); if (!session.connected || !session.canWrite || session.generation !== epoch) throw Error('WRITE_DISCONNECTED') }
    const path = `/calendar/v3/calendars/${encodeURIComponent(preview.calendarId)}/events`
    active()
    if (action === 'mutate' && name === 'compensation' && (!etag || /[\r\n]/.test(etag))) throw Error('WRITE_INVALID')
    const response = await transport.request(preview.connectionId, action === 'read'
      ? { method: 'GET', path: `${path}/${encodeURIComponent(step.eventId)}`, headers: {}, query: {} }
      : { method: name === 'successor' ? 'POST' : 'PATCH', path: name === 'successor' ? path : `${path}/${encodeURIComponent(step.eventId)}`, headers: name === 'successor' ? {} : { 'If-Match': name === 'compensation' ? etag! : step.etag! }, query: { sendUpdates: preview.sendUpdates }, body: step.body })
    active()
    if (action === 'mutate') {
      if (response.status === 409 || response.status === 412) return { kind: 'conflict' }
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) return { kind: 'rejected' }
      return { kind: 'unknown' }
    }
    if (response.status === 404 || response.status === 410) return { kind: 'conflict' }
    if (response.status !== 200) return { kind: 'unknown' }
    try {
      const value = record(response.body), marker = record(record(value.extendedProperties).private)
      if (value.id !== step.eventId || typeof value.etag !== 'string' || !value.etag || /[\r\n]/.test(value.etag) || marker.meowOperationId !== preview.operationId || marker.meowOperationHash !== plan.markerHash || value.recurringEventId !== undefined || value.status === 'cancelled') return { kind: 'conflict' }
      const expected: Record<string, unknown> = { status: 'confirmed', eventType: 'default', ...(name !== 'successor' ? { ...plan.originalParent, ...step.body } : step.body) }
      const actual: Record<string, unknown> = { status: 'confirmed', eventType: 'default', ...value }
      // Only provider-generated transport metadata and these two absent defaults are ignored.
      for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
        if (['etag', 'created', 'updated', 'sequence', 'kind', 'htmlLink', 'iCalUID'].includes(key)) continue
        if (!Object.prototype.hasOwnProperty.call(expected, key) || !Object.prototype.hasOwnProperty.call(actual, key) || JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) return { kind: 'conflict' }
      }
      return { kind: 'proved', proof: structuredClone(value) }
    } catch { return { kind: 'conflict' } }
  }
}
