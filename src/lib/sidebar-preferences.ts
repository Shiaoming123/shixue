export type SidebarDisplayMode = 'expanded' | 'icons'

export interface SidebarPreferences {
  displayMode: SidebarDisplayMode
  order: string[]
}

const STORAGE_KEY = 'shixue:sidebar-preferences:v1'

export function loadSidebarPreferences(menuKeys: string[]): SidebarPreferences {
  let stored: string | null
  try {
    stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return defaults(menuKeys)
  }
  if (stored === null) return defaults(menuKeys)

  try {
    const value = JSON.parse(stored) as unknown
    if (!isSidebarPreferences(value)) return defaults(menuKeys)
    return { displayMode: value.displayMode, order: normalizeOrder(value.order, menuKeys) }
  } catch {
    return defaults(menuKeys)
  }
}

export function saveSidebarPreferences(
  value: SidebarPreferences,
  menuKeys: string[],
): SidebarPreferences {
  if (!isSidebarPreferences(value)) throw new TypeError('Invalid sidebar preferences')
  const next = { displayMode: value.displayMode, order: normalizeOrder(value.order, menuKeys) }
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return { ...next, order: [...next.order] }
}

export function moveSidebarItem(order: string[], source: string, target: string): string[] {
  const sourceIndex = order.indexOf(source)
  const targetIndex = order.indexOf(target)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...order]
  const next = [...order]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

function defaults(menuKeys: string[]): SidebarPreferences {
  return { displayMode: 'expanded', order: normalizeOrder([], menuKeys) }
}

function normalizeOrder(order: string[], menuKeys: string[]): string[] {
  const available = new Set(menuKeys)
  const seen = new Set<string>()
  const normalized = order.filter((key) => available.has(key) && !seen.has(key) && seen.add(key))
  for (const key of menuKeys) if (!seen.has(key)) normalized.push(key)
  return normalized
}

function isSidebarPreferences(value: unknown): value is SidebarPreferences {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<SidebarPreferences>
  return (candidate.displayMode === 'expanded' || candidate.displayMode === 'icons')
    && Array.isArray(candidate.order)
    && candidate.order.every((key) => typeof key === 'string')
}
