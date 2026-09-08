import { resolveShell } from './responsive-shell.ts'

export function shouldAutoSelectTask(viewportWidth: number): boolean {
  return resolveShell(viewportWidth).detail === 'aside'
}

export function restoreDeletedInlineTaskFocus(
  viewportWidth: number,
  resolveFallback: () => HTMLElement | null,
): boolean {
  if (!shouldAutoSelectTask(viewportWidth)) return false
  const target = resolveFallback()
  if (!target?.isConnected) return false
  target.focus({ preventScroll: true })
  return true
}
