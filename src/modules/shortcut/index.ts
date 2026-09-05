import type { Module } from '../types'

const QUICK_CAPTURE_SHORTCUT = 'Ctrl+Alt+A'
const QUICK_CAPTURE_EVENT = 'shixue:quick-add'

interface ShortcutEvent {
  state: string
}

interface MainWindow {
  show(): Promise<void>
  unminimize(): Promise<void>
  setFocus(): Promise<void>
}

interface ShortcutBindings {
  register(
    shortcut: string,
    handler: (event: ShortcutEvent) => void | Promise<void>,
  ): Promise<void>
  unregister(shortcut: string): Promise<void>
  getMainWindow(): MainWindow
  dispatchEvent(event: Event): void
}

type LoadShortcutBindings = () => Promise<ShortcutBindings>

async function loadShortcutBindings(): Promise<ShortcutBindings> {
  const [{ register, unregister }, { getCurrentWindow }] = await Promise.all([
    import('@tauri-apps/plugin-global-shortcut'),
    import('@tauri-apps/api/window'),
  ])

  return {
    register,
    unregister,
    getMainWindow: getCurrentWindow,
    dispatchEvent: (event) => window.dispatchEvent(event),
  }
}

export function createShortcutModule(
  loadBindings: LoadShortcutBindings = loadShortcutBindings,
): Module {
  let bindings: ShortcutBindings | undefined
  let registered = false
  let registration: Promise<void> | undefined
  let teardownPromise: Promise<void> | undefined

  async function setup(): Promise<void> {
    if (teardownPromise) await teardownPromise
    if (registered) return

    registration ??= (async () => {
      const loaded = await loadBindings()
      await loaded.register(QUICK_CAPTURE_SHORTCUT, async ({ state }) => {
        if (state !== 'Pressed') return

        const mainWindow = loaded.getMainWindow()
        await mainWindow.show()
        await mainWindow.unminimize()
        await mainWindow.setFocus()
        loaded.dispatchEvent(new CustomEvent(QUICK_CAPTURE_EVENT))
      })
      bindings = loaded
      registered = true
    })()

    try {
      await registration
    } finally {
      if (!registered) registration = undefined
    }
  }

  async function teardown(): Promise<void> {
    teardownPromise ??= (async () => {
      if (registration) await registration
      if (!registered || !bindings) return

      await bindings.unregister(QUICK_CAPTURE_SHORTCUT)
      registered = false
      bindings = undefined
      registration = undefined
    })()

    try {
      await teardownPromise
    } finally {
      teardownPromise = undefined
    }
  }

  return {
    id: 'shortcut',
    name: '全局快捷键',
    dependencies: [],
    platforms: ['desktop'],
    requiredCapabilities: ['global-shortcut'],
    setup,
    teardown,
  }
}

export default createShortcutModule()
