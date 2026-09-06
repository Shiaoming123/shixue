import { DomainCommandError } from './types.ts'

export function assertPlanningDuration(estimateMinutes: number): void {
  if (!Number.isInteger(estimateMinutes) || estimateMinutes < 5 || estimateMinutes > 1440 || estimateMinutes % 5 !== 0) {
    throw new DomainCommandError('VALIDATION_ERROR', 'Calendar duration must be from 5 to 1440 minutes in 5-minute steps.', {
      estimateMinutes,
    })
  }
}
