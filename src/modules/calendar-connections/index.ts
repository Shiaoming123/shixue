import type { Module } from '../types'

const calendarConnections: Module = {
  id: 'calendarConnections',
  name: '外部日历连接',
  dependencies: ['storage'],
  platforms: ['desktop'],
}

export default calendarConnections
export { createCalendarConnectionRuntime } from '../../calendar-connections/runtime.ts'
