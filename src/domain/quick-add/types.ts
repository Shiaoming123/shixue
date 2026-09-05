export type QuickAddCandidateKind = 'schedule' | 'deadline' | 'priority' | 'recurrence' | 'list' | 'tag'
export type QuickAddCandidateStatus = 'resolved' | 'ambiguous'

export interface QuickAddSourceRange {
  start: number
  end: number
  text: string
}

export interface QuickAddCandidate {
  id: string
  kind: QuickAddCandidateKind
  value: string
  source: QuickAddSourceRange
  status: QuickAddCandidateStatus
}

export interface QuickAddParse {
  originalTitle: string
  candidates: QuickAddCandidate[]
}

export interface QuickAddContext {
  now: string
  timezone: string
  lists: readonly { id: string; title: string }[]
  tags: readonly { id: string; title: string }[]
}
