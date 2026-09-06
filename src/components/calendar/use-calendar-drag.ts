import { readonly, ref, type Ref } from 'vue'
import type { CalendarCapabilityCommand } from '../../domain/capabilities/calendar-commands.ts'
import type { CalendarItem } from '../../domain/calendar/project.ts'
import { calendarTimedTarget, type CalendarTargetClock } from '../../domain/calendar/target.ts'
import type { Task } from '../../domain/workspace/types.ts'

export interface CalendarDragPreview {
  itemKey: string
  proposedStart: string
  displayDate: string
  displayMinute: number | null
  proposedDuration: number
  valid: boolean
  conflict: string | null
}

export interface CalendarDragSession {
  itemKey: string
  item: CalendarItem
  action: 'move' | 'resize'
  sourceStart: string | null
  sourceDuration: number
}

interface PointerCaptureTarget {
  setPointerCapture(pointerId: number): void
  releasePointerCapture(pointerId: number): void
}

interface CalendarPointerEvent {
  pointerId: number
  currentTarget: unknown
  clientX?: number
  clientY?: number
}

export interface CalendarDragController {
  preview: Readonly<Ref<CalendarDragPreview | null>>
  session: Readonly<Ref<CalendarDragSession | null>>
  begin(event: CalendarPointerEvent, session: CalendarDragSession): boolean
  update(event: CalendarPointerEvent, preview: CalendarDragPreview): void
  release(event: CalendarPointerEvent, command: CalendarCapabilityCommand | null, itemKey: string): Promise<void>
  cancel(event: CalendarPointerEvent): void
  cancelActive(): void
}

export function createCalendarDragController(
  execute: (command: CalendarCapabilityCommand) => Promise<void>,
): CalendarDragController {
  const preview = ref<CalendarDragPreview | null>(null)
  const session = ref<CalendarDragSession | null>(null)
  let pointerId: number | null = null
  let captureTarget: PointerCaptureTarget | null = null
  let origin = { x: 0, y: 0 }

  function begin(event: CalendarPointerEvent, nextSession: CalendarDragSession) {
    if (pointerId !== null) return false
    const target = pointerCaptureTarget(event.currentTarget)
    pointerId = event.pointerId
    captureTarget = target
    origin = { x: event.clientX ?? 0, y: event.clientY ?? 0 }
    session.value = { ...nextSession, item: { ...nextSession.item } }
    target?.setPointerCapture(event.pointerId)
    return true
  }

  function update(event: CalendarPointerEvent, nextPreview: CalendarDragPreview) {
    if (event.pointerId !== pointerId || session.value?.itemKey !== nextPreview.itemKey) return
    if (Math.hypot((event.clientX ?? origin.x) - origin.x, (event.clientY ?? origin.y) - origin.y) < 4) return
    preview.value = nextPreview
  }

  async function release(event: CalendarPointerEvent, command: CalendarCapabilityCommand | null, itemKey: string) {
    if (event.pointerId !== pointerId) return
    const currentPreview = preview.value
    const currentSession = session.value
    clear(event.pointerId)
    if (!currentPreview?.valid || command === null || currentSession?.itemKey !== itemKey || currentPreview.itemKey !== itemKey || !commandTargetsItem(command, currentSession.item)) return
    await execute(command)
  }

  function cancel(event: CalendarPointerEvent) {
    if (event.pointerId !== pointerId) return
    clear(event.pointerId)
  }

  function cancelActive() {
    if (pointerId === null) return
    clear(pointerId)
  }

  function clear(releasedPointerId: number) {
    const target = captureTarget
    pointerId = null
    captureTarget = null
    preview.value = null
    session.value = null
    try { target?.releasePointerCapture(releasedPointerId) } catch { /* capture may already be lost */ }
  }

  return {
    preview: readonly(preview),
    session: readonly(session),
    begin,
    update,
    release,
    cancel,
    cancelActive,
  }
}

export function filterUnscheduledTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) =>
    task.deletedAt === null
    && task.status !== 'completed'
    && task.status !== 'cancelled'
    && task.schedule.startAt === null
    && task.schedule.startOn === null
    && task.recurrenceSeriesId === null)
}

export function snapCalendarMinutes(minutes: number): number {
  return Math.round(minutes / 15) * 15
}

export function calendarMoveCommand(
  item: Pick<CalendarItem, 'taskId' | 'occurrenceId'>,
  target: { startAt: string } | { startOn: string },
  estimateMinutes?: number,
): CalendarCapabilityCommand {
  return {
    type: 'calendar.move', taskId: item.taskId,
    ...(item.occurrenceId ? { occurrenceId: item.occurrenceId } : {}),
    ...target,
    ...(estimateMinutes === undefined ? {} : { estimateMinutes }),
    scope: item.occurrenceId ? 'occurrence' : 'task',
  }
}

export function calendarPointerMovePreview(
  item: CalendarItem,
  displayDate: string,
  displayMinute: number,
  proposedDuration: number,
  clock: CalendarTargetClock,
): CalendarDragPreview {
  const target = calendarTimedTarget(displayDate, displayMinute, clock)
  return {
    itemKey: item.key,
    proposedStart: target.startAt,
    displayDate: target.displayDate,
    displayMinute: target.displayMinute,
    proposedDuration,
    valid: true,
    conflict: null,
  }
}

export function calendarMenuMoveCommand(
  item: Pick<CalendarItem, 'taskId' | 'occurrenceId'>,
  displayDate: string,
  displayMinute: number | null,
  estimateMinutes: number,
  clock: CalendarTargetClock,
): CalendarCapabilityCommand {
  if (displayMinute === null) return calendarMoveCommand(item, { startOn: displayDate })
  const target = calendarTimedTarget(displayDate, displayMinute, clock)
  return calendarMoveCommand(item, { startAt: target.startAt }, estimateMinutes)
}

export function calendarResizeCommand(
  item: Pick<CalendarItem, 'taskId' | 'occurrenceId'>,
  estimateMinutes: number,
): CalendarCapabilityCommand {
  return {
    type: 'calendar.resize', taskId: item.taskId,
    ...(item.occurrenceId ? { occurrenceId: item.occurrenceId } : {}),
    estimateMinutes,
    scope: item.occurrenceId ? 'occurrence' : 'single',
  }
}

export function calendarCommandForPreview(
  item: CalendarItem,
  action: 'move' | 'resize',
  preview: CalendarDragPreview,
  fromTray = false,
): CalendarCapabilityCommand {
  if (action === 'resize') return calendarResizeCommand(item, preview.proposedDuration)
  const target = preview.proposedStart.includes('T') ? { startAt: preview.proposedStart } : { startOn: preview.proposedStart }
  return calendarMoveCommand(item, target, 'startAt' in target && (fromTray || item.kind === 'all-day') ? preview.proposedDuration : undefined)
}

export function calendarKeyboardCommand(
  item: CalendarItem,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  resize: boolean,
  clock: CalendarTargetClock,
): CalendarCapabilityCommand | null {
  if (item.kind === 'deadline-marker') return null
  if (resize) {
    if (item.kind !== 'timed' || (key !== 'ArrowUp' && key !== 'ArrowDown')) return null
    const current = durationMinutes(item)
    const estimateMinutes = Math.min(1440, Math.max(5, current + (key === 'ArrowDown' ? 5 : -5)))
    if (estimateMinutes === current) return null
    return calendarResizeCommand(item, estimateMinutes)
  }

  if (item.kind === 'all-day') {
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
    return calendarMoveCommand(item, { startOn: addCalendarDays(item.start, key === 'ArrowLeft' ? -1 : 1) })
  }

  let displayDate = item.displayDate
  let displayMinute = item.displayMinute ?? 0
  if (key === 'ArrowLeft' || key === 'ArrowRight') displayDate = addCalendarDays(displayDate, key === 'ArrowLeft' ? -1 : 1)
  else {
    const shifted = displayMinute + (key === 'ArrowUp' ? -15 : 15)
    if (shifted < 0) { displayDate = addCalendarDays(displayDate, -1); displayMinute = shifted + 1440 }
    else if (shifted >= 1440) { displayDate = addCalendarDays(displayDate, 1); displayMinute = shifted - 1440 }
    else displayMinute = shifted
  }
  const target = calendarTimedTarget(displayDate, displayMinute, clock)
  return calendarMoveCommand(item, { startAt: target.startAt })
}

export function durationMinutes(item: CalendarItem): number {
  if (item.end === null) return 30
  return Math.max(5, Math.round((Date.parse(item.end) - Date.parse(item.start)) / 60_000))
}

function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function pointerCaptureTarget(value: unknown): PointerCaptureTarget | null {
  if (!value || typeof value !== 'object') return null
  const target = value as Partial<PointerCaptureTarget>
  return typeof target.setPointerCapture === 'function' && typeof target.releasePointerCapture === 'function'
    ? target as PointerCaptureTarget
    : null
}

function commandTargetsItem(command: CalendarCapabilityCommand, item: CalendarItem): boolean {
  return command.taskId === item.taskId && (command.occurrenceId ?? null) === item.occurrenceId
}
