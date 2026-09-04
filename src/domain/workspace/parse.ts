import type {
  CompletionRecord,
  CommandReceipt,
  JsonValue,
  LearningTaskFields,
  ListGroup,
  ListSection,
  OccurrenceOverride,
  RecurrenceCadence,
  RecurrenceSeries,
  ReminderDelivery,
  ReminderRule,
  ReviewTaskLink,
  StudySession,
  Tag,
  Task,
  TaskDeadline,
  TaskList,
  TaskOccurrence,
  TaskSchedule,
  TaskEvent,
  WorkspaceStateV3,
} from './types.ts'
import { WORKSPACE_STATE_VERSION } from './types.ts'

const MAX_ITEMS = 100_000
const MAX_TEXT_LENGTH = 100_000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
const TASK_STATUSES = ['inbox', 'planned', 'in_progress', 'blocked', 'completed', 'cancelled'] as const
const TASK_PRIORITIES = ['none', 'low', 'medium', 'high'] as const
const EVENT_TYPES = ['captured', 'migrated', 'planned', 'started', 'paused', 'resumed', 'blocked', 'completed', 'reopened', 'cancelled', 'rescheduled', 'deleted'] as const

export function parseWorkspaceState(value: unknown): WorkspaceStateV3 {
  const state = requireRecord(value, 'Workspace state')
  if (state.version !== WORKSPACE_STATE_VERSION) {
    throw new Error('Workspace state must use version 3.')
  }
  const parsed: WorkspaceStateV3 = {
    version: WORKSPACE_STATE_VERSION,
    revision: requirePositiveInteger(state.revision, 'Workspace state revision'),
    listGroups: parseArray(state.listGroups, 'Workspace state listGroups', parseListGroup),
    lists: parseArray(state.lists, 'Workspace state lists', parseTaskList),
    sections: parseArray(state.sections, 'Workspace state sections', parseListSection),
    tags: parseArray(state.tags, 'Workspace state tags', parseTag),
    tasks: parseArray(state.tasks, 'Workspace state tasks', parseTask),
    recurrenceSeries: parseArray(state.recurrenceSeries, 'Workspace state recurrenceSeries', parseSeries),
    occurrences: parseArray(state.occurrences, 'Workspace state occurrences', parseOccurrence),
    reminderRules: parseArray(state.reminderRules, 'Workspace state reminderRules', parseReminderRule),
    reminderDeliveries: parseArray(state.reminderDeliveries, 'Workspace state reminderDeliveries', parseReminderDelivery),
    studySessions: parseArray(state.studySessions, 'Workspace state studySessions', parseStudySession),
    taskEvents: parseArray(state.taskEvents, 'Workspace state taskEvents', parseTaskEvent),
    completionRecords: parseArray(state.completionRecords, 'Workspace state completionRecords', parseCompletionRecord),
    reviewTaskLinks: parseArray(state.reviewTaskLinks, 'Workspace state reviewTaskLinks', parseReviewTaskLink),
    commandReceipts: parseArray(state.commandReceipts, 'Workspace state commandReceipts', parseCommandReceipt),
    updatedAt: requireIsoDateTime(state.updatedAt, 'Workspace state updatedAt'),
  }
  assertCollectionSizes(parsed)
  assertUniqueIds(parsed)
  assertReferences(parsed)
  return parsed
}

function parseListGroup(raw: unknown, index: number): ListGroup {
  const value = requireRecord(raw, `List group ${index}`)
  return {
    id: requireText(value.id, 'List group id'),
    title: requireText(value.title, 'List group title'),
    position: requireNonNegativeInteger(value.position, 'List group position'),
    createdAt: requireIsoDateTime(value.createdAt, 'List group createdAt'),
    updatedAt: requireIsoDateTime(value.updatedAt, 'List group updatedAt'),
    archivedAt: parseNullableIsoDateTime(value.archivedAt, 'List group archivedAt'),
  }
}

function parseTaskList(raw: unknown, index: number): TaskList {
  const value = requireRecord(raw, `Task list ${index}`)
  return {
    id: requireText(value.id, 'Task list id'),
    groupId: parseNullableText(value.groupId, 'Task list groupId'),
    title: requireText(value.title, 'Task list title'),
    position: requireNonNegativeInteger(value.position, 'Task list position'),
    goal: requireText(value.goal, 'Task list goal', true),
    successCriteria: parseTextArray(value.successCriteria, 'Task list successCriteria'),
    weeklyTargetMinutes: parseNullablePositiveInteger(value.weeklyTargetMinutes, 'Task list weeklyTargetMinutes'),
    createdAt: requireIsoDateTime(value.createdAt, 'Task list createdAt'),
    updatedAt: requireIsoDateTime(value.updatedAt, 'Task list updatedAt'),
    archivedAt: parseNullableIsoDateTime(value.archivedAt, 'Task list archivedAt'),
  }
}

function parseListSection(raw: unknown, index: number): ListSection {
  const value = requireRecord(raw, `List section ${index}`)
  return {
    id: requireText(value.id, 'List section id'),
    listId: requireText(value.listId, 'List section listId'),
    title: requireText(value.title, 'List section title'),
    position: requireNonNegativeInteger(value.position, 'List section position'),
    createdAt: requireIsoDateTime(value.createdAt, 'List section createdAt'),
    updatedAt: requireIsoDateTime(value.updatedAt, 'List section updatedAt'),
    archivedAt: parseNullableIsoDateTime(value.archivedAt, 'List section archivedAt'),
  }
}

function parseTag(raw: unknown, index: number): Tag {
  const value = requireRecord(raw, `Tag ${index}`)
  return {
    id: requireText(value.id, 'Tag id'),
    title: requireText(value.title, 'Tag title'),
    position: requireNonNegativeInteger(value.position, 'Tag position'),
    createdAt: requireIsoDateTime(value.createdAt, 'Tag createdAt'),
    updatedAt: requireIsoDateTime(value.updatedAt, 'Tag updatedAt'),
    archivedAt: parseNullableIsoDateTime(value.archivedAt, 'Tag archivedAt'),
  }
}

function parseTask(raw: unknown, index: number): Task {
  const value = requireRecord(raw, `Task ${index}`)
  const mode = parseEnum(value.mode, ['general', 'learning'], 'Task mode')
  const status = parseEnum(value.status, TASK_STATUSES, 'Task status')
  const learning = parseLearning(value.learning)
  if ((mode === 'learning') !== (learning !== null)) {
    throw new Error('A learning task requires learning fields, and a general task cannot have them.')
  }
  return {
    id: requireText(value.id, 'Task id'),
    revision: requirePositiveInteger(value.revision, 'Task revision'),
    mode,
    listId: requireText(value.listId, 'Task listId'),
    sectionId: parseNullableText(value.sectionId, 'Task sectionId'),
    tagIds: parseTextArray(value.tagIds, 'Task tagIds'),
    title: requireText(value.title, 'Task title'),
    notes: requireText(value.notes, 'Task notes', true),
    status,
    schedule: parseSchedule(value.schedule),
    deadline: parseDeadline(value.deadline),
    priority: parseEnum(value.priority, TASK_PRIORITIES, 'Task priority'),
    checklist: parseChecklist(value.checklist),
    learning,
    recurrenceSeriesId: parseNullableText(value.recurrenceSeriesId, 'Task recurrenceSeriesId'),
    createdAt: requireIsoDateTime(value.createdAt, 'Task createdAt'),
    updatedAt: requireIsoDateTime(value.updatedAt, 'Task updatedAt'),
    deletedAt: parseNullableIsoDateTime(value.deletedAt, 'Task deletedAt'),
  }
}

function parseSchedule(raw: unknown): TaskSchedule {
  const value = requireRecord(raw, 'Task schedule')
  const startAt = parseNullableIsoDateTime(value.startAt, 'Task schedule startAt')
  const startOn = parseNullableDateOnly(value.startOn, 'Task schedule startOn')
  if (startAt && startOn) throw new Error('Task schedule startOn and startAt are mutually exclusive.')
  return {
    startAt,
    startOn,
    estimateMinutes: parseNullablePositiveInteger(value.estimateMinutes, 'Task schedule estimateMinutes'),
  }
}

function parseDeadline(raw: unknown): TaskDeadline {
  const value = requireRecord(raw, 'Task deadline')
  const dueAt = parseNullableIsoDateTime(value.dueAt, 'Task deadline dueAt')
  const dueOn = parseNullableDateOnly(value.dueOn, 'Task deadline dueOn')
  if (dueAt && dueOn) throw new Error('Task deadline dueOn and dueAt are mutually exclusive.')
  return { dueAt, dueOn }
}

function parseLearning(raw: unknown): LearningTaskFields | null {
  if (raw === null) return null
  const value = requireRecord(raw, 'Task learning')
  return {
    acceptanceCriteria: parseTextArray(value.acceptanceCriteria, 'Task learning acceptanceCriteria'),
    blockedReason: parseNullableText(value.blockedReason, 'Task learning blockedReason'),
  }
}

function parseChecklist(raw: unknown): Task['checklist'] {
  const checklist = parseArray(raw, 'Task checklist', (entry, index) => {
    const value = requireRecord(entry, `Task checklist item ${index}`)
    if (typeof value.checked !== 'boolean') throw new Error('Task checklist checked must be boolean.')
    return {
      id: requireText(value.id, 'Task checklist id'),
      text: requireText(value.text, 'Task checklist text'),
      checked: value.checked,
      checkedAt: parseNullableIsoDateTime(value.checkedAt, 'Task checklist checkedAt'),
      position: requireNonNegativeInteger(value.position, 'Task checklist position'),
    }
  })
  assertUnique(checklist, 'checklist item')
  return checklist
}

function parseSeries(raw: unknown, index: number): RecurrenceSeries {
  const value = requireRecord(raw, `Recurrence series ${index}`)
  const basis = parseEnum(value.basis, ['fixed_schedule', 'after_completion'], 'Recurrence series basis')
  return {
    id: requireText(value.id, 'Recurrence series id'),
    taskId: requireText(value.taskId, 'Recurrence series taskId'),
    revision: requirePositiveInteger(value.revision, 'Recurrence series revision'),
    cadence: parseCadence(value.cadence),
    basis,
    anchorAt: requireIsoDateTime(value.anchorAt, 'Recurrence series anchorAt'),
    end: parseSeriesEnd(value.end),
    timezone: requireText(value.timezone, 'Recurrence series timezone'),
    createdThrough: parseNullableIsoDateTime(value.createdThrough, 'Recurrence series createdThrough'),
    createdCount: requireNonNegativeInteger(value.createdCount, 'Recurrence series createdCount'),
  }
}

function parseCadence(raw: unknown): RecurrenceCadence {
  const value = requireRecord(raw, 'Recurrence cadence')
  const interval = requirePositiveInteger(value.interval, 'Recurrence cadence interval')
  if (value.kind === 'daily') return { kind: 'daily', interval }
  if (value.kind === 'weekly') {
    const weekdays = parseArray(value.weekdays, 'Weekly recurrence weekdays', (day) => requireRangeInteger(day, 0, 6, 'Weekly recurrence weekday'))
    if (weekdays.length === 0 || new Set(weekdays).size !== weekdays.length) {
      throw new Error('Weekly recurrence weekdays must be unique and non-empty.')
    }
    return { kind: 'weekly', interval, weekdays }
  }
  if (value.kind === 'monthly') {
    return { kind: 'monthly', interval, dayOfMonth: requireRangeInteger(value.dayOfMonth, 1, 31, 'Monthly recurrence dayOfMonth') }
  }
  if (value.kind === 'yearly') {
    return {
      kind: 'yearly',
      interval,
      month: requireRangeInteger(value.month, 1, 12, 'Yearly recurrence month'),
      dayOfMonth: requireRangeInteger(value.dayOfMonth, 1, 31, 'Yearly recurrence dayOfMonth'),
    }
  }
  throw new Error('Recurrence cadence has invalid kind.')
}

function parseSeriesEnd(raw: unknown): RecurrenceSeries['end'] {
  const value = requireRecord(raw, 'Recurrence series end')
  if (value.kind === 'never') return { kind: 'never' }
  if (value.kind === 'on') return { kind: 'on', date: requireDateOnly(value.date, 'Recurrence series end date') }
  if (value.kind === 'after') return { kind: 'after', count: requirePositiveInteger(value.count, 'Recurrence series end count') }
  throw new Error('Recurrence series end has invalid kind.')
}

function parseOccurrence(raw: unknown, index: number): TaskOccurrence {
  const value = requireRecord(raw, `Task occurrence ${index}`)
  return {
    id: requireText(value.id, 'Task occurrence id'),
    seriesId: requireText(value.seriesId, 'Task occurrence seriesId'),
    ordinal: requirePositiveInteger(value.ordinal, 'Task occurrence ordinal'),
    scheduledAt: requireIsoDateTime(value.scheduledAt, 'Task occurrence scheduledAt'),
    status: parseEnum(value.status, ['pending', 'completed', 'skipped', 'cancelled'], 'Task occurrence status'),
    override: parseOccurrenceOverride(value.override),
    completedAt: parseNullableIsoDateTime(value.completedAt, 'Task occurrence completedAt'),
    revision: requirePositiveInteger(value.revision, 'Task occurrence revision'),
  }
}

function parseOccurrenceOverride(raw: unknown): OccurrenceOverride | null {
  if (raw === null) return null
  const value = requireRecord(raw, 'Occurrence override')
  return {
    scheduledAt: parseNullableIsoDateTime(value.scheduledAt, 'Occurrence override scheduledAt'),
    estimateMinutes: parseNullablePositiveInteger(value.estimateMinutes, 'Occurrence override estimateMinutes'),
  }
}

function parseReminderRule(raw: unknown, index: number): ReminderRule {
  const value = requireRecord(raw, `Reminder rule ${index}`)
  if (typeof value.enabled !== 'boolean') throw new Error('Reminder rule enabled must be boolean.')
  return {
    id: requireText(value.id, 'Reminder rule id'),
    taskId: requireText(value.taskId, 'Reminder rule taskId'),
    occurrenceId: parseNullableText(value.occurrenceId, 'Reminder rule occurrenceId'),
    trigger: parseReminderTrigger(value.trigger),
    enabled: value.enabled,
    revision: requirePositiveInteger(value.revision, 'Reminder rule revision'),
  }
}

function parseReminderTrigger(raw: unknown): ReminderRule['trigger'] {
  const value = requireRecord(raw, 'Reminder trigger')
  if (value.kind === 'at_start') return { kind: 'at_start' }
  if (value.kind === 'before_start' || value.kind === 'before_due') {
    return { kind: value.kind, minutes: requirePositiveInteger(value.minutes, 'Reminder trigger minutes') }
  }
  if (value.kind === 'absolute') return { kind: 'absolute', at: requireIsoDateTime(value.at, 'Reminder trigger at') }
  throw new Error('Reminder trigger has invalid kind.')
}

function parseReminderDelivery(raw: unknown, index: number): ReminderDelivery {
  const value = requireRecord(raw, `Reminder delivery ${index}`)
  const action = value.action
  if (action !== null && action !== 'complete' && action !== 'open') throw new Error('Reminder delivery action is invalid.')
  return {
    id: requireText(value.id, 'Reminder delivery id'),
    reminderRuleId: requireText(value.reminderRuleId, 'Reminder delivery reminderRuleId'),
    occurrenceId: parseNullableText(value.occurrenceId, 'Reminder delivery occurrenceId'),
    scheduledFor: requireIsoDateTime(value.scheduledFor, 'Reminder delivery scheduledFor'),
    status: parseEnum(value.status, ['pending', 'delivered', 'snoozed', 'acted', 'dismissed', 'failed'], 'Reminder delivery status'),
    snoozedUntil: parseNullableIsoDateTime(value.snoozedUntil, 'Reminder delivery snoozedUntil'),
    action,
  }
}

function parseStudySession(raw: unknown, index: number): StudySession {
  const value = requireRecord(raw, `Study session ${index}`)
  const state = parseEnum(value.state, ['running', 'paused', 'finished'], 'Study session state')
  const activeSince = parseNullableIsoDateTime(value.activeSince, 'Study session activeSince')
  if ((state === 'running') !== (activeSince !== null)) throw new Error('Only a running Study session can have activeSince.')
  return {
    id: requireText(value.id, 'Study session id'), taskId: requireText(value.taskId, 'Study session taskId'), state,
    startedAt: requireIsoDateTime(value.startedAt, 'Study session startedAt'), activeSince,
    elapsedSeconds: requireNonNegativeInteger(value.elapsedSeconds, 'Study session elapsedSeconds'),
    scratchpad: requireText(value.scratchpad, 'Study session scratchpad', true),
    createdAt: requireIsoDateTime(value.createdAt, 'Study session createdAt'),
    updatedAt: requireIsoDateTime(value.updatedAt, 'Study session updatedAt'),
    deletedAt: parseNullableIsoDateTime(value.deletedAt, 'Study session deletedAt'),
  }
}

function parseTaskEvent(raw: unknown, index: number): TaskEvent {
  const value = requireRecord(raw, `Task event ${index}`)
  return {
    id: requireText(value.id, 'Task event id'), sequence: requirePositiveInteger(value.sequence, 'Task event sequence'),
    taskId: requireText(value.taskId, 'Task event taskId'), type: parseEnum(value.type, EVENT_TYPES, 'Task event type'),
    occurredAt: requireIsoDateTime(value.occurredAt, 'Task event occurredAt'),
    fromStatus: parseNullableTaskStatus(value.fromStatus), toStatus: parseNullableTaskStatus(value.toStatus),
    reason: parseNullableText(value.reason, 'Task event reason'),
    completionRecordId: parseNullableText(value.completionRecordId, 'Task event completionRecordId'),
  }
}

function parseCompletionRecord(raw: unknown, index: number): CompletionRecord {
  const value = requireRecord(raw, `Completion record ${index}`)
  return {
    id: requireText(value.id, 'Completion record id'), taskId: requireText(value.taskId, 'Completion record taskId'),
    topicId: parseNullableText(value.topicId, 'Completion record topicId'), sessionIds: parseTextArray(value.sessionIds, 'Completion record sessionIds'),
    taskTitleSnapshot: requireText(value.taskTitleSnapshot, 'Completion record taskTitleSnapshot'),
    learned: requireText(value.learned, 'Completion record learned'), evidence: requireText(value.evidence, 'Completion record evidence'),
    blocker: requireText(value.blocker, 'Completion record blocker', true), nextAction: requireText(value.nextAction, 'Completion record nextAction'),
    mastery: parseNullableRangeInteger(value.mastery, 1, 5, 'Completion record mastery') as CompletionRecord['mastery'],
    completedAt: requireIsoDateTime(value.completedAt, 'Completion record completedAt'),
    reviewStage: requireRangeInteger(value.reviewStage, 0, 3, 'Completion record reviewStage') as CompletionRecord['reviewStage'],
    nextReviewOn: parseNullableDateOnly(value.nextReviewOn, 'Completion record nextReviewOn'),
    lastReviewResult: parseNullableEnum(value.lastReviewResult, ['clear', 'fuzzy', 'relearn'], 'Completion record lastReviewResult'),
    lastReviewedAt: parseNullableIsoDateTime(value.lastReviewedAt, 'Completion record lastReviewedAt'),
    createdAt: requireIsoDateTime(value.createdAt, 'Completion record createdAt'), updatedAt: requireIsoDateTime(value.updatedAt, 'Completion record updatedAt'),
    deletedAt: parseNullableIsoDateTime(value.deletedAt, 'Completion record deletedAt'),
  }
}

function parseReviewTaskLink(raw: unknown, index: number): ReviewTaskLink {
  const value = requireRecord(raw, `Review task link ${index}`)
  return {
    id: requireText(value.id, 'Review task link id'), completionRecordId: requireText(value.completionRecordId, 'Review task link completionRecordId'),
    reviewTaskId: requireText(value.reviewTaskId, 'Review task link reviewTaskId'), occurrenceId: parseNullableText(value.occurrenceId, 'Review task link occurrenceId'),
    reviewStage: requireRangeInteger(value.reviewStage, 0, 3, 'Review task link reviewStage') as ReviewTaskLink['reviewStage'],
    dueOn: requireDateOnly(value.dueOn, 'Review task link dueOn'), completedAt: parseNullableIsoDateTime(value.completedAt, 'Review task link completedAt'),
    createdAt: requireIsoDateTime(value.createdAt, 'Review task link createdAt'), updatedAt: requireIsoDateTime(value.updatedAt, 'Review task link updatedAt'),
  }
}

function parseCommandReceipt(raw: unknown, index: number): CommandReceipt {
  const value = requireRecord(raw, `Command receipt ${index}`)
  return {
    id: requireText(value.id, 'Command receipt id'), idempotencyKey: requireText(value.idempotencyKey, 'Command receipt idempotencyKey'),
    commandType: requireText(value.commandType, 'Command receipt commandType'),
    source: parseEnum(value.source, ['human-ui', 'keyboard', 'notification', 'agent'], 'Command receipt source'),
    workspaceRevision: requirePositiveInteger(value.workspaceRevision, 'Command receipt workspaceRevision'),
    result: parseJsonRecord(value.result, 'Command receipt result'),
    createdAt: requireIsoDateTime(value.createdAt, 'Command receipt createdAt'), expiresAt: requireIsoDateTime(value.expiresAt, 'Command receipt expiresAt'),
  }
}

function assertCollectionSizes(state: WorkspaceStateV3): void {
  for (const collection of Object.values(state)) {
    if (Array.isArray(collection) && collection.length > MAX_ITEMS) throw new Error('Workspace state contains too many records.')
  }
}

function assertUniqueIds(state: WorkspaceStateV3): void {
  assertUnique(state.listGroups, 'list group'); assertUnique(state.lists, 'list'); assertUnique(state.sections, 'section'); assertUnique(state.tags, 'tag'); assertUnique(state.tasks, 'task')
  assertUnique(state.recurrenceSeries, 'recurrence series'); assertUnique(state.occurrences, 'occurrence'); assertUnique(state.reminderRules, 'reminder rule'); assertUnique(state.reminderDeliveries, 'reminder delivery')
  assertUnique(state.studySessions, 'study session'); assertUnique(state.taskEvents, 'task event'); assertUnique(state.completionRecords, 'completion record'); assertUnique(state.reviewTaskLinks, 'review task link'); assertUnique(state.commandReceipts, 'command receipt')
  assertUniqueAcrossEntities([
    state.listGroups, state.lists, state.sections, state.tags, state.tasks,
    state.recurrenceSeries, state.occurrences, state.reminderRules, state.reminderDeliveries,
    state.studySessions, state.taskEvents, state.completionRecords, state.reviewTaskLinks,
    state.commandReceipts,
  ])
  assertUnique(state.taskEvents.map((event) => ({ id: String(event.sequence) })), 'task event sequence')
  assertUnique(state.commandReceipts.map((receipt) => ({ id: receipt.idempotencyKey })), 'command receipt idempotencyKey')
}

function assertReferences(state: WorkspaceStateV3): void {
  const groups = ids(state.listGroups); const lists = ids(state.lists); const sections = new Map(state.sections.map((section) => [section.id, section])); const tags = ids(state.tags)
  const tasks = new Map(state.tasks.map((task) => [task.id, task])); const series = new Map(state.recurrenceSeries.map((entry) => [entry.id, entry])); const occurrences = new Map(state.occurrences.map((entry) => [entry.id, entry]))
  const sessions = new Map(state.studySessions.map((session) => [session.id, session])); const records = new Map(state.completionRecords.map((record) => [record.id, record])); const rules = new Map(state.reminderRules.map((rule) => [rule.id, rule]))
  for (const list of state.lists) if (list.groupId && !groups.has(list.groupId)) throw new Error(`Task list ${list.id} has unknown groupId.`)
  for (const section of state.sections) if (!lists.has(section.listId)) throw new Error(`List section ${section.id} has unknown listId.`)
  for (const task of state.tasks) {
    if (!lists.has(task.listId)) throw new Error(`Task ${task.id} has unknown listId.`)
    if (task.sectionId) { const section = sections.get(task.sectionId); if (!section) throw new Error(`Task ${task.id} has unknown sectionId.`); if (section.listId !== task.listId) throw new Error(`Task ${task.id} section belongs to another list.`) }
    if (new Set(task.tagIds).size !== task.tagIds.length) throw new Error(`Task ${task.id} has duplicate tagIds.`)
    for (const tagId of task.tagIds) if (!tags.has(tagId)) throw new Error(`Task ${task.id} has unknown tagId.`)
  }
  for (const entry of state.recurrenceSeries) {
    const task = tasks.get(entry.taskId); if (!task) throw new Error(`Recurrence series ${entry.id} has unknown taskId.`)
    if (task.recurrenceSeriesId !== entry.id) throw new Error(`Recurrence series ${entry.id} is not linked by its task.`)
  }
  for (const task of state.tasks) if (task.recurrenceSeriesId) { const entry = series.get(task.recurrenceSeriesId); if (!entry) throw new Error(`Task ${task.id} has unknown recurrenceSeriesId.`); if (entry.taskId !== task.id) throw new Error(`Task ${task.id} recurrence series belongs to another task.`) }
  for (const occurrence of state.occurrences) if (!series.has(occurrence.seriesId)) throw new Error(`Task occurrence ${occurrence.id} has unknown seriesId.`)
  for (const rule of state.reminderRules) {
    if (!tasks.has(rule.taskId)) throw new Error(`Reminder rule ${rule.id} has unknown taskId.`)
    if (rule.occurrenceId) assertOccurrenceTask(occurrences.get(rule.occurrenceId), series, rule.taskId, `Reminder rule ${rule.id}`)
  }
  const deliveryKeys = new Set<string>()
  for (const delivery of state.reminderDeliveries) {
    const rule = rules.get(delivery.reminderRuleId); if (!rule) throw new Error(`Reminder delivery ${delivery.id} has unknown reminderRuleId.`)
    if (rule.occurrenceId && delivery.occurrenceId !== rule.occurrenceId) {
      throw new Error(`Reminder delivery ${delivery.id} does not match reminder rule occurrence.`)
    }
    if (delivery.occurrenceId) assertOccurrenceTask(occurrences.get(delivery.occurrenceId), series, rule.taskId, `Reminder delivery ${delivery.id}`)
    const key = `${delivery.reminderRuleId}\u0000${delivery.occurrenceId ?? ''}\u0000${delivery.scheduledFor}`
    if (deliveryKeys.has(key)) throw new Error('Workspace state contains a duplicate reminder delivery.')
    deliveryKeys.add(key)
  }
  for (const session of state.studySessions) if (!tasks.has(session.taskId)) throw new Error(`Study session ${session.id} has unknown taskId.`)
  for (const record of state.completionRecords) {
    if (!tasks.has(record.taskId)) throw new Error(`Completion record ${record.id} has unknown taskId.`)
    for (const sessionId of record.sessionIds) { const session = sessions.get(sessionId); if (!session) throw new Error(`Completion record ${record.id} has unknown sessionId.`); if (session.taskId !== record.taskId) throw new Error(`Completion record ${record.id} session belongs to another task.`) }
  }
  assertEvents(state.taskEvents, tasks, records)
  assertStudyEventInvariants(state.taskEvents, state.tasks)
  const activeSessions = state.studySessions.filter(
    (session) => !session.deletedAt && (session.state === 'running' || session.state === 'paused'),
  )
  if (activeSessions.length > 1) throw new Error('Workspace state allows only one active Study session.')
  if (activeSessions.some((session) => tasks.get(session.taskId)?.status !== 'in_progress')) {
    throw new Error('An active Study session requires an in-progress task.')
  }
  for (const link of state.reviewTaskLinks) {
    const record = records.get(link.completionRecordId)
    if (!record) throw new Error(`Review task link ${link.id} has unknown completionRecordId.`)
    if (!tasks.has(link.reviewTaskId)) throw new Error(`Review task link ${link.id} has unknown reviewTaskId.`)
    if (link.occurrenceId) assertOccurrenceTask(occurrences.get(link.occurrenceId), series, link.reviewTaskId, `Review task link ${link.id}`)
  }
}

function assertEvents(events: readonly TaskEvent[], tasks: ReadonlyMap<string, Task>, records: ReadonlyMap<string, CompletionRecord>): void {
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) throw new Error('Task events must use a continuous sequence in ascending order.')
    if (!tasks.has(event.taskId)) throw new Error(`Task event ${event.id} has unknown taskId.`)
    if (event.completionRecordId) { const record = records.get(event.completionRecordId); if (!record) throw new Error(`Task event ${event.id} has unknown completionRecordId.`); if (record.taskId !== event.taskId) throw new Error(`Task event ${event.id} completion belongs to another task.`) }
  }
}

function assertStudyEventInvariants(events: readonly TaskEvent[], tasks: readonly Task[]): void {
  for (const task of tasks) {
    const taskEvents = events.filter((event) => event.taskId === task.id)
    if (taskEvents.length === 0 || taskEvents[0].fromStatus !== null) {
      throw new Error(`Task ${task.id} event chain must start from null.`)
    }
    let status: Task['status'] | null = null
    for (const event of taskEvents) {
      if (event.fromStatus !== status) throw new Error(`Task ${task.id} event chain has a mismatched fromStatus.`)
      if (event.toStatus === null) throw new Error(`Task ${task.id} event chain requires a toStatus.`)
      status = event.toStatus
    }
    if (status !== task.status) throw new Error(`Task ${task.id} final event status does not match task status.`)
  }
}

function assertOccurrenceTask(occurrence: TaskOccurrence | undefined, series: ReadonlyMap<string, RecurrenceSeries>, taskId: string, label: string): void {
  if (!occurrence) throw new Error(`${label} has unknown occurrenceId.`)
  if (series.get(occurrence.seriesId)?.taskId !== taskId) throw new Error(`${label} occurrence belongs to another task.`)
}

function parseArray<T>(value: unknown, label: string, parser: (value: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return value.map(parser)
}

function parseTextArray(value: unknown, label: string): string[] { return parseArray(value, label, (entry, index) => requireText(entry, `${label} ${index}`)) }
function parseNullableTaskStatus(value: unknown): Task['status'] | null { return value === null ? null : parseEnum(value, TASK_STATUSES, 'Task event status') }
function parseNullableDateOnly(value: unknown, label: string): string | null { return value === null ? null : requireDateOnly(value, label) }
function parseNullableIsoDateTime(value: unknown, label: string): string | null { return value === null ? null : requireIsoDateTime(value, label) }
function parseNullableText(value: unknown, label: string): string | null { return value === null ? null : requireText(value, label) }
function parseNullablePositiveInteger(value: unknown, label: string): number | null { return value === null ? null : requirePositiveInteger(value, label) }
function parseNullableRangeInteger(value: unknown, min: number, max: number, label: string): number | null { return value === null ? null : requireRangeInteger(value, min, max, label) }
function parseNullableEnum<T extends string>(value: unknown, values: readonly T[], label: string): T | null { return value === null ? null : parseEnum(value, values, label) }
function parseEnum<T extends string>(value: unknown, values: readonly T[], label: string): T { if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${label} is invalid.`); return value as T }

function requireRecord(value: unknown, label: string): Record<string, unknown> { if (!isRecord(value)) throw new Error(`${label} must be an object.`); return value }
function requireText(value: unknown, label: string, allowEmpty = false): string { if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > MAX_TEXT_LENGTH) throw new Error(`${label} must be a valid string.`); return value }
function requireDateOnly(value: unknown, label: string): string { const date = requireText(value, label); if (!isDateOnly(date)) throw new Error(`${label} must use YYYY-MM-DD.`); return date }
function requireIsoDateTime(value: unknown, label: string): string { const timestamp = requireText(value, label); if (!ISO_DATETIME.test(timestamp) || !isDateOnly(timestamp.slice(0, 10)) || !Number.isFinite(Date.parse(timestamp))) throw new Error(`${label} must use an ISO datetime with timezone.`); return timestamp }
function requirePositiveInteger(value: unknown, label: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`); return value }
function requireNonNegativeInteger(value: unknown, label: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`); return value }
function requireRangeInteger(value: unknown, min: number, max: number, label: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`); return value }
function parseJsonRecord(value: unknown, label: string): { [key: string]: JsonValue } { const record = requireRecord(value, label); return parseJsonValue(record, label) as { [key: string]: JsonValue } }
function parseJsonValue(value: unknown, label: string): JsonValue { if (value === null || typeof value === 'string' || typeof value === 'boolean') return value; if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error(`${label} must be JSON-safe.`); return value }; if (Array.isArray(value)) return value.map((entry, index) => parseJsonValue(entry, `${label} ${index}`)); if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, parseJsonValue(entry, `${label}.${key}`)])); throw new Error(`${label} must be JSON-safe.`) }
function assertUnique(values: readonly { id: string }[], label: string): void { const seen = new Set<string>(); for (const value of values) { if (seen.has(value.id)) throw new Error(`Workspace state contains a duplicate ${label} id.`); seen.add(value.id) } }
function assertUniqueAcrossEntities(collections: readonly (readonly { id: string }[])[]): void { const seen = new Set<string>(); for (const collection of collections) for (const entity of collection) { if (seen.has(entity.id)) throw new Error('Workspace state contains a duplicate entity id.'); seen.add(entity.id) } }
function ids(values: readonly { id: string }[]): Set<string> { return new Set(values.map((value) => value.id)) }
function isDateOnly(value: string): boolean { if (!DATE_ONLY.test(value)) return false; const [year, month, day] = value.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
