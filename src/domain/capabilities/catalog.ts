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
  { type: 'workspace.import', risk: 'high', scope: 'workspace', reversibility: 'irreversible', requiresPreview: true },
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
