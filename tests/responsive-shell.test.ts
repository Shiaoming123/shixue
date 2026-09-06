import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveShell } from '../src/lib/responsive-shell.ts'

test('workspace shell resolves the five locked viewport contracts', () => {
  assert.deepEqual(resolveShell(1440), {
    mode: 'three-column', navigation: 'sidebar', detail: 'aside', detailWidth: 360, horizontalOverflow: false,
  })
  assert.deepEqual(resolveShell(1280), {
    mode: 'three-column', navigation: 'sidebar', detail: 'aside', detailWidth: 360, horizontalOverflow: false,
  })
  assert.deepEqual(resolveShell(820), {
    mode: 'rail-with-overlay-detail', navigation: 'rail', detail: 'overlay', detailWidth: 360, horizontalOverflow: false,
  })
  for (const width of [390, 320]) {
    assert.deepEqual(resolveShell(width), {
      mode: 'single-column-bottom-tabs', navigation: 'bottom-tabs', detail: 'sheet', detailWidth: width, horizontalOverflow: false,
    })
  }
})

test('workspace shell keeps the exact 819/820 and 1279/1280 boundaries', () => {
  assert.equal(resolveShell(819).mode, 'single-column-bottom-tabs')
  assert.equal(resolveShell(820).mode, 'rail-with-overlay-detail')
  assert.equal(resolveShell(1279).mode, 'rail-with-overlay-detail')
  assert.equal(resolveShell(1280).mode, 'three-column')
  assert.throws(() => resolveShell(0), /positive viewport width/)
})
