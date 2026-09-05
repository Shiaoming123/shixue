import type { JsonValue, ReminderDelivery, WorkspaceStateV3 } from '../workspace/types.ts'
import { DomainCommandError } from '../capabilities/types.ts'
import type { LegacyReminderRow, ReminderAckRequest, ReminderClaimRequest } from './protocol.ts'
import { deliveryKey, resolveReminderInstant } from './resolve.ts'

export type DeliveryCommand =
  | ({ type: 'reminder.claim' } & ReminderClaimRequest)
  | ({ type: 'reminder.ack' } & ReminderAckRequest)
  | { type: 'reminder.recover'; claims: ReminderClaimRequest[] }
  | { type: 'reminder.retry'; deliveryId: string; expectedRevision: number }
  | { type: 'reminder.migrate'; rows: LegacyReminderRow[] }

export function applyDeliveryCommand(state: WorkspaceStateV3, command: DeliveryCommand, now: string): JsonValue {
  if (command.type === 'reminder.migrate') {
    if (state.reminderMigration) {
      const prior = [...state.reminderMigration.mapped, ...state.reminderMigration.quarantined].map(({ row }) => row)
      const key = (rows: LegacyReminderRow[]) => JSON.stringify(rows.map((row) => JSON.stringify([row.taskId, row.reminderAt, row.deliveredAt])).sort())
      if (key(prior) !== key(command.rows)) invalid('Legacy migration input changed after completion.')
      return { migrated: true, quarantined: state.reminderMigration.quarantined.length }

    }
    const migration: NonNullable<WorkspaceStateV3['reminderMigration']> = { version: 1, completedAt: now, mapped: [], quarantined: [] }
    for (const row of command.rows) {
      const instant = Date.parse(row.reminderAt)
      const matches = Number.isFinite(instant) ? state.reminderRules.filter((rule) => rule.taskId === row.taskId && rule.occurrenceId === null && rule.trigger.kind === 'absolute' && Date.parse(rule.trigger.at) === instant) : []
      if (!matches.length || !Number.isFinite(Date.parse(row.deliveredAt))) {
        migration.quarantined.push({ row: structuredClone(row), reason: 'No provable absolute delivery mapping.' })
        continue
      }
      const ids: string[] = []
      for (const rule of matches) {
        const at = new Date(instant).toISOString()
        const key = deliveryKey(rule.id, null, at)
        let delivery = state.reminderDeliveries.find((item) => deliveryKey(item.reminderRuleId, item.occurrenceId, item.scheduledFor) === key)
        if (!delivery) {
          delivery = { id: `delivery:${key}`, reminderRuleId: rule.id, occurrenceId: null, scheduledFor: at, status: 'delivered', snoozedUntil: null, action: null }
          state.reminderDeliveries.push(delivery)
        }
        if (delivery.status === 'pending') delivery.status = 'delivered'
        if (!delivery.acknowledgedAt) {
          delivery.acknowledgedAt = new Date(row.deliveredAt).toISOString()
          delivery.revision = (delivery.revision ?? 0) + 1
        }
        ids.push(delivery.id)
      }
      migration.mapped.push({ row: structuredClone(row), deliveryIds: ids })
    }
    state.reminderMigration = migration
    return { migrated: true, quarantined: migration.quarantined.length }
  }
  if (command.type === 'reminder.recover') {
    for (const request of command.claims) {
      const delivery = requireDelivery(state, request)
      requireClaim(delivery, request.token)
      delivery.status = 'ambiguous'
      delivery.revision = (delivery.revision ?? 1) + 1
    }
    return { recovered: command.claims.length }
  }
  const delivery = requireDelivery(state, command)
  if (command.type === 'reminder.claim') {
    if (!state.reminderMigration || state.reminderMigration.quarantined.length) invalid('Reminder migration is incomplete or quarantined; sending is blocked.')
    if (!['pending', 'snoozed'].includes(delivery.status)) invalid('Delivery is not available for claiming.')
    if (typeof command.token !== 'string' || !command.token.trim()) invalid('Claim token is required.')
    const rule = state.reminderRules.find(({ id }) => id === delivery.reminderRuleId)!
    const task = state.tasks.find(({ id }) => id === rule.taskId)!
    const occurrence = delivery.occurrenceId ? state.occurrences.find(({ id }) => id === delivery.occurrenceId) ?? null : null
    const resolved = resolveReminderInstant(rule, task, occurrence)
    if (!resolved || resolved !== new Date(delivery.scheduledFor).toISOString()) invalid('Delivery no longer matches an active rule.')
    if (Date.parse(delivery.snoozedUntil ?? delivery.scheduledFor) > Date.parse(now)) invalid('Delivery is not due.')
    delivery.status = 'armed'
    delivery.claim = { token: command.token, armedAt: now }
    delete delivery.acknowledgedAt
  } else if (command.type === 'reminder.ack') {
    requireClaim(delivery, command.token)
    delivery.status = command.outcome === 'accepted' ? 'delivered' : command.outcome
    delivery.acknowledgedAt = now
  } else {
    if (delivery.status !== 'ambiguous' && delivery.status !== 'failed') invalid('Only failed or ambiguous delivery can be explicitly retried.')
    delivery.status = 'pending'
    delivery.snoozedUntil = null
    delete delivery.claim
    delete delivery.acknowledgedAt
  }
  delivery.revision = (delivery.revision ?? 1) + 1
  return JSON.parse(JSON.stringify(delivery)) as JsonValue
}

function requireDelivery(state: WorkspaceStateV3, request: { deliveryId: string; expectedRevision: number }): ReminderDelivery {
  const delivery = state.reminderDeliveries.find(({ id }) => id === request.deliveryId)
  if (!delivery) invalid('Delivery does not exist.')
  if ((delivery.revision ?? 1) !== request.expectedRevision) throw new DomainCommandError('ENTITY_REVISION_CONFLICT', 'Delivery revision changed.')
  return delivery
}

function requireClaim(delivery: ReminderDelivery, token: string): void {
  if (delivery.status !== 'armed' || delivery.claim?.token !== token) invalid('Claim is no longer armed or its token does not match.')
}

function invalid(message: string): never { throw new DomainCommandError('VALIDATION_ERROR', message) }
