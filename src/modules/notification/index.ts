import type { Module } from '../types'
import {
  createStudyReminderNotificationCopy,
  type StudyReminderCounts,
  type StudyReminderNotificationCopy,
} from '../../lib/study-reminders.ts'

/**
 * notification 模块 —— 系统通知（P1，官方插件）。
 *
 * 典型场景：Agent 完成任务后弹系统通知提醒。
 * 底层由 tauri-plugin-notification 提供。
 */
const notification: Module = {
  id: 'notification',
  name: '系统通知',
  dependencies: [],
  platforms: ['desktop', 'mobile'],
  requiredCapabilities: ['native-notification'],
}

export default notification

interface NotificationBindings {
  isPermissionGranted(): Promise<boolean>
  requestPermission(): Promise<string>
  sendNotification(
    notification: StudyReminderNotificationCopy,
  ): void | Promise<void>
}

type LoadNotificationBindings = () => Promise<NotificationBindings>

async function loadNotificationBindings(): Promise<NotificationBindings> {
  const { isPermissionGranted, requestPermission, sendNotification } =
    await import('@tauri-apps/plugin-notification')
  return { isPermissionGranted, requestPermission, sendNotification }
}

export async function sendStudyReminderNotification(
  counts: StudyReminderCounts,
  loadBindings: LoadNotificationBindings = loadNotificationBindings,
): Promise<boolean> {
  if (counts.dueTaskCount + counts.dueReviewCount === 0) return false

  try {
    const bindings = await loadBindings()
    const alreadyGranted = await bindings.isPermissionGranted()
    const granted =
      alreadyGranted || (await bindings.requestPermission()) === 'granted'
    if (!granted) return false

    await bindings.sendNotification(
      createStudyReminderNotificationCopy(counts),
    )
    return true
  } catch {
    return false
  }
}

export async function sendTaskReminderNotification(
  title: string,
  loadBindings: LoadNotificationBindings = loadNotificationBindings,
): Promise<boolean> {
  try {
    const bindings = await loadBindings()
    const granted = await bindings.isPermissionGranted() || (await bindings.requestPermission()) === 'granted'
    if (!granted) return false
    await bindings.sendNotification({ title: '拾学', body: title })
    return true
  } catch {
    return false
  }
}
