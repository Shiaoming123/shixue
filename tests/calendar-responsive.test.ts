import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CalendarItem } from '../src/domain/calendar/project.ts'
import {
  agendaWindow,
  agendaScrollAnchor,
  agendaScrollTop,
  createAgendaMeasurementState,
  finishAgendaMeasurementRestore,
  groupCalendarItems,
  monthOverflow,
  resolveCalendarMode,
  shouldVirtualizeAgenda,
  updateAgendaMeasurements,
} from '../src/domain/calendar/view.ts'

test('responsive calendar mode uses the exact compact boundary', () => {
  for (const width of [320, 819]) {
    assert.deepEqual(
      (['day', 'week', 'month', 'agenda'] as const).map((mode) => resolveCalendarMode(mode, width)),
      ['day', 'day', 'month', 'agenda'],
    )
  }
  for (const width of [820, 1440]) {
    assert.deepEqual(
      (['day', 'week', 'month', 'agenda'] as const).map((mode) => resolveCalendarMode(mode, width)),
      ['day', 'week', 'month', 'agenda'],
    )
  }
})

test('month overflow exposes three facts and reports only the hidden count', () => {
  assert.deepEqual(monthOverflow([]), { visible: [], hiddenCount: 0 })
  assert.equal(monthOverflow(items(3)).hiddenCount, 0)
  assert.deepEqual(monthOverflow(items(4)), { visible: items(4).slice(0, 3), hiddenCount: 1 })
  assert.equal(monthOverflow(items(9)).hiddenCount, 6)
})

test('agenda grouping trusts canonical display fields and has one deterministic within-day order', () => {
  const rows: CalendarItem[] = [
    item('timed-b', 'timed', '2026-09-08', 540),
    item('deadline-date', 'deadline-marker', '2026-09-07', null),
    item('all-day', 'all-day', '2026-09-07', null),
    item('deadline-time', 'deadline-marker', '2026-09-07', 540),
    item('timed-a', 'timed', '2026-09-07', 540),
    item('timed-early', 'timed', '2026-09-07', 480),
  ]

  const groups = groupCalendarItems(rows)
  assert.deepEqual(groups.map(({ date }) => date), ['2026-09-07', '2026-09-08'])
  assert.deepEqual(groups[0]?.items.map(({ key }) => key), [
    'all-day', 'deadline-date', 'timed-early', 'timed-a', 'deadline-time',
  ])
})

test('agenda virtualizes item rows only above 500 and fails open until measured', () => {
  assert.equal(shouldVirtualizeAgenda(500), false)
  assert.equal(shouldVirtualizeAgenda(501), true)
  const keys = ['day:2026-09-07', 'item:a', 'item:b', 'day:2026-09-08', 'item:c']
  assert.equal(agendaWindow(keys, new Map(), 40, 80), null)
  assert.equal(agendaWindow(keys, new Map(keys.map((key) => [key, 0])), 40, 80), null)

  const measured = new Map(keys.map((key, index) => [key, index % 3 === 0 ? 30 : 50]))
  assert.deepEqual(agendaWindow(keys, measured, 70, 50, 'item:c'), {
    start: 0,
    end: 5,
    before: 0,
    after: 0,
  })
  const anchor = agendaScrollAnchor(keys, measured, 95)
  assert.deepEqual(anchor, { key: 'item:b', offset: 15 })
  const resized = new Map(measured)
  resized.set('day:2026-09-07', 60)
  assert.equal(agendaScrollTop(keys, resized, anchor!), 125)
})

test('501-row agenda preserves a later focused anchor across partial width remeasurement', () => {
  const rowKeys = ['day:2026-09-07', ...Array.from({ length: 501 }, (_, index) => `item:item:${index}`)]
  const oldHeights = new Map(rowKeys.map((key) => [key, 20]))
  let measurement = updateAgendaMeasurements(createAgendaMeasurementState(), rowKeys, 0, 300, oldHeights, false).state
  const focusedKey = 'item:item:399'
  const oldScrollTop = 8007
  assert.equal(shouldVirtualizeAgenda(501), true)
  const initialWindow = agendaWindow(rowKeys, measurement.heights, oldScrollTop, 300, focusedKey)!
  assert.ok(initialWindow.start <= rowKeys.indexOf(focusedKey) && initialWindow.end > rowKeys.indexOf(focusedKey))

  const newHeights = new Map(rowKeys.map((key, index) => [key, index === 0 ? 40 : 30]))
  let update = updateAgendaMeasurements(
    measurement,
    rowKeys,
    oldScrollTop,
    360,
    new Map(rowKeys.slice(390, 411).map((key) => [key, newHeights.get(key)!])),
    true,
  )
  measurement = update.state
  assert.deepEqual(measurement.pendingAnchor, { key: focusedKey, offset: 7 })
  assert.equal(update.restore, null)
  assert.equal(agendaWindow(rowKeys, measurement.heights, oldScrollTop, 300, focusedKey), null)

  for (const [start, end] of [[0, 150], [150, 350]] as const) {
    update = updateAgendaMeasurements(
      measurement,
      rowKeys,
      oldScrollTop,
      360,
      new Map(rowKeys.slice(start, end).map((key) => [key, newHeights.get(key)!])),
      false,
    )
    measurement = update.state
    assert.equal(update.restore, null)
    assert.equal(agendaWindow(rowKeys, measurement.heights, oldScrollTop, 300, focusedKey), null)
  }

  update = updateAgendaMeasurements(
    measurement,
    rowKeys,
    oldScrollTop,
    360,
    new Map(rowKeys.slice(350).map((key) => [key, newHeights.get(key)!])),
    false,
  )
  measurement = update.state
  assert.deepEqual(update.restore, { top: 12017, generation: measurement.generation })
  measurement = finishAgendaMeasurementRestore(measurement, update.restore!.generation)
  assert.deepEqual(agendaScrollAnchor(rowKeys, measurement.heights, update.restore!.top), { key: focusedKey, offset: 7 })
  const restoredWindow = agendaWindow(rowKeys, measurement.heights, update.restore!.top, 360, focusedKey)!
  assert.ok(restoredWindow.start <= rowKeys.indexOf(focusedKey) && restoredWindow.end > rowKeys.indexOf(focusedKey))
  assert.equal(updateAgendaMeasurements(measurement, rowKeys, update.restore!.top, 360, new Map(), false).restore, null)
})

test('month and agenda components use the themed disclosure and measured window contracts', () => {
  const month = source('MonthGrid.vue')
  const agenda = source('AgendaView.vue')
  const toolbar = source('CalendarToolbar.vue')
  const workspace = source('CalendarWorkspace.vue')
  const item = source('CalendarItem.vue')

  assert.match(month, /monthOverflow/)
  assert.match(month, /<Popover\b/)
  assert.match(month, /mobile-sheet/)
  assert.match(month, /全天/)
  assert.match(month, /截止/)
  assert.doesNotMatch(month, /pointer-start|calendar\.move|calendar\.resize/)
  assert.match(agenda, /ResizeObserver/)
  assert.match(agenda, /agendaWindow/)
  assert.match(agenda, /entries\.find/)
  assert.match(agenda, /updateAgendaMeasurements/)
  assert.match(agenda, /finishAgendaMeasurementRestore/)
  assert.match(agenda, /shouldVirtualizeAgenda/)
  assert.match(agenda, /v-for="row in visibleRows"/)
  assert.match(agenda, /aria-posinset/)
  assert.match(agenda, /aria-setsize/)
  assert.doesNotMatch(agenda, /pointer-start|calendar\.move|calendar\.resize/)
  for (const label of ['日', '周', '月', '议程']) assert.match(toolbar, new RegExp(`>${label}<`))
  assert.match(toolbar, /calendar-toolbar__modes button \{ min-width: 44px; min-height: 44px; \}/)
  assert.match(toolbar, /calendar-toolbar__modes button \{ min-width: 48px; min-height: 48px; \}/)
  assert.match(workspace, /desktop-mode-selected/)
  assert.match(workspace, /resolveCalendarMode/)
  assert.doesNotMatch([month, agenda, item].join('\n'), /toLocaleDateString\('sv-SE'\)|getHours\(\)|getMinutes\(\)/)
})

function source(name: string) {
  return readFileSync(new URL(`../src/components/calendar/${name}`, import.meta.url), 'utf8')
}

function items(count: number) {
  return Array.from({ length: count }, (_, index) => item(`item:${index}`, 'timed', '2026-09-07', index))
}

function item(key: string, kind: CalendarItem['kind'], displayDate: string, displayMinute: number | null): CalendarItem {
  return {
    key,
    taskId: key,
    occurrenceId: null,
    kind,
    start: displayMinute === null ? displayDate : `${displayDate}T09:00:00+08:00`,
    end: kind === 'timed' ? `${displayDate}T10:00:00+08:00` : null,
    displayDate,
    displayMinute,
  }
}
