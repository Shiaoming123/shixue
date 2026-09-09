import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseWorkspaceStateV4 } from '../src/domain/workspace/parse.ts'

const seed = JSON.parse(readFileSync(new URL('../tests/fixtures/calendar-workspace-hash-v4.json', import.meta.url))).state
const cases = []
for (const boundary of [false, true]) {
  const raw = structuredClone(seed)
  raw.commandReceipts = [{ id: 'hash-contract', idempotencyKey: 'hash-contract', commandType: 'test', source: 'agent', workspaceRevision: 1,
    result: boundary ? { z: [-0, 1e-7, 1e-6, 1e20, 1e21, 333333333.33333329], '😀': '中文\n\u000f', '\ue000': true, '10': null, '2': false, a: '/' } : {},
    createdAt: '2026-09-09T00:00:00Z', expiresAt: '2026-09-10T00:00:00Z' }]
  const parsed = parseWorkspaceStateV4(structuredClone(raw))
  assert.equal(parsed.commandReceipts[0].requestFingerprint, null)
  const parsedJson = JSON.stringify(parsed)
  cases.push({ name: boundary ? 'numbers-unicode-index-keys' : 'defaulted-receipt', raw, parsedJson, hash: `sha256:${createHash('sha256').update(parsedJson).digest('hex')}` })
}
const output = new URL('../tests/fixtures/calendar-future-workspace-hash.json', import.meta.url)
const bytes = `${JSON.stringify(cases, null, 2)}\n`
if (process.argv.includes('--check')) assert.equal(readFileSync(output, 'utf8').replaceAll('\r\n', '\n'), bytes)
else writeFileSync(output, bytes)
console.log('Future workspace parsed JSON hash fixtures verified')
