import type { Tag, WorkspaceStateV4 } from '../workspace/types.ts'
import {
  DomainCommandError,
  type CapabilityCommandContext,
  type CommandApplication,
  type TagCapabilityCommand,
} from './types.ts'

export function applyTagCommand(
  state: WorkspaceStateV4,
  command: TagCapabilityCommand,
  context: CapabilityCommandContext,
): CommandApplication {
  if (command.type === 'tag.create') return createTag(state, command, context)
  if (command.type === 'tag.rename') return renameTag(state, command, context)
  return archiveTag(state, command, context)
}

function createTag(
  state: WorkspaceStateV4,
  command: Extract<TagCapabilityCommand, { type: 'tag.create' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const title = normalizedTitle(command.title)
  assertUniqueActiveTitle(state, title)
  const id = command.tagId ?? context.id('tag')
  if (workspaceHasId(state, id)) {
    throw new DomainCommandError('TAG_ALREADY_EXISTS', `Workspace entity already uses tag id: ${id}.`, { tagId: id })
  }
  const tag: Tag = {
    id,
    title,
    position: Math.max(-1, ...state.tags.map(({ position }) => position)) + 1,
    createdAt: context.now,
    updatedAt: context.now,
    archivedAt: null,
  }
  state.tags.push(tag)
  const entity = { type: 'tag' as const, id: tag.id }
  return {
    affected: [entity],
    changes: [{ entity, operation: 'create', fields: ['tag'] }],
    events: [],
    compensation: { type: 'tag.remove_created', tagId: tag.id },
    data: json(tag),
  }
}

function renameTag(
  state: WorkspaceStateV4,
  command: Extract<TagCapabilityCommand, { type: 'tag.rename' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const tag = requireActiveTag(state, command.tagId)
  const title = normalizedTitle(command.title)
  assertUniqueActiveTitle(state, title, tag.id)
  const before = structuredClone(tag)
  tag.title = title
  tag.updatedAt = context.now
  const entity = { type: 'tag' as const, id: tag.id }
  return {
    affected: [entity],
    changes: [{ entity, operation: 'update', fields: ['title'] }],
    events: [],
    compensation: { type: 'tag.restore', tag: before },
    data: json(tag),
  }
}

function archiveTag(
  state: WorkspaceStateV4,
  command: Extract<TagCapabilityCommand, { type: 'tag.archive' }>,
  context: CapabilityCommandContext,
): CommandApplication {
  const tag = requireActiveTag(state, command.tagId)
  const before = structuredClone(tag)
  tag.archivedAt = context.now
  tag.updatedAt = context.now
  const entity = { type: 'tag' as const, id: tag.id }
  return {
    affected: [entity],
    changes: [{ entity, operation: 'update', fields: ['archivedAt'] }],
    events: [],
    compensation: { type: 'tag.restore', tag: before },
    data: json(tag),
  }
}

function requireActiveTag(state: WorkspaceStateV4, tagId: string): Tag {
  const tag = state.tags.find(({ id, archivedAt }) => id === tagId && archivedAt === null)
  if (!tag) throw new DomainCommandError('TAG_NOT_FOUND', `Active tag not found: ${tagId}.`, { tagId })
  return tag
}

function normalizedTitle(title: string): string {
  const normalized = title.trim()
  if (!normalized) throw new DomainCommandError('VALIDATION_ERROR', 'Tag title is required.')
  return normalized
}

function assertUniqueActiveTitle(state: WorkspaceStateV4, title: string, exceptId?: string): void {
  if (state.tags.some(({ id, archivedAt, title: candidate }) => id !== exceptId && archivedAt === null && candidate === title)) {
    throw new DomainCommandError('TAG_ALREADY_EXISTS', `Active tag title already exists: ${title}.`, { title })
  }
}

function workspaceHasId(state: WorkspaceStateV4, id: string): boolean {
  return [
    state.listGroups, state.lists, state.sections, state.tags, state.tasks,
    state.recurrenceSeries, state.occurrences, state.reminderRules,
    state.reminderDeliveries, state.studySessions, state.taskEvents,
    state.completionRecords, state.reviewTaskLinks, state.commandReceipts,
  ].some((items) => items.some((item) => item.id === id))
}

function json(value: unknown): CommandApplication['data'] {
  return structuredClone(value) as CommandApplication['data']
}
