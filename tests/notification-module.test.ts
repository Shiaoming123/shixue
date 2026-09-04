import assert from 'node:assert/strict'
import test from 'node:test'
import { sendStudyReminderNotification, sendTaskReminderNotification } from '../src/modules/notification/index.ts'

test('permission denial and native notification failures are non-fatal to callers', async () => {
  const denied = await sendStudyReminderNotification(
    { dueTaskCount: 1, dueReviewCount: 0 },
    async () => ({
      isPermissionGranted: async () => false,
      requestPermission: async () => 'denied',
      sendNotification: () => {
        throw new Error('must not send after denial')
      },
    }),
  )
  const failed = await sendStudyReminderNotification(
    { dueTaskCount: 1, dueReviewCount: 0 },
    async () => {
      throw new Error('native bridge unavailable')
    },
  )

  assert.deepEqual([denied, failed], [false, false])
})

test('granted notifications contain only the count-based reminder copy', async () => {
  const sent: unknown[] = []
  const delivered = await sendStudyReminderNotification(
    { dueTaskCount: 2, dueReviewCount: 1 },
    async () => ({
      isPermissionGranted: async () => true,
      requestPermission: async () => {
        throw new Error('permission was already granted')
      },
      sendNotification: (notification) => { sent.push(notification) },
    }),
  )

  assert.equal(delivered, true)
  assert.deepEqual(sent, [
    { title: '拾学提醒', body: '2 个到期任务，1 个待复习' },
  ])
})

test('native send failure and an empty reminder set remain non-fatal', async () => {
  const sendFailed = await sendStudyReminderNotification(
    { dueTaskCount: 1, dueReviewCount: 0 },
    async () => ({
      isPermissionGranted: async () => true,
      requestPermission: async () => 'granted',
      sendNotification: () => { throw new Error('send failed') },
    }),
  )
  const empty = await sendStudyReminderNotification(
    { dueTaskCount: 0, dueReviewCount: 0 },
    async () => { throw new Error('must not load native bridge') },
  )

  assert.deepEqual([sendFailed, empty], [false, false])
})

test('exact task reminder keeps the user title and uses the shared permission gate', async () => {
  const sent: unknown[] = []
  const delivered = await sendTaskReminderNotification('复习 Tauri 权限', async () => ({
    isPermissionGranted: async () => true,
    requestPermission: async () => 'granted',
    sendNotification: (notification) => { sent.push(notification) },
  }))
  assert.equal(delivered, true)
  assert.deepEqual(sent, [{ title: '拾学', body: '复习 Tauri 权限' }])
})
