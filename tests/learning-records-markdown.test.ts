import assert from 'node:assert/strict'
import test from 'node:test'
import { createLearningRecordsMarkdown } from '../src/domain/export/learning-records-markdown.ts'
import type { CompletionRecord, Task, WorkspaceStateV3 } from '../src/domain/workspace/types.ts'

const AT = '2026-09-05T08:00:00.000Z'

test('exports live completion records newest first with stable snapshot details', () => {
  const state = workspace()
  state.completionRecords.push(
    record('record:b', '2026-09-07T09:00:00.000Z', {
      taskId: 'task:deleted',
      taskTitleSnapshot: '指针 *与* <生命周期>',
      topicId: 'topic:archived',
      tagIdsSnapshot: ['tag:reading', 'tag:archived'],
      learned: '理解 #1 所有权\n第二行含 [链接](https://example.com)\n~~~\n---\n1) 保持原文\n~~重点~~',
      evidence: '测试通过 & 记录已保存',
      blocker: '',
      nextAction: '复习 `Pin` 与 _Unpin_',
      mastery: 4,
      reviewStage: 2,
      nextReviewOn: '2026-09-14',
      lastReviewResult: 'fuzzy',
      lastReviewedAt: '2026-09-08T10:00:00.000Z',
    }),
    record('record:a', '2026-09-07T09:00:00.000Z', {
      taskTitleSnapshot: '同一时刻更早的稳定 ID',
    }),
    record('record:old', '2026-09-01T09:00:00.000Z', {
      topicId: null,
      tagIdsSnapshot: [],
      taskTitleSnapshot: '无主题记录',
      mastery: null,
      nextReviewOn: null,
      lastReviewResult: null,
      lastReviewedAt: null,
    }),
    record('record:deleted', '2026-09-09T09:00:00.000Z', { deletedAt: AT }),
  )

  assert.equal(createLearningRecordsMarkdown(state), `# 拾学学习记录

共 3 条完成记录，按完成时间从新到旧排列。

## 同一时刻更早的稳定 ID

- 完成时间：2026-09-07T09:00:00.000Z
- 学习主题：编程基础
- 标签：阅读
- 掌握程度：3 / 5
- 复习进度：1 / 3
- 下次复习：2026-09-08
- 最近复习：记得 · 2026-09-07T10:00:00.000Z

### 收获

学到的内容

### 证据

完成练习

### 卡点

暂无

### 下一步

继续练习

## 指针 \\*与\\* &lt;生命周期&gt;

- 完成时间：2026-09-07T09:00:00.000Z
- 学习主题：系统设计
- 标签：阅读、旧标签
- 掌握程度：4 / 5
- 复习进度：2 / 3
- 下次复习：2026-09-14
- 最近复习：模糊 · 2026-09-08T10:00:00.000Z

### 收获

理解 #1 所有权${'  '}
第二行含 \\[链接\\](https://example.com)${'  '}
\\~\\~\\~${'  '}
\\---${'  '}
\\1) 保持原文${'  '}
\\~\\~重点\\~\\~

### 证据

测试通过 &amp; 记录已保存

### 卡点

暂无

### 下一步

复习 \\\`Pin\\\` 与 \\_Unpin\\_

## 无主题记录

- 完成时间：2026-09-01T09:00:00.000Z
- 学习主题：未归类
- 标签：无
- 掌握程度：未填写
- 复习进度：1 / 3
- 下次复习：未安排
- 最近复习：尚未复习

### 收获

学到的内容

### 证据

完成练习

### 卡点

暂无

### 下一步

继续练习
`)
})

test('empty export is deterministic and does not mutate the workspace', () => {
  const state = workspace()
  state.completionRecords.push(record('record:deleted', AT, { deletedAt: AT }))
  const before = structuredClone(state)

  const first = createLearningRecordsMarkdown(state)
  const second = createLearningRecordsMarkdown(state)

  assert.equal(first, '# 拾学学习记录\n\n暂无完成记录。\n')
  assert.equal(second, first)
  assert.deepEqual(state, before)
})

test('orders offset timestamps by their instant before applying the stable id tie-breaker', () => {
  const state = workspace()
  state.completionRecords.push(
    record('record:b', '2026-09-07T12:00:00+08:00', { taskTitleSnapshot: '04:00 UTC · b' }),
    record('record:a', '2026-09-07T04:00:00.000Z', { taskTitleSnapshot: '04:00 UTC · a' }),
    record('record:newest', '2026-09-07T05:00:00.000Z', { taskTitleSnapshot: '05:00 UTC' }),
  )

  const headings = [...createLearningRecordsMarkdown(state).matchAll(/^## (.+)$/gm)]
    .map((match) => match[1])
  assert.deepEqual(headings, ['05:00 UTC', '04:00 UTC · a', '04:00 UTC · b'])
})

function workspace(): WorkspaceStateV3 {
  return {
    version: 3,
    revision: 1,
    listGroups: [],
    lists: [
      list('topic:active', '编程基础', null),
      list('topic:archived', '系统设计', AT),
    ],
    sections: [],
    tags: [
      tag('tag:reading', '阅读', null),
      tag('tag:archived', '旧标签', AT),
    ],
    tasks: [
      task('task:active', null),
      task('task:deleted', AT),
    ],
    recurrenceSeries: [],
    occurrences: [],
    reminderRules: [],
    reminderDeliveries: [],
    studySessions: [],
    taskEvents: [],
    completionRecords: [],
    reviewTaskLinks: [],
    commandReceipts: [],
    updatedAt: AT,
  }
}

function list(id: string, title: string, archivedAt: string | null): WorkspaceStateV3['lists'][number] {
  return {
    id, title, archivedAt, groupId: null, position: 0, goal: '', successCriteria: [],
    weeklyTargetMinutes: null, createdAt: AT, updatedAt: AT,
  }
}

function tag(id: string, title: string, archivedAt: string | null): WorkspaceStateV3['tags'][number] {
  return { id, title, archivedAt, position: 0, createdAt: AT, updatedAt: AT }
}

function task(id: string, deletedAt: string | null): Task {
  return {
    id, deletedAt, revision: 1, mode: 'learning', listId: 'topic:active', sectionId: null,
    tagIds: [], title: id, notes: '', status: 'completed',
    schedule: { startAt: null, startOn: null, estimateMinutes: null },
    deadline: { dueAt: null, dueOn: null }, priority: 'none', checklist: [],
    learning: { acceptanceCriteria: [], blockedReason: null }, recurrenceSeriesId: null,
    createdAt: AT, updatedAt: AT,
  }
}

function record(id: string, completedAt: string, overrides: Partial<CompletionRecord> = {}): CompletionRecord {
  return {
    id, completedAt, taskId: 'task:active', topicId: 'topic:active', sessionIds: [],
    tagIdsSnapshot: ['tag:reading'], taskTitleSnapshot: id, learned: '学到的内容',
    evidence: '完成练习', blocker: '', nextAction: '继续练习', mastery: 3,
    reviewStage: 1, nextReviewOn: '2026-09-08', lastReviewResult: 'clear',
    lastReviewedAt: '2026-09-07T10:00:00.000Z', createdAt: completedAt,
    updatedAt: completedAt, deletedAt: null, ...overrides,
  }
}
