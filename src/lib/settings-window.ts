export interface SettingsWindowHandle {
  show(): Promise<void>
  setFocus(): Promise<void>
}

interface SettingsWindowBindings {
  getByLabel(label: string): Promise<SettingsWindowHandle | null>
  create(label: string, options: Record<string, unknown>): SettingsWindowHandle
}

async function loadBindings(): Promise<SettingsWindowBindings> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  return {
    getByLabel: (label) => WebviewWindow.getByLabel(label),
    create: (label, options) => new WebviewWindow(label, options),
  }
}

export async function openSettingsWindow(
  load: () => Promise<SettingsWindowBindings> = loadBindings,
): Promise<'created' | 'focused'> {
  const bindings = await load()
  const existing = await bindings.getByLabel('settings')
  if (existing) {
    await existing.show()
    await existing.setFocus()
    return 'focused'
  }
  bindings.create('settings', {
    url: '/?window=settings',
    title: '拾学设置',
    width: 960,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    resizable: true,
    center: true,
    decorations: true,
  })
  return 'created'
}
