import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { build } from 'vite'
import { createStudyTaskQueryScaleFixture } from './benchmark-fixtures/study-task-query-scale.ts'

const samples = 7
const state = createStudyTaskQueryScaleFixture()
const projectTaskItems = await loadReleaseProjection()

measure('Today', { from: '2026-09-05', to: '2026-09-05' }, 100)
measure('7-day range', { from: '2026-09-05', to: '2026-09-11' }, 150)

function measure(label, range, targetMs) {
  projectTaskItems(state, range, 'Asia/Shanghai')
  const timings = Array.from({ length: samples }, () => {
    const startedAt = performance.now()
    const result = projectTaskItems(state, range, 'Asia/Shanghai')
    const elapsedMs = performance.now() - startedAt
    assert.equal(result.length, 0)
    return elapsedMs
  }).sort((left, right) => left - right)
  const medianMs = timings[Math.floor(timings.length / 2)]
  const maxMs = timings.at(-1)
  console.log(`${label}: median=${medianMs.toFixed(1)}ms max=${maxMs.toFixed(1)}ms samples=${samples}`)
  assert.ok(medianMs < targetMs, `${label} median ${medianMs.toFixed(1)}ms exceeds ${targetMs}ms target`)
}

async function loadReleaseProjection() {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: 'oxc',
      target: 'es2022',
      lib: {
        entry: resolve('src/lib/study-task-query.ts'),
        formats: ['es'],
        fileName: 'study-task-query',
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
  assert.equal(typeof module.projectTaskItems, 'function')
  return module.projectTaskItems
}
