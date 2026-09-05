import assert from 'node:assert/strict'
import test from 'node:test'
import { detectUiPlatform, isMobileUserAgent } from '../src/lib/platform.ts'

test('detects Android and iOS user agents without matching desktop', () => {
  assert.equal(isMobileUserAgent('Mozilla/5.0 (Linux; Android 15)'), true)
  assert.equal(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)'), true)
  assert.equal(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), false)
})

test('keeps iPad desktop user agents in the iOS presentation and mobile capability path', () => {
  const source = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  }
  assert.equal(isMobileUserAgent(source.userAgent, source.platform, source.maxTouchPoints), true)
  assert.equal(detectUiPlatform(source), 'ios')
})
