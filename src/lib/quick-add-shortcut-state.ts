export interface QuickAddCaptureActions {
  closeDeleteConfirmation(): void
  focusComposer(): void
}

export interface EditableTargetLike {
  matches(selectors: string): boolean
  readonly isContentEditable: boolean
  closest(selectors: string): { getAttribute(name: string): string | null } | null
}

export function activateQuickAddCapture(actions: QuickAddCaptureActions): void {
  actions.closeDeleteConfirmation()
  actions.focusComposer()
}

export function isQuickAddEditableTarget(target: EditableTargetLike): boolean {
  if (target.matches('input, textarea, select') || target.isContentEditable) return true

  const hostValue = target.closest('[contenteditable]')?.getAttribute('contenteditable')?.toLowerCase()
  return hostValue === '' || hostValue === 'true' || hostValue === 'plaintext-only'
}
