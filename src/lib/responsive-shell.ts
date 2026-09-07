export type ShellMode = 'three-column' | 'rail-with-overlay-detail' | 'single-column-bottom-tabs'

export interface ShellResolution {
  mode: ShellMode
  navigation: 'sidebar' | 'rail' | 'bottom-tabs'
  detail: 'aside' | 'overlay' | 'sheet'
  detailWidth: number
  horizontalOverflow: false
}

const DETAIL_WIDTH = 360

export function resolveShell(viewportWidth: number): ShellResolution {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    throw new Error('Shell resolution requires a positive viewport width.')
  }
  if (viewportWidth >= 1280) {
    return { mode: 'three-column', navigation: 'sidebar', detail: 'aside', detailWidth: DETAIL_WIDTH, horizontalOverflow: false }
  }
  if (viewportWidth >= 820) {
    return { mode: 'rail-with-overlay-detail', navigation: 'rail', detail: 'overlay', detailWidth: DETAIL_WIDTH, horizontalOverflow: false }
  }
  return { mode: 'single-column-bottom-tabs', navigation: 'bottom-tabs', detail: 'sheet', detailWidth: viewportWidth, horizontalOverflow: false }
}

export function resolveTaskDetailPlacement(viewportWidth: number): 'responsive' | 'right' | 'inline' {
  const detail = resolveShell(viewportWidth).detail
  return detail === 'sheet' ? 'responsive' : detail === 'overlay' ? 'right' : 'inline'
}
