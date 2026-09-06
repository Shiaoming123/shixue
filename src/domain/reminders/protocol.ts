/** Persistence contract only. No platform sender may activate before migration completes. */
export interface ReminderClaim {
  token: string
  armedAt: string
}

export interface LegacyReminderRow {
  taskId: string
  reminderAt: string
  deliveredAt: string
}

export interface ReminderMigration {
  version: 1
  completedAt: string
  mapped: Array<{ row: LegacyReminderRow; deliveryIds: string[] }>
  quarantined: Array<{ row: LegacyReminderRow; reason: string }>
}

export interface ReminderClaimRequest {
  deliveryId: string
  expectedRevision: number
  token: string
}

export interface ReminderAckRequest {
  deliveryId: string
  expectedRevision: number
  token: string
  outcome: 'accepted' | 'failed' | 'ambiguous'
}
