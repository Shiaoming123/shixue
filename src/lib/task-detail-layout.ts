import { resolveShell } from './responsive-shell.ts'

export function shouldAutoSelectTask(viewportWidth: number): boolean {
  return resolveShell(viewportWidth).detail === 'aside'
}
