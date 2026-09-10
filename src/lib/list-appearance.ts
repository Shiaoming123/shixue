export const listIconIds = ['folder', 'book', 'graduation', 'code', 'languages', 'notebook'] as const
export type ListIconId = typeof listIconIds[number]

export const listAccentPalette = [
  { value: '#64748B', label: '石板灰' },
  { value: '#3B82F6', label: '蓝色' },
  { value: '#14B8A6', label: '青色' },
  { value: '#22C55E', label: '绿色' },
  { value: '#F97316', label: '橙色' },
  { value: '#8B5CF6', label: '紫色' },
] as const

export interface ListAppearance {
  icon: ListIconId
  color: string
}

export function isListIconId(value: unknown): value is ListIconId {
  return typeof value === 'string' && listIconIds.includes(value as ListIconId)
}

export function isListAccent(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

export function resolveListAppearance(id: string, icon?: unknown, color?: unknown): ListAppearance {
  const hash = [...id].reduce((value, character) => ((value * 31) + character.codePointAt(0)!) >>> 0, 0)
  return {
    icon: isListIconId(icon) ? icon : 'folder',
    color: isListAccent(color) ? color : listAccentPalette[hash % listAccentPalette.length].value,
  }
}
