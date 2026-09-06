export type LearningSection = 'topics' | 'review'

export type WorkspaceView =
  | { kind: 'inbox' }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'calendar' }
  | { kind: 'lists' }
  | { kind: 'list'; listId: string }
  | { kind: 'completed' }
  | { kind: 'learning'; section: LearningSection }

export type ShellDestination = WorkspaceView | { kind: 'settings' }
export type WorkspaceRenderPage = 'today' | 'tasks' | 'calendar' | 'topics' | 'review' | 'settings'

export function renderPageForDestination(destination: ShellDestination): WorkspaceRenderPage {
  if (destination.kind === 'settings') return 'settings'
  if (destination.kind === 'today') return 'today'
  if (destination.kind === 'calendar') return 'calendar'
  if (destination.kind === 'learning') return destination.section
  return 'tasks'
}

export interface WorkspaceNavigationDescriptor {
  label: string
  preferenceKey: string
  view: WorkspaceView
}

export interface TaskTopicFilterTransition {
  destination: Extract<WorkspaceView, { kind: 'lists' | 'list' }>
  preservePriority: true
  topicFilter: string
}

export function resolveTaskTopicFilterTransition(topicFilter: string): TaskTopicFilterTransition {
  return topicFilter === 'all' || topicFilter === 'unassigned'
    ? { destination: { kind: 'lists' }, preservePriority: true, topicFilter }
    : { destination: { kind: 'list', listId: topicFilter }, preservePriority: true, topicFilter }
}

export function shouldResetTaskPriority(destination: ShellDestination, preservePriority = false): boolean {
  return !preservePriority
    && destination.kind !== 'settings'
    && destination.kind !== 'calendar'
    && destination.kind !== 'learning'
    && destination.kind !== 'list'
}

export const desktopWorkspaceNavigation: readonly WorkspaceNavigationDescriptor[] = [
  { label: '收件箱', preferenceKey: 'smart:inbox', view: { kind: 'inbox' } },
  { label: '今天', preferenceKey: 'smart:today', view: { kind: 'today' } },
  { label: '最近 7 天', preferenceKey: 'smart:next7', view: { kind: 'upcoming' } },
  { label: '日历', preferenceKey: 'page:calendar', view: { kind: 'calendar' } },
  { label: '清单', preferenceKey: 'smart:all', view: { kind: 'lists' } },
  { label: '已完成', preferenceKey: 'smart:completed', view: { kind: 'completed' } },
  { label: '学习', preferenceKey: 'page:topics', view: { kind: 'learning', section: 'topics' } },
]

export const mobileWorkspaceNavigation = desktopWorkspaceNavigation.filter(({ view }) =>
  view.kind === 'inbox'
  || view.kind === 'today'
  || view.kind === 'calendar'
  || view.kind === 'lists'
  || view.kind === 'learning')

export const mobileMoreWorkspaceNavigation = desktopWorkspaceNavigation.filter(({ view }) =>
  view.kind === 'upcoming' || view.kind === 'completed')

export const learningWorkspaceNavigation: readonly WorkspaceNavigationDescriptor[] = [
  { label: '主题', preferenceKey: 'page:topics', view: { kind: 'learning', section: 'topics' } },
  { label: '回顾', preferenceKey: 'page:review', view: { kind: 'learning', section: 'review' } },
]

const staticRoutes: Readonly<Record<string, WorkspaceView>> = {
  '/inbox': { kind: 'inbox' },
  '/today': { kind: 'today' },
  '/upcoming': { kind: 'upcoming' },
  '/calendar': { kind: 'calendar' },
  '/lists': { kind: 'lists' },
  '/completed': { kind: 'completed' },
  '/learning/topics': { kind: 'learning', section: 'topics' },
  '/learning/review': { kind: 'learning', section: 'review' },
}

export function serializeWorkspaceView(view: WorkspaceView): string {
  if (view.kind === 'list') return `/list/${encodeURIComponent(view.listId)}`
  if (view.kind === 'learning') return `/learning/${view.section}`
  return `/${view.kind}`
}

export function resolveWorkspaceView(route: string): WorkspaceView {
  const staticView = staticRoutes[route]
  if (staticView) return { ...staticView }
  if (!route.startsWith('/list/')) return { kind: 'inbox' }

  try {
    const listId = decodeURIComponent(route.slice('/list/'.length))
    return listId ? { kind: 'list', listId } : { kind: 'inbox' }
  } catch {
    return { kind: 'inbox' }
  }
}

export function serializeShellDestination(destination: ShellDestination): string {
  return destination.kind === 'settings' ? '/settings' : serializeWorkspaceView(destination)
}

export function resolveShellDestination(route: string): ShellDestination {
  return route === '/settings' ? { kind: 'settings' } : resolveWorkspaceView(route)
}
