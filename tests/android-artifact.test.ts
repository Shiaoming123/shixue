import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAndroidBadging,
  validateAndroidBadging,
} from '../scripts/check-android-artifact.mjs'

const validBadging = `package: name='com.shiaoming123.shixue' versionCode='3000' versionName='0.3.0'
sdkVersion:'24'
targetSdkVersion:'36'
native-code: 'arm64-v8a' 'x86_64'`

test('accepts a debug APK whose identity and SDK metadata match Shixue', () => {
  const metadata = parseAndroidBadging(validBadging)

  assert.deepEqual(metadata, {
    packageName: 'com.shiaoming123.shixue',
    versionCode: '3000',
    versionName: '0.3.0',
    minSdk: 24,
    targetSdk: 36,
    abis: ['arm64-v8a', 'x86_64'],
  })
  assert.deepEqual(
    validateAndroidBadging(metadata, {
      identifier: 'com.shiaoming123.shixue',
      version: '0.3.0',
    }),
    [],
  )
})

test('rejects an APK with mismatched application identity or incomplete metadata', () => {
  const metadata = parseAndroidBadging(`package: name='com.example.other' versionCode='1' versionName='0.2.0'`)

  assert.deepEqual(
    validateAndroidBadging(metadata, {
      identifier: 'com.shiaoming123.shixue',
      version: '0.3.0',
    }),
    [
      'APK package name does not match the Tauri identifier.',
      'APK versionName does not match package.json.',
      'APK must declare numeric minSdk and targetSdk values.',
      'APK must contain at least one native ABI.',
    ],
  )
})
