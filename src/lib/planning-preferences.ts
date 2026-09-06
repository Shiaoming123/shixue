export interface PlanningPreferences {
  weekStartsOn: 0 | 1
  defaultCalendarView: 'day' | 'week' | 'month' | 'agenda'
  defaultEstimateMinutes: number | null
  quickAddRemoveRecognizedText: boolean
  closeBehavior: 'ask' | 'tray' | 'quit'
  launchAtLogin: boolean
  defaultSnoozeMinutes: number
  reducedGlassOverride: 'system' | 'on' | 'off'
}

const STORAGE_KEY = 'shixue:planning-preferences:v1'

const DEFAULTS: PlanningPreferences = {
  weekStartsOn: 1,
  defaultCalendarView: 'week',
  defaultEstimateMinutes: null,
  quickAddRemoveRecognizedText: false,
  closeBehavior: 'ask',
  launchAtLogin: false,
  defaultSnoozeMinutes: 10,
  reducedGlassOverride: 'system',
}

const preferenceKeys = Object.keys(DEFAULTS) as Array<keyof PlanningPreferences>

export function loadPlanningPreferences(): PlanningPreferences {
  let stored: string | null
  try {
    stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return defaults()
  }
  if (stored === null) return defaults()

  try {
    return parseStoredPreferences(JSON.parse(stored))
  } catch {
    return defaults()
  }
}

export function savePlanningPreferences(
  patch: Partial<PlanningPreferences>,
): PlanningPreferences {
  if (!isPlainObject(patch) || !hasOnlyPreferenceKeys(patch) || !isValidPatch(patch)) {
    throw new TypeError('Invalid planning preferences patch')
  }

  const next = parseStoredPreferences({ ...loadPlanningPreferences(), ...patch })
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return { ...next }
}

function parseStoredPreferences(value: unknown): PlanningPreferences {
  if (!isPlainObject(value) || !hasOnlyPreferenceKeys(value)) throw new TypeError('Invalid planning preferences')
  const candidate = { ...DEFAULTS, ...value }
  if (!isPlanningPreferences(candidate)) throw new TypeError('Invalid planning preferences')
  return { ...candidate }
}

function defaults(): PlanningPreferences {
  return { ...DEFAULTS }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyPreferenceKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => preferenceKeys.includes(key as keyof PlanningPreferences))
}

function isValidPatch(value: Record<string, unknown>): boolean {
  return Object.entries(value).every(([key, field]) => isValidField(key as keyof PlanningPreferences, field))
}

function isPlanningPreferences(value: Record<string, unknown>): boolean {
  return preferenceKeys.every((key) => key in value && isValidField(key, value[key]))
}

function isValidField(key: keyof PlanningPreferences, value: unknown): boolean {
  if (key === 'weekStartsOn') return value === 0 || value === 1
  if (key === 'defaultCalendarView') return value === 'day' || value === 'week' || value === 'month' || value === 'agenda'
  if (key === 'defaultEstimateMinutes') return value === null || isPositiveMinutes(value)
  if (key === 'quickAddRemoveRecognizedText' || key === 'launchAtLogin') return typeof value === 'boolean'
  if (key === 'closeBehavior') return value === 'ask' || value === 'tray' || value === 'quit'
  if (key === 'defaultSnoozeMinutes') return isPositiveMinutes(value)
  return value === 'system' || value === 'on' || value === 'off'
}

function isPositiveMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1440
}
