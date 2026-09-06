import type { CapabilityCommand, TaskCapabilityService } from '../domain/capabilities/types.ts'
import type { ReminderDelivery, Task } from '../domain/workspace/types.ts'
import type { LegacyReminderRow } from '../domain/reminders/protocol.ts'

export interface ReminderRuntimeOptions {
  service: TaskCapabilityService
  readLegacyRows(): Promise<LegacyReminderRow[]>
  enabled(): boolean
  sendNotification(delivery: ReminderDelivery, task: Task): Promise<boolean>
  onError(error: unknown): void
  onDelivery?(delivery: ReminderDelivery): void
  clock?(): string
  withExclusiveLock?(operation: () => Promise<void>): Promise<void>
}

export function createReminderRuntime(options: ReminderRuntimeOptions) {
  const { service } = options
  const clock = options.clock ?? (() => new Date().toISOString())
  let started = false
  let stopped = false
  let running: Promise<void> | null = null
  const submitted = new Set<string>()
  const snapshot = () => service.query({ type: 'workspace.snapshot' })
  const execute = async (command: CapabilityCommand) => service.execute({
    protocolVersion: 1, source: 'notification', idempotencyKey: `reminder-runtime:${crypto.randomUUID()}`,
    expectedWorkspaceRevision: (await snapshot()).revision, command,
  })

  async function run() {
    if (stopped) return
    await execute({ type: 'reminder.migrate', rows: await options.readLegacyRows() })
    if (!started) {
      const abandoned = (await snapshot()).reminderDeliveries.filter(({ status }) => status === 'armed')
      if (abandoned.length) await execute({ type: 'reminder.recover', claims: abandoned.map((delivery) => ({ deliveryId: delivery.id, expectedRevision: delivery.revision ?? 1, token: delivery.claim!.token })) })
      started = true
    }
    if (stopped || !options.enabled()) return
    const migrated = await snapshot()
    if (!migrated.reminderMigration || migrated.reminderMigration.quarantined.length) throw new Error('提醒迁移存在无法确认的旧记录，系统投递已停止。')
    await execute({ type: 'reminder.reconcile' })
    const state = await snapshot()
    const due = state.reminderDeliveries.filter((delivery) => ['pending', 'snoozed'].includes(delivery.status) && Date.parse(delivery.snoozedUntil ?? delivery.scheduledFor) <= Date.parse(clock()))
    for (const candidate of due) {
      if (stopped || !options.enabled()) break
      const token = `reminder-attempt:${crypto.randomUUID()}`
      await execute({ type: 'reminder.claim', deliveryId: candidate.id, expectedRevision: candidate.revision ?? 1, token })
      const current = await snapshot()
      const delivery = current.reminderDeliveries.find(({ id }) => id === candidate.id)!
      if (delivery.status !== 'armed' || delivery.claim?.token !== token || submitted.has(token)) continue
      const rule = current.reminderRules.find(({ id }) => id === delivery.reminderRuleId)!
      const task = current.tasks.find(({ id }) => id === rule.taskId)!
      submitted.add(token)
      let outcome: 'accepted' | 'failed' | 'ambiguous' = 'ambiguous'
      try {
        outcome = !stopped && options.enabled() && await options.sendNotification(delivery, task) ? 'accepted' : 'failed'
      } catch (error) { options.onError(error) }
      await execute({ type: 'reminder.ack', deliveryId: delivery.id, expectedRevision: delivery.revision!, token, outcome })
      options.onDelivery?.((await snapshot()).reminderDeliveries.find(({ id }) => id === delivery.id)!)
    }
  }

  return {
    poll(): Promise<void> {
      if (!running) running = (options.withExclusiveLock ?? withReminderRuntimeLock)(run).catch(options.onError).finally(() => { running = null })
      return running
    },
    stop() { stopped = true },
  }
}

/** No verified native button/click callbacks are exposed by this adapter. */
export const REMINDER_NATIVE_ACTIONS = 'UNSUPPORTED' as const

export async function readNativeLegacyReminderRows(): Promise<LegacyReminderRow[]> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<LegacyReminderRow[]>('read_legacy_reminder_deliveries')
}

/** Permission query only. Thrown submission failures remain ambiguous to the runtime. */
export async function submitNativeReminder(_delivery: ReminderDelivery, task: Task): Promise<boolean> {
  const { isPermissionGranted, sendNotification } = await import('@tauri-apps/plugin-notification')
  if (!await isPermissionGranted()) return false
  await sendNotification({ title: '拾学', body: task.title })
  return true
}

/** Cross-context ownership covers the entire migration, recovery and send/ack window. */
export async function withReminderRuntimeLock(operation: () => Promise<void>, locks: Pick<LockManager, 'request'> | null = globalThis.navigator?.locks ?? null): Promise<void> {
  if (!locks) throw new Error('Reminder exclusive locking is unavailable; delivery is stopped.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    await locks.request('shixue-reminder-runtime', { mode: 'exclusive', signal: controller.signal }, async () => {
      clearTimeout(timeout)
      await operation()
    })
  } finally { clearTimeout(timeout) }
}
