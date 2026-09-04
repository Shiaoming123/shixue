import assert from 'node:assert/strict'
import test from 'node:test'
import { exportStudyState, importStudyState } from '../src/lib/study.ts'
import {
  createStudyExport,
  parseStudyExport,
  STUDY_EXPORT_FORMAT,
} from '../src/storage/study/data-port.ts'
import { createInMemoryStudyStore } from '../src/storage/study/in-memory.ts'
import { registerStudyStore } from '../src/storage/study/registry.ts'
import { createSeedStudyState } from '../src/storage/study/types.ts'

test('Study export is versioned and round-trips the complete snapshot', () => {
  const state = createSeedStudyState('2026-09-04T00:00:00.000Z')
  const payload = createStudyExport(state, '2026-09-05T00:00:00.000Z')

  assert.equal(payload.format, STUDY_EXPORT_FORMAT)
  assert.equal(payload.version, 2)
  assert.deepEqual(parseStudyExport(JSON.stringify(payload)).state, state)
})

test('Study import accepts a v1 envelope and deterministically migrates it to v2', () => {
  const exportedAt = '2026-09-05T00:00:00.000Z'
  const imported = parseStudyExport({
    format: STUDY_EXPORT_FORMAT,
    version: 1,
    exportedAt,
    state: {
      version: 1,
      updatedAt: '2026-09-04T00:00:00.000Z',
      topics: [{
        id: 'topic-1', title: 'LangGraph', goal: 'Resume workflows',
        successCriteria: ['restart resumes'], weeklyTargetMinutes: 60,
        steps: [{
          id: 'step-1', title: 'Persist state',
          acceptanceCriteria: ['restart resumes'], estimateMinutes: 30,
          scheduledOn: '2026-09-06',
        }],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-04T00:00:00.000Z', archivedAt: null,
      }],
      sessions: [],
    },
  })

  assert.equal(imported.version, 2)
  assert.equal(imported.state.version, 2)
  assert.equal(imported.state.tasks[0].revision, 1)
  assert.equal(imported.state.tasks[0].updatedAt, exportedAt)
})

test('Study import rejects invalid nested records before replacing storage', async () => {
  const original = createSeedStudyState('2026-09-04T00:00:00.000Z')
  registerStudyStore(createInMemoryStudyStore(original))
  const invalid = createStudyExport(original, '2026-09-05T00:00:00.000Z')
  invalid.state.topics[0].weeklyTargetMinutes = -1

  await assert.rejects(importStudyState(JSON.stringify(invalid)), /weeklyTargetMinutes/)
  assert.deepEqual(JSON.parse(await exportStudyState('2026-09-05T00:00:00.000Z')).state, original)
})

test('Study import replaces storage only after complete validation', async () => {
  const original = createSeedStudyState('2026-09-04T00:00:00.000Z')
  const replacement = createSeedStudyState('2026-09-06T00:00:00.000Z')
  replacement.topics[0].title = 'Imported topic'
  registerStudyStore(createInMemoryStudyStore(original))

  await importStudyState(
    JSON.stringify(createStudyExport(replacement, '2026-09-06T01:00:00.000Z')),
  )

  assert.equal(
    JSON.parse(await exportStudyState('2026-09-06T02:00:00.000Z')).state.topics[0].title,
    'Imported topic',
  )
})

test('Study import rejects a broken task event chain before replacing storage', async () => {
  const original = createSeedStudyState('2026-09-04T00:00:00.000Z')
  registerStudyStore(createInMemoryStudyStore(original))
  const invalid = createStudyExport(original, '2026-09-05T00:00:00.000Z')
  const completed = invalid.state.taskEvents.find(({ type }) => type === 'completed')
  if (!completed) throw new Error('Seed must contain a completion event.')
  completed.fromStatus = 'inbox'

  await assert.rejects(importStudyState(JSON.stringify(invalid)), /event chain/i)
  assert.deepEqual(
    JSON.parse(await exportStudyState('2026-09-05T00:00:00.000Z')).state,
    original,
  )
})
