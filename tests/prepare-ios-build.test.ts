import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareIosSimulatorBuild } from '../scripts/prepare-ios-build.mjs'

test('removes only the selected stale simulator bundle and AppleDouble files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'shixue-ios-prepare-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const tauriDir = join(root, 'src-tauri')
  const selectedBundle = join(tauriDir, 'gen', 'apple', 'build', 'arm64-sim', '拾学.app')
  const otherBundle = join(tauriDir, 'gen', 'apple', 'build', 'x86_64', '拾学.app')
  await mkdir(selectedBundle, { recursive: true })
  await mkdir(otherBundle, { recursive: true })
  await writeFile(join(tauriDir, 'tauri.conf.json'), JSON.stringify({ productName: '拾学' }))
  await writeFile(join(selectedBundle, 'stale.txt'), 'stale')
  await writeFile(join(otherBundle, 'keep.txt'), 'keep')
  await writeFile(join(root, '._sidecar'), 'sidecar')

  const result = await prepareIosSimulatorBuild(root, 'aarch64-sim')

  assert.equal(result.bundlePath, selectedBundle)
  assert.equal(result.removedBundle, true)
  assert.deepEqual(result.removedAppleDouble, [join(root, '._sidecar')])
  await assert.rejects(readFile(join(selectedBundle, 'stale.txt')))
  assert.equal(await readFile(join(otherBundle, 'keep.txt'), 'utf8'), 'keep')
})

test('rejects targets outside the supported simulator output directories', async () => {
  await assert.rejects(
    prepareIosSimulatorBuild('/tmp/example', 'aarch64'),
    /Unsupported iOS simulator target: aarch64/,
  )
})
