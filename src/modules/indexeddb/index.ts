import { createIndexedDbTodoStore } from '../../storage/todos/indexeddb'
import { registerTodoStore } from '../../storage/todos/registry'
import { createIndexedDbStudyStore } from '../../storage/study/indexeddb'
import { registerStudyStore } from '../../storage/study/registry'
import type { Module } from '../types'

/** 浏览器本地持久化适配器。 */
const indexedDb: Module = {
  id: 'indexedDb',
  name: 'IndexedDB 本地数据层',
  dependencies: ['storage'],
  platforms: ['web'],
  requiredCapabilities: ['web-storage'],
  setup() {
    registerTodoStore(createIndexedDbTodoStore())
    registerStudyStore(createIndexedDbStudyStore())
  },
}

export default indexedDb
