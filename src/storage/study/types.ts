export const STUDY_STATE_VERSION = 2 as const
export const LEGACY_STUDY_STATE_VERSION = 1 as const

export type StudyTaskStatus =
  | 'inbox'
  | 'planned'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'cancelled'
export type StudyTaskPriority = 'none' | 'low' | 'medium' | 'high'
export type StudySessionState = 'running' | 'paused' | 'finished'
export type ReviewResult = 'clear' | 'fuzzy' | 'relearn'
export type ReviewStage = 0 | 1 | 2 | 3
export type TaskEventType =
  | 'captured'
  | 'migrated'
  | 'planned'
  | 'started'
  | 'paused'
  | 'resumed'
  | 'blocked'
  | 'completed'
  | 'reopened'
  | 'cancelled'
  | 'rescheduled'
  | 'deleted'

export interface StudyTopic {
  id: string
  groupId?: string | null
  title: string
  goal: string
  successCriteria: string[]
  weeklyTargetMinutes: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface StudyListGroup {
  id: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface TaskChecklistItem {
  id: string
  text: string
  checked: boolean
  checkedAt: string | null
  position: number
}

export interface StudyTask {
  id: string
  revision: number
  topicId: string | null
  title: string
  notes: string
  status: StudyTaskStatus
  plannedOn: string | null
  dueOn: string | null
  reminderAt: string | null
  priority: StudyTaskPriority
  estimateMinutes: number | null
  acceptanceCriteria: string[]
  checklist: TaskChecklistItem[]
  blockedReason: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface StudySession {
  id: string
  taskId: string
  state: StudySessionState
  startedAt: string
  activeSince: string | null
  elapsedSeconds: number
  scratchpad: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface TaskEvent {
  id: string
  sequence: number
  taskId: string
  occurrenceId?: string | null
  type: TaskEventType
  occurredAt: string
  fromStatus: StudyTaskStatus | null
  toStatus: StudyTaskStatus | null
  reason: string | null
  completionRecordId: string | null
}

export interface CompletionRecord {
  id: string
  taskId: string
  topicId: string | null
  sessionIds: string[]
  taskTitleSnapshot: string
  learned: string
  evidence: string
  blocker: string
  nextAction: string
  mastery: 1 | 2 | 3 | 4 | 5 | null
  completedAt: string
  reviewStage: ReviewStage
  nextReviewOn: string | null
  lastReviewResult: ReviewResult | null
  lastReviewedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface StudyState {
  version: typeof STUDY_STATE_VERSION
  listGroups?: StudyListGroup[]
  topics: StudyTopic[]
  tasks: StudyTask[]
  sessions: StudySession[]
  taskEvents: TaskEvent[]
  completionRecords: CompletionRecord[]
  updatedAt: string
}

export interface StudyStore {
  load(): Promise<StudyState>
  save(state: StudyState, expectedUpdatedAt?: string): Promise<void>
}

export interface LegacyStudyStep {
  id: string
  title: string
  acceptanceCriteria: string[]
  estimateMinutes: number
  scheduledOn: string | null
}

export interface LegacyStudyTopic extends StudyTopic {
  steps: LegacyStudyStep[]
}

export interface LegacyStudySession {
  id: string
  topicId: string
  stepId: string | null
  state: 'running' | 'paused' | 'completed'
  startedAt: string
  activeSince: string | null
  elapsedSeconds: number
  scratchpad: string
  learned: string
  evidence: string
  blocker: string
  nextAction: string
  mastery: 1 | 2 | 3 | 4 | 5 | null
  completedAt: string | null
  reviewStage: ReviewStage
  nextReviewOn: string | null
  lastReviewResult: ReviewResult | null
  lastReviewedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface StudyStateV1 {
  version: typeof LEGACY_STUDY_STATE_VERSION
  topics: LegacyStudyTopic[]
  sessions: LegacyStudySession[]
  updatedAt: string
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const REVIEW_OFFSETS: readonly number[] = [1, 3, 7]
const TASK_STATUSES: readonly StudyTaskStatus[] = [
  'inbox',
  'planned',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
]
const TASK_PRIORITIES: readonly StudyTaskPriority[] = [
  'none',
  'low',
  'medium',
  'high',
]
const EVENT_TYPES: readonly TaskEventType[] = [
  'captured',
  'migrated',
  'planned',
  'started',
  'paused',
  'resumed',
  'blocked',
  'completed',
  'reopened',
  'cancelled',
  'rescheduled',
  'deleted',
]
const MAX_ITEMS = 100_000
const MAX_TEXT_LENGTH = 100_000

export function addCalendarDays(date: string, days: number): string {
  if (!isDateOnly(date)) throw new Error('Study date must use a valid YYYY-MM-DD value.')
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function nextReviewDate(completedOn: string, stage: ReviewStage): string | null {
  const offset = REVIEW_OFFSETS[stage]
  return offset === undefined ? null : addCalendarDays(completedOn, offset)
}

export function applyReviewResult(
  record: CompletionRecord,
  result: ReviewResult,
  reviewedOn: string,
  reviewedAt: string,
): CompletionRecord {
  if (!isDateOnly(reviewedOn)) throw new Error('Study review date must use YYYY-MM-DD.')
  requireText(reviewedAt, 'Study review reviewedAt')
  const stage =
    result === 'clear'
      ? (Math.min(record.reviewStage + 1, 3) as ReviewStage)
      : record.reviewStage
  return {
    ...structuredClone(record),
    reviewStage: stage,
    nextReviewOn:
      result === 'clear'
        ? nextReviewDate(reviewedOn, stage)
        : result === 'fuzzy'
          ? addCalendarDays(reviewedOn, 1)
          : null,
    lastReviewResult: result,
    lastReviewedAt: reviewedAt,
    updatedAt: reviewedAt,
  }
}

export function parseStudyStateOrMigrate(
  value: unknown,
  migratedAt = new Date().toISOString(),
): StudyState {
  if (isRecord(value) && value.version === 1) {
    return migrateStudyStateV1ToV2(value, migratedAt)
  }
  return parseStudyState(value)
}

export function migrateStudyStateV1ToV2(value: unknown, migratedAt: string): StudyState {
  const legacy = parseStudyStateV1(value)
  requireText(migratedAt, 'Study migration timestamp')
  const stepCounts = new Map<string, number>()
  for (const topic of legacy.topics) {
    for (const step of topic.steps) {
      stepCounts.set(step.id, (stepCounts.get(step.id) ?? 0) + 1)
    }
  }

  const taskIds = new Map<string, string>()
  const tasks: StudyTask[] = []
  for (const topic of legacy.topics) {
    for (const step of topic.steps) {
      const id =
        stepCounts.get(step.id) === 1
          ? step.id
          : `migrated-task:${topic.id}:${step.id}`
      taskIds.set(stepKey(topic.id, step.id), id)
      const linked = legacy.sessions.filter(
        (session) =>
          session.topicId === topic.id &&
          session.stepId === step.id &&
          !session.deletedAt,
      )
      const status: StudyTaskStatus = linked.some(
        ({ state }) => state === 'running' || state === 'paused',
      )
        ? 'in_progress'
        : linked.some(({ state }) => state === 'completed')
          ? 'completed'
          : 'planned'
      tasks.push({
        id,
        revision: 1,
        topicId: topic.id,
        title: step.title,
        notes: '',
        status,
        plannedOn: step.scheduledOn,
        dueOn: null,
        reminderAt: null,
        priority: 'none',
        estimateMinutes: step.estimateMinutes,
        acceptanceCriteria: [...step.acceptanceCriteria],
        checklist: [],
        blockedReason: null,
        createdAt: topic.createdAt,
        updatedAt: migratedAt,
        deletedAt: null,
      })
    }
  }

  for (const session of legacy.sessions) {
    if (session.stepId !== null) continue
    const id = `migrated-task:session:${session.id}`
    taskIds.set(stepKey(session.topicId, session.id), id)
    tasks.push({
      id,
      revision: 1,
      topicId: session.topicId,
      title: `学习记录 · ${session.startedAt.slice(0, 10)}`,
      notes: '',
      status: session.state === 'completed' ? 'completed' : 'in_progress',
      plannedOn: session.startedAt.slice(0, 10),
      dueOn: null,
      reminderAt: null,
      priority: 'none',
      estimateMinutes: Math.max(1, Math.round(session.elapsedSeconds / 60)),
      acceptanceCriteria: [],
      checklist: [],
      blockedReason: null,
      createdAt: session.createdAt,
      updatedAt: migratedAt,
      deletedAt: session.deletedAt,
    })
  }

  const taskIdFor = (session: LegacyStudySession): string => {
    const localId = session.stepId ?? session.id
    const taskId = taskIds.get(stepKey(session.topicId, localId))
    if (!taskId) throw new Error(`Legacy session ${session.id} cannot be mapped to a task.`)
    return taskId
  }
  const sessions: StudySession[] = legacy.sessions.map((session) => ({
    id: session.id,
    taskId: taskIdFor(session),
    state: session.state === 'completed' ? 'finished' : session.state,
    startedAt: session.startedAt,
    activeSince: session.activeSince,
    elapsedSeconds: session.elapsedSeconds,
    scratchpad: session.scratchpad,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    deletedAt: session.deletedAt,
  }))
  const completionRecords: CompletionRecord[] = legacy.sessions
    .filter(
      (session): session is LegacyStudySession & { completedAt: string } =>
        session.state === 'completed' && session.completedAt !== null,
    )
    .map((session) => {
      const task = tasks.find(({ id }) => id === taskIdFor(session))
      if (!task) throw new Error(`Legacy session ${session.id} has no migrated task.`)
      return {
        id: `completion:${session.id}`,
        taskId: task.id,
        topicId: task.topicId,
        sessionIds: [session.id],
        taskTitleSnapshot: task.title,
        learned: session.learned || session.scratchpad || '迁移的学习记录',
        evidence: session.evidence || '原记录未填写成果证据',
        blocker: session.blocker,
        nextAction: session.nextAction || '确定下一步学习行动',
        mastery: session.mastery,
        completedAt: session.completedAt,
        reviewStage: session.reviewStage,
        nextReviewOn: session.nextReviewOn,
        lastReviewResult: session.lastReviewResult,
        lastReviewedAt: session.lastReviewedAt,
        createdAt: session.completedAt,
        updatedAt: session.updatedAt,
        deletedAt: session.deletedAt,
      }
    })

  let sequence = 0
  const eventStatus = new Map<string, StudyTaskStatus>()
  const taskEvents: TaskEvent[] = tasks.map((task) => {
    const toStatus = task.status === 'completed' ? 'planned' : task.status
    eventStatus.set(task.id, toStatus)
    return {
      id: `event:migrated:${task.id}`,
      sequence: ++sequence,
      taskId: task.id,
      type: 'migrated',
      occurredAt: migratedAt,
      fromStatus: null,
      toStatus,
      reason: 'Migrated from StudyState v1.',
      completionRecordId: null,
    }
  })
  for (const record of completionRecords) {
    const task = tasks.find(({ id }) => id === record.taskId)
    if (!task) throw new Error(`Completion ${record.id} has no migrated task.`)
    const fromStatus = eventStatus.get(task.id) ?? task.status
    const toStatus = task.status === 'completed' ? 'completed' : fromStatus
    taskEvents.push({
      id: `event:completed:${record.id}`,
      sequence: ++sequence,
      taskId: record.taskId,
      type: 'completed',
      occurredAt: migratedAt,
      fromStatus,
      toStatus,
      reason: null,
      completionRecordId: record.id,
    })
    eventStatus.set(task.id, toStatus)
  }

  return parseStudyState({
    version: 2,
    topics: legacy.topics.map(({ steps: _steps, ...topic }) => topic),
    tasks,
    sessions,
    taskEvents,
    completionRecords,
    updatedAt: migratedAt,
  })
}

export function createSeedStudyState(now = new Date().toISOString()): StudyState {
  const today = now.slice(0, 10)
  const yesterday = addCalendarDays(today, -1)
  const titles = [
    '跑通最小 Agent 调用循环',
    '跑通一个带持久化状态的最小工作流',
    '验证中断后的状态恢复',
    '把人工审批节点接进退款流程',
    '补一个审批拒绝路径的端到端测试',
    '允许审批人修改退款参数后继续',
    '补齐工具失败后的恢复路径',
    '录制完整演示并复盘边界',
  ]
  const langGraph: LegacyStudyTopic = {
    id: 'topic-langgraph',
    title: 'LangGraph：可恢复的 Agent 工作流',
    goal: '独立做出包含中断、人工审批和恢复能力的客服 Agent Demo',
    successCriteria: ['程序重启后能够恢复', '审批通过与拒绝路径都有测试'],
    weeklyTargetMinutes: 240,
    steps: titles.map((title, index) => ({
      id: `step-langgraph-${index + 1}`,
      title,
      acceptanceCriteria: ['形成可验证的运行结果'],
      estimateMinutes: index === 3 ? 45 : 40,
      scheduledOn: index === 3 ? today : index < 3 ? yesterday : null,
    })),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }
  const english: LegacyStudyTopic = {
    id: 'topic-english',
    title: '英语：听懂 AI 技术分享',
    goal: '能复述一段 10 分钟的 AI 英文技术分享',
    successCriteria: ['复述三个关键观点'],
    weeklyTargetMinutes: 120,
    steps: [{
      id: 'step-english-1',
      title: '精听并跟读一段 3 分钟技术视频',
      acceptanceCriteria: ['完成三轮精听并录一次跟读'],
      estimateMinutes: 25,
      scheduledOn: null,
    }],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }
  const sessions: LegacyStudySession[] = langGraph.steps.slice(0, 3).map(
    (step, index) => ({
      id: `session-langgraph-${index + 1}`,
      topicId: langGraph.id,
      stepId: step.id,
      state: 'completed',
      startedAt: `${yesterday}T10:00:00.000Z`,
      activeSince: null,
      elapsedSeconds: 2400 + index * 300,
      scratchpad: '记录一次可复现的学习过程。',
      learned:
        index === 2
          ? '恢复运行时必须复用 thread_id。'
          : '把模型判断与确定性执行状态分开。',
      evidence: `示例与测试 ${index + 1} 已通过`,
      blocker: index === 2 ? 'checkpoint_id 与 thread_id 的边界仍需澄清' : '',
      nextAction: langGraph.steps[index + 1].title,
      mastery: index === 2 ? 3 : 4,
      completedAt: `${yesterday}T10:45:00.000Z`,
      reviewStage: 0,
      nextReviewOn: today,
      lastReviewResult: null,
      lastReviewedAt: null,
      createdAt: `${yesterday}T10:00:00.000Z`,
      updatedAt: `${yesterday}T10:45:00.000Z`,
      deletedAt: null,
    }),
  )
  return migrateStudyStateV1ToV2(
    { version: 1, topics: [langGraph, english], sessions, updatedAt: now },
    now,
  )
}

export function parseStudyState(value: unknown): StudyState {
  const object = requireRecord(value, 'Study state')
  if (object.version !== 2) throw new Error('Study state must use version 2.')
  const topics = requireArray(object.topics, 'Study state topics').map(parseTopic)
  const listGroups = object.listGroups === undefined
    ? []
    : requireArray(object.listGroups, 'Study state listGroups').map(parseListGroup)
  const tasks = requireArray(object.tasks, 'Study state tasks').map(parseTask)
  const sessions = requireArray(object.sessions, 'Study state sessions').map(parseSession)
  const taskEvents = requireArray(object.taskEvents, 'Study state taskEvents').map(parseEvent)
  const completionRecords = requireArray(
    object.completionRecords,
    'Study state completionRecords',
  ).map(parseCompletionRecord)
  for (const items of [listGroups, topics, tasks, sessions, taskEvents, completionRecords]) {
    if (items.length > MAX_ITEMS) throw new Error('Study state contains too many records.')
  }
  assertUnique(listGroups, 'list group')
  assertUnique(topics, 'topic')
  assertUnique(tasks, 'task')
  assertUnique(sessions, 'session')
  assertUnique(taskEvents, 'task event')
  assertUnique(completionRecords, 'completion record')
  assertUnique(
    taskEvents.map(({ sequence }) => ({ id: String(sequence) })),
    'task event sequence',
  )
  for (const [index, event] of taskEvents.entries()) {
    if (event.sequence !== index + 1) {
      throw new Error('Study task events must use a continuous sequence in ascending order.')
    }
  }

  const topicIds = new Set(topics.map(({ id }) => id))
  const listGroupIds = new Set(listGroups.filter(({ archivedAt }) => !archivedAt).map(({ id }) => id))
  for (const topic of topics) {
    if (topic.groupId && !listGroupIds.has(topic.groupId)) {
      throw new Error(`Topic ${topic.id} has unknown or archived groupId.`)
    }
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const recordById = new Map(completionRecords.map((record) => [record.id, record]))
  for (const task of tasks) {
    if (task.topicId && !topicIds.has(task.topicId)) {
      throw new Error(`Task ${task.id} has unknown topicId.`)
    }
  }
  for (const session of sessions) {
    if (!taskById.has(session.taskId)) {
      throw new Error(`Session ${session.id} has unknown taskId.`)
    }
  }
  for (const record of completionRecords) {
    if (!taskById.has(record.taskId)) {
      throw new Error(`Completion ${record.id} has unknown taskId.`)
    }
    if (record.topicId && !topicIds.has(record.topicId)) {
      throw new Error(`Completion ${record.id} has unknown topicId.`)
    }
    for (const sessionId of record.sessionIds) {
      const session = sessionById.get(sessionId)
      if (!session) throw new Error(`Completion ${record.id} has unknown sessionId.`)
      if (session.taskId !== record.taskId) {
        throw new Error(`Completion ${record.id} session belongs to another task.`)
      }
    }
  }
  for (const event of taskEvents) {
    if (!taskById.has(event.taskId)) {
      throw new Error(`Task event ${event.id} has unknown taskId.`)
    }
    if (event.completionRecordId) {
      const record = recordById.get(event.completionRecordId)
      if (!record) throw new Error(`Task event ${event.id} has unknown completionRecordId.`)
      if (record.taskId !== event.taskId) {
        throw new Error(`Task event ${event.id} completion belongs to another task.`)
      }
    }
  }
  for (const task of tasks) {
    const events = taskEvents.filter(({ taskId }) => taskId === task.id)
    if (events.length === 0 || events[0].fromStatus !== null) {
      throw new Error(`Task ${task.id} event chain must start from null.`)
    }
    let status: StudyTaskStatus | null = null
    for (const event of events) {
      if (event.fromStatus !== status) {
        throw new Error(`Task ${task.id} event chain has a mismatched fromStatus.`)
      }
      if (event.toStatus === null) {
        throw new Error(`Task ${task.id} event chain requires a toStatus.`)
      }
      status = event.toStatus
    }
    if (status !== task.status) {
      throw new Error(`Task ${task.id} final event status does not match task status.`)
    }
  }
  const active = sessions.filter(
    ({ state, deletedAt }) =>
      !deletedAt && (state === 'running' || state === 'paused'),
  )
  if (active.length > 1) {
    throw new Error('Study state allows only one active study session.')
  }
  if (
    active.some(
      (session) => taskById.get(session.taskId)?.status !== 'in_progress',
    )
  ) {
    throw new Error('An active Study session requires an in-progress task.')
  }
  return {
    version: 2,
    listGroups,
    topics,
    tasks,
    sessions,
    taskEvents,
    completionRecords,
    updatedAt: requireText(object.updatedAt, 'Study state updatedAt'),
  }
}

export function parseStudyStateV1(value: unknown): StudyStateV1 {
  const object = requireRecord(value, 'Study state v1')
  if (object.version !== 1) throw new Error('Legacy Study state must use version 1.')
  const topics = requireArray(object.topics, 'Legacy topics').map(
    (raw, index): LegacyStudyTopic => {
      const topic = parseTopic(raw, index)
      const record = requireRecord(raw, `Legacy topic ${index}`)
      const steps = requireArray(record.steps, `Legacy topic ${index} steps`).map(
        (stepRaw, stepIndex): LegacyStudyStep => {
          const step = requireRecord(stepRaw, `Legacy step ${stepIndex}`)
          return {
            id: requireText(step.id, `Legacy step ${stepIndex} id`),
            title: requireText(step.title, `Legacy step ${stepIndex} title`),
            acceptanceCriteria: parseTextArray(
              step.acceptanceCriteria,
              'Legacy acceptanceCriteria',
            ),
            estimateMinutes: requirePositiveInteger(
              step.estimateMinutes,
              'Legacy estimateMinutes',
            ),
            scheduledOn: parseDateOnly(step.scheduledOn, 'Legacy scheduledOn'),
          }
        },
      )
      assertUnique(steps, `step in topic ${topic.id}`)
      return { ...topic, steps }
    },
  )
  const sessions = requireArray(object.sessions, 'Legacy sessions').map(
    (raw, index): LegacyStudySession => {
      const session = requireRecord(raw, `Legacy session ${index}`)
      const state = session.state
      if (state !== 'running' && state !== 'paused' && state !== 'completed') {
        throw new Error(`Legacy session ${index} has invalid state.`)
      }
      return {
        id: requireText(session.id, 'Legacy session id'),
        topicId: requireText(session.topicId, 'Legacy session topicId'),
        stepId: parseNullableText(session.stepId, 'Legacy session stepId'),
        state,
        startedAt: requireText(session.startedAt, 'Legacy session startedAt'),
        activeSince: parseNullableText(
          session.activeSince,
          'Legacy session activeSince',
        ),
        elapsedSeconds: requireNonNegativeInteger(
          session.elapsedSeconds,
          'Legacy elapsedSeconds',
        ),
        scratchpad: requireText(
          session.scratchpad,
          'Legacy scratchpad',
          true,
        ),
        learned: requireText(session.learned, 'Legacy learned', true),
        evidence: requireText(session.evidence, 'Legacy evidence', true),
        blocker: requireText(session.blocker, 'Legacy blocker', true),
        nextAction: requireText(session.nextAction, 'Legacy nextAction', true),
        mastery: parseMastery(session.mastery),
        completedAt: parseNullableText(
          session.completedAt,
          'Legacy completedAt',
        ),
        reviewStage: parseReviewStage(session.reviewStage),
        nextReviewOn: parseDateOnly(
          session.nextReviewOn,
          'Legacy nextReviewOn',
        ),
        lastReviewResult: parseReviewResult(session.lastReviewResult),
        lastReviewedAt: parseNullableText(
          session.lastReviewedAt,
          'Legacy lastReviewedAt',
        ),
        createdAt: requireText(session.createdAt, 'Legacy createdAt'),
        updatedAt: requireText(session.updatedAt, 'Legacy updatedAt'),
        deletedAt: parseNullableText(session.deletedAt, 'Legacy deletedAt'),
      }
    },
  )
  assertUnique(topics, 'legacy topic')
  assertUnique(sessions, 'legacy session')
  const topicById = new Map(topics.map((topic) => [topic.id, topic]))
  for (const session of sessions) {
    const topic = topicById.get(session.topicId)
    if (!topic) {
      throw new Error(`Legacy session ${session.id} has unknown topicId.`)
    }
    if (
      session.stepId &&
      !topic.steps.some(({ id }) => id === session.stepId)
    ) {
      throw new Error(`Legacy session ${session.id} has unknown stepId.`)
    }
  }
  return {
    version: 1,
    topics,
    sessions,
    updatedAt: requireText(object.updatedAt, 'Legacy updatedAt'),
  }
}

function parseTopic(raw: unknown, index: number): StudyTopic {
  const value = requireRecord(raw, `Study topic ${index}`)
  return {
    id: requireText(value.id, 'Study topic id'),
    groupId: value.groupId === undefined ? null : parseNullableText(value.groupId, 'Study topic groupId'),
    title: requireText(value.title, 'Study topic title'),
    goal: requireText(value.goal, 'Study topic goal'),
    successCriteria: parseTextArray(
      value.successCriteria,
      'Study topic successCriteria',
    ),
    weeklyTargetMinutes: requirePositiveInteger(
      value.weeklyTargetMinutes,
      'Study topic weeklyTargetMinutes',
    ),
    createdAt: requireText(value.createdAt, 'Study topic createdAt'),
    updatedAt: requireText(value.updatedAt, 'Study topic updatedAt'),
    archivedAt: parseNullableText(value.archivedAt, 'Study topic archivedAt'),
  }
}

function parseListGroup(raw: unknown, index: number): StudyListGroup {
  const value = requireRecord(raw, `Study list group ${index}`)
  return {
    id: requireText(value.id, 'Study list group id'),
    title: requireText(value.title, 'Study list group title'),
    position: requireNonNegativeInteger(value.position, 'Study list group position'),
    createdAt: requireText(value.createdAt, 'Study list group createdAt'),
    updatedAt: requireText(value.updatedAt, 'Study list group updatedAt'),
    archivedAt: parseNullableText(value.archivedAt, 'Study list group archivedAt'),
  }
}

function parseTask(raw: unknown, index: number): StudyTask {
  const value = requireRecord(raw, `Study task ${index}`)
  const status = parseTaskStatus(value.status)
  const plannedOn = parseDateOnly(value.plannedOn, 'Study task plannedOn')
  const dueOn = parseDateOnly(value.dueOn, 'Study task dueOn')
  const reminderAt = value.reminderAt === undefined
    ? null
    : parseNullableIsoDateTime(value.reminderAt, 'Study task reminderAt')
  if (plannedOn && dueOn && dueOn < plannedOn) {
    throw new Error('Study task dueOn cannot precede plannedOn.')
  }
  const checklist = requireArray(value.checklist, 'Study task checklist').map(
    (rawItem, itemIndex): TaskChecklistItem => {
      const item = requireRecord(rawItem, `Checklist item ${itemIndex}`)
      if (typeof item.checked !== 'boolean') {
        throw new Error('Checklist item checked must be boolean.')
      }
      return {
        id: requireText(item.id, 'Checklist item id'),
        text: requireText(item.text, 'Checklist item text'),
        checked: item.checked,
        checkedAt: parseNullableText(item.checkedAt, 'Checklist item checkedAt'),
        position: requireNonNegativeInteger(
          item.position,
          'Checklist item position',
        ),
      }
    },
  )
  assertUnique(checklist, `checklist item in task ${String(value.id)}`)
  const blockedReason = parseNullableText(
    value.blockedReason,
    'Study task blockedReason',
  )
  if (status === 'blocked' && !blockedReason) {
    throw new Error('A blocked Study task requires blockedReason.')
  }
  return {
    id: requireText(value.id, 'Study task id'),
    revision: requirePositiveInteger(value.revision, 'Study task revision'),
    topicId: parseNullableText(value.topicId, 'Study task topicId'),
    title: requireText(value.title, 'Study task title'),
    notes: requireText(value.notes, 'Study task notes', true),
    status,
    plannedOn,
    dueOn,
    reminderAt,
    priority: value.priority === undefined ? 'none' : parseTaskPriority(value.priority),
    estimateMinutes:
      value.estimateMinutes === null
        ? null
        : requirePositiveInteger(
            value.estimateMinutes,
            'Study task estimateMinutes',
          ),
    acceptanceCriteria: parseTextArray(
      value.acceptanceCriteria,
      'Study task acceptanceCriteria',
    ),
    checklist,
    blockedReason,
    createdAt: requireText(value.createdAt, 'Study task createdAt'),
    updatedAt: requireText(value.updatedAt, 'Study task updatedAt'),
    deletedAt: parseNullableText(value.deletedAt, 'Study task deletedAt'),
  }
}

function parseSession(raw: unknown, index: number): StudySession {
  const value = requireRecord(raw, `Study session ${index}`)
  const state = value.state
  if (state !== 'running' && state !== 'paused' && state !== 'finished') {
    throw new Error(`Study session ${index} has invalid state.`)
  }
  const activeSince = parseNullableText(
    value.activeSince,
    'Study session activeSince',
  )
  if (state === 'running' && !activeSince) {
    throw new Error('A running Study session requires activeSince.')
  }
  if (state !== 'running' && activeSince) {
    throw new Error('Only a running Study session can have activeSince.')
  }
  return {
    id: requireText(value.id, 'Study session id'),
    taskId: requireText(value.taskId, 'Study session taskId'),
    state,
    startedAt: requireText(value.startedAt, 'Study session startedAt'),
    activeSince,
    elapsedSeconds: requireNonNegativeInteger(
      value.elapsedSeconds,
      'Study session elapsedSeconds',
    ),
    scratchpad: requireText(value.scratchpad, 'Study session scratchpad', true),
    createdAt: requireText(value.createdAt, 'Study session createdAt'),
    updatedAt: requireText(value.updatedAt, 'Study session updatedAt'),
    deletedAt: parseNullableText(value.deletedAt, 'Study session deletedAt'),
  }
}

function parseEvent(raw: unknown, index: number): TaskEvent {
  const value = requireRecord(raw, `Task event ${index}`)
  const type = value.type
  if (
    typeof type !== 'string' ||
    !EVENT_TYPES.includes(type as TaskEventType)
  ) {
    throw new Error(`Task event ${index} has invalid type.`)
  }
  return {
    id: requireText(value.id, 'Task event id'),
    sequence: requirePositiveInteger(value.sequence, 'Task event sequence'),
    taskId: requireText(value.taskId, 'Task event taskId'),
    type: type as TaskEventType,
    occurredAt: requireText(value.occurredAt, 'Task event occurredAt'),
    fromStatus: parseNullableTaskStatus(value.fromStatus),
    toStatus: parseNullableTaskStatus(value.toStatus),
    reason: parseNullableText(value.reason, 'Task event reason'),
    completionRecordId: parseNullableText(
      value.completionRecordId,
      'Task event completionRecordId',
    ),
  }
}

function parseCompletionRecord(
  raw: unknown,
  index: number,
): CompletionRecord {
  const value = requireRecord(raw, `Completion record ${index}`)
  return {
    id: requireText(value.id, 'Completion record id'),
    taskId: requireText(value.taskId, 'Completion record taskId'),
    topicId: parseNullableText(value.topicId, 'Completion record topicId'),
    sessionIds: parseTextArray(
      value.sessionIds,
      'Completion record sessionIds',
    ),
    taskTitleSnapshot: requireText(
      value.taskTitleSnapshot,
      'Completion record taskTitleSnapshot',
    ),
    learned: requireText(value.learned, 'Completion record learned'),
    evidence: requireText(value.evidence, 'Completion record evidence'),
    blocker: requireText(value.blocker, 'Completion record blocker', true),
    nextAction: requireText(value.nextAction, 'Completion record nextAction'),
    mastery: parseMastery(value.mastery),
    completedAt: requireText(value.completedAt, 'Completion record completedAt'),
    reviewStage: parseReviewStage(value.reviewStage),
    nextReviewOn: parseDateOnly(
      value.nextReviewOn,
      'Completion record nextReviewOn',
    ),
    lastReviewResult: parseReviewResult(value.lastReviewResult),
    lastReviewedAt: parseNullableText(
      value.lastReviewedAt,
      'Completion record lastReviewedAt',
    ),
    createdAt: requireText(value.createdAt, 'Completion record createdAt'),
    updatedAt: requireText(value.updatedAt, 'Completion record updatedAt'),
    deletedAt: parseNullableText(value.deletedAt, 'Completion record deletedAt'),
  }
}

function parseTaskStatus(value: unknown): StudyTaskStatus {
  if (
    typeof value !== 'string' ||
    !TASK_STATUSES.includes(value as StudyTaskStatus)
  ) {
    throw new Error('Invalid Study task status.')
  }
  return value as StudyTaskStatus
}

function parseTaskPriority(value: unknown): StudyTaskPriority {
  if (
    typeof value !== 'string' ||
    !TASK_PRIORITIES.includes(value as StudyTaskPriority)
  ) {
    throw new Error('Invalid Study task priority.')
  }
  return value as StudyTaskPriority
}

function parseNullableTaskStatus(value: unknown): StudyTaskStatus | null {
  return value === null ? null : parseTaskStatus(value)
}

function parseReviewStage(value: unknown): ReviewStage {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 3
  ) {
    throw new Error('Review stage must be between 0 and 3.')
  }
  return value as ReviewStage
}

function parseReviewResult(value: unknown): ReviewResult | null {
  if (value === null) return null
  if (value !== 'clear' && value !== 'fuzzy' && value !== 'relearn') {
    throw new Error('Invalid review result.')
  }
  return value
}

function parseMastery(value: unknown): CompletionRecord['mastery'] {
  if (value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 5
  ) {
    throw new Error('Mastery must be between 1 and 5.')
  }
  return value as CompletionRecord['mastery']
}

function parseDateOnly(value: unknown, label: string): string | null {
  if (value === null) return null
  const date = requireText(value, label)
  if (!isDateOnly(date)) throw new Error(`${label} must use YYYY-MM-DD.`)
  return date
}

function parseNullableIsoDateTime(value: unknown, label: string): string | null {
  if (value === null) return null
  const dateTime = requireText(value, label)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(dateTime) || !Number.isFinite(Date.parse(dateTime))) {
    throw new Error(`${label} must use an ISO datetime.`)
  }
  return dateTime
}

function parseTextArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) =>
    requireText(entry, `${label} ${index}`),
  )
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return value
}

function requireText(
  value: unknown,
  label: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > MAX_TEXT_LENGTH
  ) {
    throw new Error(`${label} must be a valid string.`)
  }
  return value
}

function parseNullableText(value: unknown, label: string): string | null {
  return value === null ? null : requireText(value, label)
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return value
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

function assertUnique(values: readonly { id: string }[], label: string): void {
  const ids = new Set<string>()
  for (const value of values) {
    if (ids.has(value.id)) {
      throw new Error(`Study state contains a duplicate ${label} id.`)
    }
    ids.add(value.id)
  }
}

function stepKey(topicId: string, stepId: string): string {
  return `${topicId}\u0000${stepId}`
}

function isDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return (
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
