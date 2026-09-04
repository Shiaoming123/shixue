import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultModuleConfig } from '../src/modules/config.ts'
import { moduleContracts } from '../src/modules/contract.ts'

test('cloud sync remains opt-in and provider-neutral at the generic module boundary', () => {
  assert.equal(defaultModuleConfig.sync, false)
  assert.equal(moduleContracts.sync.platforms, undefined)
  assert.equal(moduleContracts.sync.requiredCapabilities, undefined)
  assert.deepEqual(moduleContracts.sync.nativeBuild, { kind: 'none' })
})
