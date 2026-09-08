import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computed, ref } from 'vue'

test('production date projections invalidate on the existing clock tick across midnight and year boundaries', () => {
  const source = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const declarations = ['today', 'dateLabel'].map((name) => {
    const declaration = source.split('\n').find((line) => line.startsWith(`const ${name} = `))
    assert.ok(declaration, `Missing production projection ${name}`)
    return declaration
  }).join('\n')
  const first = new Date(2026, 11, 31, 23, 59, 59).getTime()
  const clock = ref(first)
  class FixedDate extends Date { constructor(value: number = first) { super(value) } }
  const projections = new Function('computed', 'clock', 'Date', `${declarations}\nreturn { today, dateLabel }`)(computed, clock, FixedDate)
  const label = (time: number) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(time)).replace('星期', '周')
  assert.equal(projections.today.value, '2026-12-31')
  assert.equal(projections.dateLabel.value, label(first))
  clock.value = new Date(2027, 0, 1, 0, 0, 1).getTime()
  assert.equal(projections.today.value, '2027-01-01', 'Today must follow the running clock without remounting.')
  assert.equal(projections.dateLabel.value, label(clock.value), 'The displayed date must agree with task and review filtering.')
})
