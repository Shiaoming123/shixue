import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref } from 'vue'
import { useQuickAddCandidateState } from '../src/components/study/use-quick-add-candidate-state.ts'
import type { QuickAddCandidate, QuickAddCandidateKind } from '../src/domain/quick-add/types.ts'

function candidate(
  id: string,
  kind: QuickAddCandidateKind,
  value: string,
  status: QuickAddCandidate['status'],
): QuickAddCandidate {
  return { id, kind, value, status, source: { start: 0, end: id.length, text: id } }
}

test('two resolved list chips remain visibly conflicted after edits and block submission', () => {
  const acceptedCandidates = ref<QuickAddCandidate[]>([
    candidate('list:first', 'list', 'list:first', 'ambiguous'),
    candidate('list:second', 'list', 'list:second', 'ambiguous'),
    candidate('tag:math', 'tag', 'tag:math', 'resolved'),
  ])
  const state = useQuickAddCandidateState(computed(() => acceptedCandidates.value))

  acceptedCandidates.value = acceptedCandidates.value.map((item) => (
    item.kind === 'list' ? { ...item, status: 'resolved' } : item
  ))

  assert.equal(state.submissionBlocked.value, true)
  assert.deepEqual(state.conflictedCandidateIds.value, ['list:first', 'list:second'])
  assert.equal(state.message.value, '检测到多个清单，请只保留一个清单；标签可以多选。')
})

test('multiple resolved tag chips remain valid together', () => {
  const acceptedCandidates = ref<QuickAddCandidate[]>([
    candidate('tag:math', 'tag', 'tag:math', 'resolved'),
    candidate('tag:study', 'tag', 'tag:study', 'resolved'),
  ])
  const state = useQuickAddCandidateState(computed(() => acceptedCandidates.value))

  assert.equal(state.submissionBlocked.value, false)
  assert.deepEqual(state.conflictedCandidateIds.value, [])
  assert.equal(state.message.value, '')
})
