import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { projectCalendarItems } from '../src/domain/calendar/project.ts'
import { parseWorkspaceState } from '../src/domain/workspace/parse.ts'
import { createTaskOnlyWorkspaceExportV3, createWorkspaceExport, parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'

test('frozen synthetic V3 export preserves calendar facts through the real data port', () => {
  const raw = readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')
  const original = JSON.parse(raw)
  // Hash JSON content, so checkout line endings do not change the frozen sample.
  assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),
    '48a7e9a2bb639d392323ed3d2c952c5b28279fa71ebe8ddd2c2d42742db1b1ca')
  const imported = parseWorkspaceExport(raw)
  assert.deepEqual(parseWorkspaceState(original.state), original.state)
  assert.equal(imported.version, 4)
  assert.equal(imported.state.version, 4)
  const { calendarSources, calendarEvents, calendarEventLinks, eventOutcomes, ...legacy } = imported.state
  assert.deepEqual({ ...legacy, version: 3 }, original.state, 'Migration preserves all frozen V3 fields')
  assert.equal(calendarSources.length, 1)
  assert.deepEqual([calendarEvents, calendarEventLinks, eventOutcomes], [[], [], []])
  const exported = createWorkspaceExport(imported.state, imported.exportedAt)
  assert.deepEqual(exported, imported)
  assert.deepEqual(createTaskOnlyWorkspaceExportV3(imported.state, imported.exportedAt), original)
  assert.deepEqual(parseWorkspaceExport(JSON.stringify(exported)), imported)

  const facts = projectCalendarItems(imported.state, { start: '2026-09-09', end: '2026-09-11' })
    .map(({ key, kind, displayDate, displayMinute }) => [key, kind, displayDate, displayMinute])
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
  assert.deepEqual(facts, [
    ['deadline:all-day', 'deadline-marker', '2026-09-10', null],
    ['deadline:deadline', 'deadline-marker', '2026-09-09', 1410],
    ['occurrence:synthetic-occurrence-1', 'all-day', '2026-09-10', null],
    ['occurrence:synthetic-occurrence-2', 'timed', '2026-09-10', 540],
    ['task:all-day', 'all-day', '2026-09-09', null],
    ['task:timed', 'timed', '2026-09-09', 540],
  ], 'Dates, offsets, overrides and separate deadlines survive; unscheduled and series parents are not time blocks')
  assert.deepEqual(imported, exported, 'Projection must leave the snapshot intact')
})
