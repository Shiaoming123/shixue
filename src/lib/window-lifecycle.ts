export type WindowCloseBehavior = 'ask' | 'tray' | 'quit'
export type WindowCloseResult = 'confirmation-required' | 'hidden' | 'exiting'
export interface WindowLifecycleBindings {
  hide(): Promise<void>
  exit(code: number): Promise<void>
  onCloseRequested(handler: (event: { preventDefault(): void }) => Promise<void>): Promise<() => void>
}
type LoadBindings = () => Promise<WindowLifecycleBindings>

async function loadBindings(): Promise<WindowLifecycleBindings> {
  const [{ getCurrentWindow }, { exit }] = await Promise.all([
    import('@tauri-apps/api/window'), import('@tauri-apps/plugin-process'),
  ])
  const window = getCurrentWindow()
  return { hide: () => window.hide(), exit, onCloseRequested: (handler) => window.onCloseRequested(handler) }
}

export async function requestWindowClose(
  behavior: WindowCloseBehavior,
  load: LoadBindings = loadBindings,
): Promise<WindowCloseResult> {
  if (behavior === 'ask') return 'confirmation-required'
  if (behavior !== 'tray' && behavior !== 'quit') throw new Error('无法识别关闭窗口设置。')
  try {
    const bindings = await load()
    if (behavior === 'tray') { await bindings.hide(); return 'hidden' }
    await bindings.exit(0)
    return 'exiting'
  } catch { throw new Error(behavior === 'tray' ? '窗口未能隐藏到托盘，请重试。' : '拾学未能退出，请重试。') }
}

export async function installWindowLifecycle(
  options: {
    getBehavior(): WindowCloseBehavior
    onAsk(): Promise<'tray' | 'quit' | null>
    onError(error: Error): void
  },
  load: LoadBindings = loadBindings,
): Promise<() => void> {
  try {
    const bindings = await load()
    let pending = false
    return await bindings.onCloseRequested(async (event) => {
      event.preventDefault()
      if (pending) return
      pending = true
      try {
        let behavior = options.getBehavior()
        if (behavior === 'ask') {
          const chosen = await options.onAsk()
          if (!chosen) return
          behavior = chosen
        }
        await requestWindowClose(behavior, async () => bindings)
      } catch (error) {
        options.onError(error instanceof Error ? error : new Error('关闭窗口失败，请重试。'))
      } finally { pending = false }
    })
  } catch { throw new Error('窗口关闭设置暂不可用，请重试。') }
}
