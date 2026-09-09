import { searchWorkspace, normalize as normalizeSearch } from '../search/workspace-search.ts'
import type { Task, WorkspaceStateV4 } from '../workspace/types.ts'
import { projectCalendarItems, type CalendarItem } from './project.ts'
import { projectCalendarEvents } from './project-events.ts'
import type { CalendarRange } from './range.ts'

export interface CalendarFilters {
  text?: string
  tagId?: string
  priority?: Task['priority'] | 'all'
  status?: 'all' | 'active' | 'completed'
}

export function queryCalendar(state: WorkspaceStateV4, range: CalendarRange, filters: CalendarFilters = {}, timezone = 'UTC') {
  const tasks = searchWorkspace(state, { text: filters.text, tagIds: filters.tagId ? [filters.tagId] : [], kinds: ['task'] }).tasks
    .map(({ task }) => task)
    .filter((task) => task.status !== 'cancelled' && (!filters.priority || filters.priority === 'all' || task.priority === filters.priority))
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const occurrences = new Map(state.occurrences.map((occurrence) => [occurrence.id, occurrence]))
  const tags = new Map(state.tags.map((tag) => [tag.id, tag.title]))
  const items: CalendarItem[] = []
  const allItems = projectCalendarItems(state, range, timezone)
  for (const item of allItems) {
    const task = item.taskId ? byId.get(item.taskId) : undefined
    if (!task) continue
    const status = item.occurrenceId ? occurrences.get(item.occurrenceId)!.status : task.status
    if (!matchesStatus(status, filters.status)) continue
    items.push({ ...item, presentation: { priority: task.priority, status, tags: task.tagIds.flatMap((id) => tags.has(id) ? [tags.get(id)!] : []) } })
  }
  const eventItems = projectCalendarEvents(state, range, timezone)
  const text = normalizeSearch(filters.text ?? '')
  const matchingEvents = new Set(state.calendarEvents.filter((event) => !text || [event.title, event.notes, event.location].some((value) => normalizeSearch(value).includes(text))).map(({ id }) => id))
  if (!filters.tagId && (!filters.priority || filters.priority === 'all') && filters.status !== 'completed') {
    items.push(...eventItems.filter((item) => item.eventId && matchingEvents.has(item.eventId)))
  }
  return { items, allItems: [...allItems, ...eventItems], tasks: tasks.filter((task) => matchesStatus(task.status, filters.status)) }
}

function matchesStatus(status: string, filter: CalendarFilters['status']) {
  return !filter || filter === 'all' || (filter === 'completed' ? status === 'completed' : status !== 'completed' && status !== 'skipped')
}
