import { parseWorkspaceStateV4 } from '../domain/workspace/parse.ts'
import { array, record, stableId, string } from './types.ts'
import type { CalendarWriter } from './write-outbox.ts'
import type { GoogleWriteTransport } from './google-write.ts'

const unsupported = (): never => { throw new Error('WRITE_UNSUPPORTED') }
// A future schema may introduce new attached facts. Never silently discard them.
function knownFields(raw: unknown, parsed: unknown): void {
  if (Array.isArray(raw)) { raw.forEach((value, index) => knownFields(value, array(parsed)[index])); return }
  if (raw === null || typeof raw !== 'object') return
  const target = record(parsed)
  for (const [key, value] of Object.entries(raw)) { if (!(key in target)) unsupported(); knownFields(value, target[key]) }
}

/** The loader is injected by the trusted fake host, never by a write intent. */
export function createGoogleFutureReader(transport: GoogleWriteTransport, loadWorkspace: () => Promise<unknown>): NonNullable<CalendarWriter['readFuture']> {
  return async (connectionId, calendarId, parentRef, originalStart) => {
    const session = transport.session(connectionId)
    const check = () => { const current = transport.session(connectionId); if (transport.kind !== 'fake' || !current.connected || !current.canWrite || current.generation !== session.generation) unsupported() }
    const base = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    const get = async (path: string, query: Record<string, string> = {}) => {
      check(); const response = await transport.request(connectionId, { method: 'GET', path, headers: {}, query }); check()
      if (response.status !== 200) unsupported()
      return record(response.body)
    }
    const pages = async (path: string, query: Record<string, string>) => {
      const items: Record<string, unknown>[] = [], tokens = new Set<string>(), ids = new Set<string>()
      let pageToken: string | undefined
      // ponytail: bounded full reads; larger calendars require a separately proved snapshot protocol.
      for (let page = 0; page < 100; page++) {
        const body = await get(path, { ...query, maxResults: '250', ...(pageToken ? { pageToken } : {}) })
        for (const raw of array(body.items)) {
          const item = record(raw), id = string(item.id)
          if ('recurringEventId' in item || 'originalStartTime' in item) string(item.recurringEventId)
          if (ids.has(id) || items.length >= 25_000) unsupported()
          ids.add(id); items.push(item)
        }
        if (body.nextPageToken === undefined) return items
        pageToken = string(body.nextPageToken)
        if (tokens.has(pageToken)) unsupported()
        tokens.add(pageToken)
      }
      return unsupported()
    }
    const calendar = await get(`/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`)
    if (calendar.id !== calendarId || !['owner', 'writer'].includes(String(calendar.accessRole))) unsupported()
    const parent = await get(`${base}/${encodeURIComponent(parentRef.eventId)}`)
    if (parent.id !== parentRef.eventId || parent.etag !== parentRef.etag) unsupported()
    const events = await pages(base, { singleEvents: 'false', showDeleted: 'true' })
    const listedParent = events.find((item) => item.id === parentRef.eventId)
    if (!listedParent || JSON.stringify(listedParent) !== JSON.stringify(parent)) unsupported()
    const exceptions = events.filter((item) => item.recurringEventId === parentRef.eventId)
    if (exceptions.length) unsupported()
    const instances = await pages(`${base}/${encodeURIComponent(parentRef.eventId)}/instances`, { originalStart, showDeleted: 'true' })
    if (instances.length !== 1) unsupported()
    const pivot = instances[0]!
    if (pivot.recurringEventId !== parentRef.eventId || (record(pivot.originalStartTime).date ?? record(pivot.originalStartTime).dateTime) !== originalStart) unsupported()
    if (JSON.stringify(await get(`${base}/${encodeURIComponent(parentRef.eventId)}`)) !== JSON.stringify(parent)) unsupported()
    const raw = structuredClone(await loadWorkspace()), workspace = parseWorkspaceStateV4(raw)
    knownFields(raw, workspace); check()
    const eventId = stableId('google', connectionId, calendarId, parentRef.eventId)
    const rules = workspace.reminderRules.filter((rule) => rule.target.kind === 'event' && rule.target.eventId === eventId)
    const ruleIds = new Set(rules.map((rule) => rule.id))
    const attachedFacts = [...workspace.calendarEventLinks.filter((item) => item.eventId === eventId), ...workspace.eventOutcomes.filter((item) => item.eventId === eventId), ...rules, ...workspace.reminderDeliveries.filter((item) => ruleIds.has(item.reminderRuleId))].map((item) => item.id)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(workspace)))
    return { parent, pivot, exceptions, complete: true, attachedFacts, workspaceHash: `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}` }
  }
}
