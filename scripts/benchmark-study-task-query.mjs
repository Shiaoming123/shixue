import assert from 'node:assert/strict'
import { cpus, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { build } from 'vite'
import { createStudyTaskQueryScaleFixture } from './benchmark-fixtures/study-task-query-scale.ts'

const samples = 7
const state = createStudyTaskQueryScaleFixture()
const logicalCpus = cpus()
const [projectTaskItems, projectCalendarItems] = await Promise.all([
  loadReleaseProjection('src/lib/study-task-query.ts', 'projectTaskItems'),
  loadReleaseProjection('src/domain/calendar/project.ts', 'projectCalendarItems'),
])

console.log(`Fixture: tasks=${state.tasks.length} series=${state.recurrenceSeries.length} occurrences=${state.occurrences.length}`)
console.log(`Runtime: node=${process.versions.node} platform=${platform()} arch=${process.arch} release=${release()} cpu=${logicalCpus[0]?.model ?? 'unknown'} logicalCpuCount=${logicalCpus.length}`)
measure('Today', () => projectTaskItems(state, { from: '2026-09-05', to: '2026-09-05' }, 'Asia/Shanghai'), 100, 3_000)
measure('7-day range', () => projectTaskItems(state, { from: '2026-09-05', to: '2026-09-11' }, 'Asia/Shanghai'), 100, 6_000)
measure('Calendar range', () => projectCalendarItems(state, { start: '2027-01-01', end: '2027-02-12' }), 150, 41_960)

function measure(label, project, targetMs, expectedCount) {
  project()
  let resultCount = 0
  const timings = Array.from({ length: samples }, () => {
    const startedAt = performance.now()
    const result = project()
    const elapsedMs = performance.now() - startedAt
    resultCount = result.length
    return elapsedMs
  }).sort((left, right) => left - right)
  const medianMs = timings[Math.floor(timings.length / 2)]
  const maxMs = timings.at(-1)
  assert.equal(resultCount, expectedCount, `${label} projected an unexpected result count`)
  console.log(`${label}: count=${resultCount} median=${medianMs.toFixed(1)}ms max=${maxMs.toFixed(1)}ms samples=${samples} target=<${targetMs}ms`)
  assert.ok(medianMs < targetMs, `${label} median ${medianMs.toFixed(1)}ms exceeds ${targetMs}ms target`)
}

async function loadReleaseProjection(entry, exportName) {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: 'oxc',
      target: 'es2022',
      lib: {
        entry: resolve(entry),
        formats: ['es'],
        fileName: exportName,
      },
      rollupOptions: {
        output: { format: 'es', codeSplitting: false },
      },
    },
  })
  const output = Array.isArray(result) ? result[0].output : result.output
  const chunk = output.find((item) => item.type === 'chunk' && item.isEntry)
  assert.ok(chunk && chunk.type === 'chunk', 'Release benchmark bundle did not emit an entry chunk.')
  const url = `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
  const module = await import(url)
  assert.equal(typeof module[exportName], 'function')
  return module[exportName]
}
