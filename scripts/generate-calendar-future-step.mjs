import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createGoogleFutureStep } from '../src/calendar-connections/google-future-step.ts'
import { writePreviewHash } from '../src/calendar-connections/write-outbox.ts'

const seed = JSON.parse(readFileSync(new URL('../tests/fixtures/calendar-future-plan.json', import.meta.url)))[0].expected.preview
// Native HttpReply/Ledger expose JSON values, with recursively sorted object keys.
function native(value) { return Array.isArray(value) ? value.map(native) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, native(value[key])])) : value }
const rows = [], previews = []
for (const name of ['parent', 'successor']) for (const policy of ['all', 'externalOnly', 'none']) {
  const preview = native(structuredClone(seed)); preview.calendarId = 'cal /中文!()*'; preview.sendUpdates = policy
  delete preview.hash; preview.hash = await writePreviewHash(preview)
  const previewIndex = previews.push(preview) - 1
  const step = preview.intent.plan[name]
  const proof = native({ ...(name === 'parent' ? preview.intent.plan.originalParent : {}), ...step.body, etag: 'proved-etag' })
  const cases = [['proof', 200, proof], ['defaults', 200, {...proof, status: 'confirmed', eventType: 'default'}], ['metadata', 200, {...proof, created: 'ignored', sequence: 12}], ['wrong-id', 200, {...proof, id: 'other'}], ['empty-etag', 200, {...proof, etag: ''}], ['newline-etag', 200, {...proof, etag: 'x\ny'}], ['cancelled', 200, {...proof, status: 'cancelled'}], ['instance', 200, {...proof, recurringEventId: 'parent'}], ['extra', 200, {...proof, unmodeled: true}], ['changed-title', 200, {...proof, summary: 'different'}], ['wrong-marker', 200, {...proof, extendedProperties: {private: {meowOperationId: 'other'}}}], ['missing', 404, null], ['gone', 410, null], ['server', 503, null]]
  for (const [label, status, body] of cases) await add(label, 'read', status, body)
  for (const status of [200, 201, 400, 401, 403, 404, 409, 412, 422, 429, 500]) await add(`mutate-${status}`, 'mutate', status, proof)
  async function add(label, action, status, body) {
    let request
    const adapter = createGoogleFutureStep({ kind: 'fake', session: () => ({generation: 1, connected: true, canWrite: true}), request: async (_id, value) => {request = value; return {status, body: native(body)}} })
    const expected = await adapter(preview, name, action)
    rows.push({name: `${name}-${policy}-${label}`, previewIndex, step: name, action, status, body: native(body), request, expected})
  }
}
const path = new URL('../tests/fixtures/calendar-future-step.json', import.meta.url)
const bytes = `${JSON.stringify({previews, rows}, null, 2)}\n`
if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'), bytes)
else writeFileSync(path, bytes)
console.log(`${rows.length} actual TS future-step fixtures verified`)
