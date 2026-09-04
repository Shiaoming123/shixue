import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import {
  assertDeliveryPath,
  deliveryFileName,
  selectSingleArtifact,
} from '../scripts/package-windows.mjs'

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
