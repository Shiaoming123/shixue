import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDeliveryPath,
  assertArtifactSet,
  assertDeliveryMetadata,
  assertUniqueArtifactDigests,
  deliveryFileName,
  readWindowsBuildMetadata,
  resolveCargoTargetRoot,
  selectSingleArtifact,
} from '../scripts/package-windows.mjs'
import { stageWindowsPortable } from '../scripts/stage-windows-portable.mjs'
import { validateWindowsReleaseWorkflow } from '../scripts/release-kit/config.mjs'

function testPeExecutable() {
  const executable = Buffer.alloc(0x44)
  executable.write('MZ', 0, 'ascii')
  executable.writeUInt32LE(0x40, 0x3c)
  executable.set([0x50, 0x45, 0, 0], 0x40)
  return executable
}

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

test('keeps generated Windows delivery files in the versioned delivery root', () => {
  const root = resolve('D:/repo/release-artifacts/windows')
  assert.equal(
    assertDeliveryPath(root, 'D:/repo/release-artifacts/windows/0.2.0'),
    resolve('D:/repo/release-artifacts/windows/0.2.0'),
  )
  assert.throws(() => assertDeliveryPath(root, 'D:/repo/release-artifacts'), /must stay inside/)
})

test('uses stable ASCII delivery filenames for the three Windows artifacts', () => {
  assert.equal(deliveryFileName('nsis', '0.2.0'), 'Shixue_0.2.0_x64_Setup.exe')
  assert.equal(deliveryFileName('msi', '0.2.0'), 'Shixue_0.2.0_x64_Installer.msi')
  assert.equal(deliveryFileName('portable', '0.2.0'), 'Shixue_0.2.0_x64_Portable.exe')
  assert.throws(() => deliveryFileName('appx', '0.2.0'), /Unknown Windows delivery artifact kind/)
})

test('uses one deterministic Cargo target root for custom and default builds', () => {
  const root = resolve('D:/repo')
  const absoluteTarget = resolve(root, '..', 'shared', 'cargo')
  assert.equal(resolveCargoTargetRoot(root, {}), resolve(root, 'src-tauri', 'target'))
  assert.equal(resolveCargoTargetRoot(root, { CARGO_TARGET_DIR: 'build/cargo' }), resolve(root, 'build/cargo'))
  assert.equal(resolveCargoTargetRoot(root, { CARGO_TARGET_DIR: absoluteTarget }), absoluteTarget)
})

test('uses Tauri mainBinaryName when the executable is renamed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'shixue-main-binary-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src-tauri'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  await writeFile(join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname = "cargo-name"\nversion = "1.2.3"\n')
  await writeFile(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
    version: '1.2.3', productName: '拾学', mainBinaryName: 'renamed-app', identifier: 'com.example.study',
  }))

  assert.equal((await readWindowsBuildMetadata(root)).binaryName, 'renamed-app')
})

test('selects exactly one version-matching bundle artifact', () => {
  assert.equal(
    selectSingleArtifact(
      ['D:/bundle/拾学_0.1.0_x64-setup.exe', 'D:/bundle/拾学_0.2.0_x64-setup.exe'],
      '-setup.exe',
      '0.2.0',
    ),
    'D:/bundle/拾学_0.2.0_x64-setup.exe',
  )
  assert.throws(
    () => selectSingleArtifact(['D:/bundle/拾学_0.1.0_x64-setup.exe'], '-setup.exe', '0.2.0'),
    /found 0/,
  )
})

test('requires one unique artifact of each Windows delivery kind', () => {
  const valid = [
    { kind: 'nsis', file: 'setup.exe' },
    { kind: 'msi', file: 'installer.msi' },
    { kind: 'portable', file: 'portable.exe' },
  ]
  assert.doesNotThrow(() => assertArtifactSet(valid))
  assert.throws(
    () => assertArtifactSet(valid.map(() => ({ kind: 'portable', file: 'portable.exe' }))),
    /one unique NSIS, MSI, and portable/,
  )
  assert.throws(
    () => assertArtifactSet(valid.map((artifact) => ({ ...artifact, file: 'same.exe' }))),
    /filenames must be unique/,
  )
})

test('rejects stale metadata and byte-identical delivery binaries', () => {
  const expected = {
    productName: '拾学', packageName: 'meow-study', binaryName: 'meow-study',
    identifier: 'com.example.study', version: '1.2.3', architecture: 'x64',
  }
  assert.doesNotThrow(() => assertDeliveryMetadata({ ...expected }, expected))
  assert.throws(() => assertDeliveryMetadata({ ...expected, identifier: 'com.other.study' }, expected), /identifier/)
  assert.doesNotThrow(() => assertUniqueArtifactDigests(['a', 'b', 'c']))
  assert.throws(() => assertUniqueArtifactDigests(['a', 'b', 'a']), /byte-identical/)
})

test('stages the release executable under a stable portable name with checksum proof', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'shixue-portable-release-'))
  const source = join(root, 'meow-study.exe')
  const output = join(root, 'release')
  await writeFile(source, testPeExecutable())
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await stageWindowsPortable({
    source,
    outputDirectory: output,
    version: '0.2.0',
    architecture: 'x64',
  })

  assert.equal(result.fileName, 'Shixue_0.2.0_x64_Portable.exe')
  assert.deepEqual(await readFile(result.path), testPeExecutable())
  assert.match(await readFile(result.checksumPath, 'utf8'), /^[a-f0-9]{64}  Shixue_0\.2\.0_x64_Portable\.exe\n$/)
})

test('rejects a non-PE file before staging a portable release', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'shixue-portable-invalid-'))
  const source = join(root, 'not-an-exe.bin')
  await writeFile(source, 'not a PE file')
  t.after(() => rm(root, { recursive: true, force: true }))

  await assert.rejects(
    stageWindowsPortable({
      source,
      outputDirectory: join(root, 'release'),
      version: '0.2.0',
      architecture: 'x64',
    }),
    /valid PE executable/,
  )
})

test('rejects an MZ-prefixed file without a PE signature', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'shixue-portable-mz-only-'))
  const source = join(root, 'not-a-pe.exe')
  await writeFile(source, Buffer.from('MZportable-test'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await assert.rejects(stageWindowsPortable({
    source,
    outputDirectory: join(root, 'release'),
    version: '0.2.0',
    architecture: 'x64',
  }), /valid PE executable/)
})

test('repository release workflow cannot omit the portable Windows release asset', async () => {
  const workflow = await readFile(join(projectRoot, '.github', 'workflows', 'release.yml'), 'utf8')
  assert.deepEqual(validateWindowsReleaseWorkflow(workflow), [])
  assert.match(workflow, /checksum_path/)
  assert.match(workflow, /checksum_name/)
})
