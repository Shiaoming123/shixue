import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StudyState, StudyStateV1 } from '../study/types.ts'
import type { WorkspaceStateV3 } from '../../domain/workspace/types.ts'

export const DEFAULT_WEB_DATABASE_NAME = 'meow-study'

export interface IndexedDbTodoRecord {
  id?: number
  title: string
  done: 0 | 1
  created_at: string
}

interface MeowDatabaseSchema extends DBSchema {
  todos: {
    key: number
    value: IndexedDbTodoRecord
    indexes: { 'by-created-at': string }
  }
  studyState: {
    key: string
    value: {
      key: string
      state: StudyState | StudyStateV1 | WorkspaceStateV3
    }
  }
}

const connections = new Map<string, Promise<IDBPDatabase<MeowDatabaseSchema>>>()

export function openMeowDatabase(
  databaseName = DEFAULT_WEB_DATABASE_NAME,
): Promise<IDBPDatabase<MeowDatabaseSchema>> {
  let connection = connections.get(databaseName)
  if (!connection) {
    connection = openDB<MeowDatabaseSchema>(databaseName, 2, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const todos = database.createObjectStore('todos', {
            keyPath: 'id',
            autoIncrement: true,
          })
          todos.createIndex('by-created-at', 'created_at')
        }
        if (oldVersion < 2) {
          database.createObjectStore('studyState', { keyPath: 'key' })
        }
      },
    })
    connections.set(databaseName, connection)
  }
  return connection
}
