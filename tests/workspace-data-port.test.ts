import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createTaskOnlyWorkspaceExportV3, createWorkspaceExport, parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'
import { createStudyExport } from '../src/storage/study/data-port.ts'
import { createSeedStudyState } from '../src/storage/study/types.ts'

const legacy = JSON.parse(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8'))

test('workspace envelopes enforce matching versions before migration', () => {
  const current = parseWorkspaceExport(legacy)
  for (const [version, state] of [[3, current.state], [4, legacy.state], [5, current.state]]) {
    assert.throws(() => parseWorkspaceExport({ ...legacy, version, state }), /version/)
  }
  assert.throws(() => createWorkspaceExport(legacy.state), /version 4/)
  assert.throws(() => parseWorkspaceState(current.state), /version 3/)
  assert.deepEqual(parseWorkspaceExport(JSON.stringify(current)), current)
})

test('legacy Study v2 imports migrate to V4 and retain their envelope timestamp', () => {
  const exported = createStudyExport(createSeedStudyState('2026-09-09T00:00:00Z'), legacy.exportedAt)
  const imported = parseWorkspaceExport(exported)
  assert.equal(imported.version, 4)
  assert.equal(imported.state.version, 4)
  assert.equal(imported.exportedAt, exported.exportedAt)
  assert.equal(imported.state.calendarSources.length, 1)
})

test('V4 export keeps event facts while explicit task-only downgrade is lossy and leaves the original unchanged', () => {
  const current = parseWorkspaceExport(legacy)
  const at = current.state.updatedAt
  current.state.calendarEvents.push({ id: 'event:export', revision: 1, sourceId: current.state.calendarSources[0]!.id,
    title: 'Exported meeting', notes: '', location: '', meetingUrl: null, organizer: null, attendees: [],
    availability: 'busy', status: 'confirmed', time: { kind: 'all-day', startOn: '2026-09-09', endOnExclusive: '2026-09-10' },
    recurrence: null, createdAt: at, updatedAt: at, deletedAt: null })
  current.state.commandReceipts.push({ id: 'receipt:event-export', idempotencyKey: 'event-export', requestFingerprint: null, commandType: 'event.create', source: 'human-ui', workspaceRevision: current.state.revision, result: { eventId: 'event:export' }, createdAt: at, expiresAt: '2030-01-01T00:00:00Z' })
  const before = structuredClone(current)
  assert.deepEqual(parseWorkspaceExport(createWorkspaceExport(current.state, current.exportedAt)), current)
  const downgrade = createTaskOnlyWorkspaceExportV3(current.state, current.exportedAt)
  assert.equal(downgrade.version, 3)
  assert.deepEqual(downgrade.state, legacy.state)
  assert.equal('calendarEvents' in downgrade.state, false)
  assert.deepEqual(current, before)
  assert.deepEqual(parseWorkspaceExport(downgrade).state.calendarEvents, [])
})


test('Study v1 imports reach V4 but mismatched Study envelopes are rejected', () => {
  const exported = { format: 'meow-study/study-export', version: 1, exportedAt: legacy.exportedAt,
    state: { version: 1, updatedAt: legacy.exportedAt, topics: [], sessions: [] } }
  assert.equal(parseWorkspaceExport(exported).state.version, 4)
  assert.throws(() => parseWorkspaceExport({ ...exported, version: 2 }), /does not match/)
})
