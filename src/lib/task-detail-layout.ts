const SPLIT_DETAIL_MIN_WIDTH = 1280

export function shouldAutoSelectTask(viewportWidth: number): boolean {
  return viewportWidth >= SPLIT_DETAIL_MIN_WIDTH
}
