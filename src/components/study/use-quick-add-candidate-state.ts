import { computed, type ComputedRef } from 'vue'
import type { QuickAddCandidate } from '../../domain/quick-add/types.ts'

export interface QuickAddCandidateState {
  submissionBlocked: ComputedRef<boolean>
  conflictedCandidateIds: ComputedRef<string[]>
  message: ComputedRef<string>
}

export function useQuickAddCandidateState(
  candidates: ComputedRef<readonly QuickAddCandidate[]>,
): QuickAddCandidateState {
  const multipleListIds = computed(() => {
    const lists = candidates.value.filter(({ kind }) => kind === 'list')
    return lists.length > 1 ? lists.map(({ id }) => id) : []
  })
  const conflictedCandidateIds = computed(() => [...new Set([
    ...candidates.value.filter(({ status }) => status === 'ambiguous').map(({ id }) => id),
    ...multipleListIds.value,
  ])])
  const submissionBlocked = computed(() => conflictedCandidateIds.value.length > 0)
  const message = computed(() => multipleListIds.value.length > 0
    ? '检测到多个清单，请只保留一个清单；标签可以多选。'
    : submissionBlocked.value ? '请确认有歧义的识别结果，或移除对应 chip。' : '')

  return { submissionBlocked, conflictedCandidateIds, message }
}
