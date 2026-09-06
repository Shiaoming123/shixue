export type StudyPage = 'today' | 'tasks' | 'calendar' | 'topics' | 'review' | 'settings'
export type StudySmartView = 'inbox' | 'today' | 'next7' | 'all' | 'completed'

export function currentSidebarDestination(
  page: StudyPage,
  smartView: StudySmartView = 'inbox',
  listId?: string,
): string {
  if (page === 'today') return 'smart:today'
  if (page === 'tasks') return listId ? `list:${listId}` : `smart:${smartView}`
  return `page:${page}`
}
