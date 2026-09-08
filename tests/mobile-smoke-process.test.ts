import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

const { delay, resultText, runProcess } = await import('../scripts/mobile-smoke-process.mjs') as {
  delay: (milliseconds: number) => Promise<void>
  resultText: (result?: { stdout?: string; stderr?: string }) => string
  runProcess: (
    command: string,
    args: string[],
    options?: Record<string, unknown>,
  ) => Promise<{ status: number; stdout: string; stderr: string; signal: string | null }>
}

test('mobile smoke process keeps output and a non-zero exit status', async () => {
  const result = await runProcess(process.execPath, [
    '-e',
    "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)",
  ])

  assert.deepEqual(result, {
    status: 7,
    stdout: 'out',
    stderr: 'err',
    signal: null,
  })
  assert.equal(resultText(result), 'out\nerr')
})

test('mobile smoke process keeps the terminating signal', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1_000)'],
    { timeout: 20, killSignal: 'SIGTERM' },
  )

  assert.equal(result.status, 1)
  assert.equal(result.signal, 'SIGTERM')
})

test('mobile smoke delay does not resolve before the requested wait', async () => {
  const startedAt = performance.now()

  await delay(10)

  assert.ok(performance.now() - startedAt >= 8)
})
