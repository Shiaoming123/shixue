import type { ShellDestination, WorkspaceView } from './workspace-view.ts'

export type StudyPage = 'today' | 'tasks' | 'calendar' | 'topics' | 'review' | 'settings'
export type StudySmartView = 'inbox' | 'today' | 'next7' | 'all' | 'completed'

export function workspaceDestinationFromSmartView(view: StudySmartView): WorkspaceView {
  if (view === 'next7') return { kind: 'upcoming' }
  if (view === 'all') return { kind: 'lists' }
  return { kind: view }
}

export function workspaceDestinationFromLegacy(page: StudyPage, smartView: StudySmartView = 'inbox', listId?: string): ShellDestination {
  if (page === 'settings') return { kind: 'settings' }
  if (page === 'calendar') return { kind: 'calendar' }
  if (page === 'topics') return { kind: 'learning', section: 'topics' }
  if (page === 'review') return { kind: 'learning', section: 'review' }
  if (page === 'today') return { kind: 'today' }
  if (listId) return { kind: 'list', listId }
  return workspaceDestinationFromSmartView(smartView)
}

export function currentSidebarDestination(
  page: StudyPage,
  smartView: StudySmartView = 'inbox',
  listId?: string,
): string {
  if (page === 'today') return 'smart:today'
  if (page === 'tasks') return listId ? `list:${listId}` : `smart:${smartView}`
  return `page:${page}`
}
