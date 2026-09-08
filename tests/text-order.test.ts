import assert from 'node:assert/strict'
import test from 'node:test'
import { compareText } from '../src/lib/text-order.ts'

test('text order compares raw code units without locale or normalization', () => {
  assert.equal(compareText('alpha', 'alpha'), 0)
  assert.equal(compareText('Beta', 'alpha'), -1)
  assert.equal(compareText('alpha', 'Beta'), 1)
  assert.equal(compareText('Ａ', 'A'), 1)
})
