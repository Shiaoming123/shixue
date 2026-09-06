import type { QuickAddSourceRange } from './types.ts'

export function findTokenRanges(input: string, pattern: RegExp): QuickAddSourceRange[] {
  if (!pattern.global) throw new Error('Token pattern must use the global flag.')
  return Array.from(input.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }))
}

export function rangesOverlap(left: QuickAddSourceRange, right: QuickAddSourceRange): boolean {
  return left.start < right.end && right.start < left.end
}
