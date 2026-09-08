import type { CompletionRecord, WorkspaceStateV3 } from '../workspace/types.ts'
import { compareText } from '../../lib/text-order.ts'

const REVIEW_RESULT_LABELS: Record<NonNullable<CompletionRecord['lastReviewResult']>, string> = {
  clear: '记得',
  fuzzy: '模糊',
  relearn: '忘记',
}

export function createLearningRecordsMarkdown(state: WorkspaceStateV3): string {
  const records = state.completionRecords
    .filter(({ deletedAt }) => deletedAt === null)
    .sort((left, right) =>
      Date.parse(right.completedAt) - Date.parse(left.completedAt) || compareText(left.id, right.id),
    )

  if (records.length === 0) return '# 拾学学习记录\n\n暂无完成记录。\n'

  const topics = new Map(state.lists.map(({ id, title }) => [id, title]))
  const tags = new Map(state.tags.map(({ id, title }) => [id, title]))
  const sections = records.map((record) => recordSection(record, topics, tags))

  return [
    '# 拾学学习记录',
    '',
    `共 ${records.length} 条完成记录，按完成时间从新到旧排列。`,
    '',
    ...sections,
  ].join('\n')
}

function recordSection(
  record: CompletionRecord,
  topics: ReadonlyMap<string, string>,
  tags: ReadonlyMap<string, string>,
): string {
  const topic = record.topicId === null ? '未归类' : topics.get(record.topicId) ?? '未归类'
  const tagLabels = record.tagIdsSnapshot
    .map((tagId) => tags.get(tagId))
    .filter((title): title is string => title !== undefined)
  const lastReview = record.lastReviewResult && record.lastReviewedAt
    ? `${REVIEW_RESULT_LABELS[record.lastReviewResult]} · ${record.lastReviewedAt}`
    : '尚未复习'

  return [
    `## ${escapeInline(record.taskTitleSnapshot)}`,
    '',
    `- 完成时间：${record.completedAt}`,
    `- 学习主题：${escapeInline(topic)}`,
    `- 标签：${tagLabels.length > 0 ? tagLabels.map(escapeInline).join('、') : '无'}`,
    `- 掌握程度：${record.mastery === null ? '未填写' : `${record.mastery} / 5`}`,
    `- 复习进度：${record.reviewStage} / 3`,
    `- 下次复习：${record.nextReviewOn ?? '未安排'}`,
    `- 最近复习：${lastReview}`,
    '',
    '### 收获',
    '',
    escapeBlock(record.learned, '未填写'),
    '',
    '### 证据',
    '',
    escapeBlock(record.evidence, '未填写'),
    '',
    '### 卡点',
    '',
    escapeBlock(record.blocker, '暂无'),
    '',
    '### 下一步',
    '',
    escapeBlock(record.nextAction, '未填写'),
    '',
  ].join('\n')
}

function escapeBlock(value: string, fallback: string): string {
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return fallback
  return normalized.split('\n').map(escapeLine).join('  \n')
}

function escapeInline(value: string): string {
  return escapeLine(value.replace(/\s+/g, ' ').trim())
}

function escapeLine(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_\[\]~])/g, '\\$1')
    .replace(/^(\s*)(#{1,6}|[-+] |\d+[.)] )/, '$1\\$2')
    .replace(/^(\s*)((?:-{3,}|={3,})\s*)$/, '$1\\$2')
}

