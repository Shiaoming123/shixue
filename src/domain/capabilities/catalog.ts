import { DomainCommandError, type CapabilityCommand, type CommandDescriptor, type PreviewConfirmation } from './types.ts'

export const COMMAND_CATALOG: readonly CommandDescriptor[] = [
  { type: 'task.create', risk: 'low', scope: 'single', reversibility: 'compensating', requiresPreview: false },
  { type: 'task.update', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
  { type: 'task.delete', risk: 'high', scope: 'single', reversibility: 'compensating', requiresPreview: true },
  { type: 'task.complete', risk: 'medium', scope: 'single', reversibility: 'reversible', requiresPreview: false },
  { type: 'task.reopen', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
  { type: 'task.reschedule', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
  { type: 'task.batch_reschedule', risk: 'medium', scope: 'batch', reversibility: 'reversible', requiresPreview: true },
  { type: 'task.batch_cancel', risk: 'high', scope: 'batch', reversibility: 'reversible', requiresPreview: true },
  { type: 'task.batch_delete', risk: 'high', scope: 'batch', reversibility: 'compensating', requiresPreview: true },
  { type: 'recurrence.create', risk: 'medium', scope: 'series', reversibility: 'reversible', requiresPreview: true },
  { type: 'recurrence.update', risk: 'high', scope: 'series', reversibility: 'reversible', requiresPreview: true },
  { type: 'recurrence.complete', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
  { type: 'recurrence.skip', risk: 'low', scope: 'single', reversibility: 'reversible', requiresPreview: false },
  { type: 'list.upsert', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'list_group.upsert', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'list_group.archive', risk: 'medium', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'task.plan', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'task.transition', risk: 'medium', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'task.start', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'task.switch', risk: 'medium', scope: 'batch', reversibility: 'irreversible', requiresPreview: false },
  { type: 'session.pause', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'session.resume', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'session.scratchpad.update', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'task.checklist.add', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'task.checklist.set', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'task.reorder', risk: 'low', scope: 'batch', reversibility: 'irreversible', requiresPreview: false },
  { type: 'task.toggle_completion', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'completion.review', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'completion.create_next_action', risk: 'low', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
  { type: 'workspace.reset', risk: 'high', scope: 'workspace', reversibility: 'irreversible', requiresPreview: true },
  { type: 'workspace.import', risk: 'high', scope: 'workspace', reversibility: 'irreversible', requiresPreview: true },
  ...(['reminder.set', 'reminder.snooze', 'reminder.dismiss', 'reminder.claim', 'reminder.ack', 'reminder.migrate', 'reminder.recover', 'reminder.retry', 'reminder.reconcile'] as const).map((type) => ({ type, risk: 'low' as const, scope: 'single' as const, reversibility: 'irreversible' as const, requiresPreview: false })),
  { type: 'undo.apply', risk: 'medium', scope: 'single', reversibility: 'irreversible', requiresPreview: false },
]

export function getCommandDescriptor(type: CapabilityCommand['type']): CommandDescriptor {
  const descriptor = COMMAND_CATALOG.find((candidate) => candidate.type === type)
  if (!descriptor) throw new DomainCommandError('COMMAND_NOT_FOUND', `Unknown command: ${type}.`, { commandType: type })
  return structuredClone(descriptor)
}

export function getPreviewConfirmation(descriptor: CommandDescriptor): PreviewConfirmation {
  if (descriptor.risk === 'high') return 'explicit'
  if (descriptor.scope === 'batch' || descriptor.scope === 'workspace' || descriptor.requiresPreview) return 'review'
  return 'none'
}
